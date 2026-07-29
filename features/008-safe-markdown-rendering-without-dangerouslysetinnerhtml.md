# Safe markdown rendering without dangerouslySetInnerHTML

**Category:** Security, Governance & Access Control

- **Source**: Claude Code Agent Monitor / CCAM (RESEARCH_MERGED.md, Feature inventory `MarkdownContent.tsx`; Recommended adoptions)
- **What**: A hand-written markdown renderer (fenced code, headings, lists, task lists, blockquotes, tables, inline formatting) that builds a React element tree directly instead of using `dangerouslySetInnerHTML`, removing an XSS surface on untrusted transcript content; paired with a TUI-tag/ANSI-stripping segment parser.
- **Where to add**: `src/sections/ChatSection.jsx`, `ForensicsSection.jsx`; replaces any `marked`-based rendering of untrusted content
- **Caveats**: None noted (MIT).

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
