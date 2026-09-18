# The coding agent

**VegaDuta: Start a Coding Task** runs a multi-step agent in this workspace:
it reads files, searches, edits (a real diff editor opens before anything
applies) and runs commands (asking first, every time).

It talks to an OpenAI-compatible endpoint that you choose:

- a **local server** you already run - Ollama, LM Studio, llama.cpp. Leave
  `vegaduta.agent.baseUrl` empty and the extension finds it on
  `127.0.0.1:11434 / :1234 / :8080`;
- a **provider you hold the key for** (Groq, OpenRouter, OpenAI, ...) - set
  `vegaduta.agent.baseUrl` and **VegaDuta: Set Agent API Key**.

The model must support tool calling (qwen2.5-coder, llama3.1, mistral-nemo,
devstral do). **VegaDuta: Set Up the Coding Agent** reports what it found and
offers the install/pull commands when nothing is running.

`vegaduta.agent.*` settings are machine-scoped: a repository cannot ship a
`.vscode/settings.json` that turns off the approval gate.
