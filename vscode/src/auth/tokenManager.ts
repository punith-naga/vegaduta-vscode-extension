// Auth for the extension host. Two modes:
//  - "jwt": interactive device-flow sign-in (shared auth/deviceFlow), tokens
//    persisted in context.secrets, refreshed on demand / after a 401.
//  - "apiKey": a hand-pasted vmcp_ scoped key (headless fallback - listing
//    and chat go through /api/dev/v1 via DevApiClient, see ../api.ts).
// Implements the shared TokenProvider so VegadutaClient can call it directly.
// The token never leaves this process - the webview only ever sees AuthState.

import * as vscode from "vscode";
import type { TokenProvider } from "../../../shared/src/api/client";
import { looksLikeApiKey } from "../../../shared/src/api/devApi";
import {
  pollForTokens,
  startDeviceFlow,
  type DeviceAuthorization,
} from "../../../shared/src/auth/deviceFlow";
import { OidcError, refreshTokens } from "../../../shared/src/auth/oidc";
import type { AuthState } from "../../../shared/src/webview/protocol";

const SECRET_KEY = "vegaduta.auth";

type StoredAuth =
  | {
      mode: "jwt";
      /** Issuer origin the tokens were minted against - a changed
       * vegaduta.environment invalidates them (different Keycloak). */
      authBase: string;
      accessToken: string;
      refreshToken: string | null;
      expiresAt: number;
      username: string | null;
    }
  | { mode: "apiKey"; key: string };

/** Best-effort read of preferred_username from a JWT payload (display only -
 * the server is the authority on identity). */
function usernameFromJwt(accessToken: string): string | null {
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return null;
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      preferred_username?: string;
      email?: string;
    };
    return claims.preferred_username ?? claims.email ?? null;
  } catch {
    return null;
  }
}

export class TokenManager implements TokenProvider, vscode.Disposable {
  private stored: StoredAuth | null = null;
  private refreshInFlight: Promise<string | null> | null = null;
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeAuth = this.changeEmitter.event;

