// Registers every contributed vegaduta.* command against the shared deps.

import * as vscode from "vscode";
import type { ApiFacade } from "../api";
import type { TokenManager } from "../auth/tokenManager";
import type { ChatViewProvider } from "../chat/chatViewProvider";
import { PRIVATE_MODE_BLOCKED, type PrivateMode } from "../privacy";
import { setAgentApiKey, startCodingTask } from "../agent/runTask";
import { setUpCodingAgent } from "../agent/setup";
import { chatWithAgent } from "./agents";
import { runSelectionLocally } from "./localAction";
import {
  addDocsToSelection,
  ExplainProblemActionProvider,
  explainProblem,
  generateCommitMessage,
  reviewChanges,
  writeTestsForSelection,
} from "./prefill";
import { sendSelectionToChat } from "./selection";
import { runWorkflowCommand } from "./workflows";

export interface CommandDeps {
  api: ApiFacade;
  tokens: TokenManager;
  chatView: ChatViewProvider;
  /** The agent commands need SecretStorage for the BYOK key. */
  context: vscode.ExtensionContext;
  privateMode: PrivateMode;
}

/** Turn Private Mode on, or (after a confirmation - it relaxes a guarantee)
 * off. The chat view mirrors the change through privacy.state. */
export async function togglePrivateMode(privateMode: PrivateMode): Promise<void> {
  if (!privateMode.isPrivate) {
    await privateMode.set(true);
    void vscode.window.showInformationMessage(
      "VegaDuta Private Mode is on: no prompt, code, attachment or search query leaves this machine. " +
        "Chat, completions and quick actions use your local model server or the on-device model; " +
        "hosted chat, knowledge search, the code sandbox and workflow runs are off."
    );
    return;
  }
  const choice = await vscode.window.showWarningMessage(
    "Turn Private Mode off? Hosted chat, hosted completions, knowledge search, the code sandbox and " +
      "workflow runs will be able to send your prompts and code to the VegaDuta platform again.",
    { modal: true },
    "Turn Off"
  );
  if (choice === "Turn Off") await privateMode.set(false);
}

export function registerCommands(deps: CommandDeps): vscode.Disposable[] {
  const { api, tokens, chatView, context, privateMode } = deps;
  // Commands whose prompt the chat app would send to the platform when no
  // on-device model is ready. Under Private Mode with no local model they
  // stop here with a reason instead of staging a prompt that cannot run.
  const unlessPrivate =
    <A extends unknown[]>(fn: (...args: A) => unknown) =>
    async (...args: A): Promise<unknown> =>
      (await chatView.refuseHostedCommandWhilePrivate()) ? undefined : fn(...args);
  return [
    vscode.commands.registerCommand("vegaduta.togglePrivateMode", () => togglePrivateMode(privateMode)),
    vscode.commands.registerCommand("vegaduta.startCodingTask", () =>
      startCodingTask(context, () => privateMode.isPrivate)
    ),
    vscode.commands.registerCommand("vegaduta.setUpCodingAgent", () => setUpCodingAgent(context)),
    vscode.commands.registerCommand("vegaduta.setAgentApiKey", () => setAgentApiKey(context)),
    vscode.commands.registerCommand("vegaduta.downloadModel", () => chatView.showModels()),
    vscode.commands.registerCommand("vegaduta.signIn", async () => {
      if (await tokens.signIn()) {
        await chatView.onAuthChanged();
      }
    }),
    vscode.commands.registerCommand("vegaduta.signOut", async () => {
      await tokens.signOut();
      await chatView.onAuthChanged();
      void vscode.window.showInformationMessage("VegaDuta: signed out.");
    }),
    vscode.commands.registerCommand("vegaduta.pasteApiKey", async () => {
      if (await tokens.pasteApiKey()) {
        await chatView.onAuthChanged();
      }
    }),
    vscode.commands.registerCommand("vegaduta.chatWithAgent", () => chatWithAgent(api, chatView)),
    vscode.commands.registerCommand("vegaduta.runWorkflow", () => {
      // Workflows only ever run on the platform.
      if (privateMode.isPrivate) {
        void vscode.window.showWarningMessage(`VegaDuta: ${PRIVATE_MODE_BLOCKED} - workflow runs are off.`);
        return;
      }
      return runWorkflowCommand(api);
    }),
    vscode.commands.registerCommand(
      "vegaduta.explainSelection",
      unlessPrivate(() => sendSelectionToChat(chatView, "explain"))
    ),
    vscode.commands.registerCommand(
      "vegaduta.fixSelection",
      unlessPrivate(() => sendSelectionToChat(chatView, "fix"))
    ),
    vscode.commands.registerCommand(
      "vegaduta.refactorSelection",
      unlessPrivate(() => sendSelectionToChat(chatView, "refactor"))
    ),
    // Ids kept from 0.2.0 so existing keybindings still work; since 0.3.0
    // they prefill + send through the chat app (hosted or on-device).
    vscode.commands.registerCommand(
      "vegaduta.generateTests",
      unlessPrivate(() => writeTestsForSelection(chatView))
    ),
    vscode.commands.registerCommand(
      "vegaduta.addDocumentation",
      unlessPrivate(() => addDocsToSelection(chatView))
    ),
    vscode.commands.registerCommand("vegaduta.reviewChanges", unlessPrivate(() => reviewChanges(chatView))),
    vscode.commands.registerCommand(
      "vegaduta.generateCommitMessage",
      unlessPrivate((sourceControl?: { rootUri?: vscode.Uri }) => generateCommitMessage(chatView, sourceControl))
    ),
    vscode.commands.registerCommand(
      "vegaduta.explainProblem",
      unlessPrivate((uri?: vscode.Uri, diagnostic?: vscode.Diagnostic) => explainProblem(chatView, uri, diagnostic))
    ),
    vscode.languages.registerCodeActionsProvider({ pattern: "**" }, new ExplainProblemActionProvider(), {
      providedCodeActionKinds: ExplainProblemActionProvider.providedCodeActionKinds,
    }),
    vscode.commands.registerCommand("vegaduta.explainSelectionLocal", () =>
      runSelectionLocally(chatView, "explain")
    ),
    vscode.commands.registerCommand("vegaduta.fixSelectionLocal", () =>
      runSelectionLocally(chatView, "fix")
    ),
    vscode.commands.registerCommand("vegaduta.refactorSelectionLocal", () =>
      runSelectionLocally(chatView, "refactor")
    ),
    vscode.commands.registerCommand("vegaduta.toggleCompletions", async () => {
      const cfg = vscode.workspace.getConfiguration("vegaduta");
      const current = cfg.get<string>("completions.provider", "auto");
      const next = current === "off" ? "auto" : "off";
      await cfg.update("completions.provider", next, vscode.ConfigurationTarget.Global);
      void vscode.window.showInformationMessage(
        `VegaDuta inline completions: ${next === "off" ? "off" : "on (auto)"}.`
      );
    }),
  ];
}
