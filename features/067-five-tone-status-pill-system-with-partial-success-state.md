# Five-tone status pill system with partial-success state

**Category:** UI, Viewers & Editor Integration

- **Source**: CAST — Claude Code Dashboard (RESEARCH_MERGED.md, Notable code worth stealing; Recommended adoptions)
- **What**: A single `toneFor()`-style status-to-color/label mapping (5 tones including an amber "partial success" state), with pulse animation reserved for genuinely-live states and respecting `prefers-reduced-motion`.
- **Where to add**: new `src/components/StatusPill.jsx`, applied across `RunsSection.jsx`, `ReliabilitySection.jsx`, `BoardSection.jsx`, `QualitySection.jsx`
- **Caveats**: No LICENSE file on CAST — permission recorded per research.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
