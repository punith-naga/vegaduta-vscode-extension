# VegaDūta for VS Code

**Free AI coding help that runs on your own machine.** Chat about your code,
get inline completions, explain a compiler error, review your changes before
you commit, write the commit message, and hand a multi-step task to a coding
agent — with no account, no API key and no quota.

When you want more, sign in to your VegaDūta workspace and the same panel
talks to your team's hosted agents and workflows instead.

- **Free and private by default.** The on-device path runs a model on your
  GPU inside VS Code, or uses a local server you already run (Ollama,
  LM Studio, llama.cpp). Your code stays on your machine.
- **Works where you work.** Editor right-click menu, the lightbulb on a red
  squiggle, a button in the Source Control title bar, and the command palette.
- **You stay in control.** Nothing is committed for you, the coding agent
  shows a diff before every edit and asks before every command, and no model
  downloads until you click Download.
- **Private Mode when it matters.** One switch keeps every prompt, file and
  search query on your machine, and VS Code itself enforces it — see
  [Private Mode](#private-mode).
- **For the whole team, not only developers.** A Toolkit of ready-made
  recipes for developers, testers, reviewers, architects, product/BA people
  and DevOps, across planning, design, build, test, review, release and
  operations.

---

## Contents

- [Get started in two minutes](#get-started-in-two-minutes)
- [What you can do](#what-you-can-do)
- [The Toolkit, roles and new ways to work](#the-toolkit-roles-and-new-ways-to-work)
- [Private Mode](#private-mode)
- [Signing in (optional)](#signing-in-optional)
- [Commands](#commands)
- [Settings](#settings)
- [What leaves your machine](#what-leaves-your-machine)
- [Troubleshooting](#troubleshooting)
- [Requirements](#requirements)

---

## Get started in two minutes

1. **Install** VegaDūta from the Extensions view (search for *VegaDuta*), or
   run `code --install-extension vegaduta.vegaduta-vscode`.
2. **Open the VegaDūta panel** from its winged icon in the activity bar.
3. **Pick an on-device engine** — either one works, and you need only one:
   - **A model in VS Code (WebGPU).** Click the engine chip at the top of the
     panel, choose a model and click **Download**. The recommended model is
     about 0.9 GB; larger ones answer harder questions better. The command
     **VegaDuta: Download an On-Device Model** opens the same list.
   - **A local server you already run.** Start
     [Ollama](https://ollama.com) (for example `ollama pull qwen2.5-coder:7b`),
     LM Studio or llama.cpp. The panel looks for Ollama at
     `http://127.0.0.1:11434`; for another address set
     `vegaduta.ollama.baseUrl` (LM Studio is usually `http://127.0.0.1:1234`).
4. When the engine chip shows your model and the status bar reads
   **VegaDuta: Local**, type a question in the panel. That's it — no account.

A guided version of these steps is the **Get started with VegaDuta**
walkthrough on VS Code's Welcome page (**Help → Welcome**).

> The on-device engine lives inside the VegaDūta panel, so open the panel
> once per window before expecting inline completions or local quick actions.

---

## What you can do

### Chat about your code

Ask anything in the panel. Attach context with one click — **the current
file**, **your selection**, **your uncommitted changes**, **the current
file's problems**, **your recent commits** (the last 30 subjects and short
bodies, so a commit message or release note matches your team's style) or
**your terminal selection** (select a failing test's output first) — and VS
Code sends only what you attach. Anything larger
than 24,000 characters is cut and marked *truncated* so you know the model
did not see all of it. Answers render as text and code blocks (model output is
never run as HTML), and each code block can be copied, inserted at your
cursor, or opened in a new editor tab.

### Review your changes before you commit

**VegaDuta: Review My Changes** attaches your working-tree diff — staged and
unstaged — and asks for a review: bugs, risky changes, missing tests. Run it
from the command palette, the editor right-click menu, or the **…** menu of
the Source Control view.

New files that git is not tracking yet are listed by name but their contents
are not included; `git add` them first if you want them reviewed.

### Write the commit message

Click the **✨ Generate Commit Message** button in the Source Control title
bar (or run **VegaDuta: Generate Commit Message**). VegaDūta reads the same
diff and drafts a message. Choose **Use as commit message** on the answer and
it is written into the Source Control message box — **it never commits**; you
review it and commit yourself.

### Understand an error

Put the cursor on a red or yellow squiggle, open the lightbulb (`Ctrl+.` /
`Cmd+.`) and choose **VegaDuta: Explain this problem**. VegaDūta sends the
problem message, its location and the few lines of code around it (plus your
selection, if you have one) and explains what it means and how to fix it.

### Work on a selection

Select code and right-click:

| Menu item | What happens |
|---|---|
| **Explain Selection**, **Fix Selection**, **Refactor Selection** | The selection and an instruction are placed in the chat box. You press Send. |
| **Write Tests for Selection** | Sends the selection with a request for tests in your project's existing test style. |
| **Add Docs to Selection** | Sends the selection with a request for doc comments (docstrings, JSDoc, …). |
| **Run Locally (WebLLM) → Explain / Fix / Refactor** | Runs on your on-device engine without the chat panel. Fix and Refactor **never edit your file on their own**: you choose *Replace Selection* or *Copy to Clipboard*. Explain opens a Markdown document beside your code. |

These commands, and Review, Commit Message and Explain this problem, all go
through the chat panel, so they work **signed out** (the on-device model
answers) and **signed in** (the hosted agent you picked answers). Signed out
with no on-device engine ready, the panel tells you so instead of failing
silently.

### Inline completions

Grey-text suggestions as you type, in every language, from the on-device
engine. They are cancelled rather than shown late, and if the model is unsure
you simply see nothing. Signed-in users can also use the hosted completion
service (see `vegaduta.completions.provider`). Toggle them any time with
**VegaDuta: Toggle Inline Completions**.

### The coding agent

**VegaDuta: Start a Coding Task** runs a multi-step agent in your open folder.
Describe the job — *"the date parser drops time zones; find out why, fix it
and run the tests"* — and it lists and reads files, searches, edits and runs
commands until it is done or needs you.

- **It asks first.** Every edit opens VS Code's diff editor before it is
  applied; every shell command is shown in full and waits for your approval.
  *Allow all for this run* lasts for that one task only.
- **It stays in your folder.** Paths outside the workspace are refused,
  including through symlinks.
- **It is bounded.** At most `vegaduta.agent.maxSteps` steps (default 60), and
  a model repeating the same call is told to change approach.
- **It is free.** It talks to a local server (found automatically on
  `127.0.0.1` ports 11434, 1234 and 8080) or to a provider you hold a key for.
  No VegaDūta account is involved.

The model must support tool calling — `qwen2.5-coder`, `llama3.1`,
`mistral-nemo` and `devstral` do. Run **VegaDuta: Set Up the Coding Agent** to
see what was found; if nothing is running it shows the install and pull
commands for your platform. The agent runs with your user's permissions — a
short denylist blocks a few destructive commands, but it is not a sandbox.

### Your workspace's agents and workflows (signed in)

Signed in, the panel lists the agents your VegaDūta workspace has, streams
their replies, and can run a workflow and follow it to completion. Where your
admin has enabled it, code blocks in an answer can be run in a disposable
cloud sandbox (Python, JavaScript/TypeScript via Node, or Bash).

---

## The Toolkit, roles and new ways to work

These live in the chat panel and are new in 0.3.0.

### Toolkit and roles

The **Toolkit** is a library of ready-made *recipes*: a named prompt plus the
context it needs. Pick your role the first time — **Developer**, **Tester /
QA**, **Reviewer**, **Architect**, **Product / BA** or **DevOps** — and the
recipes for the phases you work in come first (every recipe stays available;
the role only changes the order). Examples: acceptance criteria from a story,
test cases as CSV, a security review of your diff, a PR description, release
notes from your recent commits, a log or stack-trace analysis, a runbook draft.

Recipes that need context you cannot attach in VS Code (a browser page, for
example) are hidden here. Recipes marked as working on a small model run on
your on-device model; the rest are better on a hosted agent. You can write
your own recipes, and export or import them as JSON. Imported recipes are
checked strictly; anything that does not match the format exactly is refused.
Your own recipes are stored in the panel on this machine.

### Code Tour

**Code Tour** gives you a guided walk through the current file: the model
picks the stops (entry points, key data structures, the parts that aren't
obvious) and each stop opens the file with those lines selected. VS Code only
opens files **inside your workspace** — a path that leads outside it,
including through a symlink, is refused with a notification. Line numbers are
clamped to the file.

### Rubber Duck

A mode where the assistant helps you find the answer yourself: it asks one
guiding question at a time and doesn't give the solution until you ask for it
("just tell me").

### Second Opinion

Signed in, with an on-device model ready and Private Mode off, you can send a
message to **both** your on-device model and your hosted agent and compare
the answers side by side.

### Ask the team

Signed in with **VegaDuta: Sign In** (not an API key), you can ask your VegaDūta
workspace's knowledge base a question. The answer comes with the sources it
used. The search runs in VS Code with your sign-in token; the panel never sees
the token. If your workspace has no knowledge base enabled, the panel tells
you it isn't available. Ask the team is off in Private Mode, because the
question would leave your machine.

> If you sign in after opening the panel, close and reopen the panel to see
> **Ask the team**.

### Machine Check

In the model panel, **Machine Check** times one short, fixed generation on the
model that would answer right now (your on-device model or your local server)
and reports how quickly the first token arrived and how many tokens per second
it produced. It tells you what that speed is good for (for example, whether it
is fast enough for inline completions) and may suggest a model that suits this
machine better. It runs on your machine and never starts a download.

---

## Private Mode

Turn it on from the panel, or with **VegaDuta: Toggle Private Mode**. While it
is on, a lock icon labelled **Private** shows in the status bar, and it stays on after a
reload until you turn it off.

**While Private Mode is on, no prompt, code, attachment, page text or search
query leaves your machine.**

- **Still allowed:** your own local model server (Ollama, LM Studio,
  llama.cpp), the on-device (WebLLM) model, and — only when you click — fetching
  the public model list and downloading model weights. None of these carry
  your content.
- **Blocked:** hosted chat, hosted inline completions, hosted commands
  (Explain / Fix / Refactor, Write Tests, Add Docs, Review, Commit Message and
  Explain This Problem only run if an on-device model is ready to answer them),
  Ask the team, the code sandbox, workflow runs, and the syntax check used by
  local Fix / Refactor. The coding agent only runs against a server on this
  machine; if `vegaduta.agent.baseUrl` points at a hosted provider it refuses to
  start.

VS Code enforces this itself as well as the panel: blocked requests are
refused in the extension before any network call, with the message *"Private
Mode is on - this runs on your machine only"*. Private Mode is not the same as
"offline": VS Code can still sign in, refresh your sign-in and list your
workspace's agents, and the panel can fetch the public model list. None of
those send your content.

Turning it off from the status bar or the command palette asks you to confirm.

---

## Signing in (optional)

Everything in [Get started](#get-started-in-two-minutes) works without an
account. Sign in to use your VegaDūta workspace's hosted agents, workflows and
hosted completions.

1. Run **VegaDuta: Sign In** (or click **Sign in** in the panel).
2. Your browser opens the VegaDūta sign-in page with a code already filled in.
   The same code is shown in a VS Code notification — check they match.
3. Approve, and the notification closes. The status bar shows
   **VegaDuta: Hosted** unless an on-device engine is ready.

Sign-in uses the OAuth device flow, so it also works over Remote-SSH, WSL and
dev containers. Tokens are kept in VS Code's secret storage, never in
settings, and never enter the chat panel.

**No browser available?** **VegaDuta: Use API Key (vmcp_) Instead of Signing
In** accepts a scoped `vmcp_` key from your workspace admin. Chat replies then
arrive in one piece instead of streaming.

Need an account? Create one at [vegaduta.ai](https://vegaduta.ai).

---

## Commands

Open the command palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and type
*VegaDuta*.

| Command | What it does | Needs |
|---|---|---|
| **Download an On-Device Model** | Opens the model list in the panel: download, use or delete a model. | — |
| **Review My Changes** | Reviews your staged and unstaged changes. | a git folder |
| **Generate Commit Message** | Drafts a commit message from your changes; *Use as commit message* fills the Source Control box. | a git folder |
| **Explain This Problem** | Explains the problem under the cursor (also in the lightbulb menu). | a problem in the file |
| **Write Tests for Selection** | Writes tests for the selected code. | a selection |
| **Add Docs to Selection** | Adds doc comments to the selected code. | a selection |
| **Explain / Fix / Refactor Selection** | Puts the selection and an instruction in the chat box for you to send. | a selection |
| **Explain / Fix / Refactor Selection (Local · WebLLM)** | Runs on the on-device engine without the panel; never edits your file without asking. | a selection, a ready on-device engine |
| **Toggle Inline Completions** | Turns inline completions off, or back on (`auto`). | — |
| **Toggle Private Mode** | Keeps every prompt, file and search query on this machine; turning it off asks first. | — |
| **Start a Coding Task** | Runs the coding agent on a task you describe. | a local server or provider key |
| **Set Up the Coding Agent** | Finds a local model server, or shows how to install one. | — |
| **Set Agent API Key** | Stores a provider API key for the coding agent in the OS secret store. | — |
| **Sign In** / **Sign Out** | Connects to or disconnects from your VegaDūta workspace. | an account |
| **Use API Key (vmcp_) Instead of Signing In** | Uses an admin-issued scoped key instead of a browser sign-in. | a `vmcp_` key |
| **Chat with Agent…** | Picks one of your workspace's agents and opens it in the panel. | sign-in |
| **Run Workflow…** | Runs one of your workspace's workflows and reports the result. | sign-in |

Unless marked, every command works signed out with an on-device engine ready.

---

## Settings

| Setting | Default | What it controls |
|---|---|---|
| `vegaduta.edge.enabled` | `true` | Allow the panel to start the on-device engine. Off = no local probing at all. |
| `vegaduta.ollama.baseUrl` | *(empty)* | Your local OpenAI-compatible server for chat, completions and quick actions. Empty = `http://127.0.0.1:11434`. Applied when the panel next opens. |
| `vegaduta.completions.provider` | `auto` | `auto` (on-device when ready, else hosted when signed in), `local` (on-device only), `hosted` (signed in, metered to your workspace), `off`. |
| `vegaduta.agent.baseUrl` | *(empty)* | Coding-agent endpoint. Empty = find a local server automatically; set a provider origin (e.g. `https://api.groq.com/openai`) to use your own key. |
| `vegaduta.agent.model` | *(empty)* | Coding-agent model; must support tool calling. Empty = pick one automatically. |
| `vegaduta.agent.maxSteps` | `60` | Most steps one coding task may take. |
| `vegaduta.agent.autoApproveEdits` | `false` | Apply the agent's edits without asking. |
| `vegaduta.agent.autoApproveCommands` | `false` | Run the agent's commands without asking. **This lets a model run any command as you.** |
| `vegaduta.environment` | `production` | Which VegaDūta deployment to sign in to: `production` (vegaduta.ai), `staging`, or `custom`. |
| `vegaduta.customApiBase` / `vegaduta.customAuthBase` | *(empty)* | Your self-hosted API and sign-in origins, used when `environment` is `custom`. Both are required; if either is missing VegaDūta warns you and uses staging. |

The `vegaduta.agent.*` settings can only be set in your user settings, not in
a repository's `.vscode/settings.json`, and the agent stays off in folders you
have not trusted — so a repository cannot switch off the approval prompts or
redirect the agent.

---

## What leaves your machine

| You use | What is sent, and where |
|---|---|
| On-device chat, completions, quick actions | Nothing leaves your machine. Prompts go to the model in VS Code or to your own local server. |
| Opening the model list | One anonymous request for the list of available models (no code, no token). If it fails, a built-in list is used. |
| Downloading a model | Nothing is uploaded. The model's weights come from Hugging Face and its runtime library from GitHub. |
| Local Fix / Refactor on **Java or Python** | The code the local model generated (not your file) is sent in one request to VegaDūta's syntax checker, which runs for at most 3 seconds and never blocks the result. Other languages skip it. |
| The coding agent | Only to the endpoint it uses. A local server = nothing leaves your machine. A hosted provider = the files, search results and command output the agent reads go to **that provider**, under your key. Never to VegaDūta. |
| Signed-in chat, Review, Commit Message, Explain, Tests, Docs, hosted completions | Your message and whatever you attached (file, selection, diff, problems) go to your VegaDūta workspace and the model its agent uses. |
| Running a code block in the sandbox | That code block goes to your workspace's sandbox. |
| Ask the team | Your question goes to your VegaDūta workspace's knowledge search. |
| Recent commits / terminal selection attachments | Only what you attach, and only where that message goes (see the rows above). Reading your terminal selection briefly uses the clipboard; your previous clipboard text is put back straight away. |
| Anything, with **Private Mode** on | No prompt, code, attachment or search query leaves your machine — see [Private Mode](#private-mode). |

VegaDūta for VS Code sends no telemetry of its own.

---

## Troubleshooting

**Sign-in fails with "Offline tokens are not allowed for this user".**
This was a server-side problem with some accounts, fixed on 18 September
2026. If your account still shows it, the fix is on the server: ask your
VegaDūta workspace admin to re-attach the realm's default role to your
account, then sign in again. Nothing needs to change in VS Code.

**The chip says "On-device off: no WebGPU in this host".**
Your GPU or remote setup cannot run models inside VS Code. Use a local server
instead: start Ollama (or LM Studio / llama.cpp), set
`vegaduta.ollama.baseUrl` if it is not on port 11434, and reopen the panel.

**No inline completions.**
Check the status bar: completions come from the on-device engine only when it
reads **VegaDuta: Local**. Open the VegaDūta panel once in this window, make
sure your local server is running (or a model is downloaded), and check that
`vegaduta.completions.provider` is not `off`.

**Review My Changes / Generate Commit Message says there is nothing to use.**
*"There are no uncommitted changes"* means git sees nothing to review.
*"Only new, untracked files have changed"* means you need to `git add` them.
*"This folder is not a git repository"* or *"Git is disabled in VS Code"*
mean VS Code's built-in Git support cannot see a repository here.

**The commit message was copied to the clipboard instead.**
VS Code's Git support was not available, so VegaDūta could not reach the
Source Control message box. Paste it where you need it.

**Running a code block says you need permission.**
The cloud sandbox is limited to roles your admin grants. The message names
what to ask for.

**"Nothing is selected in the terminal".**
Select the output in the terminal first (drag over it), then attach it. VS
Code has no stable way for an extension to read a terminal selection
directly, so VegaDūta copies it through the clipboard and then restores your
previous clipboard text. If your clipboard held an image or files rather than
text, that is not restored.

**"Private Mode is on - this runs on your machine only".**
You asked for something that would send your content to the platform (hosted
chat, Ask the team, the sandbox, a workflow). Start your local model server or
download an on-device model, or turn Private Mode off from the status bar.

**The coding agent says the model cannot call tools.**
Choose a tool-calling model (`qwen2.5-coder`, `llama3.1`, `mistral-nemo`,
`devstral`) in `vegaduta.agent.model`, or pull one with your local server.

Still stuck? Open an issue at
[github.com/punith-naga/vegaduta-vscode-extension/issues](https://github.com/punith-naga/vegaduta-vscode-extension/issues).

---

## Requirements

- VS Code 1.90 or later.
- For free on-device use, one of: a GPU that supports WebGPU, or a local
  OpenAI-compatible server (Ollama, LM Studio, llama.cpp).
- For Review My Changes and Generate Commit Message: a git repository and VS
  Code's built-in Git support enabled.
- For hosted agents and workflows: a VegaDūta account.

---

## Building from source

The chat UI is the shared webview bundle in `clients/shared`. Build it first,
then the extension:

```sh
cd clients/shared
npm install
npm run build:webview     # -> clients/shared/dist/webview/

cd ../vscode
npm install
npm run build             # dist/extension.js + copies the webview into media/webview/
```

`npm run typecheck` runs `tsc --noEmit` over `src/` and `../shared/src`;
`npm test` runs the unit tests (vitest, borrowed from `web/node_modules`,
against a small mock of the `vscode` module); `npm run package` produces the
`.vsix`.

## License

Apache-2.0 — see [LICENSE](LICENSE).
