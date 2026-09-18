// One facade over the two API surfaces so callers never branch on auth mode:
//  - jwt mode  -> VegadutaClient (full surface incl. SSE streaming chat)
//  - apiKey    -> DevApiClient (/api/dev/v1, blocking chat, B2 list/status GETs)
// Rebuilt lazily per call so a vegaduta.environment change takes effect
// without restarting the extension host.

import { ApiError, VegadutaClient } from "../../shared/src/api/client";
import { DevApiClient } from "../../shared/src/api/devApi";
import { runCode as sdlcRunCode, type RunCodeResult, type SandboxLanguage } from "../../shared/src/api/sdlc";
import { streamAgentChat, type StreamChatParams, type StreamChatResult } from "../../shared/src/api/sse";
import type { AgentSummary, WorkflowRun, WorkflowSummary } from "../../shared/src/api/types";
import type { TokenManager } from "./auth/tokenManager";
import type { VegadutaSettings } from "./settings";

export class ApiFacade {
  private cached: { apiBase: string; client: VegadutaClient } | null = null;

  constructor(
    private readonly getSettings: () => VegadutaSettings,
    private readonly tokens: TokenManager
  ) {}

  mode(): "jwt" | "apiKey" | null {
    return this.tokens.mode();
  }

  private jwt(): VegadutaClient {
    const { apiBase } = this.getSettings();
    if (!this.cached || this.cached.apiBase !== apiBase) {
      this.cached = { apiBase, client: new VegadutaClient(apiBase, this.tokens) };
    }
    return this.cached.client;
  }

  private dev(): DevApiClient {
    const key = this.tokens.apiKey();
    if (!key) {
      throw new ApiError(401, "No API key stored - run \"VegaDuta: Use API Key\" first.");
    }
    return new DevApiClient(this.getSettings().apiBase, key);
  }

  listAgents(): Promise<AgentSummary[]> {
    return this.mode() === "apiKey" ? this.dev().listAgents() : this.jwt().listAgents();
  }

  listWorkflows(): Promise<WorkflowSummary[]> {
    return this.mode() === "apiKey" ? this.dev().listWorkflows() : this.jwt().listWorkflows();
  }

  runWorkflow(workflowId: string, input: string): Promise<WorkflowRun> {
    return this.mode() === "apiKey"
      ? this.dev().runWorkflow(workflowId, input)
      : this.jwt().runWorkflow(workflowId, input);
  }

  getWorkflowRun(workflowId: string, runId: string): Promise<WorkflowRun> {
    return this.mode() === "apiKey"
      ? this.dev().getWorkflowRun(workflowId, runId)
      : this.jwt().getWorkflowRun(workflowId, runId);
  }

  /** Streaming chat - JWT surface only (dev/v1 has no SSE by design; apiKey
   * callers use devChat below and receive one big chunk). */
  streamChat(params: StreamChatParams): Promise<StreamChatResult> {
    return streamAgentChat(this.jwt(), params);
  }

  devChat(
    agentId: string,
    message: string,
    sessionId?: string,
    signal?: AbortSignal
  ): ReturnType<DevApiClient["chat"]> {
    return this.dev().chat(agentId, message, sessionId, signal);
  }

  /** POST /api/sdlc/sandbox/run-code - JWT surface only (dev/v1 has no SDLC
   * routes). apiKey-mode callers get a clear typed "unavailable", not a
   * confusing 404 from attempting the call. */
  runCode(code: string, language: SandboxLanguage): Promise<RunCodeResult> {
    if (this.mode() === "apiKey") {
      return Promise.resolve({
        ok: false,
        reason: "unavailable",
        detail: "Running code in a sandbox needs a full sign-in (not an API key) - run \"VegaDuta: Sign In\".",
      });
    }
    return sdlcRunCode(this.jwt(), code, language);
  }

  /** Authenticated JSON POST on the JWT surface, returning the raw Response
   * (knowledge.ts maps statuses to the contract's reasons itself). */
  postJwt(path: string, body: unknown, signal: AbortSignal): Promise<Response> {
    return this.jwt().request(path, { method: "POST", body, signal });
  }

  /** Agents + workflows in parallel; failures degrade to empty lists (the
   * chat view shows its own signed-out / empty states). */
  async fetchLists(): Promise<{ agents: AgentSummary[]; workflows: WorkflowSummary[] }> {
    const [agents, workflows] = await Promise.all([
      this.listAgents().catch(() => [] as AgentSummary[]),
      this.listWorkflows().catch(() => [] as WorkflowSummary[]),
    ]);
    return { agents, workflows };
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
