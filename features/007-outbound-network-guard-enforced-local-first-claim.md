# Outbound-network guard (enforced local-first claim)

**Category:** Security, Governance & Access Control

> **Status: implemented, but the premise was wrong — read this.** `lib/network-guard.mjs`,
> opt-in via `DASH_NETWORK_GUARD=report|block`, **off by default**.
>
> The feature was written to "turn the README's local-first, zero-telemetry claim into an
> enforced invariant". That claim does not exist in this README, and this app makes real,
> deliberate outbound calls — `api.anthropic.com` (atoms), `api.figma.com` (figma-capture) and
> Atlassian (setup). So `block` mode breaks working features, and enabling anything by default
> would have been wrong. It ships as an **audit** tool: `report` records what actually leaves
> the process so the claim can be checked rather than assumed.
>
> The guarantee is also narrower than the feature implied and is documented as such in the
> module: it covers *this process only*. Child processes, worker threads, native addons and DNS
> resolution are all unaffected. Do not restate it as "nothing this app does reaches the network".

- **Source**: Claude Code Dashboard / "CSI" (RESEARCH_MERGED.md, Feature inventory `network-guard.ts`; Recommended adoptions)
- **What**: Patches `net.Socket.prototype.connect` to allowlist only `127.0.0.1`/`localhost`/`::1`/`0.0.0.0`, recording any blocked outbound connection attempt — turning a "local-first, zero telemetry" README claim into an enforced, auditable invariant.
- **Where to add**: new `lib/network-guard.mjs`, imported as the first statement of `server/index.mjs`
- **Caveats**: MIT-licensed. If Loush spawns Claude as a child process anywhere, children are unaffected by this guard — document the guarantee precisely as "this process makes no outbound connections," not a blanket zero-outbound claim.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
