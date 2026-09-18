// Host side of the shared webview protocol (clients/shared/src/webview/
// protocol.ts). The webview runs the shared chat bundle (media/webview/,
// copied from clients/shared/dist/webview by esbuild.mjs) and, when
// vegaduta.edge.enabled, the on-device engine host. Tokens never enter the
// webview: SSE streaming happens here and is relayed as chat.chunk messages.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";
import { toSandboxLanguage } from "../../../shared/src/api/sdlc";
import { TERMINAL_RUN_STATUSES } from "../../../shared/src/api/types";
import type {
  AuthState,
  ContextItem,
  ContextKind,
  EngineStatus,
  HostToWebview,
  LocalTaskKind,
  WebviewToHost,
} from "../../../shared/src/webview/protocol";
import { ApiFacade, errorMessage } from "../api";
import type { TokenManager } from "../auth/tokenManager";
import { PRIVATE_MODE_BLOCKED, type PrivateMode, refuseWhilePrivate } from "../privacy";
import type { VegadutaSettings } from "../settings";
import {
  type ContextOutcome,
  diagnosticsContext,
  diffContext,
  fileContext,
  getGitApi,
  gitlogContext,
  hostCapabilities,
  pickRepository,
  selectionContext,
  terminalContext,
} from "./hostContext";
import { searchKnowledge } from "./knowledge";
import { clampLines, resolveRevealPath } from "./reveal";

/** A prompt a host command stages in the chat composer (ui.prefill). */
export interface PrefillRequest {
  text: string;
  context?: ContextKind[];
  send?: boolean;
  /** Source Control title-bar invocations pass their repository so the diff
   * and the commit-message box are the repository the person clicked on. */
  repositoryRoot?: vscode.Uri;
}

export interface EngineRunResult {
  ok: boolean;
  text?: string;
  reason?: string;
}

interface EnginePayload {
  text: string;
  languageId?: string;
  suffix?: string;
  systemPrompt?: string;
}

