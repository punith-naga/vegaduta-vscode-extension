// Typed view over the vegaduta.* configuration. Read lazily (never cached
// across calls) so configuration changes take effect without a reload
// wherever possible.

import * as vscode from "vscode";
import { ENVIRONMENTS } from "../../shared/src/api/types";

export type EnvironmentName = "staging" | "production" | "custom";
export type CompletionsProviderSetting = "auto" | "local" | "hosted" | "off";

export interface VegadutaSettings {
  environment: EnvironmentName;
  apiBase: string;
  authBase: string;
  completionsProvider: CompletionsProviderSetting;
  edgeEnabled: boolean;
  /** Origin of the local OpenAI-compatible server, seeded into the webview
   * engine kv via init.edgeSettings. Empty = the engine default
   * (http://127.0.0.1:11434). */
  ollamaBaseUrl: string;
  agent: AgentSettings;
}

export interface AgentSettings {
  /** OpenAI-compatible origin. Empty = the local default (127.0.0.1:11434).
   * Set this to a hosted provider (Groq, OpenRouter, ...) for the BYOK path. */
  baseUrl: string;
  /** Empty = adopt the first model the server lists. */
  model: string;
  /** Hard ceiling on loop iterations. See DEFAULT_MAX_STEPS for why one exists. */
  maxSteps: number;
  /** Both default false: a coding agent that edits and runs commands without
   * asking is not a default anyone should get by installing an extension. */
  autoApproveEdits: boolean;
  autoApproveCommands: boolean;
}

let warnedIncompleteCustom = false;

export function readSettings(): VegadutaSettings {
  const cfg = vscode.workspace.getConfiguration("vegaduta");
  const environment = cfg.get<EnvironmentName>("environment", "production");

  let apiBase: string;
  let authBase: string;
  if (environment === "custom") {
    apiBase = (cfg.get<string>("customApiBase") ?? "").trim().replace(/\/$/, "");
    authBase = (cfg.get<string>("customAuthBase") ?? "").trim().replace(/\/$/, "");
    if (!apiBase || !authBase) {
      // RULE 0: never invent a localhost default. An incomplete custom
      // environment falls back to staging, loudly, once per session.
      if (!warnedIncompleteCustom) {
        warnedIncompleteCustom = true;
        void vscode.window.showWarningMessage(
          "VegaDuta: environment is \"custom\" but vegaduta.customApiBase / vegaduta.customAuthBase " +
            "are not both set. Using staging until they are."
        );
      }
      apiBase = ENVIRONMENTS.staging.apiBase;
      authBase = ENVIRONMENTS.staging.authBase;
    }
  } else {
    apiBase = ENVIRONMENTS[environment].apiBase;
    authBase = ENVIRONMENTS[environment].authBase;
  }

  return {
    environment,
    apiBase,
    authBase,
    completionsProvider: cfg.get<CompletionsProviderSetting>("completions.provider", "auto"),
    edgeEnabled: cfg.get<boolean>("edge.enabled", true),
    ollamaBaseUrl: (cfg.get<string>("ollama.baseUrl") ?? "").trim(),
    agent: {
      baseUrl: (cfg.get<string>("agent.baseUrl") ?? "").trim(),
      model: (cfg.get<string>("agent.model") ?? "").trim(),
      maxSteps: Math.max(1, cfg.get<number>("agent.maxSteps", 60)),
      autoApproveEdits: cfg.get<boolean>("agent.autoApproveEdits", false),
      autoApproveCommands: cfg.get<boolean>("agent.autoApproveCommands", false),
    },
  };
}
