# References — Ticket tab

Date: 2026-07-27
Scope: prior art and primary sources for a JIRA-key-first tab that fetches a ticket, generates
acceptance criteria and test cases, plans a system design against the real repo, renders that design
as an editable node graph, chats about it, and shows the files and data flow involved.

---

## Method, and how much to trust each entry

This matters more than usual, so it goes first.

**This environment's egress policy blocks CONNECT to most external hosts** (verified: the agent proxy
returns `403 policy denial`, and a direct `WebFetch` of `martinfowler.com` returned `403`). Three
classes of source therefore have very different reliability:

| Marker | Meaning | Trust |
|---|---|---|
| ✅ **primary** | The actual artifact was fetched and read — LICENSE files, npm tarballs, OpenAPI JSON, docs markdown, all via `raw.githubusercontent.com` and `registry.npmjs.org`, which **are** reachable | High. Quotes are verbatim; sizes were measured with `gzip -9` on shipped dist files |
| ◐ **synthesized** | Canonical URL is given, content came from search-result snippets | Medium. Verify a quote before relying on it contractually |
| ⚠ **unverified** | Title/author/venue from search only; full text never retrieved | Low. Treat as a pointer, not a citation |

Everything in §1 (repos) and the licence table is ✅ primary — licences were read from each project's
own `LICENSE` file and sizes measured from the published tarball, not from bundlephobia. Most of §2
(Atlassian, Mermaid, npm metadata) is ✅ primary. **Most of §3 (articles) is ⚠ unverified** — full
text could not be retrieved for any of them, so authors, figures and exact framing should be checked
against the primary source before being quoted anywhere that matters.

Two specific uncertainty flags carried forward from the research:

1. **"Jira REST v2 returns wiki markup where v3 returns ADF"** is load-bearing for the read path and
   was corroborated only from third-party source code and community threads, not from
   `developer.atlassian.com`. Verify with one `curl` against a real instance before building on it.
2. **`julianlam/adf-to-md` declares MIT in `package.json` but ships no `LICENSE` file.** Confirm
   before vendoring if licence hygiene is strict.

---

## 1. GitHub repositories

Sizes are `gzip -9` over the shipped `dist`, measured from the npm tarball. ✅ primary throughout.

### 1.1 Canvas / node-graph libraries

| Package | gzip | Licence | Deps | Verdict |
|---|--:|---|--:|---|
| `jerosoler/Drawflow` | **8 KB** | MIT | 0 | Benchmark, not a dep |
| `@dagrejs/dagre@3` | **13 KB** | MIT | 1 | Layout algorithm worth copying |
| `erikbrinkman/d3-dag` | **44 KB** | MIT | 4 | d3-native layered layout |
| `@xyflow/react` (React Flow) | **50 KB** + 4 KB CSS | **MIT** | 3 | The category default |
| `cytoscape/cytoscape.js` | 133 KB | MIT | 0 | Analysis kernel, not a canvas |
| `clientIO/joint` | 139 KB | MPL-2.0 | 0 | Rejected |
| `antvis/X6` | 162 KB | MIT | 4 | Rejected |
| `excalidraw/excalidraw` | ~227 KB + 700 KB chunks | MIT | 31 | Steal the schema only |
| `kieler/elkjs` | **456 KB** | EPL-2.0 **OR GPL-3.0** | 0 | Rejected on size *and* copyleft |
| `mermaid-js/mermaid` | **948 KB** | MIT | 21 | Serializer, never a runtime dep |

**`xyflow/xyflow` (React Flow)** · 37.8k★ · MIT · <https://github.com/xyflow/xyflow>
The most important finding about it: `@xyflow/system`'s runtime deps are exactly `d3-drag`,
`d3-zoom`, `d3-selection`, `d3-interpolate` — **all four already inside the `d3` package this repo
imports wholesale**. Marginal cost is therefore ~50 KB gzip of its own code, not a new d3 tree.
Licence is genuinely clean: MIT core, no paywalled features; React Flow Pro sells examples, support
and social permission to hide the attribution badge, not capability. Its wire format
(`nodes:[{id,position,data,type}]`, `edges:[{id,source,target,label}]`) is a good schema to adopt
**even if you never install it** — it makes a later swap mechanical.
*Not adopted here — see §5.*

**`tldraw/tldraw`** · 49.3k★ · **PROPRIETARY** · <https://github.com/tldraw/tldraw>
🚩 **Blocked.** `LICENSE.md`, read directly, requires you agree *"Not to use the Software in
Production Environments"* absent a commercial agreement, and defines a Production Environment as
*"where the software is used to provide functionality to end users"*, excluding only *"internal
development"*. An internal dashboard colleagues use to do their job is production. It also ships
measures to *"verify License Key validity, detect deployment environments"* and *"ensure proper
watermark display"*, which you may not *"disable, change, or interfere with"*, and transmits usage
data. npm declares the licence field as the literal string `SEE LICENSE IN LICENSE.md`.

