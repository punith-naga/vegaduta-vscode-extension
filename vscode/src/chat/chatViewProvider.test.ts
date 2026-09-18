// The chat view provider's wave-2 message handling, driven the way the
// webview drives it: messages in through onDidReceiveMessage, replies out
// through postMessage. Proves the ENFORCEMENT wiring - that under Private
// Mode the hosted API is never called - not just the refusal table.

import type * as vscode from "vscode";
import type { HostToWebview, WebviewToHost } from "../../../shared/src/webview/protocol";
import type { ApiFacade } from "../api";
import type { TokenManager } from "../auth/tokenManager";
import { PRIVATE_MODE_BLOCKED, PRIVATE_MODE_STATE_KEY, PrivateMode } from "../privacy";
import type { VegadutaSettings } from "../settings";
import { assert, assertEqual, assertIncludes, tick } from "../test/assert";
import { memoryStore } from "../test/fakes";
import { mock, mockDocument, Uri } from "../test/vscodeMock";
import { ChatViewProvider } from "./chatViewProvider";

interface Harness {
  send(message: WebviewToHost): Promise<void>;
  posted: HostToWebview[];
  apiCalls: string[];
  store: ReturnType<typeof memoryStore>;
  privateMode: PrivateMode;
  provider: ChatViewProvider;
}

function harness(opts: { private?: boolean; mode?: "jwt" | "apiKey" | null } = {}): Harness {
  const apiCalls: string[] = [];
  const mode = opts.mode === undefined ? "jwt" : opts.mode;
  const api = {
    mode: () => mode,
    streamChat: async () => {
      apiCalls.push("streamChat");
      return { sessionId: "s1" };
    },
    devChat: async () => {
      apiCalls.push("devChat");
      return { reply: "r", sessionId: "s1" };
    },
    runCode: async () => {
      apiCalls.push("runCode");
      return { ok: true, stdout: "", stderr: "", exitCode: 0, timedOut: false };
    },
    runWorkflow: async () => {
      apiCalls.push("runWorkflow");
      return { id: "run", status: "COMPLETED" };
    },
    getWorkflowRun: async () => {
      apiCalls.push("getWorkflowRun");
      return { id: "run", status: "COMPLETED" };
    },
    postJwt: async () => {
      apiCalls.push("postJwt");
      return new Response("[]", { status: 200 });
    },
    fetchLists: async () => ({ agents: [], workflows: [] }),
  } as unknown as ApiFacade;
  const tokens = {
    mode: () => mode,
    authState: () => (mode ? { signedIn: true, mode } : { signedIn: false, mode: null }),
  } as unknown as TokenManager;
  const settings = () => ({ apiBase: "https://api.vegaduta.ai", edgeEnabled: true, ollamaBaseUrl: "" }) as VegadutaSettings;
  const store = memoryStore(opts.private ? { [PRIVATE_MODE_STATE_KEY]: true } : {});
  const privateMode = new PrivateMode(store);

  const provider = new ChatViewProvider(
    Uri.file(process.platform === "win32" ? "C:\\no-such-extension" : "/no-such-extension") as unknown as vscode.Uri,
    api,
    tokens,
    settings,
    privateMode
  );

  const posted: HostToWebview[] = [];
  let onMessage: ((m: WebviewToHost) => void) | null = null;
  const view = {
    webview: {
      options: {},
      html: "",
      cspSource: "vscode-resource:",
      asWebviewUri: (u: unknown) => u,
      onDidReceiveMessage: (cb: (m: WebviewToHost) => void) => {
        onMessage = cb;
        return { dispose() {} };
      },
      postMessage: async (m: HostToWebview) => {
        posted.push(m);
        return true;
      },
    },
    onDidDispose: () => ({ dispose() {} }),
  };
  provider.resolveWebviewView(view as unknown as vscode.WebviewView);

  return {
    posted,
    apiCalls,
    store,
    privateMode,
    provider,
    async send(message) {
      assert(onMessage, "webview listener registered");
      onMessage(message);
      for (let i = 0; i < 5; i++) await tick();
    },
  };
}

beforeEach(() => mock.reset());

