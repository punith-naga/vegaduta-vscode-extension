# Toolkit, roles and Private Mode

**The Toolkit** in the VegaDuta panel is a library of ready-made recipes: a
named prompt plus the context it needs. Pick your role (Developer, Tester / QA,
Reviewer, Architect, Product / BA or DevOps) and the recipes for the phases
you work in come first. Every recipe stays available; your role only changes
the order. Write your own recipes and export or import them as JSON.

Also in the panel:

- **Code Tour** walks through the current file stop by stop and selects each
  stop's lines in the editor. It only opens files inside this workspace.
- **Rubber Duck** asks you one guiding question at a time instead of handing
  you the answer.
- **Second Opinion** (signed in, with an on-device model ready) shows your
  on-device model's answer next to your hosted agent's.
- **Ask the team** (signed in) answers from your workspace's knowledge base,
  with sources.
- **Machine Check** in the model panel times a short generation on this
  machine and says what your model is fast enough for.

**Private Mode**: while it is on, no prompt, code, attachment, page text or
search query leaves your machine. Your own local model server, the on-device
model, and model downloads you click are still allowed; hosted chat, hosted
completions, hosted commands, knowledge search, the code sandbox, workflow runs
and code validation are blocked. VS Code enforces it too, shows a lock icon
labelled *Private* in the status bar, and keeps it on across reloads.
