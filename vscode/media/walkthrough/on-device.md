# Free on-device AI

Open the **VegaDuta** view in the activity bar. The chip at the top of the
panel shows the on-device engine's state. Click it to open the model panel:

- **Download** a model that fits your machine. The recommended one is small
  (about 0.9 GB) and quick; bigger ones answer better on harder questions.
  A download starts only when you click it, is stored by the editor, and can
  be deleted from the same panel.
- **Use** a downloaded model, or set *Prefer* to *Best fit for this device*.
- No WebGPU on this machine? Start **Ollama**, **LM Studio** or
  **llama.cpp** and the panel connects to it instead
  (`vegaduta.ollama.baseUrl`).

Once the chip shows your model:

- the composer works **without signing in** - every answer runs here;
- right-click a selection for *Write Tests for Selection*, *Add Docs to
  Selection*, or **VegaDuta: Run Locally** → *Explain / Fix / Refactor*;
- inline completions come from the same engine.

Your code stays on your machine on this path. One narrow exception, listed in
the README: after a local *Fix* or *Refactor* of **Java or Python** code, the
generated code (not your file) is sent once to VegaDuta's syntax checker.
