// ui.reveal (Code Tour): open a workspace file and select a line range.
//
// The path comes from the webview, which got it from a model's answer - so it
// is untrusted input. It is resolved against the workspace folders with the
// coding agent's containment check (agent/containment.ts: lexical AND real
// path, so a committed symlink cannot point a reveal at ~/.ssh), and anything
// that escapes is refused with a notification rather than opened.

import { stat } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
import * as vscode from "vscode";
import { resolveContained, type RealpathFn } from "../agent/containment";

export type RevealTarget = { uri: vscode.Uri } | { reason: string };

export interface RevealDeps {
  exists?: (uri: vscode.Uri) => Promise<boolean>;
  realpathFn?: RealpathFn;
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    return (await stat(uri.fsPath)).isFile();
  } catch {
    return false;
  }
}

/** "/x", "\x", "C:\x", "C:/x", "\\server\share", or any "scheme:" URI. */
export function isAbsoluteLike(path: string): boolean {
  return /^([\\/]|[a-zA-Z]:[\\/]|[a-zA-Z][a-zA-Z0-9+.-]+:)/.test(path);
}

/**
 * Resolve a Code Tour path to a file inside one of the workspace folders.
 * Relative paths (the host's own ContextItem labels) are tried against each
 * folder in order - a multi-root label carries no folder name - and the first
 * folder holding the file wins. An absolute path is accepted only when it lies
 * inside a folder. ".." that climbs out, an absolute path elsewhere, a URI
 * scheme, or a symlink that leads outside is refused.
 */
export async function resolveRevealPath(
  rawPath: string,
  folders: readonly { uri: vscode.Uri }[],
  deps: RevealDeps = {}
): Promise<RevealTarget> {
  const exists = deps.exists ?? fileExists;
  const path = rawPath.trim();
  if (!path) return { reason: "No file was named" };
  if (path.includes("\0")) return { reason: `"${rawPath}" is not a valid path` };
  if (folders.length === 0) return { reason: "Open a folder first - Code Tour only opens files inside the workspace" };

  const outside = { reason: `"${path}" is outside this workspace, so VegaDuta will not open it` };
  // A URI ("file://...", "vscode-remote://...", "https://...") is never a
  // Code Tour path - the host labels files by workspace-relative path.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]+:/.test(path)) return outside;
  let escaped = false;

  for (const folder of folders) {
    let candidateRelative: string;
    if (isAbsoluteLike(path)) {
      // Absolute: only if it is under this folder on disk.
      const rel = relative(folder.uri.fsPath, path);
      if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
        escaped = true;
        continue;
      }
      candidateRelative = rel;
    } else {
      candidateRelative = path;
    }
    const uri = await resolveContained(folder.uri, candidateRelative, deps.realpathFn);
    if (!uri) {
      escaped = true;
      continue;
    }
    if (await exists(uri)) return { uri };
  }
  return escaped ? outside : { reason: `${path} was not found in this workspace` };
}

/** 1-based inclusive webview lines -> 0-based document lines, clamped to the
 * document and put in order. Non-numbers fall back to line 1. */
export function clampLines(
  startLine: unknown,
  endLine: unknown,
  lineCount: number
): { start: number; end: number } {
  const last = Math.max(0, lineCount - 1);
  const toIndex = (value: unknown, fallback: number): number => {
    if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
    return Math.min(last, Math.max(0, Math.floor(value) - 1));
  };
  const start = toIndex(startLine, 0);
  const end = toIndex(endLine, start);
  return start <= end ? { start, end } : { start: end, end: start };
}
