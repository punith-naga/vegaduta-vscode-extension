# Changelog

All notable changes to the VegaDūta VS Code extension are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Dates are the date the change landed in the repository; 0.1.0 and 0.1.1 were
packaged as `.vsix` but never published to the Marketplace.

## [Unreleased]

Nothing yet.

## [0.5.1] - 2026-09-18

### Changed

- **Getting a free on-device model is one obvious click.** The home card now
  says "Download lightest · 880 MB" (or "Start it" once downloaded) next to
  "Choose a model", and names the model plainly ("Llama 3.2 1B") instead of an
  internal id. One click picks a model already on this machine, otherwise the
  lightest one it can run - not a bigger "recommended" one.
- The model list opens with a "New here? Start with the lightest model" step,
  then lists models lightest-first.
- **No more dead ends.** Where this window can't run models itself (no
  WebGPU), the panel shows "Get free on-device AI in 3 steps" with a Show me
  how button instead of "cannot run". Every model list ends with a "Want a more
  powerful model?" guide: memory needed for 3B/7B models, and how to run the
  strongest ones with Ollama, which VegaDūta then finds by itself.
- **Ask AI about this** (Instant tools) leaves the cursor on a "My question:"
  line, so the AI answers what you want to know instead of restating the result.

## [0.5.0] - 2026-09-18

### Changed

- The on-device model panel lays out each model's name, size and action
  cleanly, and a model that is starting shows a moving progress bar instead of
  an empty one.
- When the editor restarts or moves its local model server, the chat picks up
  the new address straight away instead of after a 30-second cache.

## [0.4.3] - 2026-09-18

### Fixed

- **"On-device off" was a dead end.** The chip now reads "On-device: set up"
  (or shows the model when one is ready) and is always clickable: it opens the
  model panel, or - where this editor has no built-in engine - step-by-step
  setup for a free local model server.

## [0.4.2] - 2026-09-18

### Fixed

- **The Repository and Issues links pointed at a private repository**, so they
  opened a 404 on the Marketplace and Open VSX pages. They now point at the
  extension's public source: https://github.com/punith-naga/vegaduta-vscode-extension

## [0.4.1] - 2026-09-18

### Changed

- **Calmer colours.** Softer, less saturated brand colours, gentler glows and
  slower animation - easier on the eyes over a long day, in dark and light.
- **The sidebar icon is bolder.** VS Code draws activity-bar icons in one
  colour, so the icon is the winged emblem's own silhouette, cropped and
  thickened so it reads clearly at 24px.

### Fixed

- **Panels no longer cut each other off.** Only one drawer (models, history,
  Toolkit or Instant tools) is open at a time; it takes the conversation's
  space and scrolls inside it, so the header, account bar and message box
  always stay fully visible.
- **Small panels arrange properly.** Short or narrow panels tighten their
  rows, and a notice explains how to get more room (drag the edge, or move
  VegaDūta to the Secondary Side Bar). Dismiss it and it stays away.
- **Toolkit recipe cards** stack their title, text and details instead of
  squeezing them into columns.
- **Recipes run before sign-in.** Picking a recipe while signed out now holds
  it and runs it once you sign in or a model is ready.

## [0.4.0] - 2026-09-18

### Added

- **A redesigned panel.** VegaDūta now has its own look instead of the pale
  host greys: the emblem's violet, cyan and gold on a deep indigo (or a soft
  light theme), with real boxed buttons, a floating message box, and a sign-in
  bar that lines up. VS Code high-contrast themes keep their own colours.
- **Always listening.** The message box never locks. Ask something before you
  have signed in or downloaded a model and VegaDūta holds the question, offers
  one-click ways to answer it (a free on-device model, or signing in), and
  sends it by itself as soon as one is ready. A live indicator in the header
  shows Ready, Listening, Thinking or Holding.
- **A home screen worth opening.** A greeting, a one-click card for free
  on-device AI, quick starts with icons, "Try asking" prompts for your role,
  recipes for your role, and a daily tip. All of it works before you sign in.
