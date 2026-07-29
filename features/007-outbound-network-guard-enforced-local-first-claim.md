# Outbound-network guard (enforced local-first claim)

**Category:** Security, Governance & Access Control

- **Source**: Claude Code Dashboard / "CSI" (RESEARCH_MERGED.md, Feature inventory `network-guard.ts`; Recommended adoptions)
- **What**: Patches `net.Socket.prototype.connect` to allowlist only `127.0.0.1`/`localhost`/`::1`/`0.0.0.0`, recording any blocked outbound connection attempt — turning a "local-first, zero telemetry" README claim into an enforced, auditable invariant.
- **Where to add**: new `lib/network-guard.mjs`, imported as the first statement of `server/index.mjs`
- **Caveats**: MIT-licensed. If Loush spawns Claude as a child process anywhere, children are unaffected by this guard — document the guarantee precisely as "this process makes no outbound connections," not a blanket zero-outbound claim.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
