// Private Mode: persistence, what it refuses, and the loopback test the coding
// agent uses. The end-to-end wiring through the chat view provider is covered
// in chat/chatViewProvider.test.ts; hosted completions in
// completions/provider.test.ts.

import type { WebviewToHost } from "../../shared/src/webview/protocol";
import { assert, assertEqual } from "./test/assert";
import { memoryStore } from "./test/fakes";
import {
  isLoopbackUrl,
  PRIVATE_MODE_BLOCKED,
  PRIVATE_MODE_STATE_KEY,
  PrivateMode,
  refuseWhilePrivate,
} from "./privacy";

describe("PrivateMode", () => {
  it("is off by default and persists when turned on", async () => {
    const store = memoryStore();
    const mode = new PrivateMode(store);
    assertEqual(mode.isPrivate, false, "default off");
    const seen: boolean[] = [];
    mode.onDidChange((on) => seen.push(on));
    await mode.set(true);
    assertEqual(store.data[PRIVATE_MODE_STATE_KEY], true, "persisted");
    assertEqual(mode.isPrivate, true, "on");
    await mode.set(true);
    assertEqual(seen, [true], "no event for a no-op");
    await mode.set(false);
    assertEqual(seen, [true, false], "event on change");
  });

  it("is honoured from startup when the stored flag is on", () => {
    assertEqual(new PrivateMode(memoryStore({ [PRIVATE_MODE_STATE_KEY]: true })).isPrivate, true, "restored");
    // Anything but a literal true is not "on".
    assertEqual(new PrivateMode(memoryStore({ [PRIVATE_MODE_STATE_KEY]: "yes" })).isPrivate, false, "junk");
  });
});

describe("refuseWhilePrivate", () => {
  const hosted: WebviewToHost[] = [
    { type: "chat.send", reqId: "c", agentId: "a", message: "secret code" },
    { type: "knowledge.search", reqId: "k", query: "q" },
    { type: "sdlc.run", reqId: "s", code: "print(1)", languageId: "python" },
    { type: "workflow.run", reqId: "w", workflowId: "wf", input: "in" },
  ];

  it("refuses every hosted path with the exact wording", () => {
    const [chat, knowledge, sdlc, workflow] = hosted.map((m) => refuseWhilePrivate(m, true));
    assertEqual(chat, { type: "chat.error", reqId: "c", message: PRIVATE_MODE_BLOCKED }, "chat");
    assertEqual(knowledge, { type: "knowledge.result", reqId: "k", ok: false, reason: PRIVATE_MODE_BLOCKED }, "knowledge");
    assert(sdlc?.type === "sdlc.run.result" && sdlc.ok === false && sdlc.reqId === "s", "sandbox");
    assertEqual(workflow, { type: "workflow.error", reqId: "w", message: PRIVATE_MODE_BLOCKED }, "workflow");
    assertEqual(PRIVATE_MODE_BLOCKED, "Private Mode is on - this runs on your machine only", "wording");
  });

  it("lets everything through when Private Mode is off", () => {
    for (const m of hosted) assertEqual(refuseWhilePrivate(m, false), null, m.type);
  });

  it("never refuses local paths", () => {
    const local: WebviewToHost[] = [
      { type: "ready" },
      { type: "context.request", reqId: "r", kinds: ["file", "terminal"] },
      { type: "ui.reveal", path: "src/a.ts", startLine: 1, endLine: 2 },
      { type: "ui.insert", text: "x" },
      { type: "ui.copy", text: "x" },
      { type: "privacy.mode", private: false },
      { type: "engine.result", reqId: "e", ok: true, text: "local answer" },
    ];
    for (const m of local) assertEqual(refuseWhilePrivate(m, true), null, m.type);
  });
});

describe("isLoopbackUrl", () => {
  it("accepts this machine only", () => {
    for (const u of ["http://127.0.0.1:11434", "http://localhost:1234/v1", "http://[::1]:8080", "http://127.1.2.3"]) {
      assert(isLoopbackUrl(u), u);
    }
    for (const u of ["https://api.groq.com/openai", "http://192.168.1.10:11434", "http://localhost.evil.com", "not a url"]) {
      assert(!isLoopbackUrl(u), u);
    }
  });
});
