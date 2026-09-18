// Inline completions from either source: the on-device engine running in the
// chat webview (engine.request kind:"completion" over the shared protocol),
// or the platform's fill-in-the-middle endpoint via the shared
// hostedCompletions client. Discipline that keeps "free" feeling fast is the
// same for both: 250ms debounce with abort-on-keystroke, a 1200ms hard
// deadline, and an LRU(32) result cache.
//
// Source selection (vegaduta.completions.provider):
//   local  - on-device only; nothing leaves the machine.
//   (Private Mode turns hosted and auto into local: no hosted request is made.)
//   hosted - platform only.
//   auto   - on-device when the engine is ready, otherwise hosted. This is
//            the path for a machine with no WebGPU and no local Ollama-style
//            server, which before had no completions at all.
//
// Hosted failures are silent by design: this runs on keystrokes, so a toast
// per attempt would be a storm. The shared client makes a 404 (no such
// endpoint on this core build), a 402 (the caller's budget) and a 403 (the
// tenant's quota, or a plain refusal - the server does not distinguish)
// sticky for the session, and backs off on 429/401/503/network - see
// hostedCompletions.ts. The one signal here is a console line per distinct
// shutdown, which lands in the Extension Host log and nowhere the user has
// to dismiss. "Per distinct shutdown", not "once per session": the shared
// client drops its sticky state when the configured environment changes, so
// a second deployment that also refuses gets its own line.

import * as vscode from "vscode";
import type { ChatViewProvider } from "../chat/chatViewProvider";
import type { TokenProvider } from "../../../shared/src/api/client";
import {
  createHostedCompletionClient,
  type HostedCompletionClient,
  type HostedCompletionDisabled,
} from "../../../shared/src/api/hostedCompletions";
import { stripFence } from "../../../shared/src/edge/completions";
import { readSettings, type CompletionsProviderSetting } from "../settings";

const DEBOUNCE_MS = 250;
const DEADLINE_MS = 1200;
const PREFIX_MAX_LINES = 64;
const PREFIX_MAX_CHARS = 4000;
const SUFFIX_MAX_CHARS = 1000;
const CACHE_SIZE = 32;

type CompletionSource = "local" | "hosted";

/** djb2 - cheap, stable, good enough for a 32-entry cache key. */
function hashKey(...parts: string[]): string {
  let hash = 5381;
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) {
      hash = ((hash << 5) + hash + part.charCodeAt(i)) | 0;
    }
    hash = ((hash << 5) + hash) | 0; // part separator
  }
  return String(hash >>> 0);
}

class LruCache {
  private readonly map = new Map<string, string>();

  constructor(private readonly capacity: number) {}

  get(key: string): string | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  set(key: string, value: string): void {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }
}