- **Instant tools: 18 offline developer utilities.** JSON formatter, JWT
  decoder, regex tester, cron explainer, timestamps, test data (JSON/CSV/SQL),
  text diff, hashes, Base64, URL and query strings, UUIDs, passwords, number
  bases, colours with WCAG contrast, case conversion, SQL formatting, HTML
  entities and text stats. They run inside the panel: no account, no model,
  nothing sent anywhere. Results can be copied, opened as a file, or handed to
  the AI with one click.

## [0.3.1] - 2026-09-18

### Fixed

- **Sign-in gave up when the sign-in server rate-limited it.** While you
  approve the code in your browser, the extension checks for the approval every
  few seconds. The sign-in server's edge answers repeated checks with HTTP 429,
  which the extension treated as a failed sign-in - and continuing to check
  could get your network temporarily blocked from the sign-in page itself. It
  now waits longer after a 429 (honouring the server's Retry-After, up to a
  minute between checks) and keeps going until the code expires.

## [0.3.0] - 2026-09-18

Not yet published to the Marketplace. Type-checked, bundled and packaged;
not yet exercised in a running VS Code.

### Added

- **Attach context to a chat message.** The panel can now ask VS Code for the
  file in the active editor, the current selection, your working-tree changes
  (staged and unstaged, through VS Code's built-in Git support) or the active
  file's problems. Each attachment is capped at 24,000 characters and marked
  *truncated* when it was cut; anything VS Code cannot supply comes back with
  a reason ("No file is open", "This folder is not a git repository",
  "There are no uncommitted changes") instead of an empty attachment. New,
  untracked files are named but their contents are not included.
- **VegaDuta: Review My Changes** — reviews your uncommitted changes. In the
  command palette, the editor right-click menu and the Source Control view's
  **…** menu.
- **VegaDuta: Generate Commit Message** — a ✨ button in the Source Control
  title bar (and a palette command) that drafts a commit message from your
  changes. *Use as commit message* writes it into the Source Control message
  box; the extension never commits. Without VS Code's Git support the message
  is copied to the clipboard and a notification says why.
- **VegaDuta: Explain This Problem** — a lightbulb quick fix on every error
  and warning that explains the problem with the surrounding code (and your
  selection, if any).
- **Open in a new editor tab.** Generated code from the panel can open as a
  new untitled document in its language.
- The panel is told what this editor supports (context kinds, insert, new
  file, run code, commit message) so it only offers what works here.
- A walkthrough step for reviewing changes and writing commit messages.
- **Toolkit and roles.** The panel gains a library of recipes for developers,
  testers, reviewers, architects, product/BA people and DevOps, ordered for
  the role you pick, plus your own recipes (export / strict import as JSON).
- **Private Mode** (panel switch, or **VegaDuta: Toggle Private Mode**). While
  it is on, no prompt, code, attachment, page text or search query leaves the
  machine. Allowed: your own local model server, on-device (WebLLM) inference,
  and fetching the public model list / downloading model weights on an
  explicit click. Blocked: hosted chat, hosted completions, hosted commands,
  knowledge search, the code sandbox, workflow runs and code validation. The
  extension enforces this itself (not only the panel): those requests are
  refused before any network call, hosted inline completions are not
  requested, the editor and Source Control commands only proceed when an
  on-device model is ready, **Run Workflow…** is refused, and the coding agent
  refuses to start against a non-local endpoint. The setting persists across
  reloads, a lock icon labelled *Private* shows in the status bar, and
  turning it off from the status bar asks for confirmation.
- **Code Tour.** The panel can open a workspace file and select the lines it is
  explaining. Paths are checked with the same containment rules as the coding
  agent (no `..`, no absolute paths outside the workspace, no symlink that
  leads out); anything else is refused with a notification. Line numbers are
  clamped to the file.
- **Ask the team.** With a full sign-in (not a `vmcp_` API key) the panel can
  search your workspace's knowledge base (`POST /api/knowledge/search`, top 5
  by default, at most 20, 15-second timeout) and answer with sources. The
  search runs in the extension with your token; the panel never holds it.
  Failures come back as *signed out*, *forbidden* (401/403) or *unavailable*.
- **Rubber Duck** and **Second Opinion** modes, and **Machine Check** (a short
  timed generation on this machine that says what your model is fast enough
  for), all in the panel.