const WORKFLOW_POLL_MS = 2000;
const WORKFLOW_WATCH_LIMIT_MS = 30 * 60_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = "vegaduta.chat";

  private view: vscode.WebviewView | null = null;
  private webviewReady = false;

  private engine: EngineStatus = { state: "unavailable", detail: "Chat view not opened yet" };
  private readonly engineEmitter = new vscode.EventEmitter<EngineStatus>();
  readonly onDidChangeEngineStatus = this.engineEmitter.event;

  private readonly chatAborts = new Map<string, AbortController>();
  private readonly enginePending = new Map<string, (result: EngineRunResult) => void>();
  private hostReqCounter = 0;

  /** True once init has been POSTED for the current webview. Messages that
   * only make sense after init (ui.prefill) wait in `afterInit` until then. */
  private initPosted = false;
  private afterInit: HostToWebview[] = [];

  /** The last real text editor, so "the file I was just in" survives focus
   * moving into the chat view even if activeTextEditor ever clears. */
  private lastEditor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
  private readonly editorSub = vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (editor) this.lastEditor = editor;
  });

  /** Set by a Source Control title-bar command; used for that command's diff
   * and commit message. */
  private repositoryHint: vscode.Uri | undefined;

  private readonly privacySub: vscode.Disposable;
  private privacyFromWebview = false;

  dispose(): void {
    this.engineEmitter.dispose();
    this.editorSub.dispose();
    this.privacySub.dispose();
  }

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly api: ApiFacade,
    private readonly tokens: TokenManager,
    private readonly getSettings: () => VegadutaSettings,
    private readonly privateMode: PrivateMode
  ) {
    // Private Mode can change outside the webview (the status bar item, the
    // command palette); keep an open webview's toggle in step.
    this.privacySub = privateMode.onDidChange((on) => {
      if (this.initPosted && !this.privacyFromWebview) {
        this.post({ type: "privacy.state", private: on, enforced: true });
      }
    });
  }

  /** Whether Private Mode is on (commands and completions check this). */
  get isPrivate(): boolean {
    return this.privateMode.isPrivate;
  }

  /** For host commands that would reach the platform: true (after telling the
   * person why) when Private Mode is on and no on-device model is ready to
   * take the prompt instead. With a local model ready, the chat app runs the
   * prompt on it, so the command proceeds. The engine lives in the chat view,
   * so a closed view is opened first and given a few seconds to find the
   * local model before the answer is "no". */
  async refuseHostedCommandWhilePrivate(): Promise<boolean> {
    // A method, not an inline comparison: the engine state changes while
    // this awaits, which TypeScript's narrowing cannot see.
    const ready = (): boolean => this.engine.state === "ready";
    if (!this.privateMode.isPrivate || ready()) return false;
    if (await this.reveal()) {
      for (let i = 0; i < 50 && !ready(); i++) await delay(100);
      if (ready()) return false;
    }
    void vscode.window.showWarningMessage(
      `VegaDuta: ${PRIVATE_MODE_BLOCKED}, and no on-device model is ready. Start your local model ` +
        "server or download an on-device model, or turn Private Mode off."
    );
    return true;
  }

  get engineStatus(): EngineStatus {
    return this.engine;
  }

  // --- WebviewViewProvider ---------------------------------------------------

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    view.webview.html = this.buildHtml(view.webview);
    view.webview.onDidReceiveMessage((message: WebviewToHost) => {
      void this.onMessage(message);
    });
    view.onDidDispose(() => {
      this.view = null;
      this.webviewReady = false;
      this.initPosted = false;
      this.afterInit = [];
      for (const controller of this.chatAborts.values()) controller.abort();
      this.chatAborts.clear();
      for (const resolve of this.enginePending.values()) {
        resolve({ ok: false, reason: "view-disposed" });
      }
      this.enginePending.clear();
      this.setEngineStatus({ state: "unavailable", detail: "Chat view closed" });
    });
  }

  private buildHtml(webview: vscode.Webview): string {
    const webviewDir = join(this.extensionUri.fsPath, "media", "webview");
    const htmlPath = join(webviewDir, "index.html");
    if (!existsSync(htmlPath)) {
      return `<!doctype html><html><body style="font-family: var(--vscode-font-family); padding: 1rem;">
        <p><strong>VegaDuta chat UI is not built.</strong></p>
        <p>Run <code>npm run build:webview</code> in <code>clients/shared</code>, then
        <code>npm run build</code> in <code>clients/vscode</code>, and reload.</p>
      </body></html>`;
    }

    const mediaUri = vscode.Uri.joinPath(this.extensionUri, "media", "webview");
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, "chat.css"));
    const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, "chat.js"));
    const { apiBase } = this.getSettings();

    // connect-src: the platform API (manifest fetch by the engine host), the
    // Hugging Face CDN hosts WebLLM pulls weights/wasm from, and local
    // loopback for the Ollama/LM Studio probe. script-src needs
    // 'wasm-unsafe-eval' or WebAssembly.instantiate (WebLLM) is blocked under
    // default-src 'none'; worker-src blob: covers WebLLM's worker spawns.
    const csp = [
      "default-src 'none'",
      `img-src data: ${webview.cspSource}`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src ${webview.cspSource} 'wasm-unsafe-eval'`,
      `font-src ${webview.cspSource}`,
      "worker-src blob:",
      `connect-src ${apiBase} https://huggingface.co https://*.hf.co https://raw.githubusercontent.com https://cdn-lfs.huggingface.co http://127.0.0.1:*`,
    ].join("; ");

    return readFileSync(htmlPath, "utf8")
      .replace(
        "<head>",
        `<head>\n  <meta http-equiv="Content-Security-Policy" content="${csp}" />`
      )
      .replace('href="chat.css"', `href="${cssUri.toString()}"`)
      .replace('src="chat.js"', `src="${jsUri.toString()}"`);
  }

  // --- webview -> host -------------------------------------------------------

  private async onMessage(message: WebviewToHost): Promise<void> {
    // Private Mode: hosted paths are refused HERE, whatever the webview does.
    const refusal = refuseWhilePrivate(message, this.privateMode.isPrivate);
    if (refusal) {
      this.post(refusal);
      return;
    }
    switch (message.type) {
      case "ready":
        this.webviewReady = true;
        await this.sendInit();
        break;
      case "auth.signIn":
        await vscode.commands.executeCommand("vegaduta.signIn");
        break;
      case "auth.signOut":
        await vscode.commands.executeCommand("vegaduta.signOut");
        break;
      case "chat.send":
        await this.handleChatSend(message.reqId, message.agentId, message.message, message.sessionId ?? null);
        break;
      case "chat.abort":
        this.chatAborts.get(message.reqId)?.abort();
        break;
      case "workflow.run":
        await this.watchWorkflow(message.reqId, message.workflowId, message.input);
        break;
      case "engine.status":
        this.setEngineStatus(message.status);
        break;
      case "engine.result": {
        const resolve = this.enginePending.get(message.reqId);
        if (resolve) {
          this.enginePending.delete(message.reqId);
          resolve({ ok: message.ok, text: message.text, reason: message.reason });
        }
        break;
      }
      case "download.start":
      case "download.delete":
        // Downloads and deletes run entirely inside the webview: the chat
        // app's model panel calls its own engine host directly (WebGPU and
        // Cache Storage live in the webview, not in the extension host).
        // These messages exist for hosts that proxy downloads. Not us.
        break;
      case "ui.insert":
        await this.insertAtCursor(message.text);
        break;
      case "ui.copy":
        await vscode.env.clipboard.writeText(message.text);
        break;
      case "ui.openExternal": {
        // Only http(s) - the webview is sandboxed but stay defensive about
        // scheme-based command injection (vscode://, file:// ...).
        if (/^https?:\/\//i.test(message.url)) {
          await vscode.env.openExternal(vscode.Uri.parse(message.url));
        }
        break;
      }
      case "sdlc.run":
        await this.handleSdlcRun(message.reqId, message.code, message.languageId);
        break;
      case "context.request":
        await this.handleContextRequest(message.reqId, message.kinds);
        break;
      case "ui.newFile":
        await this.openNewFile(message.text, message.languageId);
        break;
      case "ui.setCommitMessage":
        await this.setCommitMessage(message.text);
        break;
      case "ui.reveal":
        await this.revealRange(message.path, message.startLine, message.endLine);
        break;
      case "knowledge.search":
        this.post(
          await searchKnowledge(
            { mode: () => this.api.mode(), post: (path, body, signal) => this.api.postJwt(path, body, signal) },
            message
          )
        );
        break;
      case "privacy.mode":
        // Answered here, always (even a no-op, even before init has gone
        // out), so the webview is never left waiting; the onDidChange
        // listener stays quiet for a change the webview itself asked for.
        this.privacyFromWebview = true;
        try {
          await this.privateMode.set(message.private === true);
        } finally {
          this.privacyFromWebview = false;
        }
        this.post({ type: "privacy.state", private: this.privateMode.isPrivate, enforced: true });
        break;
    }
  }

  // --- Code Tour -------------------------------------------------------------

  /** Open a workspace file (or the active editor) and select a 1-based
   * inclusive line range. Paths that escape the workspace are refused. */
  private async revealRange(path: string | undefined, startLine: number, endLine: number): Promise<void> {
    let document: vscode.TextDocument;
    if (path && path.trim()) {
      const target = await resolveRevealPath(path, vscode.workspace.workspaceFolders ?? []);
      if ("reason" in target) {
        void vscode.window.showWarningMessage(`VegaDuta Code Tour: ${target.reason}.`);
        return;
      }
      try {
        document = await vscode.workspace.openTextDocument(target.uri);
      } catch (err) {
        void vscode.window.showWarningMessage(`VegaDuta Code Tour: could not open ${path}: ${errorMessage(err)}`);
        return;
      }
    } else {
      const editor = this.activeEditor();
      if (!editor) {
        void vscode.window.showInformationMessage("VegaDuta Code Tour: open a file first.");
        return;
      }
      document = editor.document;
    }
    const { start, end } = clampLines(startLine, endLine, document.lineCount);
    const range = new vscode.Range(start, 0, end, document.lineAt(end).range.end.character);
    const shown = await vscode.window.showTextDocument(document, {
      selection: range,
      preview: true,
      viewColumn: vscode.ViewColumn.Active,
    });
    shown.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  // --- context attachments ---------------------------------------------------

  private activeEditor(): vscode.TextEditor | undefined {
    const active = vscode.window.activeTextEditor;
    if (active) return active;
    // Drop a remembered editor whose document has since been closed.
    if (this.lastEditor && !this.lastEditor.document.isClosed) return this.lastEditor;
    return undefined;
  }

  /** Build one context kind. Public so host commands can check up front
   * ("there are no uncommitted changes") instead of sending an empty prompt. */
  async collectContext(kind: ContextKind, repositoryRoot?: vscode.Uri): Promise<ContextOutcome> {
    const editor = this.activeEditor();
    switch (kind) {
      case "file":
        return fileContext(editor);
      case "selection":
        return selectionContext(editor);
      case "diagnostics":
        return diagnosticsContext(editor);
      case "diff":
        return diffContext(repositoryRoot ?? this.repositoryHint, editor?.document.uri);
      case "gitlog":
        return gitlogContext(repositoryRoot ?? this.repositoryHint, editor?.document.uri);
      case "terminal":
        return terminalContext();
      case "page":
      case "pageElements":
        return { reason: "VS Code has no browser page to attach" };
      default:
        // Kinds added to the contract after this host was built. Declared
        // unsupported (and never listed in capabilities.context) rather than
        // left to fall through to an undefined outcome.
        return { reason: `Attaching "${kind}" is not supported in this version of the extension` };
    }
  }

  private async handleContextRequest(reqId: string, kinds: ContextKind[]): Promise<void> {
    const items: ContextItem[] = [];
    const missing: Array<{ kind: ContextKind; reason: string }> = [];
    for (const kind of [...new Set(kinds)]) {
      let outcome: ContextOutcome;
      try {
        outcome = await this.collectContext(kind);
      } catch (err) {
        outcome = { reason: `Could not read the ${kind}: ${errorMessage(err)}` };
      }
      if ("item" in outcome) items.push(outcome.item);
      else missing.push({ kind, reason: outcome.reason });
    }
    this.post({ type: "context.result", reqId, items, ...(missing.length ? { missing } : {}) });
  }

  private async openNewFile(text: string, languageId?: string): Promise<void> {
    let doc: vscode.TextDocument;
    try {
      doc = await vscode.workspace.openTextDocument({ content: text, language: languageId });
    } catch {
      // A language id no installed extension knows - still open it, as plain text.
      doc = await vscode.workspace.openTextDocument({ content: text });
    }
    await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Active });
  }

  /** Write into the git commit-message box. Never commits: the person does. */
  private async setCommitMessage(text: string): Promise<void> {
    const git = await getGitApi();
    const repo =
      "api" in git ? pickRepository(git.api, this.repositoryHint, this.activeEditor()?.document.uri) : null;
    if (!repo) {
      await vscode.env.clipboard.writeText(text);
      const reason = "reason" in git ? git.reason : "This folder is not a git repository";
      void vscode.window.showWarningMessage(
        `VegaDuta: ${reason}, so the commit message was copied to the clipboard instead.`
      );
      return;
    }
    repo.inputBox.value = text.trim();
    await vscode.commands.executeCommand("workbench.view.scm");
    void vscode.window.showInformationMessage(
      "VegaDuta: commit message written to Source Control. Review it, then commit when you are ready."
    );
  }

  /** Stage a prompt in the composer and, with send, submit it once the
   * requested context has arrived. Works signed in (hosted agent) and signed
   * out (on-device model) - the chat app routes it. Resolves false when the
   * chat view could not be opened. */
  async prefill(request: PrefillRequest): Promise<boolean> {
    this.repositoryHint = request.repositoryRoot;
    const opened = await this.reveal();
    if (!opened) {
      void vscode.window.showErrorMessage(
        "VegaDuta: the chat view did not open. Open it from the VegaDuta icon in the activity bar and try again."
      );
      return false;
    }
    this.postAfterInit({
      type: "ui.prefill",
      text: request.text,
      ...(request.context?.length ? { context: request.context } : {}),
      ...(request.send ? { send: true } : {}),
    });
    return true;
  }

  private postAfterInit(message: HostToWebview): void {
    if (this.initPosted) this.post(message);
    else this.afterInit.push(message);
  }

  private async handleSdlcRun(reqId: string, code: string, languageId?: string): Promise<void> {
    const language = toSandboxLanguage(languageId);
    if (!language) {
      this.post({
        type: "sdlc.run.result",
        reqId,
        ok: false,
        reason: "unavailable",
        detail: languageId
          ? `"${languageId}" isn't runnable here - the sandbox supports python, node (JS/TS), and bash.`
          : "Tag the code block with a language, e.g. ```python, so the sandbox knows what to run.",
      });
      return;
    }
    const result = await this.api.runCode(code, language);
    this.post({ type: "sdlc.run.result", reqId, ...result });
  }

  private async handleChatSend(
    reqId: string,
    agentId: string,
    message: string,
    sessionId: string | null
  ): Promise<void> {
    if (this.api.mode() === "apiKey") {
      // dev/v1 is blocking by design - deliver the reply as one chunk. Still
      // register the controller so the webview's Stop button (chat.abort)
      // isn't a silent no-op while this fetch is in flight.
      const devController = new AbortController();
      this.chatAborts.set(reqId, devController);
      try {
        const result = await this.api.devChat(agentId, message, sessionId ?? undefined, devController.signal);
        this.post({ type: "chat.chunk", reqId, delta: result.reply });
        this.post({ type: "chat.done", reqId, sessionId: result.sessionId ?? null });
      } catch (err) {
        if (devController.signal.aborted) {
          this.post({ type: "chat.done", reqId, sessionId });
        } else {
          this.post({ type: "chat.error", reqId, message: errorMessage(err) });
        }
      } finally {
        this.chatAborts.delete(reqId);
      }
      return;
    }

    const controller = new AbortController();
    this.chatAborts.set(reqId, controller);
    try {
      const result = await this.api.streamChat({
        agentId,
        message,
        sessionId,
        signal: controller.signal,
        onChunk: (delta) => this.post({ type: "chat.chunk", reqId, delta }),
      });
      this.post({ type: "chat.done", reqId, sessionId: result.sessionId });
    } catch (err) {
      if (controller.signal.aborted) {
        // User pressed Stop - what streamed so far stays; not an error.
        this.post({ type: "chat.done", reqId, sessionId });
      } else {
        this.post({ type: "chat.error", reqId, message: errorMessage(err) });
      }
    } finally {
      this.chatAborts.delete(reqId);
    }
  }

  private async watchWorkflow(reqId: string, workflowId: string, input: string): Promise<void> {
    try {
      let run = await this.api.runWorkflow(workflowId, input);
      this.post({ type: "workflow.status", reqId, run });
      const deadline = Date.now() + WORKFLOW_WATCH_LIMIT_MS;
      while (!TERMINAL_RUN_STATUSES.has(run.status) && this.view) {
        if (Date.now() > deadline) {
          this.post({
            type: "workflow.error",
            reqId,
            message: "Stopped watching after 30 minutes - check the run in the web console.",
          });
          return;
        }
        await delay(WORKFLOW_POLL_MS);
        run = await this.api.getWorkflowRun(workflowId, run.id);
        this.post({ type: "workflow.status", reqId, run });
      }
    } catch (err) {
      this.post({ type: "workflow.error", reqId, message: errorMessage(err) });
    }
  }

  private async insertAtCursor(text: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      await vscode.env.clipboard.writeText(text);
      void vscode.window.showInformationMessage("VegaDuta: no active editor - copied to clipboard instead.");
      return;
    }
    await editor.edit((edit) => {
      for (const selection of editor.selections) {
        edit.insert(selection.active, text);
      }
    });
  }

  // --- host -> webview -------------------------------------------------------

  private post(message: HostToWebview): void {
    void this.view?.webview.postMessage(message);
  }

  private async sendInit(): Promise<void> {
    this.initPosted = false;
    const settings = this.getSettings();
    const auth: AuthState = this.tokens.authState();
    const [lists, capabilities] = await Promise.all([
      auth.signedIn ? this.api.fetchLists() : Promise.resolve({ agents: [], workflows: [] }),
      hostCapabilities({ authMode: this.tokens.mode() }),
    ]);
    this.post({
      type: "init",
      platform: "vscode",
      apiBase: settings.apiBase,
      auth,
      agents: lists.agents,
      workflows: lists.workflows,
      hostLocalEngine: settings.edgeEnabled,
      // Seed the webview's engine kv from settings BEFORE the engine host
      // starts (the chat app applies these to localStorage first). This is
      // what makes vegaduta.ollama.baseUrl live and keeps the manifest fetch
      // on the configured environment instead of the production default.
      edgeSettings: {
        "edge.apiBase": settings.apiBase,
        "edge.ollamaBaseUrl": settings.ollamaBaseUrl || null,
      },
      capabilities,
    });
    this.initPosted = true;
    // Honour a persisted Private Mode from the first message on. Only sent
    // when ON: a webview that itself remembers Private Mode and asks for it
    // (privacy.mode) wins over a host that does not - failing towards private.
    if (this.privateMode.isPrivate) this.post({ type: "privacy.state", private: true, enforced: true });
    const queued = this.afterInit;
    this.afterInit = [];
    for (const message of queued) this.post(message);
  }

  /** Open the chat view's on-device model panel (Download / Use / Delete). */
  async showModels(): Promise<void> {
    await this.reveal();
    this.post({ type: "ui.showModels" });
  }

  /** After sign-in/sign-out. Sends auth.changed + agents.changed instead of
   * a fresh init because a second init would restart the webview engine
   * host (main.ts calls startEngineHost on every init). */
  async onAuthChanged(): Promise<void> {
    const auth = this.tokens.authState();
    this.post({ type: "auth.changed", auth });
    const lists = auth.signedIn ? await this.api.fetchLists() : { agents: [], workflows: [] };
    this.post({ type: "agents.changed", agents: lists.agents, workflows: lists.workflows });
  }

  /** Configuration changed. The CSP/apiBase baked into the current webview
   * HTML stays until the view is reopened; auth/list state refreshes now. */
  async onSettingsChanged(): Promise<void> {
    await this.onAuthChanged();
  }

  /** Focus the view and wait for the webview to boot (first `ready`).
   * Resolves false if it has not booted within 5 s. */
  async reveal(): Promise<boolean> {
    await vscode.commands.executeCommand(`${ChatViewProvider.viewId}.focus`);
    for (let i = 0; i < 50 && !this.webviewReady; i++) {
      await delay(100);
    }
    return this.webviewReady;
  }

  /** Stage a selection in the chat composer (see commands/selection.ts). */
  sendSelectionContext(text: string, languageId?: string, fileName?: string): void {
    this.post({ type: "selection.context", text, languageId, fileName });
  }

  /** Preselect an agent picked from the command palette. The frozen protocol
   * has no explicit "select agent" message; renderAgents() keeps a
   * still-valid selection and otherwise falls back to the FIRST list entry,
   * so moving the pick to the front selects it on a fresh view. If the user
   * already chose a different agent in the view, their choice wins - accepted
   * tradeoff over widening the contract. */
  async preselectAgent(agentId: string): Promise<void> {
    const lists = await this.api.fetchLists();
    const picked = lists.agents.find((a) => a.id === agentId);
    const agents = picked
      ? [picked, ...lists.agents.filter((a) => a.id !== agentId)]
      : lists.agents;
    this.post({ type: "agents.changed", agents, workflows: lists.workflows });
  }

  private setEngineStatus(status: EngineStatus): void {
    this.engine = status;
    this.engineEmitter.fire(status);
  }

  /** Run a local-engine task inside the webview (completions provider and
   * quick actions call this). Resolves {ok:false} - never rejects - on
   * timeout, cancellation, disposal, or engine-off. */
  requestEngine(
    kind: LocalTaskKind,
    payload: EnginePayload,
    timeoutMs: number,
    cancellation?: vscode.CancellationToken
  ): Promise<EngineRunResult> {
    if (!this.view || this.engine.state !== "ready") {
      return Promise.resolve({ ok: false, reason: "engine-unavailable" });
    }
    this.hostReqCounter += 1;
    const reqId = `host-${this.hostReqCounter}`;
    return new Promise<EngineRunResult>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      let cancelSub: vscode.Disposable | null = null;
      const finish = (result: EngineRunResult): void => {
        if (timer) clearTimeout(timer);
        cancelSub?.dispose();
        this.enginePending.delete(reqId);
        resolve(result);
      };
      this.enginePending.set(reqId, finish);
      timer = setTimeout(() => {
        this.post({ type: "engine.abort", reqId });
        finish({ ok: false, reason: "timeout" });
      }, timeoutMs);
      cancelSub =
        cancellation?.onCancellationRequested(() => {
          this.post({ type: "engine.abort", reqId });
          finish({ ok: false, reason: "cancelled" });
        }) ?? null;
      this.post({ type: "engine.request", reqId, kind, payload });
    });
  }
}
