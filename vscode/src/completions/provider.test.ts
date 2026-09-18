// Hosted inline completions under Private Mode: the prefix/suffix must never
// be sent, so the provider must not even ask the token provider for a bearer.

import type * as vscode from "vscode";
import type { TokenProvider } from "../../../shared/src/api/client";
import type { ChatViewProvider } from "../chat/chatViewProvider";
import { assertEqual } from "../test/assert";
import { mock } from "../test/vscodeMock";
import { VegadutaInlineCompletionProvider } from "./provider";

function setup(isPrivate: boolean, engineReady = false) {
  let tokenAsks = 0;
  const tokens: TokenProvider = {
    getToken: async () => {
      tokenAsks += 1;
      return "jwt";
    },
    refresh: async () => null,
  };
  const chatView = {
    engineStatus: { state: engineReady ? "ready" : "unavailable" },
  } as unknown as ChatViewProvider;
  const provider = new VegadutaInlineCompletionProvider(chatView, tokens, () => isPrivate);
  return { provider, tokenAsks: () => tokenAsks };
}

const pickSource = (p: VegadutaInlineCompletionProvider, setting: string): unknown =>
  (p as unknown as { pickSource(s: string): unknown }).pickSource(setting);

beforeEach(() => mock.reset());

describe("inline completions and Private Mode", () => {
  it("never picks hosted while private", () => {
    const { provider } = setup(true);
    assertEqual(pickSource(provider, "hosted"), null, "hosted setting");
    assertEqual(pickSource(provider, "auto"), null, "auto with no local engine");
  });

  it("still uses the on-device engine while private", () => {
    const { provider } = setup(true, true);
    assertEqual(pickSource(provider, "auto"), "local", "auto");
    assertEqual(pickSource(provider, "local"), "local", "local");
  });

  it("uses hosted when not private (tokens are wired)", () => {
    const { provider } = setup(false);
    assertEqual(pickSource(provider, "hosted"), "hosted", "hosted");
    assertEqual(pickSource(provider, "auto"), "hosted", "auto falls back to hosted");
  });

  it("returns nothing and makes no request for a keystroke while private", async () => {
    mock.config.set("completions.provider", "hosted");
    const { provider, tokenAsks } = setup(true);
    const result = await provider.provideInlineCompletionItems(
      {} as vscode.TextDocument,
      {} as vscode.Position,
      {} as vscode.InlineCompletionContext,
      { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) } as unknown as vscode.CancellationToken
    );
    assertEqual(result, undefined, "no completion");
    assertEqual(tokenAsks(), 0, "no bearer requested, so nothing was sent");
  });
});
