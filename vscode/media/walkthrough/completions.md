# Inline completions

Fill-in-the-middle suggestions in every language, debounced 250 ms, cached,
and abandoned rather than shown stale.

`vegaduta.completions.provider`:

- **auto** - the on-device engine when it is ready (a downloaded WebLLM model
  or your local server), else the platform when you are signed in;
- **local** - on-device only, never the platform;
- **hosted** - the platform's fill-in-the-middle endpoint, metered under your
  tenant budget;
- **off**.

The status bar chip shows which source is live: *Local*, *Hosted* or *Sign in*.
**VegaDuta: Toggle Inline Completions** flips between *off* and
*auto*.
