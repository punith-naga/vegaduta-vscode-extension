// Two status bar chips, deliberately separate because they answer different
// questions and change independently:
//
//   vegaduta.status - what completions and the chat view are running on
//                     (on-device engine > hosted > signed out)
//   vegaduta.agent  - whether the coding agent has somewhere to send a task
//   vegaduta.privacy - shown only while Private Mode is on
//
// Folding the agent into the first one was the obvious move and the wrong one:
// a signed-in user with no local server would read "VegaDuta: Hosted" and have
// no idea why the agent cannot start.

import * as vscode from "vscode";
import {
  agentEndpointState,
  onDidChangeAgentEndpoint,
  type ResolvedAgentEndpoint,
} from "./agent/endpoint";
import type { TokenManager } from "./auth/tokenManager";
import type { ChatViewProvider } from "./chat/chatViewProvider";
import { isLikelyToolCapable, preferToolCapableModel } from "../../shared/src/agent/discovery";
import type { PrivateMode } from "./privacy";
import { readSettings } from "./settings";

/** The model the agent would use, and whether its NAME suggests tool calling.
 * A false `likely` is never surfaced as "this will not work" - see
 * isLikelyToolCapable - only as "worth a look". */
function modelOutlook(endpoint: ResolvedAgentEndpoint): { model: string; likely: boolean } {
  const configured = readSettings().agent.model;
  const model = configured || preferToolCapableModel(endpoint.models) || endpoint.models[0] || "";
  return { model, likely: model !== "" && isLikelyToolCapable(model) };
}

function describeAgent(item: vscode.StatusBarItem): void {
  const state = agentEndpointState();
  switch (state.kind) {
    case "resolving":
      item.text = "$(loading~spin) Agent";
      item.tooltip = "Looking for a local model server on the well-known ports";
      return;
    case "none":
      item.text = "$(tools) Agent: set up";
      item.tooltip =
        "No model server answered. Click to run \"VegaDuta: Set Up the Coding Agent\" - " +
        "it shows the install and pull commands for this machine.";
      return;
    case "ready": {
      const { endpoint } = state;
      const { model, likely } = modelOutlook(endpoint);
      if (endpoint.source === "setting") {
        item.text = "$(tools) Agent: configured";
        item.tooltip = `Coding agent talks to ${endpoint.baseUrl} (vegaduta.agent.baseUrl)`;
        return;
      }
      item.text = likely ? `$(tools) Agent: ${endpoint.label}` : "$(tools) Agent: check model";
      item.tooltip = likely
        ? `Coding agent ready: ${model} on ${endpoint.label} (${endpoint.baseUrl})`
        : `${endpoint.label} at ${endpoint.baseUrl} is serving ${model || "no model"}, which is not a ` +
          "name known to call tools here. That is a guess from the name, not a check - click to see " +
          "models that are known to work.";
      return;
    }
    default:
      item.text = "$(tools) Agent";
      item.tooltip = "Click to set up the VegaDuta coding agent";
  }
}

export function createStatusBar(
  context: vscode.ExtensionContext,
  chatView: ChatViewProvider,
  tokens: TokenManager,
  privateMode: PrivateMode
): void {
  const item = vscode.window.createStatusBarItem("vegaduta.status", vscode.StatusBarAlignment.Right, 100);
  item.name = "VegaDuta";
  item.command = "vegaduta.chat.focus";

  const agentItem = vscode.window.createStatusBarItem(
    "vegaduta.agent",
    vscode.StatusBarAlignment.Right,
    99
  );
  agentItem.name = "VegaDuta Coding Agent";
  agentItem.command = "vegaduta.setUpCodingAgent";

  const privacyItem = vscode.window.createStatusBarItem(
    "vegaduta.privacy",
    vscode.StatusBarAlignment.Right,
    101
  );
  privacyItem.name = "VegaDuta Private Mode";
  privacyItem.text = "$(lock) Private";
  privacyItem.tooltip =
    "VegaDuta Private Mode is on: no prompt, code, attachment or search query leaves this machine. " +
    "Only your local model server and the on-device model are used; hosted chat, hosted completions, " +
    "knowledge search, the code sandbox and workflow runs are off. Click to turn it off.";
  privacyItem.command = "vegaduta.togglePrivateMode";

  const update = (): void => {
    const engine = chatView.engineStatus;
    const auth = tokens.authState();
    if (engine.state === "ready") {
      item.text = "$(sparkle) VegaDuta: Local";
      item.tooltip = `On-device model ready${engine.modelId ? `: ${engine.modelId}` : ""}${engine.backend ? ` (${engine.backend})` : ""}`;
    } else if (engine.state === "loading") {
      item.text = `$(sparkle) VegaDuta: Loading ${Math.round((engine.progress ?? 0) * 100)}%`;
      item.tooltip = "Downloading/loading the on-device model";
    } else if (privateMode.isPrivate) {
      item.text = "$(sparkle) VegaDuta: No local model";
      item.tooltip =
        "Private Mode is on and no on-device model is ready, so chat and completions have nothing to run on. " +
        "Start your local model server or download an on-device model.";
    } else if (auth.signedIn) {
      item.text = "$(sparkle) VegaDuta: Hosted";
      item.tooltip = `Signed in${auth.username ? ` as ${auth.username}` : ""} - inference runs on the platform`;
    } else {
      item.text = "$(sparkle) VegaDuta: Sign in";
      item.tooltip = "Open the VegaDuta chat view to sign in";
    }
    item.show();
    if (privateMode.isPrivate) privacyItem.show();
    else privacyItem.hide();
  };

  const updateAgent = (): void => {
    describeAgent(agentItem);
    agentItem.show();
  };

  context.subscriptions.push(
    item,
    agentItem,
    privacyItem,
    chatView.onDidChangeEngineStatus(update),
    privateMode.onDidChange(update),
    tokens.onDidChangeAuth(update),
    onDidChangeAgentEndpoint(updateAgent)
  );
  update();
  updateAgent();
}