**`@dagrejs/dagre@3`** · 5.7k★ · MIT · <https://github.com/dagrejs/dagre>
Pure `{nodes,edges} → {x,y}` Sugiyama layout, 13 KB gzip, one bundled dep. Use the `@dagrejs` scope,
**not** legacy `dagre@0.8.5`, which drags in lodash + graphlib. Independent corroboration:
`@likec4/diagram` renders architecture diagrams with exactly `@xyflow/react` + `@dagrejs/dagre`.

**`excalidraw/excalidraw`** · 128k★ · MIT · <https://github.com/excalidraw/excalidraw>
Reject the dependency (45 MB unpacked, 31 deps). **Steal `convertToExcalidrawElements`' contract:**
the model emits topology with arrows bound by `start:{id}`/`end:{id}` and **zero coordinates**; a
layout pass computes geometry. LLMs are good at topology and bad at pixels — this split is a hard
rule, not a preference.

**`kieler/elkjs`** · 2.7k★ · EPL-2.0 OR GPL-3.0 · Rejected twice: 456 KB gzip (9× React Flow), and
it is the only non-MIT thing that would reach the browser. Note it arrives **transitively** via
`reaviz/reaflow`, whose own badge says Apache-2.0 — the licence-laundering trap. Check what a
diagram library uses for layout, not just its top-level badge.

**Others measured and rejected:** `retejs/rete` (typed sockets, over-constrained), `projectstorm/react-diagrams`
(pre-hooks OO factories), `antvis/G6` (Chinese-first docs), `antonioru/beautiful-react-diagrams`
(dead since 2020 — but its `useSchema` controlled-component hook is exactly the right contract for a
canvas mutated by generation, dragging *and* chat), `jgraph/drawio` (iframe + postMessage only),
`hpcc-systems/hpcc-js-wasm` (Graphviz in WASM; server-side escape hatch).

### 1.2 Diagram-as-code

**`mermaid-js/mermaid`** · 89.4k★ · MIT — 948 KB gzip full build. **Emit it, never import it.** A
mermaid serializer is ~15 lines with zero deps, and mermaid is the format LLMs write most reliably
and that pastes straight into JIRA. But mermaid ids are display-oriented and lossy, so it must never
be the canonical format — you cannot round-trip a dragged position or a deleted node through it.

**`excalidraw/mermaid-to-excalidraw`** · 853★ · MIT — the exact feature, and the exact implementation
to reject: it obtains node geometry by **rendering into a live DOM `<svg>` and reading
`getBoundingClientRect()`**, complete with Firefox workarounds and a serialization queue. Steal the
pipeline shape (`LLM → terse DSL → parser → editable graph`), reject the DOM-measurement mechanism.

**`likec4/likec4`** · 5.2k★ · MIT — the closest analogue to this feature and the strongest validation
of the stack. Steal its **layered model**: one semantic model (elements + relationships + tags),
with *views* as filtered projections. "Files touched", "data flow" and "system design" are three
views over one model, not three generations.

**`terrastruct/d2`** · 24.8k★ · MPL-2.0 — Go; the npm WASM build is **58 MB unpacked**, unshippable.
🚩 Trap: **`npm i d2` installs a DHIS2 health-information client**, not Terrastruct D2.
**`plantuml/plantuml`** · GPL-3.0, JVM — rejected. **`structurizr/java`** — archived; steal only the
C4 Context→Container→Component→Code ladder.

### 1.3 JIRA / Atlassian

**Headline: don't add a client.** `server/eng.mjs:205` already hand-rolls REST v3 with Basic auth
over global `fetch`. The real problem is ADF, not transport.

**`sooperset/mcp-atlassian`** · 5.6k★ · MIT · Python — the most battle-tested OSS answer to "hand a
JIRA issue to an LLM". Four ideas worth taking: the **v2-read / v3-write split**; `_extract_blocks`/
`_restore_blocks`, which pull `{code}` bodies out before running regexes and splice them back so code
is never mangled; **`merge_adf_with_preserved_media`** — when overwriting a description you must
re-attach the original `media` nodes or you silently destroy the user's screenshots; and field
allow-listing on every read path.

**`julianlam/adf-to-md`** · MIT (⚠ no LICENSE file) — ~180 lines, 4.5 KB. **Vendor, don't install**
(its `package.json` lists `eslint-config-nodebb` as a *runtime* dep). Three defects to fix while
porting: nested lists are broken by a `this`-binding hack; the `default:` branch silently drops
`mention`, `panel`, `status`, `taskList`/`taskItem`, `date` and `expand` — fatal, because `taskList`
is where teams actually write acceptance criteria; and table separators are only emitted when a row
has `tableHeader`. Surface its `warnings` in the API response rather than lying about completeness.

**`MrRefactoring/jira.js`** · 491★ · MIT — 16.8 MB / 7,691 files, and its entire value is TypeScript
types this repo cannot consume: 100% of the cost, 0% of the benefit. Rejected.
**`jira-node/node-jira-client`** — CJS-only, depends on `postman-request` (a fork of the dead
`request`). **`floralvikings/jira-connector`** — archived 2020. **`@atlaskit/adf-utils`** — pulls
`@atlaskit/adf-schema@^56` and a ProseMirror world; hundreds of MB to convert one field.

### 1.4 AC / test-case generation

**Blunt finding: this niche is almost entirely toy repos** — the closest exact match to this feature
has 0 stars. The transferable craft is in adjacent, more serious projects.

