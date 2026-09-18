// The VS Code implementation of the shared coding toolset: the half that is
// allowed to touch the user's machine.
//
// Three invariants this file exists to hold, in priority order:
//  1. NOTHING escapes the workspace root. Every path the model supplies is
//     resolved and re-checked against the root before any I/O. A model that
//     asks for "../../.ssh/id_rsa" gets an error string, not a file.
//  2. NOTHING mutating happens without the user's say-so, and for file changes
//     that means seeing the actual diff first (diffPreview.ts) - approving a
//     change you cannot read is not consent. Edits and commands go through an
//     approval gate the user controls; "allow for this run" is a per-run
//     decision that dies with the run, never a stored setting.
//  3. NOTHING throws. A tool failure is content the model reads and corrects.
//     An exception here would end a run that was one retry from succeeding.

import { spawn } from "node:child_process";
import * as vscode from "vscode";
import {
  EDIT_FILE,
  LIST_DIR,
  READ_FILE,
  RUN_COMMAND,
  SEARCH_TEXT,
  WRITE_FILE,
  CODING_TOOL_SPECS,
} from "../../../shared/src/agent/codingTools";
import {
  describeChange,
  planEdit,
  recheckEdit,
  summariseChange,
} from "../../../shared/src/agent/editPlan";
import type { ToolCall, ToolExecutor, ToolOutcome, ToolSpec } from "../../../shared/src/agent/types";
import { resolveContained } from "./containment";
import { previewChange, type PreviewDecision } from "./diffPreview";

/** Read cap per file. Big enough for real source files, small enough that one
 * minified bundle cannot evict the whole conversation from a 8k-context model. */
const MAX_READ_CHARS = 60_000;
const MAX_SEARCH_FILES = 400;
const MAX_SEARCH_MATCHES = 80;
const MAX_COMMAND_OUTPUT_CHARS = 20_000;
const COMMAND_TIMEOUT_MS = 120_000;
/** Whole-scan budget for search_text, and the slice any single regex match sees.
 * Both exist to bound a model-supplied pattern - see searchText. */
const SEARCH_DEADLINE_MS = 10_000;
const MAX_MATCH_LINE_CHARS = 2_000;

/**
 * Commands that are never worth the risk of a model getting creative, and that
 * no legitimate coding task needs. This is a blunt backstop UNDER the approval
 * prompt, not a substitute for it - the user still approves everything else.
 * Deliberately short: a long denylist reads as a security boundary, and a
 * string denylist is not one.
 */
const REFUSED_COMMAND_PATTERNS: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /\brm\s+(-[a-z]*[rf][a-z]*\s+)+\/(\s|$)/i, why: "recursive delete of the filesystem root" },
  { pattern: /\b(mkfs|fdisk|diskpart)\b/i, why: "disk formatting" },
  { pattern: /\bdd\s+[^|]*of=\/dev\//i, why: "raw write to a block device" },
  { pattern: /:\(\)\s*\{\s*:\|:&\s*\}\s*;:/, why: "fork bomb" },
  { pattern: /\bgit\s+push\b[^\n]*--force/i, why: "force push - run this yourself if you mean it" },
  { pattern: /\bshutdown\b|\breboot\b|\bhalt\b/i, why: "power state change" },
];

export type ApprovalKind = "edit" | "command";

/**
 * Per-run approval. "Allow for the rest of this run" is intentionally held in
 * memory on this object: it expires when the run does, and cannot be
 * accidentally persisted into settings where the user would forget it is on.
 */
export class ApprovalGate {
  private allowAll: Record<ApprovalKind, boolean> = { edit: false, command: false };
  private cancelled = false;

  constructor(private readonly autoApprove: Record<ApprovalKind, boolean>) {}

  get wasCancelled(): boolean {
    return this.cancelled;
  }

  async request(kind: ApprovalKind, summary: string, detail?: string): Promise<boolean> {
    if (this.cancelled) return false;
    if (this.autoApprove[kind] || this.allowAll[kind]) return true;

    const allowAllLabel = kind === "edit" ? "Allow all edits this run" : "Allow all commands this run";
    const choice = await vscode.window.showWarningMessage(
      summary,
      { modal: true, detail },
      "Allow",
      allowAllLabel,
      "Stop the agent"
    );
    if (choice === "Allow") return true;
    if (choice === allowAllLabel) {
      this.allowAll[kind] = true;
      return true;
    }
    // Dismissing the dialog is a refusal of this step, not of the run. Only the
    // explicit stop ends things - otherwise an accidental Escape kills the work.
    if (choice === "Stop the agent") this.cancelled = true;
    return false;
  }

