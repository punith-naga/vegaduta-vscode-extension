// "VegaDuta: Start a Coding Task" - the command that turns this extension from
// a chat client into an agent.
//
// The whole path is local and free by construction: an OpenAI-compatible server
// the user already runs, or a key they own. Nothing here calls the VegaDuta
// platform, needs an account, or consumes a quota. The hosted platform stays
// the paid/team path (code-intel, shared repos, CI) - it is not on this road.

import * as vscode from "vscode";
import { buildCodingSystemPrompt } from "../../../shared/src/agent/codingTools";
import { runAgentLoop } from "../../../shared/src/agent/loop";
import { createOpenAiCompatibleModel } from "../../../shared/src/agent/openAiCompatibleModel";
import type { AgentEvent, AgentMessage } from "../../../shared/src/agent/types";
import { isLoopbackUrl, PRIVATE_MODE_BLOCKED } from "../privacy";
import { readSettings } from "../settings";
import { AGENT_API_KEY_SECRET, chooseAgentModel, resolveAgentEndpoint } from "./endpoint";
import { setUpCodingAgent } from "./setup";
import { ApprovalGate, WorkspaceToolExecutor } from "./workspaceTools";

export { AGENT_API_KEY_SECRET } from "./endpoint";

/** Files that, when present, tell the agent how this project expects to be
 * worked in. Read in order; the first two that exist are included. */
const CONVENTION_FILES = ["AGENTS.md", "CLAUDE.md", ".cursorrules", "CONTRIBUTING.md"];
const MAX_CONVENTION_CHARS = 4_000;

async function pickWorkspaceFolder(): Promise<vscode.WorkspaceFolder | null> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) return null;
  if (folders.length === 1) return folders[0];
  const picked = await vscode.window.showWorkspaceFolderPick({
    placeHolder: "Which folder should the agent work in?",
  });
  return picked ?? null;
}

async function readConventions(root: vscode.Uri): Promise<string> {
  const decoder = new TextDecoder();
  const found: string[] = [];
  for (const name of CONVENTION_FILES) {
    if (found.length >= 2) break;
    try {
      const text = decoder.decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, name)));
      found.push(`--- ${name} ---\n${text.slice(0, MAX_CONVENTION_CHARS)}`);
    } catch {
      // absent is the common case, not an error
    }
  }
  return found.join("\n\n");
}

/** Human-readable, actionable reasons - never a raw provider error. */
function explainFailure(reason: string, detail: string | undefined, baseUrl: string): string {
  switch (reason) {
    case "no-model":
      return (
        `No model answered at ${baseUrl}. Run "VegaDuta: Set Up the Coding Agent" - it finds whichever ` +
        "local server is running and tells you what to do when none is."
      );
    case "no-tool-support":
      return (
        "That model cannot call tools, so it cannot edit files. Pick a tool-calling model - " +
        "qwen2.5-coder, llama3.1, mistral-nemo and devstral all work locally."
      );
    case "step-budget-exceeded":
      return "The agent hit its step limit without finishing. Narrow the task, or raise vegaduta.agent.maxSteps.";
    case "aborted":
      return "Cancelled.";
    case "model-refused":
      return "The model declined to answer this request.";
    case "model-failed":
      // `detail` carries the provider's raw response body, and AgentFailure.detail
      // says in its own doc comment that it is for logs and never for the UI.
      // The body goes to the output channel; the notification gets a status line.
      return `The model endpoint rejected the request${
        /^\s*(\d{3})\b/.exec(detail ?? "") ? ` (HTTP ${/^\s*(\d{3})\b/.exec(detail ?? "")?.[1]})` : ""
      }. See the VegaDuta Agent output channel for the response.`;
    default:
      return "The model call failed. See the VegaDuta Agent output channel for details.";
  }
}