**`qodo-ai/pr-agent`** · ~12.3k★ · MIT — the best prompt-architecture reference, and structurally the
same problem (structured artifact from a SaaS API → compress → prompt → parse → render). Four steals:
prompts are **versioned files, not string literals**; **teach the model the input format before
showing it the input**; **conditionally render optional sections** (an empty labelled section
measurably degrades output); and steal the *"Determining what to flag"* calibration block —
*"prefer not reporting over guessing"* maps directly onto the AC-generator failure mode.

**`qodo-ai/qodo-cover`** · 5.6k★ · **AGPL-3.0, archived** — ⚠ ideas only, copy no code. Two patterns:
**ask for YAML, not JSON** (test steps are full of quotes, apostrophes and newlines; one bad escape
kills a whole JSON parse, while YAML block scalars handle multiline natively — and `yaml@^2.4.5` is
*already a dependency*), and **express the output schema as annotated pseudo-code**, which costs far
fewer tokens than JSON Schema and is followed more reliably.

**`567-labs/instructor`** · ~13.6k★ · MIT — steal the loop, reject the dep: call → parse →
hand-rolled validate → on failure, **re-call once with the specific error text**, then surface raw
output. One retry, never unbounded.

**`AutomationPanda/gherkin-guidelines-for-ai`** · 31★ · MIT — a single markdown file written to be
pasted into an LLM's context, explicitly targeting acceptance criteria. Cheapest quality win
available; its declarative-over-imperative rule is the single change that most improves LLM Gherkin.

**`cucumber/gherkin`** · 378★ · MIT — adopt as a **validator**, never a generator: the parser's error
message is your retry feedback string. 1.1 MB unpacked; skip for v1.

### 1.5 Design agents and repo comprehension

**`Aider-AI/aider`** · 47.7k★ · Apache-2.0 — **the single most important reference for the design
step.** Its repo map builds a graph where nodes are files and edges are `referencer → definer` per
identifier, then runs PageRank **seeded from the terms in the user's request**. The multipliers are
the insight: **10×** if the identifier appears in the request, **10×** for well-named identifiers,
**50×** if referenced from a file already in context, **0.1×** for `_private` or for identifiers with
>5 definitions. Applied here: seed from the JIRA ticket text and the graph tells you which files the
ticket touches *before spending a token*. Reject porting tree-sitter + networkx; get file-level edges
from an import graph and write PageRank in ~40 lines.

**`The-Pocket/PocketFlow-Tutorial-Codebase-Knowledge`** · 12.6k★ · MIT — steal the LLM I/O contract:
the model refers to files by **integer index into a numbered list you supplied**, with the path
echoed as a YAML comment for self-checking. This near-eliminates hallucinated file paths — validate
every index against your list and drop unknowns. Its `relationships[].label` is a short verb: your
data-flow edge label, for free.

**`CodeBoarding/CodeBoarding`** · 2.4k★ · MIT — steal three response-schema fields:
**`Relation.evidence`** (prose justification per edge, so every arrow is auditable and the chat panel
can answer "why is this here?"); **`RelationEdge.call_sites`** (the concrete lines behind an abstract
arrow, so clicking an edge opens the code); and **`is_static: bool`** — separating statically-proven
edges from LLM-inferred ones. **Render inferred edges dashed.**

**`potpie-ai/potpie`** · 5.5k★ · Apache-2.0 — one principle: *reads return ranked evidence, not a
server-synthesized answer*. Also the cautionary tale — Neo4j + Postgres + Redis + CrewAI is what this
feature becomes if you let it. **`AntonOsika/gpt-engineer`** (archived) — steal only `preprompts/`:
prompts as loose files. **`sweepai/sweep`** — ⚠ proprietary Sweep EE licence, copy zero lines.
**`yamadashy/repomix`** · 27.4k★ · MIT — 29 runtime deps; unnecessary here, because a Claude Code
subagent already runs with the repo as cwd and can compress it itself.

### 1.6 Import graphs / data flow

**`sverweij/dependency-cruiser`** · 7.0k★ · MIT — v18.1.0, published 2026-07-12, **no TypeScript peer
required** (acorn handles TS/TSX/JSX). Runs in-process against an arbitrary cwd. Its JSON shape is a
good canonical wire format: `source` is a stable repo-relative id — the same path the LLM plan cites
and the same one an editor opens — and `dynamic`, `circular`, `dependencyTypes` give three free
visual encodings. It also ships `mermaid` and `d2` reporters natively.
**Stated caveat:** this yields *module-level* edges. Real data flow is symbol-level. Statically-proven
edge **+** LLM semantic label = a data-flow diagram you can defend.
*Not adopted here — `server/fe.mjs:128` `buildImportGraph()` already does this in-repo with zero deps.*

