// hostContext: labels, truncation and reasons for the context kinds, plus the
// capabilities this host declares. Runs against the vscode mock
// (src/test/vscodeMock.ts) - see vitest.config.mjs.

import { CONTEXT_ITEM_MAX_CHARS } from "../../../shared/src/webview/protocol";
import { assert, assertEqual, assertIncludes } from "../test/assert";
import { mock, Selection, Uri } from "../test/vscodeMock";
import {
  GITLOG_MAX_COMMITS,
  type GitCommit,
  fileContext,
  formatCommit,
  gitlogContext,
  hostCapabilities,
  selectionContext,
  terminalContext,
  type TerminalDeps,
} from "./hostContext";

const ROOT = Uri.file(process.platform === "win32" ? "C:\\ws" : "/ws");

function commit(i: number, message = `feat: change ${i}`): GitCommit {
  return { hash: `${i.toString(16).padStart(7, "0")}deadbeefcafe`, message };
}

/** Install a fake vscode.git extension with one repository. */
function installGit(repo: Record<string, unknown> | null, opts: { enabled?: boolean } = {}): void {
  const repositories = repo ? [{ rootUri: ROOT, inputBox: { value: "" }, state: { indexChanges: [], workingTreeChanges: [] }, ...repo }] : [];
  mock.extensions.set("vscode.git", {
    isActive: true,
    exports: {
      enabled: opts.enabled ?? true,
      getAPI: () => ({ repositories, getRepository: () => repositories[0] ?? null }),
    },
  });
}

beforeEach(() => mock.reset());

describe("formatCommit", () => {
  it("puts the short hash and subject first, then the body indented", () => {
    const out = formatCommit(commit(1, "fix(api): handle 404\n\nThe client retried forever.\nNow it stops."));
    assertEqual(
      out,
      "0000001 fix(api): handle 404\n    The client retried forever.\n    Now it stops.",
      "formatted commit"
    );
  });

  it("keeps a subject-only commit to one line", () => {
    assertEqual(formatCommit(commit(2, "chore: bump\n")), "0000002 chore: bump", "subject only");
  });

  it("cuts a long body and says so", () => {
    const body = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const out = formatCommit(commit(3, `docs: long\n\n${body}`));
    assertIncludes(out, "    line 5", "keeps the first lines");
    assert(!out.includes("line 6"), "drops the seventh body line");
    assert(out.endsWith("    [...]"), "marks the cut");
  });

  it("normalises CRLF messages", () => {
    assertEqual(formatCommit(commit(4, "a\r\n\r\nb")), "0000004 a\n    b", "crlf");
  });
});

describe("gitlogContext", () => {
  it("attaches the last 30 commits, labelled, even if git returns more", async () => {
    let asked: unknown;
    installGit({
      log: async (options: unknown) => {
        asked = options;
        return Array.from({ length: 45 }, (_, i) => commit(i));
      },
    });
    const outcome = await gitlogContext(undefined, undefined);
    assert("item" in outcome, "an item");
    assertEqual(asked, { maxEntries: GITLOG_MAX_COMMITS }, "asks git for 30");
    assertEqual(outcome.item.kind, "gitlog", "kind");
    assertEqual(outcome.item.label, "Last 30 commits", "label");
    assertEqual(outcome.item.text.split("\n\n").length, 30, "30 entries");
    assert(!outcome.item.truncated, "not truncated");
  });

  it("uses the singular for one commit", async () => {
    installGit({ log: async () => [commit(1)] });
    const outcome = await gitlogContext(undefined, undefined);
    assert("item" in outcome, "an item");
    assertEqual(outcome.item.label, "Last 1 commit", "singular label");
  });

  it("truncates to the per-item ceiling and flags it", async () => {
    // Bodies are capped per commit, so it takes enormous subjects to pass the
    // per-item ceiling.
    installGit({
      log: async () => Array.from({ length: 30 }, (_, i) => commit(i, `feat: ${"y".repeat(2000)} ${i}`)),
    });
    const outcome = await gitlogContext(undefined, undefined);
    assert("item" in outcome, "an item");
    assertEqual(outcome.item.text.length, CONTEXT_ITEM_MAX_CHARS, "clipped to the ceiling");
    assertEqual(outcome.item.truncated, true, "truncated flag");
  });

  it("gives a reason when the git extension is missing", async () => {
    const outcome = await gitlogContext(undefined, undefined);
    assert("reason" in outcome, "a reason");
    assertIncludes(outcome.reason, "Git extension is not available", "reason text");
  });

  it("gives a reason when git is disabled", async () => {
    installGit({ log: async () => [] }, { enabled: false });
    const outcome = await gitlogContext(undefined, undefined);
    assert("reason" in outcome, "a reason");
    assertIncludes(outcome.reason, "Git is disabled", "reason text");
  });

  it("gives a reason outside a repository", async () => {
    installGit(null);
    const outcome = await gitlogContext(undefined, undefined);
    assertEqual(outcome, { reason: "This folder is not a git repository" }, "no repo");
  });

  it("gives a reason for a repository with no commits", async () => {
    installGit({
      log: async () => {
        throw new Error("fatal: your current branch 'main' does not have any commits yet");
      },
    });
    assertEqual(await gitlogContext(undefined, undefined), { reason: "This repository has no commits yet" }, "throws");
    installGit({ log: async () => [] });
    assertEqual(await gitlogContext(undefined, undefined), { reason: "This repository has no commits yet" }, "empty");
  });

  it("gives a reason when the API has no log()", async () => {
    installGit({});
    const outcome = await gitlogContext(undefined, undefined);
    assert("reason" in outcome, "a reason");
    assertIncludes(outcome.reason, "cannot read the commit history", "reason text");
  });
});

