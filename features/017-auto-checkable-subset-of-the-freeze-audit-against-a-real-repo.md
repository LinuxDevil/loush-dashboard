# Auto-checkable subset of the freeze audit against a real repo

**Category:** Security, Governance & Access Control

> **Status: implemented.** `lib/freeze-audit.mjs` (75 items, 21 auto-checks) + 53 tests,
> `GET /api/gov/freeze-audit`, and a Freeze audit tab in `GovernanceSection.jsx`.
>
> Feature 016's checklist data is included here rather than split — the data and the checking
> are one deliverable. 21 checks are automated, well past the ~8 the feature scoped, and the
> three that report facts upstream never covered (LICENSE, test command, tests exist) live in
> `result.checks` with `itemId: null` so the 75-item set stays comparable with upstream.
>
> The honesty machinery is the point: `manual` and `unknown` are distinct from `fail`, a partial
> pass on a compound item resolves to `manual` carrying the unsettled clause, an unreadable root
> makes all 75 `unknown` with zero fails, and a human tick can lift a `manual` but deliberately
> cannot clear a `fail` — verified.
>
> Five items were re-scoped to a `ccbf` tag during integration. They check for
> claude-code-build-framework's own files (STATE.md, CONTEXT.md, docs/resources/README.md,
> lessons-learned.md, tests/role-tests.md); untagged they made every project that does not use
> that framework fail five readiness checks for not adopting someone else's filenames. Stack
> tags are auto-detected from the checkout with the evidence reported, so a wrong guess is
> visible rather than quietly turning real failures into n-a.

- **Source**: A. claude-code-build-framework (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: Machine-verifiable checks for ~8 of the 75 audit items against a real checkout: `.claude/agents/` non-empty, `.claude/hooks/pre_tool_use.py` exists, `settings.json` has `hooks` + `permissions.defaultMode`, `settings.local.json` gitignored, `.env.example` keys match `process.env` usage, `git status` clean.
- **Where to add**: new `/api/gov/freeze-audit?project=` endpoint in `server/index.mjs`, feeding the Freeze Audit tab with `auto: pass|fail|n-a` alongside manual ticks.
- **Caveats**: MIT. Flagged as the single highest-value differentiator — "nobody else auto-attests a production-readiness checklist against a real repo."

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
