#!/usr/bin/env node
// Bundles the extension host (src/extension.ts -> dist/extension.js, cjs for
// VS Code's Node runtime) and copies the shared chat webview bundle
// (../shared/dist/webview, built by `npm run build:webview` in clients/shared)
// into media/webview/. The copy is defensive: a missing shared build is not
// fatal - the chat view shows a "build the shared webview first" message.

import { context, build } from "esbuild";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes("--watch");

const options = {
  entryPoints: [join(root, "src", "extension.ts")],
  outfile: join(root, "dist", "extension.js"),
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  external: ["vscode"],
  sourcemap: true,
  logLevel: "info",
};

function copyWebview() {
  const sharedWebview = join(root, "..", "shared", "dist", "webview");
  const target = join(root, "media", "webview");
  if (!existsSync(sharedWebview)) {
    console.warn(
      "[esbuild] ../shared/dist/webview not found - chat webview assets NOT copied. " +
        "Run `npm run build:webview` in clients/shared first."
    );
    return;
  }
  mkdirSync(target, { recursive: true });
  cpSync(sharedWebview, target, { recursive: true });
  console.log(`[esbuild] copied webview assets -> ${target}`);
}

if (watch) {
  const ctx = await context(options);
  copyWebview();
  await ctx.watch();
} else {
  await build(options);
  copyWebview();
}