**`pahen/madge`** · 10.1k★ · MIT — `.obj()` returns a flat adjacency map, but carries **zero edge
metadata**, and `.svg()` requires Graphviz installed on the host. **`antoine-coulon/skott`** · 862★ ·
MIT — steal `groupBy: path => path.split('/')[1]`, the mechanical version of C4's abstraction ladder
and exactly the zoom-out a canvas needs above ~50 files. **`scottrogowski/code2flow`** · 4.6k★ · MIT
— steal one UX idea: `--target-function` with `--upstream-depth`/`--downstream-depth`. Don't render
the whole repo; render *N hops around the entry point the ticket implies*, with a slider.
**`dsherret/ts-morph`** · 6.1k★ · MIT — the precision option, but `@ts-morph/common` embeds the full
TypeScript compiler (~60 MB). **`CoatiSoftware/Sourcetrail`** · GPL-3.0, archived — ⚠ never link or
vendor; the reimplementable pattern is **graph pane and source pane locked in sync**.

### 1.7 Canvas + chat hybrids

**`SawyerHood/draw-a-ui`** · 13.6k★ · **MIT** — the licence-clean reference implementation of
canvas → LLM → applied back to canvas. **`tldraw/make-real`** · ~5.4k★ · **NO LICENSE FILE**,
archived — ⚠ no grant at all, which is worse than a restrictive licence; read-only. Its one
transferable trick is high-value though: it exports the canvas as an image **and extracts the text
separately and appends it**, because vision models misread small canvas labels. Applied here: when
chatting about the diagram, send the **structured graph JSON**, never a screenshot alone.

---

## 2. Official documentation and specifications

### 2.1 Jira Cloud REST API v3 — ✅ primary (read from the OpenAPI spec)

`info.title = "The Jira Cloud platform REST API"`, `openapi: 3.0.1`, **305 paths**, and
`servers: [{"url": "https://your-domain.atlassian.net"}]` — **the base URL is the tenant site; there
is no global Jira API host.**

**`GET /rest/api/3/issue/{issueIdOrKey}`** — params `fields`, `fieldsByKeys`, `expand`, `properties`,
`updateHistory`. `expand` accepts `renderedFields`, `names`, `schema`, `transitions`, `editmeta`,
`changelog`, `versionedRepresentations`.
> 🚩 **"Note: When included in the request, the `fields` parameter is ignored"** — for
> `versionedRepresentations`. Never send it; it silently voids your field selection.

Its `security` block is `[{basicAuth:[]}, {OAuth2:[…]}, {}]` — the empty `{}` means **the endpoint
permits anonymous access, so a 200 does not prove your credentials worked.** Validate explicitly
against `/rest/api/3/myself`.

**Auth** — `Authorization: Basic base64(<atlassian-account-email>:<api-token>)`. The username half is
the **account email**, not a username and not an account ID. No newlines in the encoded value.

**`GET /rest/api/3/field`** — no parameters, returns the full unpaginated list. Custom field ids are
**per-site**: Story Points is `customfield_10016` on one instance and `customfield_10024` on another.
Never hardcode one. (`server/eng.mjs:227` `resolveFields()` already does this correctly, and even
ranks candidates by real usage.)

**`POST /rest/api/3/issue/{key}/comment`** — 🚩 **the body must be ADF**, not HTML and not markdown:
`{"body": {"type":"doc","version":1,"content":[…]}}`. Posting generated AC back to a ticket therefore
needs a markdown → ADF serializer. Note the comment endpoints' expand value is **`renderedBody`**,
not `renderedFields`.

**`/rest/api/3/search` is `410 Gone`** — retired between Aug and Oct 2025, replaced by
**`/rest/api/3/search/jql`** with opaque `nextPageToken` cursors instead of `startAt`/`maxResults`.
✅ *This repo is already correct here* — `server/eng.mjs:255` uses `/search/jql` with `nextPageToken`.

**Rate limits** — cost-based and dynamic, not fixed RPS. On 429 read `Retry-After` (authoritative),
`X-RateLimit-Reset`, `X-RateLimit-Remaining`, `RateLimit-Reason`. Only **8 of 468** operations even
declare a 429 response, so **do not derive retry logic from the spec** — any endpoint can 429.

### 2.2 Atlassian Document Format — ◐ synthesized, and the most consequential finding

ADF is a **ProseMirror JSON tree**: `{"type":"doc","version":1,"content":[…]}`, with block nodes
(`paragraph`, `bulletList`, `codeBlock`, `table`, `panel`, `taskList`, `expand`, …), inline nodes
(`text`, `mention`, `emoji`, `inlineCard`, `status`, `date`, …) and formatting via `marks`.

> 🚩 **`expand=renderedFields` is not a uniform escape hatch from ADF.** It returns HTML for
> `description` but leaves **comment bodies as raw ADF**.

This is exactly the bug found in this repo — see `findings.md` §2d, where `htmlToText(adfObject)`
produces the literal string `"[object Object]"`, and that string is then fed into every generation
prompt. **Build the ADF walker; treat `renderedFields` as an optimization, not the strategy.**

For LLM prompts, always serialize **ADF → Markdown**: stripping HTML tags destroys list nesting and
table structure, which is how you get acceptance criteria that miss a requirement stated in a table
cell. `@atlaskit/adf-schema` is ✅ Apache-2.0 (v56.1.17) and can be vendored for validation;
`@atlaskit/renderer` is ✅ Apache-2.0 (v133.16.3) but pulls a very large Atlaskit tree.

### 2.3 Diagram libraries — ✅ primary licence verification

