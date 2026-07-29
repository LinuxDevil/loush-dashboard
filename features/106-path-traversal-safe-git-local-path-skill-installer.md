# Path-traversal-safe git/local-path skill installer

**Category:** Capability Ledger, Frameworks, Skills & Setup

- **Source**: openskills (RESEARCH_MERGED.md, Feature inventory `install.ts`)
- **What**: An installer that clones/copies skills from a GitHub `owner/repo`, arbitrary git URL, or local path, auto-detecting source type, with an `isPathInside(targetPath, targetDir)` guard, and a hardcoded warning list of 15 Anthropic-marketplace skill names it might collide with.
- **Where to add**: any skill-install flow in `CapabilityLedger.jsx` / `CustomizeSection.jsx`, backed by `server/index.mjs`
- **Caveats**: Apache-2.0, safe to copy directly.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
