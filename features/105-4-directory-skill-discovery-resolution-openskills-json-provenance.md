# 4-directory skill-discovery resolution + `.openskills.json` provenance

**Category:** Capability Ledger, Frameworks, Skills & Setup

- **Source**: openskills (RESEARCH_MERGED.md, Feature inventory `install.ts`, `skill-metadata.ts`, `dirs.ts`, `skills.ts`; Recommended adoptions)
- **What**: Resolves installed skills across 4 search directories (first-wins dedup), records provenance in a `.openskills.json` sidecar (source repo, install date), and parses an `AGENTS.md`'s `<available_skills>` block.
- **Where to add**: extend `KINDS.skills.dirs()` and `hubListSkills` in `server/index.mjs` to also scan `./.agent/skills` and `~/.agent/skills`; add `source`/`installedAt` columns to `/api/capabilities`; render in `CapabilityLedger.jsx` and `CustomizeSection.jsx`
- **Caveats**: Apache-2.0 — safe to copy code directly. Fixes a real gap: projects using openskills have skills and an always-on `AGENTS.md` block Loush's context-budget math currently doesn't see or price.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