Covered in §1.1. The verified table: React Flow **MIT** (webkid GmbH, v12.11.2) · Mermaid **MIT**
(v11.16.0) · Excalidraw **MIT** (v0.18.1) · Cytoscape.js **MIT** (v3.34.0) · dagre **MIT** ·
D2 **MPL-2.0** · elkjs **EPL-2.0 OR GPL-3.0-or-later** (pin to EPL in any SBOM) ·
**tldraw proprietary**.

✅ **Mermaid flowchart node shapes**, read verbatim from `packages/mermaid/src/docs/syntax/flowchart.md`:
`id[rect]` · `id(round)` · `id([stadium])` · `id[[subroutine]]` · **`id[(cylinder/db)]`** ·
`id((circle))` · `id>asymmetric]` · **`id{rhombus/decision}`** · `id{{hexagon}}` · `id[/parallelogram/]` ·
`id[/trapezoid\]` · `id(((double circle)))`. Edges: `-->` `---` `-.->`(dotted) `==>`(thick) `~~~`(invisible)
`--o` `--x` `<-->`, with `A-- text -->B` labels and chaining.
⚠ **Mermaid C4 is officially experimental** — its own docs say *"The syntax and properties can change
in future releases."* Use flowchart for export; never persist C4 mermaid as source of truth.

### 2.4 Requirements engineering

**INVEST** (Bill Wake, 2003) — Independent, Negotiable, Valuable, Estimable, Small, **Testable**.
`T` is what makes AC → test cases a *derivation* rather than two independent generations. `N`
(Negotiable — *"stories are not specifications"*) is a warning: auto-generating AC converts a
negotiable story into a fixed spec.

✅ **Gherkin reference**, read verbatim from the Cucumber docs repo. Keywords: `Feature`, `Rule`,
`Example`/`Scenario`, `Given`/`When`/`Then`/`And`/`But`/`*`, `Background`, `Scenario Outline`,
`Examples`. Rules that constrain a generator:
> *"we recommend **3-5 steps per example**"*
> *"A Background … **You can only have one set of Background steps per Feature or Rule**"*
> 🚩 *"**Keywords are not taken into account when looking for a step definition. This means you cannot
> have a Given, When, Then, And or But step with the same text as another step.**"*

That last one is a hard generator constraint: `Given the user is logged in` and `When the user is
logged in` collide into one step definition and break the file. Enforce global step-text uniqueness
as a post-generation pass.

**ISTQB CTFL v4.0.1 §4.2** — black-box techniques are equivalence partitioning, boundary value
analysis (**2-value and 3-value variants**, which change output count per boundary by 50%), decision
tables, state transition, use-case testing. "Generate test cases" is not one prompt.

**Acceptance criteria vs Definition of Done** (Mountain Goat) — AC are **per-story**, written by the
product owner, and are *"those items so vital that the product owner will reject a backlog item if it
doesn't fulfill the criteria"*; DoD is team-wide and identical for every story. 🚩 **The #1 failure
mode of LLM-generated AC is emitting DoD boilerplate** ("code reviewed", "unit tests written").
Make it an explicit negative constraint.

### 2.5 Architecture documentation

**C4 model** (Simon Brown) — Context → Container → Component → Code. ⚠ *"Container"* means a
deployable/executable unit, **not** Docker; label it explicitly or every reviewer misreads it.
**arc42** — 12 sections; its stated principle *"Everything is optional… the cabinet has a value, even
if certain compartments remain empty"* is the right posture for a ticket-scoped plan. Sections 5
(Building Block View) and 6 (Runtime View) map onto nodes and edges respectively.
**ADR** (Michael Nygard, 2011) — Title · Status · Context · Decision · **Consequences**.
🚩 `Consequences` is the field LLMs skip and the only field that makes an ADR worth keeping.
**Structurizr** — *one model, many views*. The non-negotiable data-architecture lesson: persist a
single semantic model and derive each view, or "files touched" and "design graph" become two
separately-editable representations that drift on first edit.
**DFD / STRIDE** (Shostack et al.) — exactly four element types plus trust boundaries: `process`,
`dataStore`, `externalEntity`, `dataFlow`, `trustBoundary`. *"Every data flow that crosses a trust
boundary is a candidate for detailed STRIDE analysis."* Because STRIDE-per-element is a pure lookup
table, a **closed** node vocabulary buys a threat checklist for free — but it cannot be retrofitted
onto free-form shapes.

### 2.6 Anthropic — Claude API and Claude Code

**Structured outputs** use `output_config: { format: { type: "json_schema", schema } }`; the older
top-level `output_format` is deprecated. `strict: true` goes on the **tool definition**, not on
`tool_choice`.
🚩 **Recursive schemas are not supported** — a direct hit here, because a node graph and a file tree
are the two most naturally recursive structures there are. The design schema must be **flat**:
`{nodes:[{id, parentId, …}], edges:[…]}`, tree rebuilt client-side. Numeric (`minimum`/`maximum`) and
string (`minLength`) constraints are also unsupported, so all range validation is client-side.

