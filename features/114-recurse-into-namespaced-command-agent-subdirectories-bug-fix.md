# Recurse into namespaced command/agent subdirectories (bug fix)

**Category:** Capability Ledger, Frameworks, Skills & Setup

- **Source**: SuperClaude Framework (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: SuperClaude installs commands into `~/.claude/commands/sc/*.md`; Loush's own scanner currently only reads the top level of `~/.claude/commands`/`agents`, so 30 real, installed commands are invisible today.
- **Where to add**: `server/index.mjs` — `KINDS`, `itemFile()`, `/api/res/:kind`, `overviewItems()` — walk `~/.claude/commands/**` and `~/.claude/agents/**`, deriving display names as `sc/implement.md` → `sc:implement`.
- **Caveats**: None noted. Described as the single highest-value item in the whole SuperClaude analysis — fixes a real bug in Loush itself.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
