# Agent tool taxonomy

A way of partitioning a large agent tool surface into categories, and two patterns worth applying
deliberately rather than by accident. Taken as a design idea from the Perfect-Web-Clone /
"Nexting" writeup in `RESEARCH_MERGED.md` — that project has no LICENSE file, so nothing here is
derived from its source; this is the shape of the idea, re-expressed for this codebase.

It is documentation, not a module. The value is in having a shared vocabulary when deciding what
a new tool *is*, and in giving `McpSection.jsx` and `CapabilityLedger.jsx` something better than
an alphabetical list to group by.

## Why partition at all

Past roughly twenty tools, an agent's tool list stops being a menu and starts being context cost
you pay on every single turn whether the tools fire or not — which is exactly what
`CapabilityLedger` measures. Grouping is how you notice that eleven of your tools are all
variations on "read something" and none of them are "check whether the thing I just did worked".

The categories below are a checklist for that gap analysis, not a schema to enforce.

| # | Category | What belongs here | Reads or writes |
|---|---|---|---|
| 1 | **Discovery** | Find what exists — list projects, enumerate sessions, search capabilities | read |
| 2 | **Source query** | Ask questions *of* a large artifact without loading it (see below) | read |
| 3 | **Inspection** | Read one known thing in full — a file, a config, a transcript | read |
| 4 | **Extraction** | Turn an external artifact into structured data — page capture, Figma capture, transcript parsing | read |
| 5 | **Analysis** | Derive a judgement from data already held — scoring, ranking, anomaly detection | pure |
| 6 | **Preview** | Show what a mutation *would* do, without doing it — diffs, dry runs, plans | pure |
| 7 | **Mutation** | Change state — write a file, post a comment, toggle a capability | write |
| 8 | **Diagnostics** | Check whether the state is healthy *after* the fact — hook health, drift, dangling paths | read |
| 9 | **Self-healing** | Repair what diagnostics found, within a bounded blast radius | write |
| 10 | **Governance** | Gate, record, and audit the categories above — approvals, access, audit log | write |

## The Source Query pattern

The problem: an extraction step produces something far too large to hand to a model. A full CSS
extraction from a real page is hundreds of kilobytes. A long transcript is larger. The naive move
is to dump it into context, and it either blows the window or crowds out everything useful.

The pattern: **store the artifact, expose queries against it.** Do not return the artifact.

`server/page-capture.mjs` is the worked example in this repo. The capture writes
`capture.json` — the whole extraction, on disk — and what a caller actually gets back is:

- `styleSummary` — ranked histograms, a few hundred bytes, answering "what are the design tokens"
- `context.md` — a flat markdown rendering sized for a prompt
- the full `capture.json`, addressable when a specific question needs it

The ranking *is* the query. "Which colours does this page use" has a useful answer at the top of
a usage histogram and a useless one in a list of every declaration.

Applied to our own transcript endpoints, the same rule says: an endpoint that returns parsed
JSONL is a source-query tool, and it should rank, aggregate or filter rather than return raw
records. Where it can't, it should say what it truncated — see the note on silent caps below.

## The Preview → Diagnostics → Self-Healing ladder

Categories 6, 8 and 9 form a progression, and a tool surface is usually strong at one rung and
absent at the others. The ladder is a prompt for the missing rungs:

1. **Preview** — before a mutation, can the user see what will change? A capability that can only
   be exercised by running it is one the user has to trust blind.
2. **Diagnostics** — after a mutation, can the system tell whether it worked? Writing a hook and
   never checking that it is executable is how a dashboard shows green while nothing runs.
3. **Self-healing** — when diagnostics find a problem, can the system fix the ones with an
   obvious, bounded fix, and clearly refuse the ones without?

Rung 3 is where restraint matters most. Self-healing that reaches beyond an obvious fix becomes a
mutation the user did not ask for and cannot preview — which is rung 1's problem again, with
worse consequences. A self-healing tool should have a narrower blast radius than the mutation
tool it repairs, never a wider one.

## Two rules that apply across all ten

**No silent caps.** Several tools here bound their work — `MAX_ELEMENTS` in the page capture, the
`limit` on every histogram, the tool-call sampling in transcript parsing. Every one of those must
surface the fact that it truncated (`truncated: true`, "showing top 40 of 900"). A capped result
presented as a complete one is worse than no result, because it reads as authoritative.

**Unknown is a value.** A tool that cannot determine something should return null and say so,
never a plausible default. `detectTheme()` returns `theme: null` rather than guessing `light`;
`PRICE_PER_M()` returns null for an unrecognised model rather than falling through to Sonnet's
rate. Both of those were real bugs in this codebase before they were rules.
