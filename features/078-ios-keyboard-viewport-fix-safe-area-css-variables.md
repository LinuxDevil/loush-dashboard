# iOS keyboard/viewport fix + safe-area CSS variables

**Category:** UI, Viewers & Editor Integration

- **Source**: CloudCLI / siteboon-claude-code-ui (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: A `visualViewport`-based effect that fixes the mobile-Safari on-screen-keyboard layout bug, plus CSS custom properties for `safe-area-inset-*`.
- **Where to add**: `src/App.jsx` and `src/styles.css`.
- **Caveats**: A ~14-line effect, small enough to write independently rather than port from AGPL source. Flagged as the cheapest visible mobile-usability win in the research.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