**Claude Code headless** — `claude -p "<prompt>"`; `--output-format` is exactly `text` | `json` |
`stream-json`; `--resume <session_id>` continues a prior session, and `json` output carries the
`session_id`. The documented two-stage pattern is to capture `session_id` from the first run and
resume it. Applied here: **the session id is the thread identity for "chat about the design"** — resume
it rather than re-sending the whole plan as context every turn.
Use `spawn` with an argv array, never `exec` with an interpolated string — the ticket description is
untrusted input from JIRA.

### 2.7 Canvas UX and accessibility

**Direct manipulation** (Shneiderman, 1983) — continuous representation; physical actions instead of
complex syntax; and *"rapid, incremental, **reversible** operations"*. Reversibility is
**constitutive**, not a nice-to-have: model graph state as an immutable patch stack from the start,
because bolting undo onto mutable state later is a rewrite.

**WAI-ARIA APG** — 🚩 **there is no ARIA pattern for a node-graph editor**, and `role="application"`
is not the answer (it suppresses browse mode and makes the canvas a black box). The accessible
approach is a **dual representation**: the visual canvas plus a semantically equivalent `tree`/
`treegrid` over the same model — which the single-model architecture gives you anyway.
> *"Unlike HTML input elements, **ARIA roles do not cause browsers to provide keyboard behaviors** or
> styling."*

So every key handler is yours to write. **SVG-AAM**: edges rendered as SVG paths carry no inherent
semantics — each needs a role and a plain-language `aria-label` naming the relationship, and must be
keyboard-reachable. **Never encode meaning in colour or line style alone** — a dashed trust boundary
is invisible to a screen reader and to a colourblind user.

---

## 3. Articles, papers and talks

⚠ **Full text could not be retrieved for any item in this section** — entries are from search
metadata. Verify before quoting. They are included because the *arguments* are checkable against the
design even where a figure is not.

### 3.1 The skeptical case on generated requirements and tests

- **"AI-Generated 'Workslop' Is Destroying Productivity"** — HBR / BetterUp Labs + Stanford, 2025.
  Reports ~41% of workers received polished-but-hollow AI output in a month, at ~1h56m of rework per
  incident, with lasting trust damage to the sender.
  → The cost is **externalised**: the producer saves time, the reviewer pays. Never post generated AC
  to a ticket unreviewed; measure reviewer-minutes per artifact, not artifacts generated.
- **"Human Oversight and Overload"** — Garousi, arXiv 2606.05770. Argues oversight effort can exceed
  effort saved. → Cap generation volume: 6 criteria plus an explicit *unknowns* list beats 40.
- **2025 Stack Overflow Developer Survey — AI section.** 84% use AI tools; trust in accuracy ~29%;
  the #1 frustration (66%) is *"almost right, but not quite"*. → Optimise the **edit** path, with
  cheap partial regeneration, not the generate path.
- **"Prompt engineering in LLMs for automated unit test generation"** — *Empirical Software
  Engineering*, 2026. Reports hallucination-driven failures with compilation failure rates as high as
  86%. → Ship "test intentions", not executable tests, unless you compile-and-run them.
- **curl / Daniel Stenberg on AI slop bug reports** — true-positive rate fell from ~15% to under 5%.
  → **Format quality is anti-correlated with truth.** A beautifully rendered diagram is not evidence.

### 3.2 Can LLMs do system design?

- **"Software Architecture Meets LLMs: A Systematic Literature Review"** — arXiv 2505.16697.
  LLMs beat baselines on *classifying* design decisions; generation-from-requirements remains thin.
  → Reframe from "AI generates the design" to "AI drafts from the repo's actual structure and flags
  where the ticket doesn't fit."
- **"The SWE-Bench Illusion"** — Microsoft Research, arXiv 2506.12286, ICSE 2026. Models identify
  buggy file paths at up to **76% accuracy from the issue description alone, with no repository
  access**, dropping to ~53% on repos absent from the benchmark. → Any "files this plan touches" list
  must come from **real retrieval over the real repo**, with the evidence shown — never from recall.
- **"LLMs Can't Plan, But Can Help Planning in LLM-Modulo Frameworks"** — Kambhampati et al., ICML
  2024, arXiv 2402.01817. The LLM proposes; a sound **external** verifier disposes; self-critique
  often *degrades* quality. → This is the architectural thesis. The verifiers here are cheap and
  real: does this file exist, does this module import that one.
- **"Context Rot"** — Chroma Research, 2025. Accuracy degrades 30–50% as input grows, well before
  nominal limits. → Retrieve narrowly; make context visible and editable, not a hidden detail.
- **METR, "Measuring the Impact of Early-2025 AI on Experienced Open-Source Developer Productivity"**
  — 16 developers, 246 real tasks, repos they averaged 5 years on: **19% slower** with AI, while
  forecasting 24% faster and *still* self-reporting ~20% faster afterwards.
  → 🚩 **Positive user feedback about this tab is not evidence it works.** The population is close to
  this app's user. Instrument ticket-to-merge time against matched controls.
- **DORA / State of DevOps 2025.** AI adoption correlates with throughput *and* with **reduced
  delivery stability** — more change failures, more rework. → Ship the amplifier only where tests and
  fast feedback exist.

### 3.3 Diagram drift

