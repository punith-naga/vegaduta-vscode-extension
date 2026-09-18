// Workspace containment: prove a path stays inside a workspace root, lexically
// AND through symlinks. Extracted from workspaceTools.ts (the coding agent) so
// the chat view's Code Tour reveal (ui.reveal) holds the same line with the
// same code - two hand-rolled copies of a security check drift apart.

import { realpath } from "node:fs/promises";
import { dirname } from "node:path";
import * as vscode from "vscode";

export type RealpathFn = (path: string) => Promise<string>;

/**
 * Lexical containment: normalise, then prove the result is the root or below
 * it. `Uri.joinPath` collapses "..", so this handles traversal, absolute paths
 * and the "/a/proj" vs "/a/project" prefix trap (the separator in the
 * startsWith is what closes that one).
 *
 * Leading slashes are stripped, so "/src/a.ts" means "src/a.ts" under the
 * root - the coding agent's historical behaviour, kept. Callers that must
 * REJECT absolute input (ui.reveal) check for it before calling this.
 *
 * This is NOT sufficient on its own - it cannot see symlinks. Use
 * `resolveContained()`, which adds the real-path check.
 */
export function resolveLexical(root: vscode.Uri, relative: string): vscode.Uri | null {
  const cleaned = relative.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (cleaned === "" || cleaned === ".") return root;
  const candidate = vscode.Uri.joinPath(root, cleaned);
  const rootPath = root.path.replace(/\/+$/, "");
  if (candidate.path !== rootPath && !candidate.path.startsWith(`${rootPath}/`)) return null;
  return candidate;
}

/**
 * True when the real path of `candidateFsPath` is `rootFsPath` or below it.
 *
 * Lexical normalisation alone is defeated by any symlink inside the
 * workspace: a repo can commit `vendor/home -> /home/you`, and
 * `vendor/home/.ssh/id_rsa` passes every prefix test while a read follows the
 * link off the edge of the world. So resolve the real path of both sides and
 * re-check. For a path that does not exist yet (a file about to be created),
 * walk up to the deepest ancestor that DOES exist and check that - the parent
 * is what the new file inherits.
 */
export async function realPathContained(
  rootFsPath: string,
  candidateFsPath: string,
  realpathFn: RealpathFn = realpath
): Promise<boolean> {
  let realRoot: string;
  try {
    realRoot = await realpathFn(rootFsPath);
  } catch {
    return false; // a workspace root we cannot resolve is not one we can bound
  }

  let probe = candidateFsPath;
  for (let depth = 0; depth < 64; depth += 1) {
    try {
      const real = await realpathFn(probe);
      const sep = real.includes("\\") ? "\\" : "/";
      const boundary = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
      // Windows paths are case-insensitive; comparing raw would let
      // "VENDOR/x" slip a check that "vendor/x" fails.
      const norm = (value: string): string => (sep === "\\" ? value.toLowerCase() : value);
      return norm(real) === norm(realRoot) || norm(real).startsWith(norm(boundary));
    } catch {
      const parent = dirname(probe);
      if (parent === probe) return false;
      probe = parent;
    }
  }
  return false;
}

/** Lexical + real-path containment. The URI, or null when it escapes. */
export async function resolveContained(
  root: vscode.Uri,
  relative: string,
  realpathFn: RealpathFn = realpath
): Promise<vscode.Uri | null> {
  const lexical = resolveLexical(root, relative);
  if (!lexical) return null;
  return (await realPathContained(root.fsPath, lexical.fsPath, realpathFn)) ? lexical : null;
}
