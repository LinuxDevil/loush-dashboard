# PostToolUse prompt-hook cost pricing

**Category:** Cost, Pricing & Usage Accounting

- **Source**: SuperClaude Framework (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: Recognizing a `type: "prompt"` hook on `Write`/`Edit` costs an extra model turn per edit, priced using existing per-session `Write`/`Edit` tool-call counts.
- **Where to add**: `src/sections/HooksSection.jsx`, `customizeHooks()` in `server/index.mjs`.
- **Caveats**: None noted; extends the Capability Ledger cost-attribution idea to hooks specifically.

## Related / Depends on

This feature shares infrastructure or a prerequisite with the following features. If you're implementing this one, check whether the related feature already exists or needs to be built first/alongside — reconciling that overlap is this agent's responsibility.

- `115-framework-attribution-in-the-capability-ledger.md` — Framework attribution in the Capability Ledger

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
