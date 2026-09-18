// "Run Workflow…" - QuickPick a workflow, prompt for input, run it and poll
// under a progress notification until a terminal status (2s interval, same
// cadence as the chat view's workflow watcher).

import * as vscode from "vscode";
import { TERMINAL_RUN_STATUSES } from "../../../shared/src/api/types";
import type { ApiFacade } from "../api";
import { errorMessage } from "../api";

const POLL_MS = 2000;

interface WorkflowPickItem extends vscode.QuickPickItem {
  workflowId: string;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runWorkflowCommand(api: ApiFacade): Promise<void> {
  if (!api.mode()) {
    const choice = await vscode.window.showInformationMessage(
      "Sign in to VegaDuta to run workflows.",
      "Sign in"
    );
    if (choice === "Sign in") await vscode.commands.executeCommand("vegaduta.signIn");
    return;
  }

  let workflows;
  try {
    workflows = await api.listWorkflows();
  } catch (err) {
    void vscode.window.showErrorMessage(`VegaDuta: could not list workflows - ${errorMessage(err)}`);
    return;
  }
  if (workflows.length === 0) {
    void vscode.window.showInformationMessage("VegaDuta: no workflows in this tenant yet.");
    return;
  }

  const pick = await vscode.window.showQuickPick<WorkflowPickItem>(
    workflows.map((wf) => ({
      label: wf.name,
      detail: wf.description ?? undefined,
      workflowId: wf.id,
    })),
    { placeHolder: "Run which workflow?", matchOnDetail: true }
  );
  if (!pick) return;

  const input = await vscode.window.showInputBox({
    title: `Input for "${pick.label}"`,
    prompt: "Workflow input (leave empty for none)",
    ignoreFocusOut: true,
  });
  if (input === undefined) return; // Esc - empty string is a valid input

  try {
    const finalRun = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `VegaDuta: running "${pick.label}"…`,
        cancellable: true,
      },
      async (progress, token) => {
        let run = await api.runWorkflow(pick.workflowId, input);
        progress.report({ message: run.status });
        while (!TERMINAL_RUN_STATUSES.has(run.status)) {
          if (token.isCancellationRequested) {
            // Stop watching only - cancelling the run itself is jwt-only and
            // destructive; the run keeps going server-side.
            return null;
          }
          await delay(POLL_MS);
          run = await api.getWorkflowRun(pick.workflowId, run.id);
          progress.report({ message: run.status });
        }
        return run;
      }
    );

    if (!finalRun) {
      void vscode.window.showInformationMessage(
        `VegaDuta: stopped watching "${pick.label}" - the run continues server-side.`
      );
    } else if (finalRun.status === "COMPLETED") {
      void vscode.window.showInformationMessage(
        `VegaDuta: workflow "${pick.label}" completed${finalRun.outputFileName ? ` (output: ${finalRun.outputFileName})` : ""}.`
      );
    } else {
      void vscode.window.showErrorMessage(
        `VegaDuta: workflow "${pick.label}" ${finalRun.status.toLowerCase()}${finalRun.errorMessage ? ` - ${finalRun.errorMessage}` : ""}.`
      );
    }
  } catch (err) {
    void vscode.window.showErrorMessage(`VegaDuta: workflow run failed - ${errorMessage(err)}`);
  }
}
