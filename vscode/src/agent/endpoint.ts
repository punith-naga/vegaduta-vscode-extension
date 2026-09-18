// Where the coding agent's requests go, decided once per session instead of
// asked of the user.
//
// Before this existed, an empty `vegaduta.agent.baseUrl` meant "assume Ollama
// on 11434", so a user running LM Studio on 1234 got a connection error and no
// idea why. Now an empty setting means "find whichever local server is actually
// running" via the shared discovery probe.
//
// RULE 0 NOTE: every address this module can produce is either the user's own
// setting or one of the loopback inference ports in shared/agent/discovery.ts -
// the user's own machine, never a browser-facing platform URL or token issuer.
//
// The result is cached for the session because discovery costs three loopback
// round trips and the answer does not change while a server keeps running; the
// cache is keyed on the setting, so editing `agent.baseUrl` re-probes.

import * as vscode from "vscode";
import { discoverLocalEndpoint, preferToolCapableModel } from "../../../shared/src/agent/discovery";
import { readSettings } from "../settings";

/** SecretStorage key for the BYOK provider key. Deliberately NOT a setting:
 * settings sync to the cloud and show up in screen shares. Lives here rather
 * than next to the command that writes it so both the task runner and the setup
 * flow can read it without importing each other. */
export const AGENT_API_KEY_SECRET = "vegaduta.agent.apiKey";

export interface ResolvedAgentEndpoint {
  /** Origin only, no trailing slash. */
  baseUrl: string;
  /** "setting" is taken on trust and never probed: it is routinely a hosted
   * BYOK provider that 401s an unauthenticated /v1/models, and treating that
   * as "not running" would break the BYOK path. */
  source: "setting" | "discovered";
  /** Product name for a discovered server, the host for a configured one. */
  label: string;
  /** Model ids the server listed. Empty for a configured endpoint - we did not
   * ask it anything. */
  models: string[];
}

export type AgentEndpointState =
  /** Nothing has probed yet this session. */
  | { kind: "unresolved" }
  | { kind: "resolving" }
  | { kind: "ready"; endpoint: ResolvedAgentEndpoint }
  /** No setting, and nothing answered on the known local ports. */
  | { kind: "none" };

const stateEmitter = new vscode.EventEmitter<AgentEndpointState>();
export const onDidChangeAgentEndpoint = stateEmitter.event;

/** Push into `context.subscriptions`: the emitter is module-level and outlives
 * any single command or view. */
export const agentEndpointDisposable: vscode.Disposable = stateEmitter;

let state: AgentEndpointState = { kind: "unresolved" };
/** The `agent.baseUrl` the cached result was computed for. */
let cachedFor: string | null = null;
/** Collapses concurrent callers (status bar at startup, a command a moment
 * later) onto one set of probes. */
let inFlight: Promise<ResolvedAgentEndpoint | null> | null = null;
/** Bumped by every refresh. A probe started before a refresh must not publish
 * its (now stale) answer over the newer one when it finally returns. */
let generation = 0;

export function agentEndpointState(): AgentEndpointState {
  return state;
}

function setState(next: AgentEndpointState): void {
  state = next;
  stateEmitter.fire(next);
}

function hostLabel(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

async function resolve(signal?: AbortSignal): Promise<ResolvedAgentEndpoint | null> {
  const mine = generation;
  const configured = readSettings().agent.baseUrl.replace(/\/+$/, "");
  const publish = (next: AgentEndpointState): void => {
    if (mine !== generation) return;
    cachedFor = configured;
    setState(next);
  };

  if (configured) {
    const endpoint: ResolvedAgentEndpoint = {
      baseUrl: configured,
      source: "setting",
      label: hostLabel(configured),
      models: [],
    };
    publish({ kind: "ready", endpoint });
    return endpoint;
  }

  publish({ kind: "resolving" });
  const found = await discoverLocalEndpoint(undefined, signal);
  if (!found) {
    publish({ kind: "none" });
    return null;
  }
  const endpoint: ResolvedAgentEndpoint = {
    baseUrl: found.baseUrl,
    source: "discovered",
    label: found.label,
    models: found.models,
  };
  publish({ kind: "ready", endpoint });
  return endpoint;
}

/**
 * The endpoint to talk to, or null when there is nothing to talk to. Never
 * throws - discovery swallows its own failures and a null here is the signal to
 * route the user into the setup flow.
 *
 * Cached per session. A cached "none" is returned as-is: re-probing on every
 * call would add a second-plus to a path that has already failed once. Callers
 * that want a fresh answer (the setup command, a settings change) call
 * `refreshAgentEndpoint`.
 */
export async function resolveAgentEndpoint(signal?: AbortSignal): Promise<ResolvedAgentEndpoint | null> {
  const configured = readSettings().agent.baseUrl.replace(/\/+$/, "");
  if (cachedFor === configured) {
    if (state.kind === "ready") return state.endpoint;
    if (state.kind === "none") return null;
  }
  if (!inFlight) {
    inFlight = resolve(signal).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

/** Drops the cache and probes again. */
export async function refreshAgentEndpoint(signal?: AbortSignal): Promise<ResolvedAgentEndpoint | null> {
  generation += 1;
  cachedFor = null;
  state = { kind: "unresolved" };
  inFlight = null;
  return resolveAgentEndpoint(signal);
}

/**
 * The model id to request, given the user's setting and what a discovered
 * server listed. An explicit setting always wins; otherwise we prefer a model
 * whose NAME suggests tool calling, and failing that return "" so the
 * OpenAI-compatible adapter adopts whatever the server lists first.
 */
export function chooseAgentModel(endpoint: ResolvedAgentEndpoint | null, configuredModel: string): string {
  if (configuredModel) return configuredModel;
  if (!endpoint) return "";
  return preferToolCapableModel(endpoint.models) ?? "";
}
