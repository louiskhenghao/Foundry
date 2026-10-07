# ADR-0026: Messages link on the tailnet, and Foundry serves preview ports there

**Status:** accepted · 2026-10-07

## Context

Notifications linked to a page only when **Link base URL** was set, and a milestone's preview went out as a bare
`http://localhost:42xx`, which Telegram does not even turn into a link and which opens nothing on a phone. Most people
who read the messages on a phone reach the machine over Tailscale, and previews listen on loopback, so even a known
`ts.net` name did not reach them.

## Decision

- Messages carry links as links (Telegram HTML, Discord masked links): the page on this computer (the link base URL,
  else `http://localhost:<port>`), and the same page on the tailnet when Tailscale runs here. A channel that refuses a
  link gets the address written out.
- The tailnet address comes from `tailscale status` (or a name in Settings). A port already served with
  `tailscale serve` is reused as it is. Otherwise Foundry runs `tailscale serve --bg --https=<port> http://127.0.0.1:<port>`
  for its own port and for each running preview, so the address is HTTPS and reachable only on the tailnet; a preview's
  serve is removed when the preview stops, and every serve Foundry added when the engine stops. Ports the person served
  are never removed.
- The preview card opens a preview at its tailnet address when the page itself was opened from another device.
- **Tailscale links** = off turns all of this off; tests never touch the machine's tailnet.

## Consequences

- Foundry changes the machine's `tailscale serve` configuration on its own. It only adds HTTPS listeners on the tailnet
  (never `funnel`), on the same port numbers as the local servers.
- Without Tailscale nothing changes but the links: they point at this computer.
