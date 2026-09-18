// Commands that stage a prompt in the chat composer through ui.prefill
// (protocol.ts, 2026-09-18) and let the chat app attach the context kinds
// they name. Because the chat app - not this host - decides where a prompt
// runs, every command here works signed in (the hosted agent the person
// picked) AND signed out (the on-device model), with no second code path.
//
// Each command checks its context up front and says what is missing in a
// notification, rather than sending a prompt with nothing attached.

import * as vscode from "vscode";
import type { ChatViewProvider } from "../chat/chatViewProvider";
import { formatDiagnostic } from "../chat/hostContext";

/** The slash commands are the chat app's shorthand for "review this diff" /
 * "write a commit message for this diff". */
const REVIEW_PROMPT = "/review";
const COMMIT_PROMPT = "/commit";

const TESTS_PROMPT =
  "Write tests for the attached code, covering the main behaviour and realistic edge cases. " +
  "Match the test framework and style already used in this project; if none is evident, use " +
  "the conventional default for the language. Reply with the test code.";

const DOCS_PROMPT =
  "Add clear documentation to the attached code (docstrings, JSDoc or doc comments as the " +
  "language expects). Cover non-obvious parameters, return values, errors and important " +
  "behaviour; do not restate what the names already say. Reply with the fully documented code.";

async function requireDiff(chatView: ChatViewProvider, repositoryRoot?: vscode.Uri): Promise<boolean> {
  const outcome = await chatView.collectContext("diff", repositoryRoot);
  if ("reason" in outcome) {
    void vscode.window.showInformationMessage(`VegaDuta: ${outcome.reason}.`);
    return false;
  }
  return true;
}

export async function reviewChanges(chatView: ChatViewProvider): Promise<void> {
  if (!(await requireDiff(chatView))) return;
  await chatView.prefill({ text: REVIEW_PROMPT, context: ["diff"], send: true });
}

/** From the Source Control title bar VS Code passes the SourceControl the
 * button belongs to; its rootUri picks the repository in a multi-root
 * workspace. From the command palette there is no argument. */
export async function generateCommitMessage(
  chatView: ChatViewProvider,
  sourceControl?: { rootUri?: vscode.Uri }
): Promise<void> {
  const repositoryRoot = sourceControl?.rootUri instanceof vscode.Uri ? sourceControl.rootUri : undefined;
  if (!(await requireDiff(chatView, repositoryRoot))) return;
  await chatView.prefill({ text: COMMIT_PROMPT, context: ["diff"], send: true, repositoryRoot });
}

function requireSelection(): vscode.TextEditor | null {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    void vscode.window.showInformationMessage("VegaDuta: select some code first.");
    return null;
  }
  return editor;
}

export async function writeTestsForSelection(chatView: ChatViewProvider): Promise<void> {
  if (!requireSelection()) return;
  await chatView.prefill({ text: TESTS_PROMPT, context: ["selection"], send: true });
}

export async function addDocsToSelection(chatView: ChatViewProvider): Promise<void> {
  if (!requireSelection()) return;
  await chatView.prefill({ text: DOCS_PROMPT, context: ["selection"], send: true });
}

/** Up to three lines either side of the problem, so the explanation is about
 * real code even when nothing is selected (the usual lightbulb case). */
function surroundingCode(document: vscode.TextDocument, range: vscode.Range): string {
  const first = Math.max(0, range.start.line - 3);
  const last = Math.min(document.lineCount - 1, range.end.line + 3);
  const lines: string[] = [];
  for (let i = first; i <= last; i++) {
    lines.push(`${String(i + 1).padStart(4)} | ${document.lineAt(i).text}`);
  }
  return lines.join("\n");
}

function fence(code: string): string {
  // A fence longer than any backtick run inside, so the code cannot close it.
  const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length));
  const ticks = "`".repeat(Math.max(3, longest + 1));
  return `${ticks}\n${code}\n${ticks}`;
}

/** Quick fix / command: explain one diagnostic. `uri` and `diagnostic` come
 * from the code action; from the palette, the first problem under the cursor
 * is used. */
export async function explainProblem(
  chatView: ChatViewProvider,
  uri?: vscode.Uri,
  diagnostic?: vscode.Diagnostic
): Promise<void> {
  let document: vscode.TextDocument | undefined;
  if (uri instanceof vscode.Uri) {
    document = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  }
  const editor = vscode.window.activeTextEditor;
  if (!document && editor) document = editor.document;
  if (!document) {
    void vscode.window.showInformationMessage("VegaDuta: open a file with a problem first.");
    return;
  }

  let target = diagnostic;
  if (!target) {
    const cursor = editor?.selection.active;
    const all = vscode.languages.getDiagnostics(document.uri);
    target =
      (cursor ? all.find((d) => d.range.contains(cursor)) : undefined) ??
      (cursor ? all.find((d) => d.range.start.line === cursor.line) : undefined);
    if (!target) {
      void vscode.window.showInformationMessage(
        "VegaDuta: there is no problem under the cursor. Put the cursor on a squiggle, or use the lightbulb's " +
          "\"VegaDuta: Explain this problem\"."
      );
      return;
    }
  }

  const text =
    "Explain this problem in plain language: what it means, why it happens here, and how to fix it. " +
    "Show the corrected code.\n\n" +
    `${formatDiagnostic(document.uri, target)}${target.source ? ` (${target.source})` : ""}\n\n` +
    fence(surroundingCode(document, target.range));

  // Attach the selection too when the person has one in this document - it
  // is usually the wider code they want explained.
  const hasSelection =
    editor !== undefined &&
    editor.document.uri.toString() === document.uri.toString() &&
    !editor.selection.isEmpty;

  await chatView.prefill({ text, context: hasSelection ? ["selection"] : undefined, send: true });
}

/** Lightbulb entry for explainProblem: one quick fix per diagnostic in range
 * (at most three, so the menu stays readable). */
export class ExplainProblemActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    if (context.only && !context.only.contains(vscode.CodeActionKind.QuickFix)) return [];
    const diagnostics = context.diagnostics.slice(0, 3);
    return diagnostics.map((diagnostic) => {
      const short = diagnostic.message.split("\n")[0];
      const title =
        diagnostics.length === 1
          ? "VegaDuta: Explain this problem"
          : `VegaDuta: Explain "${short.length > 50 ? `${short.slice(0, 49)}…` : short}"`;
      const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
      action.diagnostics = [diagnostic];
      action.command = {
        command: "vegaduta.explainProblem",
        title,
        arguments: [document.uri, diagnostic],
      };
      return action;
    });
  }
}
