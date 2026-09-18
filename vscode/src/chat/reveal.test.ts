// ui.reveal path containment and line clamping, on a REAL temporary directory
// so the real-path (symlink) check runs against the real filesystem. The
// symlink is a directory junction on Windows (no admin needed) and a plain
// symlink elsewhere.

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveContained } from "../agent/containment";
import type * as vscode from "vscode";
import { assert, assertEqual, assertIncludes } from "../test/assert";
import { Uri } from "../test/vscodeMock";
import { clampLines, isAbsoluteLike, resolveRevealPath } from "./reveal";

/** The mock Uri, typed as the real one the code under test expects. */
const fileUri = (p: string): vscode.Uri => Uri.file(p) as unknown as vscode.Uri;

const base = mkdtempSync(join(tmpdir(), "vegaduta-reveal-"));
const ws = join(base, "ws");
const ws2 = join(base, "ws2");
const outside = join(base, "outside");
mkdirSync(join(ws, "src"), { recursive: true });
mkdirSync(ws2, { recursive: true });
mkdirSync(outside, { recursive: true });
writeFileSync(join(ws, "src", "a.ts"), "export const a = 1;\n");
writeFileSync(join(ws2, "only-in-two.ts"), "two\n");
writeFileSync(join(outside, "secret.txt"), "do not open\n");
let symlinkOk = true;
try {
  symlinkSync(outside, join(ws, "link"), process.platform === "win32" ? "junction" : "dir");
} catch {
  symlinkOk = false;
}

afterAll(() => rmSync(base, { recursive: true, force: true }));

const folders = [{ uri: fileUri(ws) }];

async function uriFor(path: string, fs = folders): Promise<string> {
  const target = await resolveRevealPath(path, fs);
  assert("uri" in target, `expected ${path} to resolve, got ${JSON.stringify(target)}`);
  return target.uri.fsPath;
}

async function reasonFor(path: string, fs = folders): Promise<string> {
  const target = await resolveRevealPath(path, fs);
  assert("reason" in target, `expected ${path} to be refused, got ${JSON.stringify(target)}`);
  return target.reason;
}

describe("resolveRevealPath", () => {
  it("opens a workspace-relative path (either slash)", async () => {
    assertIncludes((await uriFor("src/a.ts")).toLowerCase(), join("ws", "src", "a.ts").toLowerCase(), "forward slash");
    assertIncludes((await uriFor("src\\a.ts")).toLowerCase(), join("ws", "src", "a.ts").toLowerCase(), "backslash");
    assertIncludes((await uriFor("./src/../src/a.ts")).toLowerCase(), "a.ts", "dot segments that stay inside");
  });

  it("refuses .. that climbs out of the workspace", async () => {
    assertIncludes(await reasonFor("../outside/secret.txt"), "outside this workspace", "..");
    assertIncludes(await reasonFor("src/../../outside/secret.txt"), "outside this workspace", "nested ..");
  });

  it("accepts an absolute path only inside the workspace", async () => {
    assertIncludes((await uriFor(join(ws, "src", "a.ts"))).toLowerCase(), "a.ts", "absolute inside");
    assertIncludes(await reasonFor(join(outside, "secret.txt")), "outside this workspace", "absolute outside");
    assertIncludes(await reasonFor("/etc/passwd"), "outside this workspace", "posix absolute");
  });

  it("refuses URIs", async () => {
    assertIncludes(await reasonFor("file:///etc/passwd"), "outside this workspace", "file uri");
    assertIncludes(await reasonFor("https://example.com/a.ts"), "outside this workspace", "https");
  });

  it("refuses a symlink that leads out of the workspace", async () => {
    if (!symlinkOk) return; // could not create one on this machine - nothing to prove
    assertIncludes(await reasonFor("link/secret.txt"), "outside this workspace", "symlink escape");
  });

  it("says not found for a missing file inside the workspace", async () => {
    assertIncludes(await reasonFor("src/missing.ts"), "was not found", "missing");
  });

  it("tries every workspace folder (multi-root labels carry no folder name)", async () => {
    const both = [{ uri: fileUri(ws) }, { uri: fileUri(ws2) }];
    assertIncludes((await uriFor("only-in-two.ts", both)).toLowerCase(), "ws2", "second folder");
  });

  it("refuses everything with no folder open, and empty paths", async () => {
    assertIncludes(await reasonFor("src/a.ts", []), "Open a folder first", "no folders");
    assertIncludes(await reasonFor("   "), "No file was named", "blank");
  });
});

describe("resolveContained (shared with the coding agent)", () => {
  it("keeps the agent's semantics: leading slash means workspace-relative", async () => {
    const uri = await resolveContained(fileUri(ws), "/src/a.ts");
    assert(uri !== null, "resolved");
    assertIncludes(uri.fsPath.toLowerCase(), join("ws", "src", "a.ts").toLowerCase(), "under the root");
  });

  it("allows a not-yet-existing file inside, refuses traversal", async () => {
    assert((await resolveContained(fileUri(ws), "src/new/file.ts")) !== null, "new file inside");
    assertEqual(await resolveContained(fileUri(ws), "../outside/secret.txt"), null, "traversal");
  });

  it("refuses the prefix trap (/ws vs /ws2)", async () => {
    assertEqual(await resolveContained(fileUri(ws), "../ws2/only-in-two.ts"), null, "sibling prefix");
  });
});

describe("isAbsoluteLike", () => {
  it("recognises posix, windows, UNC and URI forms", () => {
    for (const p of ["/a", "\\a", "C:\\a", "c:/a", "\\\\server\\share", "file:///a"]) assert(isAbsoluteLike(p), p);
    for (const p of ["a", "src/a.ts", "./a", "../a"]) assert(!isAbsoluteLike(p), p);
  });
});

describe("clampLines", () => {
  it("converts 1-based inclusive to 0-based", () => {
    assertEqual(clampLines(3, 5, 10), { start: 2, end: 4 }, "plain");
  });
  it("clamps to the document", () => {
    assertEqual(clampLines(0, 999, 10), { start: 0, end: 9 }, "clamped both ends");
    assertEqual(clampLines(-5, -1, 10), { start: 0, end: 0 }, "negative");
  });
  it("orders a reversed range and floors fractions", () => {
    assertEqual(clampLines(8, 2, 10), { start: 1, end: 7 }, "reversed");
    assertEqual(clampLines(2.9, 4.2, 10), { start: 1, end: 3 }, "fractions");
  });
  it("falls back for non-numbers and an empty document", () => {
    assertEqual(clampLines("x", undefined, 10), { start: 0, end: 0 }, "garbage");
    assertEqual(clampLines(7, NaN, 10), { start: 6, end: 6 }, "missing end = start");
    assertEqual(clampLines(4, 9, 0), { start: 0, end: 0 }, "empty document");
  });
});