- **Martin Fowler, "UmlMode" (2003)** — ✅ *verified via search synthesis*: three modes, **sketch**
  (informal, selective, for communication), **blueprint** (comprehensive, for handoff, expensive to
  maintain), **programming language** (diagram compiles to code). Most value is in sketch mode;
  blueprint is where diagrams rot.
  → 🚩 **A hand-editable, persisted design graph is precisely blueprint mode with an AI accelerant.**
  Decide which mode the canvas is and say so in the UI.
- **Gregor Hohpe, "Diagram-Driven Design"** — good diagrams are a genuine design technique, but *"bad
  diagrams outnumber good diagrams by some margin"*, and a diagram whose boxes have no meaningful
  connecting lines isn't depicting an architecture. → **The value is in the edges.** Force the model
  to *type* every edge (calls / reads / publishes / depends-on) and refuse to render untyped ones.
- **Simon Brown, "The Lost Art of Software Design"** + C4 — a small set of abstractions with
  self-describing legends. → Ship a legend; adopt levels, not a free-form canvas.
- **Michael Nygard, "Documenting Architecture Decisions" (2011)** — decisions and their forces survive
  refactoring; structural diagrams do not. → The durable artifact may be an ADR, not a graph.
- **"Understanding Architecture Erosion"** — Li, Liang, Soliman, Avgeriou, arXiv 2103.11392.
  → The design is a *prescription*, the repo is the *description*. **Conformance** — flagging where
  the merged implementation diverged from the plan — is the genuinely novel product.
- **Gojko Adzic, *Specification by Example*** (Manning, 2011) — living documentation stays true only
  because an automated check **fails** when it drifts. → For every artifact: *what breaks when this
  becomes false?* If nothing, it will be stale within a sprint.

### 3.4 Human factors

- **Skitka, Mosier & Burdick — automation bias** (IJHCS 1999; HFES 1996). Two error classes:
  **omission** (missing what the aid didn't flag) and **commission** (following the aid *even against
  valid contradicting information*). Non-automated participants outperformed those with a
  highly-but-imperfectly-reliable aid. **Making participants accountable for accuracy reduced both.**
  → Two concrete moves: add a deliberate *"what's missing?"* prompt to counter omission, and put a
  **named human approver** on every published artifact.
- **Artem Zakirullin, "Cognitive load is what matters"** — working memory holds ~4 chunks.
  → A 30-node graph is *less* comprehensible than a 10-line list. Hard-cap the default view.
- **"The 80% Problem"** — the remaining 20% is 100% of the value, and the 80% *feels finished*, so
  vigilance drops exactly when it's most needed. → Consider shipping the artifact in a visibly
  **unfinished** state — gaps, question marks, per-node confidence — so it never signals "done".
- **GitClear, "AI Copilot Code Quality"** (211M changed lines) — duplicated blocks up sharply,
  refactoring's share of changed lines down from 25% to under 10%.
  → AI-assisted work systematically **fails to reuse existing structure** — which is exactly what a
  design step is for. Bias the prompt toward *"which existing module does this belong in?"* and make
  "reuses existing component" a countable output.

### 3.5 Canvas and chat UX

- **"Canvas UIs: A Critical Review"** (joodaloop) — largely aesthetic wins; branching *"devolves into
  visual chaos"*; invokes the **Deutsch limit** (~50 visual primitives before comprehension
  collapses). → Prototype the outline version first and make the canvas beat it head-to-head.
- **Mike Hadlow, "Visual Programming — Why it's a Bad Idea" (2018)** — graphical construction loses to
  text on diffing, version control, refactoring and search. → 🚩 **Text is the source of truth; graph
  is a view.** That buys free diffs, review and history, and an exit if the canvas is removed.
- **Bret Victor, "Up and Down the Ladder of Abstraction"** — power comes from controlling a variable
  and watching the system respond. → The Victor test: *what can the user change and immediately see
  respond?* A static generated picture fails it.
- **Amelia Wattenberger, "Why Chatbots Are Not the Future"** — *"Good tools make it clear how they
  should be used… and how they should not be used"*; a text box conveys neither.
  → Seed the design chat with **node-scoped actions**, not an empty box.
- **Allen Pike, "Post-Chat UI"** — the artifact is primary, chat is a side rail. → Direct validation
  for side-by-side, with the caveat that the artifact must be **directly editable**.
- **"Conversations in Space" — arXiv 2605.15848.** Observed division of labour: **chat for generation
  and task progression, canvas for orientation, navigation and reflection.** → Optimise each for its
  observed role; don't make the canvas a generation surface.
- **Liu, Zhang & Liang, "Evaluating Verifiability in Generative Search Engines"** — Findings of EMNLP
  2023. Only ~51.5% of generated sentences were fully supported by their citations.
  → 🚩 **Generate links programmatically from the retrieval layer** (path + line + SHA), never from
  the model's text.

### 3.6 Requirements practice, comprehension, and tool sprawl

- **Matt Wynne, "Introducing Example Mapping" (2015)** — 25 minutes, four card colours: story, rules,
  examples, **red questions**. → Steal the shape: *rules → examples → questions*. The red card gives
  the model a legitimate place to express uncertainty instead of fabricating.
