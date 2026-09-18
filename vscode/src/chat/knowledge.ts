// knowledge.search (webview) -> POST {apiBase}/api/knowledge/search (core's
// KnowledgeController, @Profile("knowledge")) with the host's token. The
// webview never holds a token, so "Ask the team" goes through here.
//
// The response is core's List<SearchResultResponse>:
//   { id, source, chunkIndex, content, collectionId, distance, documentId }
// mapped to the contract's KnowledgeHit. `distance` is "smaller is closer"
// (since hybrid search it is a negated fused score, not a raw cosine).

import {
  CONTEXT_ITEM_MAX_CHARS,
  type HostToWebview,
  type KnowledgeHit,
} from "../../../shared/src/webview/protocol";

export const KNOWLEDGE_TIMEOUT_MS = 15_000;
export const KNOWLEDGE_DEFAULT_TOP_K = 5;
export const KNOWLEDGE_MAX_TOP_K = 20;

export type KnowledgeResult = Extract<HostToWebview, { type: "knowledge.result" }>;

export interface KnowledgeRequest {
  reqId: string;
  query: string;
  topK?: number;
  collectionIds?: string[];
}

export interface KnowledgeDeps {
  /** "jwt" is the only auth mode with knowledge endpoints. */
  mode(): "jwt" | "apiKey" | null;
  /** An authenticated POST relative to the API base (VegadutaClient.request). */
  post(path: string, body: unknown, signal: AbortSignal): Promise<Response>;
  timeoutMs?: number;
}

export function clampTopK(topK: unknown): number {
  if (typeof topK !== "number" || !Number.isFinite(topK)) return KNOWLEDGE_DEFAULT_TOP_K;
  return Math.min(KNOWLEDGE_MAX_TOP_K, Math.max(1, Math.round(topK)));
}

function stringOrNull(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return null;
}

/** core's search response -> KnowledgeHit[]. Null for a body that is not the
 * expected shape (a proxy's HTML error page, an older core). Hits without
 * content are dropped; each content is capped like every other attachment. */
export function mapKnowledgeHits(body: unknown): KnowledgeHit[] | null {
  if (!Array.isArray(body)) return null;
  const hits: KnowledgeHit[] = [];
  body.forEach((raw, index) => {
    if (!raw || typeof raw !== "object") return;
    const r = raw as Record<string, unknown>;
    if (typeof r.content !== "string" || r.content.trim() === "") return;
    hits.push({
      id: stringOrNull(r.id) ?? `hit-${index}`,
      source: stringOrNull(r.source),
      content: r.content.length > CONTEXT_ITEM_MAX_CHARS ? r.content.slice(0, CONTEXT_ITEM_MAX_CHARS) : r.content,
      collectionId: stringOrNull(r.collectionId),
      documentId: stringOrNull(r.documentId),
      distance: typeof r.distance === "number" && Number.isFinite(r.distance) ? r.distance : null,
    });
  });
  return hits;
}

/** Never rejects: every failure is a knowledge.result with ok:false. */
export async function searchKnowledge(deps: KnowledgeDeps, request: KnowledgeRequest): Promise<KnowledgeResult> {
  const { reqId } = request;
  const fail = (reason: string): KnowledgeResult => ({ type: "knowledge.result", reqId, ok: false, reason });

  const mode = deps.mode();
  if (mode === null) return fail("signed-out");
  if (mode !== "jwt") return fail("unavailable"); // the vmcp_ API-key surface has no knowledge endpoints

  const query = typeof request.query === "string" ? request.query.trim() : "";
  if (!query) return fail("Type a question to search your team's knowledge base.");

  const body: Record<string, unknown> = { query, topK: clampTopK(request.topK) };
  const ids = Array.isArray(request.collectionIds)
    ? request.collectionIds.filter((id): id is string => typeof id === "string" && id.trim() !== "")
    : [];
  if (ids.length) body.collectionIds = ids;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? KNOWLEDGE_TIMEOUT_MS);
  try {
    const response = await deps.post("/api/knowledge/search", body, controller.signal);
    if (response.status === 401 || response.status === 403) return fail("forbidden");
    if (!response.ok) return fail("unavailable");
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      return fail("unavailable");
    }
    const hits = mapKnowledgeHits(json);
    return hits ? { type: "knowledge.result", reqId, ok: true, hits } : fail("unavailable");
  } catch {
    // Network failure, or the 15 s timeout fired.
    return fail("unavailable");
  } finally {
    clearTimeout(timer);
  }
}