describe("terminalContext", () => {
  function deps(selected: string | null, terminal: { name: string } | null = { name: "npm test" }) {
    const calls: string[] = [];
    let clipboard = "what the user had copied";
    const d: TerminalDeps = {
      activeTerminal: () => terminal ?? undefined,
      readClipboard: async () => clipboard,
      writeClipboard: async (text) => {
        calls.push(`write:${text.startsWith("vegaduta-terminal-probe") ? "<sentinel>" : text}`);
        clipboard = text;
      },
      copySelection: async () => {
        calls.push("copy");
        if (selected !== null) clipboard = selected;
      },
    };
    return { d, calls, clipboard: () => clipboard };
  }

  it("reads the selection and restores the clipboard", async () => {
    const t = deps("FAIL src/a.test.ts\r\n  expected 1\r\n  received 2\r\n");
    const outcome = await terminalContext(t.d);
    assert("item" in outcome, "an item");
    assertEqual(outcome.item.kind, "terminal", "kind");
    assertEqual(outcome.item.label, "Terminal: npm test (3 lines)", "label counts lines, not the trailing newline");
    assertEqual(outcome.item.text, "FAIL src/a.test.ts\n  expected 1\n  received 2\n", "crlf normalised");
    assertEqual(t.clipboard(), "what the user had copied", "clipboard restored");
    assertEqual(t.calls, ["write:<sentinel>", "copy", "write:what the user had copied"], "order");
  });

  it("says nothing is selected when the copy is a no-op, and still restores", async () => {
    const t = deps(null);
    const outcome = await terminalContext(t.d);
    assert("reason" in outcome, "a reason");
    assertIncludes(outcome.reason, 'Nothing is selected in the terminal "npm test"', "reason");
    assertEqual(t.clipboard(), "what the user had copied", "clipboard restored");
  });

  it("does not mistake an unchanged clipboard for a selection", async () => {
    // The user's clipboard already holds text; nothing is selected. The
    // sentinel is what tells these apart.
    const t = deps(null);
    const outcome = await terminalContext(t.d);
    assert("reason" in outcome, "not an item made of the old clipboard");
  });

  it("gives a reason with no terminal open, touching nothing", async () => {
    const t = deps("x", null);
    assertEqual(await terminalContext(t.d), { reason: "No terminal is open" }, "reason");
    assertEqual(t.calls, [], "clipboard untouched");
  });

  it("truncates a huge selection", async () => {
    const t = deps("z".repeat(CONTEXT_ITEM_MAX_CHARS + 50));
    const outcome = await terminalContext(t.d);
    assert("item" in outcome, "an item");
    assertEqual(outcome.item.text.length, CONTEXT_ITEM_MAX_CHARS, "clipped");
    assertEqual(outcome.item.truncated, true, "flagged");
  });

  it("goes through the real clipboard + copySelection command by default", async () => {
    mock.activeTerminal = { name: "bash" };
    mock.clipboard = "previous";
    mock.commandHandlers.set("workbench.action.terminal.copySelection", () => {
      mock.clipboard = "selected output";
    });
    const outcome = await terminalContext();
    assert("item" in outcome, "an item");
    assertEqual(outcome.item.text, "selected output", "text");
    assertEqual(mock.clipboard, "previous", "restored");
  });
});

describe("file and selection labels", () => {
  function editor(text: string, selection: Selection) {
    const uri = Uri.joinPath(ROOT, "src/app.ts");
    return {
      document: { uri, languageId: "typescript", getText: () => text },
      selection,
    };
  }

  it("labels the file by its workspace-relative path", () => {
    mock.workspaceFolders = [{ uri: ROOT, name: "ws", index: 0 }];
    const outcome = fileContext(editor("const a = 1;", new Selection(0, 0, 0, 0)) as never);
    assert("item" in outcome, "an item");
    assertEqual(outcome.item.label, "src/app.ts", "label");
    assertEqual(outcome.item.languageId, "typescript", "language");
  });

  it("counts selected lines, not the line the selection ends at column 0", () => {
    const outcome = selectionContext(editor("a\nb\nc\n", new Selection(0, 0, 3, 0)) as never);
    assert("item" in outcome, "an item");
    assertEqual(outcome.item.label, "Selection (3 lines)", "label");
  });

  it("gives reasons with no editor or an empty selection", () => {
    assertEqual(fileContext(undefined), { reason: "No file is open" }, "no editor");
    assertEqual(
      selectionContext(editor("a", new Selection(0, 1, 0, 1)) as never),
      { reason: "Nothing is selected in the editor" },
      "empty selection"
    );
  });
});

describe("hostCapabilities", () => {
  it("declares wave-2 capabilities, knowledge only for a JWT sign-in", async () => {
    installGit({ log: async () => [] });
    const jwt = await hostCapabilities({ authMode: "jwt" });
    assertEqual(jwt.context, ["file", "selection", "diff", "diagnostics", "gitlog", "terminal"], "context kinds");
    assertEqual(jwt.reveal, true, "reveal");
    assertEqual(jwt.privateMode, true, "privateMode");
    assertEqual(jwt.knowledge, true, "knowledge with jwt");
    assertEqual((await hostCapabilities({ authMode: "apiKey" })).knowledge, false, "no knowledge with an API key");
    assertEqual((await hostCapabilities({ authMode: null })).knowledge, false, "no knowledge signed out");
  });

  it("drops gitlog and commitMessage without git", async () => {
    const caps = await hostCapabilities({ authMode: null });
    assert(!caps.context.includes("gitlog"), "no gitlog");
    assert(caps.context.includes("terminal"), "terminal stays");
    assertEqual(caps.commitMessage, false, "no commit box");
  });
});
