// Explain / Fix / Refactor the current selection.
//
// v1 path (simple + deterministic): reveal the chat view and stage the
// selection - instruction included - in the composer via selection.context;
// the user reviews and presses Send, so the request always goes through the
// agent they chose, with the platform's budget/guardrail advisors applied.
// Tradeoffs, accepted consciously:
//  - The instruction line sits INSIDE the fenced block the webview builds
//    (the frozen protocol's selection.context has no separate instruction
//    field). Models handle a leading instruction comment fine.
//  - The engine-ready local path (engine.request kind explain/fix/refactor)
//    is NOT used here yet: the protocol has no host->webview "append
//    assistant message" type, so a locally-generated answer would have
//    nowhere to render in the chat transcript. Revisit if the protocol
//    grows one (coordinate - it's a shared contract across three hosts).

import { basename } from "node:path";
import * as vscode from "vscode";
import type { ChatViewProvider } from "../chat/chatViewProvider";

// Write Tests / Add Docs moved to commands/prefill.ts in 0.3.0 (ui.prefill
// with the selection attached as context, then sent).
export type SelectionAction = "explain" | "fix" | "refactor";

const INSTRUCTIONS: Record<SelectionAction, string> = {
  explain: "Explain what this code does and point out any pitfalls.",
  fix: "Find and fix the bugs in this code. Reply with the corrected code and a short note on what changed.",
  refactor: "Refactor this code for clarity and maintainability without changing behavior. Reply with the refactored code.",
};

export async function sendSelectionToChat(
  chatView: ChatViewProvider,
  action: SelectionAction
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    void vscode.window.showInformationMessage("VegaDuta: select some code first.");
    return;
  }
  const text = editor.document.getText(editor.selection);
  await chatView.reveal();
  chatView.sendSelectionContext(
    `${INSTRUCTIONS[action]}\n${text}`,
    editor.document.languageId,
    basename(editor.document.fileName)
  );
}