  /**
   * Approval for a file change, decided in front of a diff.
   *
   * The preview is a thunk so it is never built when nobody will look at it:
   * autoApproveEdits means what it says, and "allow all edits this run" means
   * the user already stopped reviewing. Neither opens an editor.
   */
  async requestChange(preview: () => Promise<PreviewDecision>): Promise<boolean> {
    if (this.cancelled) return false;
    if (this.autoApprove.edit || this.allowAll.edit) return true;

    const decision = await preview();
    if (decision === "apply") return true;
    if (decision === "allow-all") {
      this.allowAll.edit = true;
      return true;
    }
    if (decision === "stop") this.cancelled = true;
    return false;
  }
}

function ok(content: string): ToolOutcome {
  return { content };
}

function fail(content: string): ToolOutcome {
  return { content: `Error: ${content}`, failed: true };
}

function str(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function int(args: Record<string, unknown>, key: string): number | null {
  const value = args[key];
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return Number.parseInt(value, 10);
  return null;
}

export class WorkspaceToolExecutor implements ToolExecutor {
  private readonly decoder = new TextDecoder();
  private readonly encoder = new TextEncoder();

  constructor(
    private readonly root: vscode.Uri,
    private readonly approvals: ApprovalGate,
    private readonly log: (line: string) => void = () => {}
  ) {}

  specs(): ToolSpec[] {
    return CODING_TOOL_SPECS;
  }

  /**
   * Containment (lexical + real path, so a committed symlink cannot walk a
   * read off the edge of the workspace). The logic lives in containment.ts,
   * shared with the chat view's Code Tour reveal; see there for the reasoning.
   */
  private resolve(relative: string): Promise<vscode.Uri | null> {
    return resolveContained(this.root, relative);
  }

  private relativeTo(uri: vscode.Uri): string {
    const rootPath = this.root.path.replace(/\/+$/, "");
    return uri.path.startsWith(`${rootPath}/`) ? uri.path.slice(rootPath.length + 1) : uri.path;
  }

  async execute(call: ToolCall, signal?: AbortSignal): Promise<ToolOutcome> {
    try {
      switch (call.name) {
        case LIST_DIR:
          return await this.listDir(call.args);
        case READ_FILE:
          return await this.readFile(call.args);
        case SEARCH_TEXT:
          return await this.searchText(call.args, signal);
        case WRITE_FILE:
          return await this.writeFile(call.args);
        case EDIT_FILE:
          return await this.editFile(call.args);
        case RUN_COMMAND:
          return await this.runCommand(call.args, signal);
        default:
          return fail(`unknown tool "${call.name}"`);
      }
    } catch (error) {
      // Invariant 3: a thrown tool is a message, never a dead run.
      return fail(error instanceof Error ? error.message : String(error));
    }
  }

  // -------------------------------------------------------------------------
  // Read-only tools
  // -------------------------------------------------------------------------

  private async listDir(args: Record<string, unknown>): Promise<ToolOutcome> {
    const path = str(args, "path") ?? ".";
    const uri = await this.resolve(path);
    if (!uri) return fail(`path "${path}" is outside the workspace`);
    const entries = await vscode.workspace.fs.readDirectory(uri);
    if (entries.length === 0) return ok(`(empty directory: ${path})`);
    const lines = entries
      .filter(([name]) => name !== ".git" && name !== "node_modules")
      .sort(([aName, aType], [bName, bType]) =>
        aType === bType ? aName.localeCompare(bName) : aType === vscode.FileType.Directory ? -1 : 1
      )
      .map(([name, type]) => (type === vscode.FileType.Directory ? `${name}/` : name));
    return ok(`${path}:\n${lines.join("\n")}`);
  }

  private async readFile(args: Record<string, unknown>): Promise<ToolOutcome> {
    const path = str(args, "path");
    if (!path) return fail("read_file needs a \"path\" argument");
    const uri = await this.resolve(path);
    if (!uri) return fail(`path "${path}" is outside the workspace`);

    let bytes: Uint8Array;
    try {
      bytes = await vscode.workspace.fs.readFile(uri);
    } catch {
      return fail(`no such file: ${path}`);
    }
    const text = this.decoder.decode(bytes);
    const allLines = text.split(/\r?\n/);
    const start = Math.max(1, int(args, "start_line") ?? 1);
    const end = Math.min(allLines.length, int(args, "end_line") ?? allLines.length);
    if (start > allLines.length) {
      return fail(`start_line ${start} is past the end of ${path} (${allLines.length} lines)`);
    }

    const selected = allLines.slice(start - 1, end);
    let body = selected.map((line, index) => `${start + index}\t${line}`).join("\n");
    let note = "";
    if (body.length > MAX_READ_CHARS) {
      body = body.slice(0, MAX_READ_CHARS);
      note = `\n... truncated at ${MAX_READ_CHARS} characters - re-read with start_line/end_line for the rest.`;
    }
    return ok(`${path} (lines ${start}-${end} of ${allLines.length}):\n${body}${note}`);
  }

  private async searchText(args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolOutcome> {
    const query = str(args, "query");
    if (!query) return fail("search_text needs a \"query\" argument");
    const include = str(args, "include") ?? "**/*";
    const isRegex = args.is_regex === true;

    // The model supplies this pattern, so "(a+)+$" against a long line is a
    // reachable denial of service - and it runs on the extension host thread
    // shared with every other extension. JavaScript cannot interrupt a regex
    // mid-backtrack, so the mitigations are bounds, not a cure: cap the text any
    // single match sees, and give the whole scan a deadline checked between
    // lines. A pathological pattern can still stall for one line's worth.
    const deadline = Date.now() + SEARCH_DEADLINE_MS;

    let matcher: RegExp;
    try {
      matcher = isRegex
        ? new RegExp(query, "i")
        : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    } catch (error) {
      return fail(`invalid regular expression: ${error instanceof Error ? error.message : String(error)}`);
    }

    const files = await vscode.workspace.findFiles(
      new vscode.RelativePattern(this.root, include),
      "**/{node_modules,.git,dist,build,target,out}/**",
      MAX_SEARCH_FILES
    );

    const hits: string[] = [];
    let timedOut = false;
    for (const file of files) {
      if (hits.length >= MAX_SEARCH_MATCHES) break;
      if (signal?.aborted) return fail("search cancelled");
      if (Date.now() > deadline) {
        timedOut = true;
        break;
      }
      let text: string;
      try {
        text = this.decoder.decode(await vscode.workspace.fs.readFile(file));
      } catch {
        continue; // binary or unreadable - not an error worth reporting
      }
      const lines = text.split(/\r?\n/);
      for (let index = 0; index < lines.length && hits.length < MAX_SEARCH_MATCHES; index += 1) {
        if ((index & 0xff) === 0 && Date.now() > deadline) {
          timedOut = true;
          break;
        }
        if (matcher.test(lines[index].slice(0, MAX_MATCH_LINE_CHARS))) {
          hits.push(`${this.relativeTo(file)}:${index + 1}: ${lines[index].trim().slice(0, 200)}`);
        }
      }
      if (timedOut) break;
    }

    // Say so rather than reporting a truncated scan as a clean "no matches" -
    // the model would take that as proof the string is absent.
    const stopped = timedOut
      ? `\n(search stopped after ${SEARCH_DEADLINE_MS / 1000}s - narrow it with "include", or simplify the pattern)`
      : "";
    if (hits.length === 0) {
      return ok(`No matches for ${JSON.stringify(query)} in ${include}.${stopped}`);
    }
    const capped = hits.length >= MAX_SEARCH_MATCHES ? `\n(stopped at ${MAX_SEARCH_MATCHES} matches)` : "";
    return ok(`${hits.length} match(es):\n${hits.join("\n")}${capped}${stopped}`);
  }

  // -------------------------------------------------------------------------
  // Mutating tools
  // -------------------------------------------------------------------------

  /**
   * What the file says RIGHT NOW - the open buffer when there is one, the bytes
   * on disk otherwise. An unsaved editor is what the user sees, what the diff
   * editor will render, and therefore the only text it is honest to match
   * old_text against. Null means the file does not exist.
   */
  private async currentText(uri: vscode.Uri): Promise<string | null> {
    const open = this.openDocument(uri);
    if (open) return open.getText();
    try {
      return this.decoder.decode(await vscode.workspace.fs.readFile(uri));
    } catch {
      return null;
    }
  }

  private openDocument(uri: vscode.Uri): vscode.TextDocument | undefined {
    const target = uri.toString();
    return vscode.workspace.textDocuments.find((doc) => !doc.isClosed && doc.uri.toString() === target);
  }

  /**
   * Write the new contents back through whichever channel owns the text. A file
   * with unsaved changes is owned by its buffer: writing bytes underneath it
   * would either be reverted by the user's next save or silently destroy their
   * work. Editing the buffer and saving it keeps both, and keeps one undo step.
   *
   * Returns null on success, or what actually happened when it did not - the
   * two failures differ and the model must not be told "nothing changed" when
   * the buffer already holds the edit.
   */
  private async writeText(uri: vscode.Uri, text: string): Promise<string | null> {
    const open = this.openDocument(uri);
    if (open?.isDirty) {
      const whole = new vscode.Range(open.positionAt(0), open.positionAt(open.getText().length));
      const edit = new vscode.WorkspaceEdit();
      edit.replace(open.uri, whole, text);
      if (!(await vscode.workspace.applyEdit(edit))) {
        return "the open editor rejected the change, so nothing was changed";
      }
      if (!(await open.save())) {
        return "the change is in the open editor but it could not be saved, so the file on disk " +
          "is still the old version - do not run anything that reads it until the user saves";
      }
      return null;
    }
    await vscode.workspace.fs.writeFile(uri, this.encoder.encode(text));
    return null;
  }

  private async writeFile(args: Record<string, unknown>): Promise<ToolOutcome> {
    const path = str(args, "path");
    const content = typeof args.content === "string" ? args.content : null;
    if (!path || content == null) return fail("write_file needs \"path\" and \"content\" arguments");
    const uri = await this.resolve(path);
    if (!uri) return fail(`path "${path}" is outside the workspace`);

    const before = await this.currentText(uri);
    if (before === content) return ok(`${path} already contains exactly that text - nothing written.`);

    const lines = content.split(/\r?\n/).length;
    const summary = before === null
      ? `VegaDuta wants to CREATE ${path}`
      : `VegaDuta wants to REPLACE all of ${path}`;
    const detail = before === null ? `${lines} line(s)` : describeChange(summariseChange(before, content));

    const approved = await this.approvals.requestChange(() =>
      previewChange({ uri, label: path, current: before, proposed: content }, summary, detail)
    );
    if (!approved) return fail(`the user declined the write to ${path}`);

    // The diff the user just read was against `before`. A whole-file write has
    // no snippet to re-anchor to, so if the file moved underneath it there is
    // nothing honest left to do: what they approved no longer describes what
    // would happen. Stop and let the model look again.
    if ((await this.currentText(uri)) !== before) {
      return fail(
        `${path} changed while this write was waiting for approval, so the diff shown was out ` +
          "of date. Nothing was written. Re-read the file and try again."
      );
    }

    const problem = await this.writeText(uri, content);
    if (problem) return fail(`could not write ${path}: ${problem}`);
    this.log(`${before === null ? "created" : "rewrote"} ${path}`);
    return ok(`${before === null ? "Created" : "Replaced"} ${path} (${lines} lines).`);
  }

  private async editFile(args: Record<string, unknown>): Promise<ToolOutcome> {
    const path = str(args, "path");
    const oldText = typeof args.old_text === "string" ? args.old_text : null;
    const newText = typeof args.new_text === "string" ? args.new_text : null;
    if (!path || oldText == null || newText == null) {
      return fail("edit_file needs \"path\", \"old_text\" and \"new_text\" arguments");
    }
    if (oldText === "") return fail("old_text must not be empty - use write_file to create a file");
    const uri = await this.resolve(path);
    if (!uri) return fail(`path "${path}" is outside the workspace`);

    const snapshot = await this.currentText(uri);
    if (snapshot === null) return fail(`no such file: ${path}`);

    const plan = planEdit(snapshot, oldText, newText);
    if (!plan.ok) {
      return fail(
        plan.reason === "ambiguous"
          ? `old_text occurs more than once in ${path}. Include more surrounding context so it ` +
              "identifies exactly one location."
          : `old_text was not found in ${path}. It must match the file exactly, including ` +
              "indentation and line endings. Re-read the file and copy the snippet verbatim."
      );
    }

    const approved = await this.approvals.requestChange(() =>
      previewChange(
        { uri, label: path, current: snapshot, proposed: plan.updated },
        `VegaDuta wants to edit ${path} (line ${plan.line})`,
        describeChange(summariseChange(snapshot, plan.updated))
      )
    );
    if (!approved) return fail(`the user declined the edit to ${path}`);

    // The user may have spent minutes in front of that diff, and the agent's own
    // run_command steps rewrite files too. `plan.updated` was spliced at an
    // offset in text that may no longer exist, so never write it blind: re-read,
    // and let old_text find itself again.
    const fresh = await this.currentText(uri);
    if (fresh === null) return fail(`${path} was deleted while this edit waited for approval`);

    const recheck = recheckEdit(snapshot, fresh, oldText, newText);
    if (recheck.state === "conflict") {
      return fail(
        `${path} changed while this edit waited for approval, and old_text ` +
          (recheck.reason === "ambiguous"
            ? "now matches more than one place in it"
            : "is no longer present in it") +
          `. Nothing was written. Re-read ${path} and redo the edit against its current contents.`
      );
    }

    const problem = await this.writeText(uri, recheck.updated);
    if (problem) return fail(`could not edit ${path}: ${problem}`);

    const moved = recheck.state === "reanchored";
    this.log(`edited ${path}:${recheck.line}${moved ? " (re-anchored)" : ""}`);
    return ok(
      `Edited ${path} at line ${recheck.line}.` +
        (moved
          ? ` The file had changed since you read it, so the edit was re-anchored - re-read ${path} before making another edit to it.`
          : "")
    );
  }

  private async runCommand(args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolOutcome> {
    const command = str(args, "command");
    if (!command) return fail("run_command needs a \"command\" argument");

    for (const { pattern, why } of REFUSED_COMMAND_PATTERNS) {
      if (pattern.test(command)) return fail(`refusing to run this command (${why})`);
    }

    const cwdRelative = str(args, "cwd") ?? ".";
    const cwdUri = await this.resolve(cwdRelative);
    if (!cwdUri) return fail(`cwd "${cwdRelative}" is outside the workspace`);

    if (!(await this.approvals.request("command", "VegaDuta wants to run a command", `${command}\n\nin ${cwdRelative}`))) {
      return fail("the user declined to run that command");
    }

    this.log(`$ ${command}`);
    return await new Promise<ToolOutcome>((resolve) => {
      const child = spawn(command, { cwd: cwdUri.fsPath, shell: true });
      let stdout = "";
      let stderr = "";
      let settled = false;

      const finish = (outcome: ToolOutcome): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(outcome);
      };
      const onAbort = (): void => {
        child.kill();
        finish(fail("the run was cancelled while this command was executing"));
      };
      const timer = setTimeout(() => {
        child.kill();
        finish(fail(`command timed out after ${COMMAND_TIMEOUT_MS / 1000}s: ${command}`));
      }, COMMAND_TIMEOUT_MS);

      signal?.addEventListener("abort", onAbort);
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => finish(fail(`could not start the command: ${error.message}`)));
      child.on("close", (code) => {
        // Tails, not heads: compilers and test runners put the part you need at
        // the end, and a head-truncated failure is useless to the model.
        const tail = (text: string): string =>
          text.length > MAX_COMMAND_OUTPUT_CHARS
            ? `... (truncated)\n${text.slice(-MAX_COMMAND_OUTPUT_CHARS)}`
            : text;
        const parts = [`exit code: ${code ?? "unknown"}`];
        if (stdout.trim()) parts.push(`stdout:\n${tail(stdout)}`);
        if (stderr.trim()) parts.push(`stderr:\n${tail(stderr)}`);
        if (!stdout.trim() && !stderr.trim()) parts.push("(no output)");
        // A non-zero exit is a normal, expected result the model must read and
        // act on - not a tool failure.
        finish(ok(parts.join("\n\n")));
      });
    });
  }
}