function debounce(ms: number, token: vscode.CancellationToken): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      sub.dispose();
      resolve(true);
    }, ms);
    const sub = token.onCancellationRequested(() => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

export class VegadutaInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  private readonly cache = new LruCache(CACHE_SIZE);
  private readonly hosted: HostedCompletionClient | null;
  /** `reason: detail` of the shutdown already written to the log, so the same
   * one is never written twice and a different one is never swallowed. */
  private reportedShutdown: string | null = null;

  /** `tokens` is optional so the provider keeps working (local-only, exactly
   * as before) anywhere it is constructed without auth. Hosted completions
   * need a bearer, so without one this reports hosted as unavailable rather
   * than firing calls that can only 401. */
  constructor(
    private readonly chatView: ChatViewProvider,
    tokens?: TokenProvider,
    /** Private Mode: while true, hosted completions are never requested -
     * the prefix/suffix would leave the machine. On-device still works. */
    private readonly isPrivate: () => boolean = () => false
  ) {
    this.hosted = tokens
      ? createHostedCompletionClient(() => readSettings().apiBase, tokens)
      : null;
  }

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    const settings = readSettings();
    const provider = settings.completionsProvider;
    if (provider === "off") return undefined;

    const source = this.pickSource(provider);
    if (!source) return undefined;

    if (!(await debounce(DEBOUNCE_MS, token))) return undefined;
    if (token.isCancellationRequested) return undefined;

    const startLine = Math.max(0, position.line - PREFIX_MAX_LINES);
    const prefix = document
      .getText(new vscode.Range(startLine, 0, position.line, position.character))
      .slice(-PREFIX_MAX_CHARS);
    const cursorOffset = document.offsetAt(position);
    const suffix = document.getText(
      new vscode.Range(position, document.positionAt(cursorOffset + SUFFIX_MAX_CHARS))
    );

    // The source is part of the key: a 1-3B local model and the hosted model
    // give different answers for the same cursor, and "auto" can switch
    // between them mid-session when the engine finishes loading.
    const key = hashKey(prefix, suffix, document.languageId, source);
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return cached ? [this.item(cached, position)] : undefined;
    }

    const text =
      source === "local"
        ? await this.completeLocally(prefix, suffix, document.languageId, token)
        : await this.completeHosted(prefix, suffix, document.languageId, token);
    if (token.isCancellationRequested) return undefined;
    if (!text) return undefined;

    this.cache.set(key, text);
    return [this.item(text, position)];
  }

  /** Which backend serves this request, or null for "nothing can right now". */
  private pickSource(
    provider: Exclude<CompletionsProviderSetting, "off">
  ): CompletionSource | null {
    const engineReady = this.chatView.engineStatus.state === "ready";
    if (provider === "local") return engineReady ? "local" : null;
    if (provider === "auto" && engineReady) return "local";
    if (this.isPrivate()) return null;
    return this.hostedUsable() ? "hosted" : null;
  }

  private hostedUsable(): boolean {
    if (!this.hosted) return false;
    const shutdown = this.hosted.disabled();
    if (!shutdown) {
      // Usable again - an environment switch cleared the sticky state, or
      // something called resetHosted(). Arm the log for the next shutdown.
      this.reportedShutdown = null;
      return true;
    }
    this.reportHostedShutdown(shutdown);
    return false;
  }

  /** One line per distinct shutdown, to the Extension Host log - never a
   * toast: this can be reached on every keystroke. Keyed on the reason+detail
   * rather than a session-wide flag so that switching environments and
   * failing again still logs, while the sticky state that produced a line
   * (it cannot change until it is cleared) never logs twice. */
  private reportHostedShutdown(shutdown: HostedCompletionDisabled): void {
    const key = `${shutdown.reason}: ${shutdown.detail}`;
    if (this.reportedShutdown === key) return;
    this.reportedShutdown = key;
    console.warn(
      `VegaDuta: hosted inline completions are switched off (${key}). ` +
        "They are not retried until the configured environment changes or the client is reset; " +
        "local completions and plain editing are unaffected."
    );
  }

  /** Clear the shared client's sticky + cooldown state. For the host to call
   * after a sign-in or a manual "retry hosted completions": a signed-out or
   * refused editor backs off, so without this the first completion after
   * signing in can wait out the remaining cooldown window. */
  resetHosted(): void {
    this.hosted?.reset();
    this.reportedShutdown = null;
  }

  private async completeLocally(
    prefix: string,
    suffix: string,
    languageId: string,
    token: vscode.CancellationToken
  ): Promise<string | undefined> {
    const result = await this.chatView.requestEngine(
      "completion",
      { text: prefix, suffix, languageId },
      DEADLINE_MS,
      token
    );
    if (!result.ok || !result.text) return undefined;
    return result.text;
  }

  private async completeHosted(
    prefix: string,
    suffix: string,
    languageId: string,
    token: vscode.CancellationToken
  ): Promise<string | undefined> {
    const hosted = this.hosted;
    if (!hosted) return undefined;
    const controller = new AbortController();
    const sub = token.onCancellationRequested(() => controller.abort());
    try {
      const result = await hosted.complete({
        prefix,
        suffix,
        language: languageId,
        deadlineMs: DEADLINE_MS,
        signal: controller.signal,
      });
      if (!result.ok) {
        // A 404/402/403 closed the surface for the session - say so once.
        // Every other reason (timeout, rate-limited, 503, empty) leaves
        // disabled() null and just yields no suggestion.
        const shutdown = hosted.disabled();
        if (shutdown) this.reportHostedShutdown(shutdown);
        return undefined;
      }
      // Hosted models add a fence about as reliably as local ones do; the
      // same strip the on-device path applies (edge/completions.ts).
      return stripFence(result.text) || undefined;
    } finally {
      sub.dispose();
    }
  }

  private item(text: string, position: vscode.Position): vscode.InlineCompletionItem {
    return new vscode.InlineCompletionItem(text, new vscode.Range(position, position));
  }
}
