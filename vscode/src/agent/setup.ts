// "VegaDuta: Set Up the Coding Agent" - the path from a fresh install to a
// working agent, for a user who has never heard of Ollama.
//
// The command answers one question at a time: is anything running? is it
// serving a model? does that model look like it can call tools? Each "no" ends
// with the concrete next step for this machine - a command to copy, not a
// documentation link to go read.
//
// Nothing here probes the VegaDuta platform or needs an account: the addresses
// involved are the user's own loopback inference ports (RULE 0 carve-out, as in
// shared/agent/discovery.ts) or an origin the user typed into
// `vegaduta.agent.baseUrl` themselves.

import * as vscode from "vscode";
import {
  LOCAL_ENDPOINTS,
  TOOL_CAPABLE_MODELS,
  isLikelyToolCapable,
  listModels,
  preferToolCapableModel,
  toolCapabilityNote,
} from "../../../shared/src/agent/discovery";
import { readSettings } from "../settings";
import {
  AGENT_API_KEY_SECRET,
  type ResolvedAgentEndpoint,
  refreshAgentEndpoint,
} from "./endpoint";

/** 7B fits the machines this extension is installed on far more often than the
 * bigger tags do, so the copyable command pins a size rather than leaving the
 * user to pick one. */
const OLLAMA_PULL_COMMAND = "ollama pull qwen2.5-coder:7b";

/** A hosted BYOK provider can take several seconds to answer /v1/models, and
 * the user is watching a progress notification while it does. */
const CONFIGURED_PROBE_TIMEOUT_MS = 6_000;

interface InstallCommand {
  platform: string;
  command: string;
}

/** Package-manager line for this OS. Offered next to the download page rather
 * than instead of it: whether `winget`/`brew` are present, and under which
 * package id, depends on the machine - the installer on the site does not. */
function ollamaInstallCommand(): InstallCommand {
  switch (process.platform) {
    case "win32":
      return { platform: "Windows", command: "winget install --id Ollama.Ollama" };
    case "darwin":
      return { platform: "macOS", command: "brew install ollama" };
    default:
      return { platform: "Linux", command: "curl -fsSL https://ollama.com/install.sh | sh" };
  }
}

interface CopyableStep {
  /** Button title. */
  title: string;
  text: string;
}

interface SetupRoute {
  label: string;
  /** From LOCAL_ENDPOINTS - one sentence on how to get this server running. */
  hint: string;
  copyables: CopyableStep[];
  docsUrl?: string;
}

function routeFor(label: string, hint: string): SetupRoute {
  if (label === "Ollama") {
    const install = ollamaInstallCommand();
    return {
      label,
      hint: `${hint} On ${install.platform}: \`${install.command}\`, then \`${OLLAMA_PULL_COMMAND}\`.`,
      copyables: [
        { title: "Copy install command", text: install.command },
        { title: "Copy pull command", text: OLLAMA_PULL_COMMAND },
      ],
      docsUrl: "https://ollama.com/download",
    };
  }
  if (label === "LM Studio") {
    // Loading a model and flipping the server switch are GUI steps; there is no
    // command to hand over, so do not pretend there is one.
    return { label, hint, copyables: [], docsUrl: "https://lmstudio.ai" };
  }
  return {
    label,
    hint,
    copyables: [{ title: "Copy server command", text: "llama-server -m <model>.gguf --port 8080" }],
  };
}

/** What the user chose to do next. */
type NextStep = "recheck" | "stop";

interface PassResult {
  next: NextStep;
  /** Whether this pass ended with something the agent can actually call. An
   * endpoint that lists no models is not that, even though it exists. */
  usable: boolean;
}

