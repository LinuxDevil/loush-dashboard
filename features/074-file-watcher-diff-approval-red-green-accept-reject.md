# File-watcher diff approval (red/green accept/reject)

**Category:** UI, Viewers & Editor Integration

- **Source**: Nimbalyst (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: A PreToolUse hook snapshots a file's content before an agent tool edits it; a filesystem watcher then detects the change and renders an accept/reject diff in the file's native viewer. A DB-level "one pending tag per file" constraint prevents duplicate reviews; consecutive edits to the same file coalesce into a single original→latest diff.
- **Where to add**: new `server/history.mjs` (tag store + watcher) and `src/ui/viewers.jsx` (diff rendering), surfaced in `ArtifactsSection.jsx`. A degraded v1 without hooks can snapshot on file-open/each accepted review and diff disk-vs-last-known.
- **Caveats**: None noted (MIT).

## Related / Depends on

This feature shares infrastructure or a prerequisite with the following features. If you're implementing this one, check whether the related feature already exists or needs to be built first/alongside — reconciling that overlap is this agent's responsibility.

- `040-jsonl-filesystem-watcher-sse-live-event-bus.md` — JSONL filesystem-watcher → SSE live event bus

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