describe("Private Mode enforcement in the chat view provider", () => {
  it("blocks hosted chat and never calls the API", async () => {
    const h = harness({ private: true });
    await h.send({ type: "chat.send", reqId: "c1", agentId: "a", message: "my proprietary code" });
    assertEqual(h.posted, [{ type: "chat.error", reqId: "c1", message: PRIVATE_MODE_BLOCKED }], "chat.error");
    assertEqual(h.apiCalls, [], "no API call");
  });

  it("blocks knowledge search, the sandbox and workflow runs", async () => {
    const h = harness({ private: true });
    await h.send({ type: "knowledge.search", reqId: "k", query: "deploy" });
    await h.send({ type: "sdlc.run", reqId: "s", code: "print(1)", languageId: "python" });
    await h.send({ type: "workflow.run", reqId: "w", workflowId: "wf", input: "x" });
    assertEqual(h.apiCalls, [], "no API call");
    assertEqual(
      h.posted.map((m) => m.type),
      ["knowledge.result", "sdlc.run.result", "workflow.error"],
      "each answered"
    );
  });

  it("lets hosted chat through when Private Mode is off", async () => {
    const h = harness();
    await h.send({ type: "chat.send", reqId: "c2", agentId: "a", message: "hi" });
    assertEqual(h.apiCalls, ["streamChat"], "streamed");
    assertEqual(h.posted.at(-1), { type: "chat.done", reqId: "c2", sessionId: "s1" }, "done");
  });

  it("privacy.mode persists, answers privacy.state, and takes effect immediately", async () => {
    const h = harness();
    await h.send({ type: "privacy.mode", private: true });
    assertEqual(h.store.data[PRIVATE_MODE_STATE_KEY], true, "persisted");
    await h.send({ type: "chat.send", reqId: "c3", agentId: "a", message: "hi" });
    assertEqual(h.apiCalls, [], "blocked after the switch");
    await h.send({ type: "privacy.mode", private: true });
    assertEqual(
      h.posted.filter((m) => m.type === "privacy.state"),
      [
        { type: "privacy.state", private: true, enforced: true },
        { type: "privacy.state", private: true, enforced: true },
      ],
      "every request answered once, a no-op too"
    );
  });

  it("announces a persisted Private Mode right after init", async () => {
    const h = harness({ private: true });
    await h.send({ type: "ready" });
    const types = h.posted.map((m) => m.type);
    assertEqual(types.slice(0, 2), ["init", "privacy.state"], "init then privacy.state");
    const init = h.posted[0];
    assert(init.type === "init", "init");
    assertEqual(init.capabilities?.privateMode, true, "privateMode capability");
    assertEqual(init.capabilities?.reveal, true, "reveal capability");
    assertEqual(init.capabilities?.knowledge, true, "knowledge capability with a JWT");
  });

  it("does not claim knowledge for an API-key sign-in", async () => {
    const h = harness({ mode: "apiKey" });
    await h.send({ type: "ready" });
    const init = h.posted[0];
    assert(init.type === "init", "init");
    assertEqual(init.capabilities?.knowledge, false, "no knowledge");
    assertEqual(
      h.posted.some((m) => m.type === "privacy.state"),
      false,
      "no privacy.state when Private Mode is off"
    );
  });
});

describe("knowledge.search through the provider", () => {
  it("posts the search with the host's API client and answers", async () => {
    const h = harness();
    await h.send({ type: "knowledge.search", reqId: "k1", query: "runbook", topK: 3 });
    assertEqual(h.apiCalls, ["postJwt"], "one POST");
    assertEqual(h.posted, [{ type: "knowledge.result", reqId: "k1", ok: true, hits: [] }], "answered");
  });
});

describe("ui.reveal through the provider", () => {
  it("refuses a path outside the workspace with a notification", async () => {
    const h = harness();
    mock.workspaceFolders = [{ uri: Uri.file(process.cwd()), name: "ws", index: 0 }];
    await h.send({ type: "ui.reveal", path: "../../../../etc/passwd", startLine: 1, endLine: 1 });
    assertEqual(mock.shown, [], "nothing opened");
    assertEqual(mock.messages.length, 1, "one notification");
    assertIncludes(mock.messages[0].text, "outside this workspace", "why");
  });

  it("opens a workspace file and selects the clamped range", async () => {
    const h = harness();
    const root = Uri.file(process.cwd());
    mock.workspaceFolders = [{ uri: root, name: "ws", index: 0 }];
    const uri = Uri.joinPath(root, "package.json");
    mock.documents.set(uri.toString(), mockDocument(uri, "l1\nl2\nline three\nl4"));
    await h.send({ type: "ui.reveal", path: "package.json", startLine: 3, endLine: 99 });
    assertEqual(mock.messages, [], "no warning");
    assertEqual(mock.shown.length, 1, "opened");
    const sel = mock.shown[0].selection;
    assert(sel, "a selection");
    assertEqual([sel.start.line, sel.start.character, sel.end.line, sel.end.character], [2, 0, 3, 2], "lines 3..4");
    assertEqual(mock.revealed.length, 1, "scrolled into view");
  });
});

describe("host commands under Private Mode", () => {
  it("proceed when Private Mode is off", async () => {
    const h = harness();
    assertEqual(await h.provider.refuseHostedCommandWhilePrivate(), false, "not refused");
    assertEqual(mock.messages, [], "no warning");
  });

  it("proceed under Private Mode when the on-device model is ready (it answers instead)", async () => {
    const h = harness({ private: true });
    await h.send({ type: "ready" });
    await h.send({ type: "engine.status", status: { state: "ready", backend: "ollama", modelId: "qwen2.5-coder" } });
    assertEqual(await h.provider.refuseHostedCommandWhilePrivate(), false, "not refused");
    assertEqual(mock.messages, [], "no warning");
  });
});
