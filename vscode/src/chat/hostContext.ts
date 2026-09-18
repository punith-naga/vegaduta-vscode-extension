// Host side of the context-attachment contract (protocol.ts, 2026-09-18):
// builds ContextItems for context.request and reports what this host can do
// in init.capabilities.
//
// Git goes through the built-in vscode.git extension's public API only. If
// that API is absent (git disabled, git not installed, a web/remote host
// without it) the diff kind is reported MISSING with a reason - this module
// never shells out to a `git` binary.

import * as vscode from "vscode";
import {
  CONTEXT_ITEM_MAX_CHARS,
  type ContextItem,
  type ContextKind,
  type HostCapabilities,
} from "../../../shared/src/webview/protocol";

// --- minimal typing of the vscode.git extension API (git.d.ts, v1) ---------
// Only the members used here. The real API is larger; these have been stable
// since the API's introduction.

interface GitChange {
  readonly uri: vscode.Uri;
  /** 7 = UNTRACKED in git.d.ts's Status enum. */
  readonly status: number;
}

interface GitRepositoryState {
  readonly indexChanges: GitChange[];
  readonly workingTreeChanges: GitChange[];
  readonly untrackedChanges?: GitChange[];
}

export interface GitRepository {
  readonly rootUri: vscode.Uri;
  readonly inputBox: { value: string };
  readonly state: GitRepositoryState;
  diff(cached?: boolean): Promise<string>;
  /** Present in every current vscode.git API; typed optional so a build that
   * lacks it degrades to a reason instead of a TypeError. */
  log?(options?: { maxEntries?: number }): Promise<GitCommit[]>;
}

/** git.d.ts Commit - `message` is the full message (subject + body). */
export interface GitCommit {
  readonly hash: string;
  readonly message: string;
}

interface GitApi {
  readonly repositories: GitRepository[];
  getRepository(uri: vscode.Uri): GitRepository | null;
}

interface GitExtensionExports {
  readonly enabled: boolean;
  getAPI(version: 1): GitApi;
}

const GIT_STATUS_UNTRACKED = 7;

