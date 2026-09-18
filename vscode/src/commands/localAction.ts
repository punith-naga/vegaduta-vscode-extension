// Right-click actions that run entirely on-device via the chat webview's
// WebLLM engine (LocalTaskKind explain/fix/refactor over the shared
// protocol - clients/shared/src/webview/protocol.ts). Deliberately a
// separate mechanism from selection.ts's hosted path: no call to the
// platform API, no tenant agent, no budget/guardrail advisors, no network
// beyond whatever the model already downloaded - just the developer's own
// GPU, or a clear "not ready" message if the engine isn't.
//
// The engine host itself (clients/shared/src/webview/engineHost.ts) already
// handles these kinds end-to-end, including fix/refactor validation via
// POST /api/tools/code/validate - this file only needs to call
// ChatViewProvider.requestEngine and present the result.

import { basename } from "node:path";
import * as vscode from "vscode";
import type { ChatViewProvider } from "../chat/chatViewProvider";

export type LocalSelectionAction = "explain" | "fix" | "refactor";

/** Generous one-shot deadline for a context-menu action (not the tight
 * 1200ms budget inline completions use) - still well under the engine's own
 * 120s whole-turn ceiling. */
const LOCAL_DEADLINE_MS = 60_000;

const CODE_OUTPUT_ACTIONS: ReadonlySet<LocalSelectionAction> = new Set(["fix", "refactor"]);

const PROGRESS_TITLES: Record<LocalSelectionAction, string> = {
  explain: "VegaDuta: explaining selection locally (WebLLM)…",
  fix: "VegaDuta: fixing selection locally (WebLLM)…",
  refactor: "VegaDuta: refactoring selection locally (WebLLM)…",
};

export async function runSelectionLocally(
  chatView: ChatViewProvider,
  action: LocalSelectionAction
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    void vscode.window.showInformationMessage("VegaDuta: select some code first.");
    return;
  }
  const selection = editor.selection;
  // Generation can take up to LOCAL_DEADLINE_MS, plus however long the user
  // takes to click "Replace Selection" afterward - the document can change
  // in that gap. Compare against this version before applying the edit so a
  // stale Selection never overwrites text the user has since edited.
  const documentVersion = editor.document.version;
  const text = editor.document.getText(selection);
  const languageId = editor.document.languageId;

  // The engine host lives inside the chat webview - it must be mounted (and
  // its own backend probe finished) before requestEngine can answer
  // anything other than "engine-unavailable".
  await chatView.reveal();
  if (chatView.engineStatus.state !== "ready") {
    const detail = chatView.engineStatus.detail ? ` (${chatView.engineStatus.detail})` : "";
    const pick = await vscode.window.showWarningMessage(
      `VegaDuta: no on-device model is ready${detail}. Download one (runs on your GPU, ` +
        `nothing leaves your machine) or start a local server such as Ollama - or use the ` +
        `regular hosted "${action}" command instead.`,
      "Download a model"
    );
    if (pick === "Download a model") {
      await chatView.showModels();
    }
    return;
  }

  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: PROGRESS_TITLES[action], cancellable: true },
    (_progress, token) => chatView.requestEngine(action, { text, languageId }, LOCAL_DEADLINE_MS, token)
  );

  if (!result.ok || !result.text) {
    void vscode.window.showWarningMessage(`VegaDuta (local): ${describeFailure(result.reason)}`);
    return;
  }

  if (CODE_OUTPUT_ACTIONS.has(action)) {
    await presentCodeResult(editor, selection, documentVersion, result.text, action);
  } else {
    await presentProseResult(result.text, basename(editor.document.fileName));
  }
}

async function presentCodeResult(
  editor: vscode.TextEditor,
  selection: vscode.Selection,
  documentVersion: number,
  text: string,
  action: LocalSelectionAction
): Promise<void> {
  const label = action === "fix" ? "fix" : "refactor";
  const choice = await vscode.window.showInformationMessage(
    `VegaDuta (local WebLLM) proposed a ${label} for the selection. Nothing has been changed yet.`,
    "Replace Selection",
    "Copy to Clipboard"
  );
  if (choice === "Replace Selection") {
    if (editor.document.version !== documentVersion) {
      // The file changed while generating or while this prompt was open -
      // `selection`'s positions may no longer point at the original code.
      // Copy instead of risking an edit at the wrong location.
      void vscode.window.showWarningMessage(
        "VegaDuta: the file changed since this suggestion was generated - copied to clipboard instead of replacing, to avoid overwriting the wrong text."
      );
      await vscode.env.clipboard.writeText(text);
      return;
    }
    await editor.edit((edit) => edit.replace(selection, text));
  } else if (choice === "Copy to Clipboard") {
    await vscode.env.clipboard.writeText(text);
  }
}

async function presentProseResult(text: string, fileName: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({
    content: `# VegaDuta (local WebLLM) — ${fileName}\n\n${text}\n`,
    language: "markdown",
  });
  await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
}

function describeFailure(reason?: string): string {
  switch (reason) {
    case "unavailable":
    case "engine-unavailable":
      return "no local engine is ready right now - download a model in the chat panel first.";
    case "context-window-exceeded":
      return "the selection is too large for the local model's context window.";
    case "timeout":
    case "generation-timeout":
    case "turn-ceiling-exceeded":
      return "the local model didn't finish in time.";
    case "cancelled":
    case "aborted":
      return "cancelled.";
    default:
      return reason ? `failed (${reason}).` : "failed.";
  }
}