- Two more attachments: **recent commits** (the last 30 commit subjects and
  short bodies, through VS Code's Git support) and **your terminal selection**
  (copied via the clipboard, whose previous text is restored; VS Code has no
  stable API to read a terminal selection directly).
- **Unit tests.** `npm test` runs vitest (borrowed from `web/node_modules`)
  against a small mock of the `vscode` module: context labels, truncation and
  reasons, Code Tour path containment (including a real symlink escape), the
  knowledge-search mapping, and Private Mode enforcement through the chat view.

### Changed

- **Generate Tests** and **Add Documentation** are now **Write Tests for
  Selection** and **Add Docs to Selection**. They send straight away with the
  selection attached, and — like every new command above — work signed out
  with an on-device model as well as signed in. The command ids are
  unchanged, so existing keybindings keep working.
- README rewritten as a user guide: getting started with the free on-device
  path, every command and setting, what leaves your machine, and
  troubleshooting (including the "Offline tokens are not allowed for this
  user" sign-in error, which was a server-side account problem fixed on
  2026-09-18).
- Marketplace description and keywords updated.
- The coding agent's workspace-containment check moved into its own module so
  Code Tour reuses it unchanged.

### Fixed

- **Hosted inline completions never ran.** The extension built the
  completion provider without its sign-in, so `vegaduta.completions.provider`
  `hosted` (and `auto` with no on-device model) silently produced nothing.
  Signed-in users now get what the setting describes.

## [0.2.0] - 2026-09-17

### Added

- **On-device model panel.** Clicking the engine chip in the chat panel opens
  a list of the WebLLM models the server advertises at
  `GET /api/edge/manifest`, each with Download / Use / Delete and a progress
  bar while it fetches, plus a *Prefer* select (best fit / hosted only / one
  named model). Until now no client had any way to start or remove a
  download — a model had to arrive some other way before the on-device path
  did anything.
- **On-device chat.** Once a model is ready the composer works without
  signing in and answers stream from the local model; a signed-in user gets a
  Hosted / On-device toggle next to the engine chip. Local chat keeps its own
  conversation history, windowed against the model's context budget.
- **`VegaDuta: Download an On-Device Model`**, a command that opens the same
  panel, and a four-step getting-started walkthrough (on-device, coding agent,
  completions, sign-in).
- **Use-case aware model choice.** Manifest models may now carry a `useCases`
  field, inferred from the model id when the server omits it. Completions,
  Fix, Refactor and Explain pick a code-trained model (Qwen2.5-Coder) when one
  is installed; plain chat picks a general model.
- **A larger built-in catalog** — ten models, ids and sizes taken from the
  bundled `@mlc-ai/web-llm` 0.2.84: Qwen2.5-Coder 1.5B / 3B / 7B, Llama 3.2 1B
  / 3B, Qwen3 1.7B / 4B, Phi-4-mini, Llama 3.1 8B and
  DeepSeek-R1-Distill-Qwen-7B. The platform's own default catalog gained the
  same coder models, so they appear without an admin enabling anything.
  Everything on the on-device path is free and needs no VegaDuta account.
- **Coding agent** (`VegaDuta: Start a Coding Task`, plus a setup walkthrough
  under `VegaDuta: Set Up the Coding Agent`). A multi-step tool-calling agent
  that reads, searches, edits and runs commands in the open workspace against
  your own OpenAI-compatible endpoint - a local server (Ollama / LM Studio /
  llama.cpp) or a provider key you hold. No sign-in, no quota, no platform
  call. Every edit opens a real diff editor before it applies, and every
  command asks first.
- **Hosted inline completions.** `completions.provider: hosted` now works:
  the platform exposes a fill-in-the-middle endpoint, metered under your
  tenant budget like every other hosted call. Machines without WebGPU or a
  local server get completions for the first time.
- Marketplace metadata (`repository`, `bugs`, `homepage`, `keywords`,
  `galleryBanner`, `pricing: Free`), `LICENSE` (Apache-2.0) and this
  changelog.

### Changed

- Licensed Apache-2.0 and dropped `"private": true` so `vsce` will package
  and publish it.
- Description, README and categories (AI / Chat / Machine Learning) rewritten
  to match what the code does today.
- `vegaduta.agent.*` settings are machine-scoped, and the extension declares
  limited support in untrusted workspaces, so a repository cannot ship a
  `.vscode/settings.json` that turns off the approval gate or repoints the
  model endpoint.
- `.vscodeignore` drops `package-lock.json`, `**/*.ts`, `test/**` and
  stray `*.vsix` files.

### Fixed

- **Multi-line agent replies lost every newline.** The SSE reader treated each
  `data:` line as a chunk, but the server frames one multi-line event as
  several `data:` lines. Whole answers on the Planned / Careful / Rigorous
  reasoning depths arrived as one flattened line. Events are now reassembled
  per the SSE spec, with regression tests.
- **`vegaduta.ollama.baseUrl` was read and then ignored.** The setting was
  loaded but never passed to the local-server probe, so a server on any port
  other than the default was never found. It is applied now.
- A connect-timeout on a chat turn no longer retries the POST, which had
  started a second full turn server-side and re-run every tool.
- Hosted completions arm their deadline before waiting for a token, so a
  hanging refresh cannot block past the budget on every keystroke, and
  signing in clears a leftover signed-out cooldown.
- Coding-agent hardening from an adversarial review: symlink escapes out of
  the workspace are rejected on resolved real paths; `AGENTS.md` /
  `CONTRIBUTING.md` are fenced as untrusted data rather than appended to the
  system prompt; a ReDoS in `search_text`; raw provider error bodies no
  longer surface in notifications.

## [0.1.1] - 2026-08-19

### Added

- Marketplace listing icon (`media/icon.png`). The manifest had no top-level
  `icon` — the only `icon` key was nested in the Chat view-container config —
  so the listing fell back to VS Code's generic default.

### Changed

- Default environment switched from staging to **production**
  (`api.vegaduta.ai` / `auth.vegaduta.ai`). Staging remains available via
  `vegaduta.environment`.

### Fixed

- Local **Fix** / **Refactor** could apply an edit at stale positions: the
  document can change during the up-to-60s generation, or while the
  replace/copy prompt is open. The edit is now checked against the document
  version captured before generating, and degrades to a clipboard copy instead
  of overwriting the wrong text.
- The chat **Stop** button was a no-op in `vmcp_` API-key mode.
- Sign-in against staging was blocked by two Keycloak-side faults on the
  `agentic-ai-ide` client (a client description longer than the column allows,
  and a client-wide PKCE requirement that breaks the device-authorization
  flow). Fixed live and in the realm export, so a fresh import does not
  reintroduce them.
- `.vsix` packaging no longer sweeps in a stray `.idea/` folder.

## [0.1.0] - 2026-08-09

Initial release.

### Added

- **On-device inline completions** for every language: fill-in-the-middle
  against the local engine, 250ms debounce with abort-on-keystroke, a 1200ms
  hard deadline, and a 32-entry LRU cache. Runs signed out and never calls the
  platform.
- **Two local backends**, tried in order: WebLLM over WebGPU (only a model you
  already downloaded is used — nothing downloads by itself) and any
  OpenAI-compatible local server (Ollama / LM Studio / llama.cpp), auto-probed
  at `127.0.0.1:11434` or wherever `vegaduta.ollama.baseUrl` points.
- **Local quick actions** in a `VegaDuta: Run Locally (WebLLM)` context
  submenu — Explain, Fix, Refactor. Fix/Refactor propose only; nothing is
  written until you choose *Replace Selection*.
- **Agent chat** in the activity-bar panel, streamed over SSE, with OIDC
  device-flow sign-in and a scoped `vmcp_` API-key fallback for environments
  where the browser flow is not an option.
- **Workflow runs** from the panel or `VegaDuta: Run Workflow…`, polled every
  2s until COMPLETED / FAILED / CANCELLED.
- **Hosted context-menu actions** — Explain, Fix, Refactor, Generate Tests, Add
  Documentation — which stage the selection and an instruction into the chat
  composer so the request goes through your chosen agent under your tenant's
  budget and guardrail policies.
- Status-bar chip reporting the live state: on-device engine (with model and
  backend) > hosted > signed out.
- Settings for environment (staging / production / self-hosted custom),
  completion source, on-device opt-out, and the local server URL.

[Unreleased]: https://github.com/punith-naga/vegaduta-vscode-extension/commits/main