/** The git API, or a human reason it is unavailable. Never throws. */
export async function getGitApi(): Promise<{ api: GitApi } | { reason: string }> {
  const ext = vscode.extensions.getExtension<GitExtensionExports>("vscode.git");
  if (!ext) {
    return { reason: "VS Code's built-in Git extension is not available in this window" };
  }
  try {
    const exports = ext.isActive ? ext.exports : await ext.activate();
    if (!exports?.enabled) {
      return { reason: "Git is disabled in VS Code (git.enabled is off)" };
    }
    return { api: exports.getAPI(1) };
  } catch (err) {
    return {
      reason: `VS Code's Git extension could not start: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Pick the repository a request is about: an explicit root (the Source
 * Control title-bar button passes its repository), else the one holding the
 * active file, else the only one open. */
export function pickRepository(
  api: GitApi,
  preferredRoot: vscode.Uri | undefined,
  activeUri: vscode.Uri | undefined
): GitRepository | null {
  if (preferredRoot) {
    const byRoot = api.repositories.find((r) => r.rootUri.toString() === preferredRoot.toString());
    if (byRoot) return byRoot;
  }
  if (activeUri) {
    const byFile = api.getRepository(activeUri);
    if (byFile) return byFile;
  }
  // Several repositories and nothing to disambiguate: the first one VS Code
  // opened, which is the workspace's primary folder in the common case.
  return api.repositories[0] ?? null;
}

// --- item construction ------------------------------------------------------

function clip(text: string): { text: string; truncated?: boolean } {
  if (text.length <= CONTEXT_ITEM_MAX_CHARS) return { text };
  return { text: text.slice(0, CONTEXT_ITEM_MAX_CHARS), truncated: true };
}

function item(kind: ContextKind, label: string, raw: string, languageId?: string): ContextItem {
  const { text, truncated } = clip(raw);
  const out: ContextItem = { kind, label, text };
  if (languageId) out.languageId = languageId;
  if (truncated) out.truncated = true;
  return out;
}

export type ContextOutcome = { item: ContextItem } | { reason: string };

export function fileContext(editor: vscode.TextEditor | undefined): ContextOutcome {
  if (!editor) return { reason: "No file is open" };
  const doc = editor.document;
  const text = doc.getText();
  if (!text) return { reason: `${vscode.workspace.asRelativePath(doc.uri, false)} is empty` };
  return { item: item("file", vscode.workspace.asRelativePath(doc.uri, false), text, doc.languageId) };
}

/** Lines the selection actually spans (a selection ending at column 0 of a
 * line does not include that line). */
export function selectedLineCount(selection: vscode.Selection): number {
  let lines = selection.end.line - selection.start.line + 1;
  if (selection.end.character === 0 && selection.end.line > selection.start.line) lines -= 1;
  return lines;
}

export function selectionContext(editor: vscode.TextEditor | undefined): ContextOutcome {
  if (!editor) return { reason: "No file is open" };
  if (editor.selection.isEmpty) return { reason: "Nothing is selected in the editor" };
  const text = editor.document.getText(editor.selection);
  const n = selectedLineCount(editor.selection);
  return {
    item: item("selection", `Selection (${n} ${n === 1 ? "line" : "lines"})`, text, editor.document.languageId),
  };
}

const SEVERITY: Record<vscode.DiagnosticSeverity, string> = {
  [vscode.DiagnosticSeverity.Error]: "error",
  [vscode.DiagnosticSeverity.Warning]: "warning",
  [vscode.DiagnosticSeverity.Information]: "info",
  [vscode.DiagnosticSeverity.Hint]: "hint",
};

/** "path:line:col severity message" - 1-based line/col like every compiler. */
export function formatDiagnostic(uri: vscode.Uri, d: vscode.Diagnostic): string {
  const path = vscode.workspace.asRelativePath(uri, false);
  const message = d.message.replace(/\s*\n\s*/g, " ");
  return `${path}:${d.range.start.line + 1}:${d.range.start.character + 1} ${SEVERITY[d.severity]} ${message}`;
}

export function diagnosticsContext(editor: vscode.TextEditor | undefined): ContextOutcome {
  if (!editor) return { reason: "No file is open" };
  const uri = editor.document.uri;
  const diagnostics = [...vscode.languages.getDiagnostics(uri)].sort(
    (a, b) => a.severity - b.severity || a.range.start.line - b.range.start.line
  );
  if (diagnostics.length === 0) {
    return { reason: `No problems reported in ${vscode.workspace.asRelativePath(uri, false)}` };
  }
  const n = diagnostics.length;
  return {
    item: item(
      "diagnostics",
      `${n} ${n === 1 ? "problem" : "problems"}`,
      diagnostics.map((d) => formatDiagnostic(uri, d)).join("\n")
    ),
  };
}

/** Distinct files named by `diff --git a/X b/Y` headers (a file with both
 * staged and unstaged edits counts once). */
function diffFiles(diff: string): Set<string> {
  const files = new Set<string>();
  for (const m of diff.matchAll(/^diff --git a\/.* b\/(.*)$/gm)) files.add(m[1]);
  return files;
}

export async function diffContext(
  preferredRoot: vscode.Uri | undefined,
  activeUri: vscode.Uri | undefined
): Promise<ContextOutcome> {
  const git = await getGitApi();
  if ("reason" in git) return { reason: git.reason };
  const repo = pickRepository(git.api, preferredRoot, activeUri);
  if (!repo) return { reason: "This folder is not a git repository" };

  let staged: string;
  let unstaged: string;
  try {
    [staged, unstaged] = await Promise.all([repo.diff(true), repo.diff(false)]);
  } catch (err) {
    return { reason: `Git could not produce a diff: ${err instanceof Error ? err.message : String(err)}` };
  }

  const untracked = [
    ...(repo.state.untrackedChanges ?? []),
    ...repo.state.workingTreeChanges.filter((c) => c.status === GIT_STATUS_UNTRACKED),
  ].map((c) => vscode.workspace.asRelativePath(c.uri, false));
  const untrackedUnique = [...new Set(untracked)];

  const sections: string[] = [];
  if (staged.trim()) sections.push(`# Staged changes\n${staged.trimEnd()}`);
  if (unstaged.trim()) sections.push(`# Unstaged changes\n${unstaged.trimEnd()}`);
  if (sections.length === 0) {
    return {
      reason: untrackedUnique.length
        ? `Only new, untracked files have changed (${untrackedUnique.length}) - stage them with git add so their contents are part of the diff`
        : "There are no uncommitted changes",
    };
  }
  if (untrackedUnique.length) {
    sections.push(
      `# Untracked files (contents not included - stage them to include)\n${untrackedUnique.join("\n")}`
    );
  }
  const body = sections.join("\n\n");
  const files = new Set([...diffFiles(staged), ...diffFiles(unstaged)]).size || 1;
  return {
    item: item("diff", `Working tree diff (${files} ${files === 1 ? "file" : "files"})`, body, "diff"),
  };
}

// --- git log ----------------------------------------------------------------

export const GITLOG_MAX_COMMITS = 30;
/** Body kept per commit: enough to show the team's style, not a novel. */
const GITLOG_BODY_LINES = 6;
const GITLOG_BODY_CHARS = 400;

/** One commit as "abc1234 subject", then its short body indented. */
export function formatCommit(commit: GitCommit): string {
  const lines = commit.message.replace(/\r\n/g, "\n").trim().split("\n");
  const subject = (lines[0] ?? "").trim();
  // Collapse runs of blank lines inside the body.
  let body = lines
    .slice(1)
    .map((l) => l.trimEnd())
    .filter((l, i, all) => l !== "" || (i > 0 && all[i - 1] !== ""))
    .join("\n")
    .trim();
  let cut = false;
  const bodyLines = body.split("\n");
  if (bodyLines.length > GITLOG_BODY_LINES) {
    body = bodyLines.slice(0, GITLOG_BODY_LINES).join("\n");
    cut = true;
  }
  if (body.length > GITLOG_BODY_CHARS) {
    body = body.slice(0, GITLOG_BODY_CHARS).trimEnd();
    cut = true;
  }
  const head = `${commit.hash.slice(0, 7)} ${subject}`;
  if (!body) return head;
  const indented = body
    .split("\n")
    .map((l) => (l ? `    ${l}` : ""))
    .join("\n");
  return `${head}\n${indented}${cut ? "\n    [...]" : ""}`;
}

export async function gitlogContext(
  preferredRoot: vscode.Uri | undefined,
  activeUri: vscode.Uri | undefined
): Promise<ContextOutcome> {
  const git = await getGitApi();
  if ("reason" in git) return { reason: git.reason };
  const repo = pickRepository(git.api, preferredRoot, activeUri);
  if (!repo) return { reason: "This folder is not a git repository" };
  if (typeof repo.log !== "function") {
    return { reason: "This version of VS Code's Git extension cannot read the commit history" };
  }
  let commits: GitCommit[];
  try {
    commits = await repo.log({ maxEntries: GITLOG_MAX_COMMITS });
  } catch (err) {
    // `git log` fails outright in a repository with no commits yet.
    const detail = err instanceof Error ? err.message : String(err);
    return /does not have any commits|bad default revision|unknown revision/i.test(detail)
      ? { reason: "This repository has no commits yet" }
      : { reason: `Git could not read the commit history: ${detail}` };
  }
  commits = commits.slice(0, GITLOG_MAX_COMMITS);
  if (commits.length === 0) return { reason: "This repository has no commits yet" };
  const n = commits.length;
  return {
    item: item("gitlog", `Last ${n} ${n === 1 ? "commit" : "commits"}`, commits.map(formatCommit).join("\n\n")),
  };
}

// --- terminal selection -------------------------------------------------------

/** What the terminal reader needs from VS Code - injectable for tests. */
export interface TerminalDeps {
  activeTerminal(): { name: string } | undefined;
  readClipboard(): Thenable<string>;
  writeClipboard(text: string): Thenable<void>;
  copySelection(): Thenable<unknown>;
}

const vscodeTerminalDeps: TerminalDeps = {
  activeTerminal: () => vscode.window.activeTerminal,
  readClipboard: () => vscode.env.clipboard.readText(),
  writeClipboard: (text) => vscode.env.clipboard.writeText(text),
  copySelection: () => vscode.commands.executeCommand("workbench.action.terminal.copySelection"),
};

/**
 * The active terminal's selection. The stable API (@types/vscode 1.125) has
 * no Terminal.selection, so this copies the selection with the built-in
 * workbench.action.terminal.copySelection command, reads it back from the
 * clipboard, and then restores what the clipboard held before. A sentinel
 * written first is how "nothing is selected" is told apart from "the
 * clipboard already held this text". Only text survives the round trip: if
 * the clipboard held an image or files, the restore writes back their (empty)
 * text form - the clipboard API cannot save anything else.
 */
export async function terminalContext(deps: TerminalDeps = vscodeTerminalDeps): Promise<ContextOutcome> {
  const terminal = deps.activeTerminal();
  if (!terminal) return { reason: "No terminal is open" };

  const previous = await deps.readClipboard();
  const sentinel = `vegaduta-terminal-probe-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let copied = "";
  try {
    await deps.writeClipboard(sentinel);
    await deps.copySelection();
    copied = await deps.readClipboard();
  } catch (err) {
    return { reason: `Could not read the terminal selection: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    try {
      await deps.writeClipboard(previous);
    } catch {
      // Nothing more can be done; the selection read itself is unaffected.
    }
  }
  if (copied === sentinel || copied.trim() === "") {
    return { reason: `Nothing is selected in the terminal "${terminal.name}" - select the output first` };
  }
  const text = copied.replace(/\r\n/g, "\n");
  const n = text.replace(/\n+$/, "").split("\n").length;
  return { item: item("terminal", `Terminal: ${terminal.name} (${n} ${n === 1 ? "line" : "lines"})`, text) };
}

// --- capabilities ----------------------------------------------------------

export interface CapabilityInputs {
  /** Knowledge search needs a JWT sign-in; the vmcp_ API-key surface has no
   * knowledge endpoints. */
  authMode: "jwt" | "apiKey" | null;
}

export async function hostCapabilities(inputs: CapabilityInputs = { authMode: null }): Promise<HostCapabilities> {
  const git = await getGitApi();
  const hasGit = "api" in git;
  const context: ContextKind[] = ["file", "selection", "diff", "diagnostics"];
  if (hasGit) context.push("gitlog");
  context.push("terminal");
  return {
    context,
    insert: true,
    newFile: true,
    runCode: true,
    commitMessage: hasGit,
    reveal: true,
    knowledge: inputs.authMode === "jwt",
    privateMode: true,
  };
}
