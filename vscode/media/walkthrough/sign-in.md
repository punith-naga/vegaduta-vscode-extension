# Your tenant's agents and workflows

Signing in adds the hosted half: the agents and workflows your VegaDuta
tenant already has, streamed into the panel, under your tenant's budget and
guardrail policies.

- **Sign In** uses the OAuth device flow - a code to confirm in your browser,
  no local ports, so it works over Remote/SSH/WSL.
- Headless or CI? **VegaDuta: Use API Key (vmcp_) Instead of Signing In** accepts a scoped `vmcp_` key
  (chat becomes non-streaming and is limited to what the key exposes).
- The **Hosted / On-device** switch next to the engine chip picks where a
  signed-in chat runs. Signed out, the composer is on-device by construction.

`vegaduta.environment` selects production (`vegaduta.ai`), staging or a
self-hosted deployment.
