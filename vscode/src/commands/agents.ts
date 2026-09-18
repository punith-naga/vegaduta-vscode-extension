// "Chat with Agent…" - QuickPick over the tenant's agents, then focus the
// chat view with the pick preselected.

import * as vscode from "vscode";
import type { ApiFacade } from "../api";
import { errorMessage } from "../api";
import type { ChatViewProvider } from "../chat/chatViewProvider";

interface AgentPickItem extends vscode.QuickPickItem {
  agentId: string;
}

export async function chatWithAgent(api: ApiFacade, chatView: ChatViewProvider): Promise<void> {
  if (!api.mode()) {
    const choice = await vscode.window.showInformationMessage(
      "Sign in to VegaDuta to see your agents.",
      "Sign in"
    );
    if (choice === "Sign in") await vscode.commands.executeCommand("vegaduta.signIn");
    return;
  }

  let agents;
  try {
    agents = await api.listAgents();
  } catch (err) {
    void vscode.window.showErrorMessage(`VegaDuta: could not list agents - ${errorMessage(err)}`);
    return;
  }
  if (agents.length === 0) {
    void vscode.window.showInformationMessage("VegaDuta: no agents in this tenant yet - create one in the web console.");
    return;
  }

  const pick = await vscode.window.showQuickPick<AgentPickItem>(
    agents.map((agent) => ({
      label: agent.name,
      description: agent.model ?? undefined,
      detail: agent.description ?? undefined,
      agentId: agent.id,
    })),
    { placeHolder: "Chat with which agent?", matchOnDetail: true }
  );
  if (!pick) return;

  await chatView.reveal();
  await chatView.preselectAgent(pick.agentId);
}
