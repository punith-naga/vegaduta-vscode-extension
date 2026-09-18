# VegaDūta for VS Code

Source code for the **VegaDūta** Visual Studio Code extension
(`vegaduta.vegaduta-vscode`), published on the VS Code Marketplace and Open VSX
(for VS Code, Cursor, Windsurf, VSCodium and other VS Code-compatible editors).

An AI pair for the whole SDLC: chat with your VegaDūta agents or a free model
on your own machine, run workflows, review your changes, write commit messages,
take a guided Code Tour, use ready-made recipes for developers, testers,
architects, product and DevOps, and 18 offline Instant tools. Sign-in uses the
OAuth 2.0 device grant (RFC 8628), so it works over Remote SSH and in
containers.

Licensed under **Apache-2.0** - see [LICENSE](LICENSE) and [NOTICE](NOTICE).

## Layout

```
vscode/    The extension itself (TypeScript, esbuild). This is what is packaged
           into the .vsix.
shared/    The shared TypeScript core the extension is built from - API
           client, SSE reader, device-flow auth, host<->webview protocol, the
           chat UI and the on-device (WebLLM / Ollama) engine layer.
```

`shared/` is extracted from the VegaDūta platform monorepo, where the same core
also backs the Chrome, JetBrains and Eclipse clients. Only the VS Code
extension and the code it is built from are published here.

## Build from source

Requires Node 20+.

```bash
# 1. Build the chat view bundle (shared/dist/webview)
cd shared
npm ci
npm run build:webview

# 2. Build and package the extension
cd ../vscode
npm ci
npm run build
npx @vscode/vsce package
```

Tests: `npx vitest@3 run --globals --environment node` in `vscode/`, and
`npx vitest run` in `shared/`.

## Privacy

When you are signed in and send a message, the prompt and the context you
attached are sent to the VegaDūta service (api.vegaduta.ai). Private Mode keeps
everything on your machine; the Instant tools never send anything. See
<https://vegaduta.ai/privacy>.

## Issues

Please open an issue in this repository, or visit <https://vegaduta.ai>.