export async function startCodingTask(
  context: vscode.ExtensionContext,
  isPrivate: () => boolean = () => false
): Promise<void> {
  const folder = await pickWorkspaceFolder();
  if (!folder) {
    void vscode.window.showWarningMessage("VegaDuta: open a folder first - the agent works inside a workspace.");
    return;
  }

  // Asked before the task prompt, not after: a first-time user who is about to
  // be told "install Ollama" should not first have to compose a task. There is
  // no once-only flag on this - "no endpoint" IS the first-run condition, and a
  // user who still has nothing running on the second attempt needs the same
  // help, not a raw connection error.
  let resolved = await resolveAgentEndpoint();
  if (!resolved) {
    const ready = await setUpCodingAgent(context, { offerToStart: false });
    if (!ready) return;
    resolved = await resolveAgentEndpoint();
    if (!resolved) return;
  }
  const endpoint = resolved;

  // Private Mode: the agent sends the task and file contents to its endpoint,
  // so only a server on this machine is allowed (discovery only ever finds
  // loopback ones; a vegaduta.agent.baseUrl BYOK provider is not).
  if (isPrivate() && !isLoopbackUrl(endpoint.baseUrl)) {
    void vscode.window.showWarningMessage(
      `VegaDuta: ${PRIVATE_MODE_BLOCKED}. The coding agent is set to ${endpoint.baseUrl}, which is not on ` +
        "this machine - point vegaduta.agent.baseUrl at a local server, or turn Private Mode off."
    );
    return;
  }

  const editor = vscode.window.activeTextEditor;
  const task = await vscode.window.showInputBox({
    title: "VegaDuta coding task",
    prompt: "What should the agent do? It can read, search, edit and run commands in this workspace.",
    placeHolder: "e.g. the date parser drops timezones - find why and fix it, then run the tests",
    ignoreFocusOut: true,
  });
  if (!task?.trim()) return;

  const settings = readSettings();
  const apiKey = await context.secrets.get(AGENT_API_KEY_SECRET);
  const model = createOpenAiCompatibleModel({
    baseUrl: endpoint.baseUrl,
    model: chooseAgentModel(endpoint, settings.agent.model),
    apiKey,
  });

  const output = vscode.window.createOutputChannel("VegaDuta Agent");
  output.show(true);
  output.appendLine(`Task: ${task.trim()}`);
  output.appendLine(`Workspace: ${folder.uri.fsPath}`);
  output.appendLine(`Model: ${model.id}`);
  output.appendLine(
    `Endpoint: ${endpoint.source === "discovered" ? `${endpoint.label}, found by probing` : "vegaduta.agent.baseUrl"}`
  );
  output.appendLine("");

  const approvals = new ApprovalGate({
    edit: settings.agent.autoApproveEdits,
    command: settings.agent.autoApproveCommands,
  });
  const executor = new WorkspaceToolExecutor(folder.uri, approvals, (line) => output.appendLine(`  ${line}`));

  const messages: AgentMessage[] = [
    {
      role: "system",
      content: buildCodingSystemPrompt({
        workspaceName: folder.name,
        projectNotes: await readConventions(folder.uri),
        activeFile: editor ? vscode.workspace.asRelativePath(editor.document.uri) : undefined,
      }),
    },
    { role: "user", content: task.trim() },
  ];

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "VegaDuta agent", cancellable: true },
    async (progress, token) => {
      const controller = new AbortController();
      token.onCancellationRequested(() => controller.abort());

      const onEvent = (event: AgentEvent): void => {
        switch (event.type) {
          case "step":
            progress.report({ message: `step ${event.index}/${event.of}` });
            break;
          case "assistant":
            output.appendLine(event.content);
            break;
          case "tool-start":
            output.appendLine(`> ${event.call.name} ${JSON.stringify(event.call.args).slice(0, 180)}`);
            break;
          case "tool-end":
            if (event.outcome.failed) output.appendLine(`  ! ${event.outcome.content.slice(0, 300)}`);
            break;
          default:
            break;
        }
      };

      const result = await runAgentLoop({
        model,
        executor,
        messages,
        maxSteps: settings.agent.maxSteps,
        signal: controller.signal,
        onEvent,
      });

      output.appendLine("");
      if (result.ok) {
        output.appendLine(`Done in ${result.stepsUsed} step(s).`);
        // The agent's own summary is the answer; the output channel already
        // holds the trace, so the notification stays short.
        void vscode.window.showInformationMessage(
          result.answer.trim().split("\n")[0]?.slice(0, 200) || "VegaDuta agent finished.",
          "Show details"
        ).then((choice) => {
          if (choice === "Show details") output.show(true);
        });
        return;
      }

      const message = approvals.wasCancelled
        ? "Stopped at your request."
        : explainFailure(result.reason, result.detail, endpoint.baseUrl);
      output.appendLine(`Stopped: ${result.reason}${result.detail ? ` - ${result.detail}` : ""}`);
      void vscode.window.showWarningMessage(`VegaDuta agent: ${message}`);
    }
  );
}

/** Stores the BYOK key in SecretStorage. Clearing it (empty input) is allowed. */
export async function setAgentApiKey(context: vscode.ExtensionContext): Promise<void> {
  const value = await vscode.window.showInputBox({
    title: "VegaDuta agent API key",
    prompt: "Key for the OpenAI-compatible provider in vegaduta.agent.baseUrl. Leave empty to clear. Local servers need no key.",
    password: true,
    ignoreFocusOut: true,
  });
  if (value === undefined) return;
  if (value.trim() === "") {
    await context.secrets.delete(AGENT_API_KEY_SECRET);
    void vscode.window.showInformationMessage("VegaDuta: agent API key cleared.");
    return;
  }
  await context.secrets.store(AGENT_API_KEY_SECRET, value.trim());
  void vscode.window.showInformationMessage("VegaDuta: agent API key saved to the OS secret store.");
}