- **Liz Keogh, "Acceptance Criteria vs Scenarios" (2011)** — explicitly advises **not** writing
  scenarios for every acceptance criterion. → Directly contradicts blanket AC → test expansion. Make
  it opt-in per criterion.
- **Cucumber anti-patterns** — LLMs generate exactly these by default: imperative, UI-level,
  over-long scenarios. → Lint generated Gherkin against the list before showing it.
- **Xia, Bao, Lo, Xing, Hassan & Li, "Measuring Program Comprehension"** — *IEEE TSE* 2018.
  Professionals spend **~58% of working time on program comprehension**; juniors more than seniors.
  → This is the value proposition *and* the benchmark. Design for newcomers.
- **Merino, Ghafari, Anslow & Nierstrasz, SLR of software-visualisation evaluation** — *JSS* 2018.
  Across the complete 387-paper SOFTVIS/VISSOFT corpus, **62% of proposed visualisations lack a strong
  evaluation**. → 🚩 *"Visualisation aids comprehension"* is **not** an established finding. Do not
  cite it as justification. Run the cheap A/B (graph vs file list) nobody runs.
- **"Code Comprehension with GitHub Copilot"** — arXiv 2511.02922. Task-performance gains with
  comprehension **trade-offs**: developers ship while understanding less of what they touched.
  → The most uncomfortable finding for this feature.
- **Dashboard sprawl** (Tasman; Holistics) — unowned dashboards accrue as debt and erode trust in the
  whole environment. → Give the tab an **owner and a pre-committed kill date**, and make every screen
  terminate in an action, not a view.

---

## 4. The five strongest sourced arguments *against* building this

Recorded because a reference doc that only supports the plan is advocacy, not research.

1. **It may make expert users slower, and they will not notice.** METR: 19% slower, while believing
   they were 20% faster. Positive feedback is not evidence.
2. **The cost lands on reviewers, not the person who pressed Generate** — so every individual reports
   a win while the org loses (HBR workslop; Garousi; curl).
3. **The marquee capability has the weakest evidence.** LLMs classify design well and *generate* it
   poorly (arXiv 2505.16697); apparent repo competence is substantially memorisation (SWE-Bench
   Illusion); planning is the weakest capability of all (Kambhampati).
4. **The interactive diagram is the least-evidenced, most expensive component** — 62% of software
   visualisations were never properly evaluated — and auto-generating specs destroys the property
   that makes specs work (INVEST's *Negotiable*; Example Mapping's value is the conversation).
5. **It will drift, be quietly distrusted, then abandoned** — blueprint-mode diagrams rot (Fowler);
   the only cure is a check that *fails* when the spec becomes false (Adzic); unowned tools accrue as
   debt. This repo has already deleted 81 panels for exactly this reason (`README.md:411-414`).

---

## 5. What this repo actually adopts, and why

The research recommends **React Flow + dagre (~63 KB gzip)**, and that recommendation is well
evidenced — MIT, near-zero marginal transitive weight because its d3 deps are already vendored inside
the `d3` package this app imports wholesale, and independently corroborated by `@likec4/diagram`
choosing the same pair for the same job.

**It is not adopted here.** Three reasons, in order of weight:

1. **Theme purity is a hard rule in this codebase.** `src/styles.css:7` — *"if you add a raw hex
   anywhere, you have broken the light theme."* React Flow ships its own stylesheet carrying its own
   colour values and animated edges by default, so adopting it means writing and owning override CSS
   plus a `prefers-reduced-motion` override — much of the work the dependency was meant to save.
2. **`d3-zoom`, `d3-drag` and `d3-selection` are already installed and verified working** (d3 7.9.0
   bundles all three; confirmed by import in this environment). Pan, zoom and drag — the two genuinely
   hard parts, pointer/touch normalisation and transform math — are therefore available at zero cost.
3. **`src/sections/PlanGraph.jsx` is proven in-repo prior art** for the exact rendering approach:
   absolutely-positioned node cards over an SVG edge layer with bezier paths and arrow markers, every
   colour already a CSS variable. The requirement for *diamonds and cylinders* means custom SVG paths
   either way — a place where a general-purpose library saves little.

**What is lost, stated plainly** (so this is a decision, not a rationalisation): edge routing around
obstacles, box-select, connection handles with snapping, a minimap, and roughly a week of work.
The mitigation is to **use React Flow's field names** (`id` / `position` / `data`, `source` / `target`)
in the persisted schema from day one, so adopting it later is an adapter of approximately zero lines.

Similarly **not adopted**: `dependency-cruiser` — because `server/fe.mjs:128` `buildImportGraph()`
already produces a real import graph in-repo with zero dependencies; and `mermaid` as a runtime —
but a ~15-line mermaid **serializer** is worth having for export, since mermaid pastes directly into
JIRA and Confluence.

**Adopted as ideas, at zero dependency cost:** YAML over JSON for LLM output (`yaml@^2.4.5` is already
a dependency, and block scalars survive quotes and newlines where JSON escaping breaks); integer
`file_indices` into a supplied numbered list to suppress path hallucination; `covers: [AC-ids]` for
traceability; `evidence` and `is_static` per edge with **inferred edges rendered dashed**; a single
retry that feeds the specific parse error back; and prompts as files rather than string literals.