  dispose(): void {
    this.changeEmitter.dispose();
  }

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly getAuthBase: () => string
  ) {}

  /** Load persisted auth once at activation. */
  async initialize(): Promise<void> {
    const raw = await this.secrets.get(SECRET_KEY);
    if (!raw) return;
    try {
      this.stored = JSON.parse(raw) as StoredAuth;
    } catch {
      await this.secrets.delete(SECRET_KEY);
    }
  }

  private async persist(): Promise<void> {
    if (this.stored) {
      await this.secrets.store(SECRET_KEY, JSON.stringify(this.stored));
    } else {
      await this.secrets.delete(SECRET_KEY);
    }
  }

  /** JWT auth from a different environment's Keycloak is unusable. */
  private currentJwt(): Extract<StoredAuth, { mode: "jwt" }> | null {
    if (this.stored?.mode === "jwt" && this.stored.authBase === this.getAuthBase()) {
      return this.stored;
    }
    return null;
  }

  mode(): "jwt" | "apiKey" | null {
    if (this.stored?.mode === "apiKey") return "apiKey";
    return this.currentJwt() ? "jwt" : null;
  }

  apiKey(): string | null {
    return this.stored?.mode === "apiKey" ? this.stored.key : null;
  }

  authState(): AuthState {
    const mode = this.mode();
    if (mode === "apiKey") {
      return { signedIn: true, username: "API key", mode };
    }
    const jwt = this.currentJwt();
    if (mode === "jwt" && jwt) {
      return { signedIn: true, username: jwt.username, mode };
    }
    return { signedIn: false, mode: null };
  }

  // --- TokenProvider ---------------------------------------------------------

  async getToken(): Promise<string | null> {
    if (this.stored?.mode === "apiKey") return this.stored.key;
    const jwt = this.currentJwt();
    if (!jwt) return null;
    if (Date.now() < jwt.expiresAt) return jwt.accessToken;
    return this.refresh();
  }

  async refresh(): Promise<string | null> {
    if (this.stored?.mode === "apiKey") return null; // nothing to refresh
    const jwt = this.currentJwt();
    const refreshToken = jwt?.refreshToken;
    if (!jwt || !refreshToken) return null;
    // Single-flight: SSE + list calls can 401 concurrently.
    this.refreshInFlight ??= (async () => {
      try {
        const tokens = await refreshTokens({
          authBase: jwt.authBase,
          refreshToken,
        });
        this.stored = {
          mode: "jwt",
          authBase: jwt.authBase,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken ?? refreshToken,
          expiresAt: tokens.expiresAt,
          username: usernameFromJwt(tokens.accessToken) ?? jwt.username,
        };
        await this.persist();
        return tokens.accessToken;
      } catch (err) {
        if (err instanceof OidcError) {
          // Refresh token expired/revoked - sign out locally so the UI
          // offers a fresh sign-in instead of looping on 401s.
          this.stored = null;
          await this.persist();
          this.changeEmitter.fire();
          return null;
        }
        return null; // transient network failure - keep tokens, caller sees the 401
      } finally {
        this.refreshInFlight = null;
      }
    })();
    return this.refreshInFlight;
  }

  // --- interactive flows -----------------------------------------------------

  /** Device-flow sign-in (`gh auth login` UX). Returns true on success. */
  async signIn(): Promise<boolean> {
    const authBase = this.getAuthBase();
    let authorization: DeviceAuthorization;
    try {
      authorization = await startDeviceFlow(authBase);
    } catch (err) {
      void vscode.window.showErrorMessage(
        `VegaDuta sign-in could not start: ${err instanceof Error ? err.message : String(err)}`
      );
      return false;
    }

    void vscode.env.openExternal(vscode.Uri.parse(authorization.verificationUriComplete));
    // Non-modal so polling starts immediately; the code is pre-filled in the
    // opened URL - the message is a safety net if the browser didn't open.
    void vscode.window
      .showInformationMessage(
        `Your VegaDuta sign-in code is ${authorization.userCode}. Approve the request in your browser.`,
        "Copy code"
      )
      .then((choice) => {
        if (choice === "Copy code") void vscode.env.clipboard.writeText(authorization.userCode);
      });

    try {
      const tokens = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "VegaDuta: waiting for sign-in approval in your browser…",
          cancellable: true,
        },
        (_progress, cancel) => {
          const controller = new AbortController();
          cancel.onCancellationRequested(() => controller.abort());
          return pollForTokens(authBase, authorization, { signal: controller.signal });
        }
      );
      this.stored = {
        mode: "jwt",
        authBase,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        username: usernameFromJwt(tokens.accessToken),
      };
      await this.persist();
      this.changeEmitter.fire();
      void vscode.window.showInformationMessage(
        `VegaDuta: signed in${this.stored.username ? ` as ${this.stored.username}` : ""}.`
      );
      return true;
    } catch (err) {
      if (err instanceof OidcError && err.code === "aborted") return false;
      void vscode.window.showErrorMessage(
        `VegaDuta sign-in failed: ${err instanceof Error ? err.message : String(err)}`
      );
      return false;
    }
  }

  async signOut(): Promise<void> {
    this.stored = null;
    await this.persist();
    this.changeEmitter.fire();
  }

  /** API-key fallback: paste a vmcp_ scoped key (admin-issued, shown once).
   * Listing/chat then go through /api/dev/v1 (blocking, no SSE) - see
   * ApiFacade. Returns true when a key was stored. */
  async pasteApiKey(): Promise<boolean> {
    const value = await vscode.window.showInputBox({
      title: "VegaDuta API key",
      prompt: "Paste a vmcp_ scoped API key (issued by your tenant admin under MCP grants)",
      password: true,
      ignoreFocusOut: true,
      validateInput: (input) =>
        looksLikeApiKey(input) ? null : "Expected a key starting with vmcp_",
    });
    if (!value) return false;
    this.stored = { mode: "apiKey", key: value.trim() };
    await this.persist();
    this.changeEmitter.fire();
    void vscode.window.showInformationMessage(
      "VegaDuta: API key stored. Chat is non-streaming in this mode - sign in for the full experience."
    );
    return true;
  }
}