async function showRoute(route: SetupRoute): Promise<NextStep> {
  const buttons = [...route.copyables.map((step) => step.title)];
  if (route.docsUrl) buttons.push("Open download page");
  buttons.push("Check again");

  for (;;) {
    const choice = await vscode.window.showInformationMessage(
      `VegaDuta - ${route.label}: ${route.hint}`,
      ...buttons
    );
    if (choice === undefined || choice === "Check again") {
      // Dismissing the notification is not "give up": the user has most likely
      // gone to a terminal to run the command, and re-probing costs three
      // loopback round trips.
      return choice === "Check again" ? "recheck" : "stop";
    }
    if (choice === "Open download page" && route.docsUrl) {
      await vscode.env.openExternal(vscode.Uri.parse(route.docsUrl));
      continue;
    }
    const copyable = route.copyables.find((step) => step.title === choice);
    if (copyable) {
      await vscode.env.clipboard.writeText(copyable.text);
      void vscode.window.setStatusBarMessage(`VegaDuta: copied \`${copyable.text}\``, 4_000);
    }
  }
}

async function useHostedProvider(): Promise<NextStep> {
  await vscode.commands.executeCommand("vegaduta.setAgentApiKey");
  const opened = await vscode.window.showInformationMessage(
    "VegaDuta: set vegaduta.agent.baseUrl to your provider's OpenAI-compatible origin " +
      "(for example https://api.groq.com/openai). The key you just entered is sent to that origin only.",
    "Open Settings",
    "Check again"
  );
  if (opened === "Open Settings") {
    await vscode.commands.executeCommand("workbench.action.openSettings", "vegaduta.agent.baseUrl");
  }
  return opened === undefined ? "stop" : "recheck";
}

/** Nothing answered on any known port. Offer the three local servers and the
 * BYOK path, each with its own concrete next step. */
async function offerInstall(): Promise<NextStep> {
  interface Item extends vscode.QuickPickItem {
    route?: SetupRoute;
    hosted?: boolean;
  }

  const items: Item[] = LOCAL_ENDPOINTS.map((endpoint, index) => {
    const route = routeFor(endpoint.label, endpoint.hint);
    return {
      label: `$(server) ${endpoint.label}`,
      description: index === 0 ? "recommended - no GUI step" : new URL(endpoint.baseUrl).port,
      detail: route.hint,
      route,
    };
  });
  items.push({
    label: "$(key) Use a hosted provider with my own API key",
    detail: "Groq, OpenRouter, Together, OpenAI - anything OpenAI-compatible. Free tiers work.",
    hosted: true,
  });

  const ports = LOCAL_ENDPOINTS.map((endpoint) => new URL(endpoint.baseUrl).port).join(", ");
  const picked = await vscode.window.showQuickPick(items, {
    title: "VegaDuta: no model server is running",
    placeHolder: `Nothing answered on 127.0.0.1 ports ${ports}. Pick how you want to run the agent.`,
    ignoreFocusOut: true,
  });

  if (!picked) return "stop";
  if (picked.hosted) return useHostedProvider();
  return showRoute(picked.route!);
}

/** Names the curated models without claiming more than the heuristic knows. */
function toolCapableSuggestion(): string {
  const names = TOOL_CAPABLE_MODELS.map((model) => model.id).join(", ");
  return `Models seen to work here: ${names}.`;
}

/**
 * A server answered. Report what it is serving, and whether the model it will
 * actually use looks tool-capable.
 *
 * The capability line is deliberately hedged: `isLikelyToolCapable` matches on
 * the model NAME and nothing else, so a false result is an absence of
 * knowledge, not a verdict - saying "this model cannot call tools" here would
 * be a claim this code cannot make.
 */
