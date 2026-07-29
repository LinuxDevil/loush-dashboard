# `EditorHost` uniform viewer lifecycle contract

**Category:** UI, Viewers & Editor Integration

- **Source**: Nimbalyst (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: A shared interface all file-type viewers implement — load/save/echo-detection/watch/diff/theme — where content never lives in React state; the host pushes content via `applyContent` and pulls via `getCurrentContent`, ignoring watcher events caused by its own saves.
- **Where to add**: refactor of `src/ui/viewers.jsx` plus a new `src/lib/editorHost.js`.
- **Caveats**: Adopt the interface only, not their packaged extension SDK/marketplace.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
