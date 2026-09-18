// knowledge.search -> POST /api/knowledge/search: request shape, response
// mapping to KnowledgeHit, and the contract's failure reasons.

import { CONTEXT_ITEM_MAX_CHARS } from "../../../shared/src/webview/protocol";
import { assert, assertEqual } from "../test/assert";
import { clampTopK, type KnowledgeDeps, mapKnowledgeHits, searchKnowledge } from "./knowledge";

function json(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function deps(
  respond: (path: string, body: unknown, signal: AbortSignal) => Promise<Response>,
  mode: "jwt" | "apiKey" | null = "jwt"
): KnowledgeDeps & { calls: Array<{ path: string; body: unknown }> } {
  const calls: Array<{ path: string; body: unknown }> = [];
  return {
    calls,
    mode: () => mode,
    post: (path, body, signal) => {
      calls.push({ path, body });
      return respond(path, body, signal);
    },
  };
}

const CORE_HIT = {
  id: "7f1c1a52-0d7e-4a8b-9b1e-2f0e5b0c9a11",
  source: "runbooks/deploy.md",
  chunkIndex: 3,
  content: "Deploys follow the zero-downtime rules.",
  collectionId: "c0ffee00-0000-4000-8000-000000000001",
  distance: -0.42,
  documentId: null,
};

describe("clampTopK", () => {
  it("defaults to 5 and clamps to 1..20", () => {
    assertEqual(clampTopK(undefined), 5, "default");
    assertEqual(clampTopK(0), 1, "floor");
    assertEqual(clampTopK(-3), 1, "negative");
    assertEqual(clampTopK(99), 20, "ceiling");
    assertEqual(clampTopK(7.6), 8, "rounded");
    assertEqual(clampTopK(Number.NaN), 5, "NaN");
    assertEqual(clampTopK("10"), 5, "not a number");
  });
});

describe("mapKnowledgeHits", () => {
  it("maps core's SearchResultResponse to KnowledgeHit", () => {
    assertEqual(
      mapKnowledgeHits([CORE_HIT]),
      [
        {
          id: CORE_HIT.id,
          source: "runbooks/deploy.md",
          content: "Deploys follow the zero-downtime rules.",
          collectionId: CORE_HIT.collectionId,
          documentId: null,
          distance: -0.42,
        },
      ],
      "mapped"
    );
  });

  it("drops hits without content, tolerates missing fields, caps content", () => {
    const hits = mapKnowledgeHits([
      { id: "a", content: "" },
      { id: "b" },
      null,
      "junk",
      { content: "x".repeat(CONTEXT_ITEM_MAX_CHARS + 10), distance: "near" },
    ]);
    assert(hits !== null, "array in, array out");
    assertEqual(hits.length, 1, "one usable hit");
    assertEqual(hits[0].id, "hit-4", "synthesised id");
    assertEqual(hits[0].source, null, "missing source");
    assertEqual(hits[0].distance, null, "non-numeric distance");
    assertEqual(hits[0].content.length, CONTEXT_ITEM_MAX_CHARS, "capped");
  });

  it("returns null for a body that is not a list", () => {
    assertEqual(mapKnowledgeHits({ error: "nope" }), null, "object");
    assertEqual(mapKnowledgeHits("<html>"), null, "string");
  });
});

describe("searchKnowledge", () => {
  it("POSTs query, clamped topK and collectionIds, and answers ok", async () => {
    const d = deps(async () => json(200, [CORE_HIT]));
    const result = await searchKnowledge(d, {
      reqId: "k1",
      query: "  how do we deploy?  ",
      topK: 50,
      collectionIds: ["c1", "", "c2"],
    });
    assertEqual(d.calls, [
      { path: "/api/knowledge/search", body: { query: "how do we deploy?", topK: 20, collectionIds: ["c1", "c2"] } },
    ], "request");
    assertEqual(result.type, "knowledge.result", "type");
    assertEqual(result.reqId, "k1", "reqId");
    assertEqual(result.ok, true, "ok");
    assertEqual(result.hits?.length, 1, "hits");
  });

  it("uses topK 5 and omits empty collectionIds by default", async () => {
    const d = deps(async () => json(200, []));
    const result = await searchKnowledge(d, { reqId: "k2", query: "q" });
    assertEqual(d.calls[0].body, { query: "q", topK: 5 }, "defaults");
    assertEqual(result, { type: "knowledge.result", reqId: "k2", ok: true, hits: [] }, "empty ok");
  });

  it("says signed-out without a sign-in, unavailable for an API key, and sends nothing", async () => {
    const out = deps(async () => json(200, []), null);
    assertEqual(await searchKnowledge(out, { reqId: "a", query: "q" }), {
      type: "knowledge.result",
      reqId: "a",
      ok: false,
      reason: "signed-out",
    }, "signed out");
    const key = deps(async () => json(200, []), "apiKey");
    assertEqual((await searchKnowledge(key, { reqId: "b", query: "q" })).reason, "unavailable", "api key");
    assertEqual(out.calls.length + key.calls.length, 0, "no requests");
  });

  it("maps 401 and 403 to forbidden", async () => {
    assertEqual((await searchKnowledge(deps(async () => json(401, {})), { reqId: "a", query: "q" })).reason, "forbidden", "401");
    assertEqual((await searchKnowledge(deps(async () => json(403, {})), { reqId: "b", query: "q" })).reason, "forbidden", "403");
  });

  it("maps server errors, 404 (knowledge profile off), bad bodies and network failures to unavailable", async () => {
    const cases: Array<() => Promise<Response>> = [
      async () => json(500, { error: "boom" }),
      async () => json(404, {}),
      async () => json(200, "<html>not json"),
      async () => json(200, { unexpected: true }),
      async () => {
        throw new TypeError("fetch failed");
      },
    ];
    for (const [i, respond] of cases.entries()) {
      const result = await searchKnowledge(deps(respond), { reqId: `u${i}`, query: "q" });
      assertEqual([result.ok, result.reason], [false, "unavailable"], `case ${i}`);
    }
  });

  it("gives up after the timeout", async () => {
    const d = deps(
      (_path, _body, signal) =>
        new Promise<Response>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        })
    );
    d.timeoutMs = 20;
    const started = Date.now();
    const result = await searchKnowledge(d, { reqId: "t", query: "q" });
    assertEqual(result.reason, "unavailable", "timed out");
    assert(Date.now() - started < 2000, "did not hang");
  });

  it("refuses a blank query without a request", async () => {
    const d = deps(async () => json(200, []));
    const result = await searchKnowledge(d, { reqId: "e", query: "   " });
    assertEqual(result.ok, false, "not ok");
    assertEqual(d.calls.length, 0, "no request");
  });
});
