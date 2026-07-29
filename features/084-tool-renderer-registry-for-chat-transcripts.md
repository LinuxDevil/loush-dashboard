# Tool-renderer registry for chat transcripts

**Category:** Chat & Permissions

- **Source**: CloudCLI / siteboon-claude-code-ui (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: A `toolName → renderer` lookup registry plus `parentToolUseId`-based subagent grouping, so live chat and historical transcript views share one rendering path.
- **Where to add**: `ChatSection.jsx` (formalizing existing ad-hoc subagent nesting), reused in `ForensicsSection.jsx` and `ContextExplorerSection.jsx`.
- **Caveats**: AGPL-3.0-or-later, pattern only.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
