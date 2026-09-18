// Private Mode, host side.
//
// While Private Mode is on, NO prompt, code, attachment, page text or search
// query leaves the machine. Allowed: the user's own local model server,
// WebLLM on-device inference, and fetching the public model manifest /
// downloading model weights on an explicit click (none of those carry the
// user's content). Blocked here, in the extension host: hosted chat, hosted
// inline completions, hosted selection commands, knowledge search, the code
// sandbox (sdlc.run is hosted), workflow runs, and a coding agent pointed at a
// non-local endpoint. Code validation is a webview-side call and is blocked by
// the engine host (engineHost.ts setPrivateMode).
//
// This is NOT "nothing touches the network": the extension still signs in,
// refreshes tokens and lists agents/workflows when asked, and the webview may
// fetch the public model manifest. None of those carry the user's content.
//
// The flag persists in globalState so it survives a reload, and is honoured
// from activation on - before the chat view has ever opened.

import * as vscode from "vscode";
import type { HostToWebview, WebviewToHost } from "../../shared/src/webview/protocol";

export const PRIVATE_MODE_STATE_KEY = "vegaduta.privateMode";

/** The one sentence every blocked path shows. */
export const PRIVATE_MODE_BLOCKED = "Private Mode is on - this runs on your machine only";

/** The subset of vscode.Memento this needs (so tests can pass a plain fake). */
export interface FlagStore {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): Thenable<void>;
}

export class PrivateMode implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<boolean>();
  readonly onDidChange = this.emitter.event;

  constructor(private readonly store: FlagStore) {}

  get isPrivate(): boolean {
    return this.store.get<boolean>(PRIVATE_MODE_STATE_KEY, false) === true;
  }

  async set(on: boolean): Promise<void> {
    if (on === this.isPrivate) return;
    await this.store.update(PRIVATE_MODE_STATE_KEY, on);
    this.emitter.fire(on);
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

/**
 * The reply to a webview request Private Mode refuses, or null when the
 * request may proceed. Only hosted paths are listed; everything the webview
 * can send that stays on the machine (engine.*, ui.*, context.request, which
 * reads the local editor and hands the result back to the local webview) is
 * never refused.
 */
export function refuseWhilePrivate(message: WebviewToHost, isPrivate: boolean): HostToWebview | null {
  if (!isPrivate) return null;
  switch (message.type) {
    case "chat.send":
      return { type: "chat.error", reqId: message.reqId, message: PRIVATE_MODE_BLOCKED };
    case "knowledge.search":
      return { type: "knowledge.result", reqId: message.reqId, ok: false, reason: PRIVATE_MODE_BLOCKED };
    case "sdlc.run":
      return {
        type: "sdlc.run.result",
        reqId: message.reqId,
        ok: false,
        reason: "unavailable",
        detail: `${PRIVATE_MODE_BLOCKED}. The code sandbox is hosted, so it is off while Private Mode is on.`,
      };
    case "workflow.run":
      return { type: "workflow.error", reqId: message.reqId, message: PRIVATE_MODE_BLOCKED };
    default:
      return null;
  }
}

/** Loopback hosts: the user's own machine. Anything else is "leaves the machine". */
export function isLoopbackUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  return host === "localhost" || host === "::1" || /^127(\.\d{1,3}){3}$/.test(host);
}