async function reportReady(
  endpoint: ResolvedAgentEndpoint,
  context: vscode.ExtensionContext,
  offerToStart: boolean
): Promise<PassResult> {
  const configuredModel = readSettings().agent.model;
  let models = endpoint.models;
  if (models.length === 0) {
    // A configured endpoint is taken on trust and never probed during
    // resolution; ask it here, with the key, because this command's whole job
    // is to find out.
    models = await listModels(endpoint.baseUrl, {
      apiKey: await context.secrets.get(AGENT_API_KEY_SECRET),
      timeoutMs: CONFIGURED_PROBE_TIMEOUT_MS,
    });
  }

  const where = `${endpoint.label} (${endpoint.baseUrl})`;

  if (models.length === 0) {
    const choice = await vscode.window.showWarningMessage(
      `VegaDuta: ${where} did not list any models. That is fatal for a local server ` +
        "and merely unusual for a hosted provider - some do not expose /v1/models, and the agent " +
        "will still try. If it is local, load a model there; if it is hosted, check the origin and the key.",
      "Set API Key",
      "Open Settings",
      "Check again"
    );
    if (choice === "Set API Key") await vscode.commands.executeCommand("vegaduta.setAgentApiKey");
    if (choice === "Open Settings") {
      await vscode.commands.executeCommand("workbench.action.openSettings", "vegaduta.agent");
    }
    // A hosted origin that hides /v1/models is still worth trying; a local
    // server with nothing loaded is not.
    return { next: choice === undefined ? "stop" : "recheck", usable: endpoint.source === "setting" };
  }

  const chosen = configuredModel || preferToolCapableModel(models) || models[0];
  const startButton = offerToStart ? ["Start a Coding Task"] : [];

  if (isLikelyToolCapable(chosen)) {
    const note = toolCapabilityNote(chosen);
    const choice = await vscode.window.showInformationMessage(
      `VegaDuta coding agent is set up: ${chosen} on ${where}.` +
        (note ? ` ${note}` : "") +
        " Tool calling is only proven on the first task - if that model turns out not to support it, " +
        "the agent says so and names alternatives.",
      ...startButton
    );
    if (choice === "Start a Coding Task") {
      await vscode.commands.executeCommand("vegaduta.startCodingTask");
    }
    return { next: "stop", usable: true };
  }

  const isOllama = endpoint.label === "Ollama";
  const buttons = [
    ...(isOllama ? ["Copy pull command"] : []),
    ...startButton,
  ];
  const choice = await vscode.window.showWarningMessage(
    `VegaDuta: ${where} is serving ${models.slice(0, 4).join(", ")}${models.length > 4 ? ", …" : ""}, ` +
      `and the agent would use ${chosen}. None of those names is one this extension recognises as a ` +
      "tool-calling model - that is a guess from the name, not a check, so if yours does call tools it " +
      `will work fine. ${toolCapableSuggestion()}`,
    ...buttons
  );
  if (choice === "Copy pull command") {
    await vscode.env.clipboard.writeText(OLLAMA_PULL_COMMAND);
    void vscode.window.setStatusBarMessage(`VegaDuta: copied \`${OLLAMA_PULL_COMMAND}\``, 4_000);
    return { next: "recheck", usable: true };
  }
  if (choice === "Start a Coding Task") {
    await vscode.commands.executeCommand("vegaduta.startCodingTask");
  }
  // Unrecognised name or not, there is a model here and the user may well be
  // right about it - this is not a blocked state.
  return { next: "stop", usable: true };
}

export interface SetUpOptions {
  /** False when the setup flow was entered from `startCodingTask`, which
   * resumes the task itself - offering a "Start a Coding Task" button there
   * would re-enter the command the user is already inside. */
  offerToStart?: boolean;
}

/**
 * Walks the user from nothing to a working agent. Returns true when the flow
 * ended with a reachable endpoint, so a caller that interrupted its own work to
 * run setup can decide whether to carry on.
 *
 * Re-probes (never trusts the session cache) on every pass: the entire point of
 * "Check again" is that the user just started something.
 */
export async function setUpCodingAgent(
  context: vscode.ExtensionContext,
  options: SetUpOptions = {}
): Promise<boolean> {
  const offerToStart = options.offerToStart ?? true;

  for (;;) {
    const endpoint = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: "VegaDuta: looking for a local model server" },
      () => refreshAgentEndpoint()
    );

    const pass: PassResult = endpoint
      ? await reportReady(endpoint, context, offerToStart)
      : { next: await offerInstall(), usable: false };

    if (pass.next === "stop") return pass.usable;
  }
}
