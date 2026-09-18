// Extension entry point. Wiring order: settings -> TokenManager ->
// ApiFacade (VegadutaClient/DevApiClient) -> ChatViewProvider -> commands,
// inline completions, status bar.

import * as vscode from "vscode";
import { disposeDiffPreview } from "./agent/diffPreview";
import { agentEndpointDisposable, refreshAgentEndpoint } from "./agent/endpoint";
import { ApiFacade } from "./api";
import { TokenManager } from "./auth/tokenManager";
import { ChatViewProvider } from "./chat/chatViewProvider";
import { registerCommands } from "./commands";
import { VegadutaInlineCompletionProvider } from "./completions/provider";
import { PrivateMode } from "./privacy";
import { readSettings } from "./settings";
import { createStatusBar } from "./statusBar";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const tokens = new TokenManager(context.secrets, () => readSettings().authBase);
  await tokens.initialize();

  // Private Mode is read from globalState before anything can make a hosted
  // call, so a reload never opens a window in which it is briefly off.
  const privateMode = new PrivateMode(context.globalState);

  const api = new ApiFacade(readSettings, tokens);
  const chatView = new ChatViewProvider(context.extensionUri, api, tokens, readSettings, privateMode);

  // Held so the auth listener below can clear the hosted-completion client's
  // sticky/cooldown state. Without that, signing in leaves the "not signed in"
  // cooldown running and the first minute after a successful sign-in still
  // returns no completions — the client exposes reset() for exactly this and
  // nothing was calling it.
  //
  // `tokens` was never passed here before 0.3.0, so the provider built no
  // hosted client and vegaduta.completions.provider "hosted"/"auto" silently
  // never reached the platform. Passing it makes the setting do what it says.
  const completions = new VegadutaInlineCompletionProvider(chatView, tokens, () => privateMode.isPrivate);

  context.subscriptions.push(
    privateMode,
    tokens,
    chatView,
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewId, chatView, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    ...registerCommands({ api, tokens, chatView, context, privateMode }),
    vscode.languages.registerInlineCompletionItemProvider({ pattern: "**" }, completions),
    tokens.onDidChangeAuth(() => {
      completions.resetHosted();
      void chatView.onAuthChanged();
    }),
    agentEndpointDisposable,
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("vegaduta")) {
        void chatView.onSettingsChanged();
      }
      // The discovered endpoint is cached for the session, so a user who edits
      // the setting must not keep talking to the old one.
      if (event.affectsConfiguration("vegaduta.agent.baseUrl")) {
        void refreshAgentEndpoint();
      }
    })
  );

  createStatusBar(context, chatView, tokens, privateMode);

  // Probe once at startup so the status bar can say whether the agent has
  // anywhere to go before the user asks it to do anything. Three loopback
  // requests to the user's own machine, fired concurrently, nothing hosted -
  // and skipped entirely when vegaduta.agent.baseUrl is set.
  void refreshAgentEndpoint();
}

export function deactivate(): void {
  // Everything else is disposed via context.subscriptions; the agent's diff
  // content provider registers itself lazily, so it is not in there.
  disposeDiffPreview();
}
