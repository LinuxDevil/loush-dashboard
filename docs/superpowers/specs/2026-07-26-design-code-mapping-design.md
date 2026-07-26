# Design ⇄ Code Mapping — replacing Figma Capture's annotation editor

Date: 2026-07-26
Status: approved (Approach 1)
Supersedes: the freehand annotation half of the Figma Capture feature

## Why the current feature fails

`FigmaCaptureSection.jsx` asks a **human to hand-draw the mapping, per screen, once, on a frozen
PNG**. That artifact is manual, per-screen (so it never accumulates), and dead the moment the design
changes — a Capture is explicitly non-refreshable. Nothing about it can *detect* drift. It **is** a
snapshot of drift.

The durable artifact is the **component-level mapping**: `DS component ⇄ Figma node ⇄ code import
path`. Authored once per component (~48 rows, not per-screen), it is exactly what Figma's own Code
Connect consumes, and all three target problems become queries over it:

| Problem | Query over the mapping |
|---|---|
| **D** Claude invents markup instead of reusing our components | Publish the mapping → `get_design_context` returns real component names + props |
| **A** Code drifts from design (one-off component instead of the DS one) | Resolve a frame's Figma layers → expected code components → diff vs. what the branch imports |
| **B** Design drifts from code (designer updates component, code lags) | Figma node `updated_at` vs. git last-modified of the mapped code file → flag design-ahead, with blast radius |

One artifact, three reads. Not three features.

Explicitly **out of scope**: "Figma frames for post-interaction states" (the original secondary
idea). It needs designer buy-in and write access to a designer-owned file, and it fixes none of
A/B/D. Dropped, not deferred-with-scaffolding.

## Findings that shape the design

Established by inspecting the local repos (`~/workspace/ct-web-design-system`,
`~/workspace/ct-web-transport`, `~/learnspace/ct-web-flights`):

1. **A seed mapping already exists and is mostly wrong.** 47 of 52 story files in
   `ct-web-design-system/stories/*.stories.tsx` carry `parameters.design.figma.url`. They resolve to
   only **19 unique Figma nodes**. Nine nodes are claimed by 2–7 components each:

   | Node | × | Components |
   |---|---|---|
   | `8nasqg…\|601:5` | 7 | Button, VoucherCodeField, InputFieldDesktop, IconButton, Autocomplete, Dropdown, DropdownDesktop |
   | `8nasqg…\|4812:49526` | 6 | Popup, SwipeableDrawer, Link, Drawer, Tooltip, Modal |
   | `bbm5N7…\|23:5627` | 6 | CurrencySymbol, LinearProgress, Box, Typography, CircularProgress, TypographyList |
   | `8nasqg…\|4673:49009` | 4 | Stepper, Snackbar, Accordion, AppBar |
   | `8nasqg…\|810:3886` | 4 | DateInputField, InputField, SearchInputField, InputStepper |
   | `8nasqg…\|646:2324` | 3 | Card, FlightsBookingCard, BookingCard |
   | `8nasqg…\|628:103` | 3 | Banner, LoyaltyBanner, Price |
   | `8nasqg…\|3636:39079` | 2 | Tag, Chips |
   | `8nasqg…\|1578:6731` | 2 | Colors, Tokens |

   At most 19 of 47 links can be correct; **≥28 are provably wrong**. Coverage looks like 90%;
   correctness is ~40% at best. Detecting this costs **zero Figma API calls** — it is a pure
   duplicate-key check over local files. This is both the headline finding and the reason the
   feature must *verify* rather than *trust* its seed.

2. **No Code Connect anywhere.** `find ct-web-design-system -name "*.figma.ts*"` → 0 files. The
   durable mapping layer does not exist yet.

3. **Dev Mode is available** (Organization/Enterprise + Full seats), so `figma connect publish` and
   two-sided visibility are on the table.

4. **The DS repo is not PR-able in practice** (different team, slow review). Mappings therefore live
   in a repo the author controls and import from the published package
   `@tajawal/ct-web-design-system` (v0.28.0-rc.0, `src/components/<Name>/`, 48 component dirs).
   `figma connect publish` works from any repo; files can be upstreamed later by moving them.

5. **Real usage is narrow.** `ct-web-transport` (nx monorepo, `packages/app`) imports the DS in ~284
   places, but only ~25 distinct components — top by frequency: `COLOR_VARIANTS` (202),
   `TYPOGRAPHY_VARIANT` (111), `Icons` (68), `Typography` (41), `Cell` (17), `Divider` (16),
   `InputField` (14), `Button` (12). Prop-level mapping work is scoped to these; the long tail gets
   a bare mapping.

6. **The DS repo already ships machine-readable metadata** — `registery/registry.json` (38 KB;
   `metadata`, `distribution`, `dependencies`, `catalog`, `utilities`, `tokens`, `typography`,
   `guidelines`; no Figma references) and a `ct-web-design-system-mcp/` server. The local repo is a
   better catalog source than scraping the built Storybook bundle.

## The artifact

One file, `design-map.json`, in the dashboard repo. One row per DS component.

```json
{
  "generatedAt": "2026-07-26T00:00:00.000Z",
  "dsRepo": "/Users/ali.mohammad/workspace/ct-web-design-system",
  "dsPackage": "@tajawal/ct-web-design-system",
  "dsVersion": "0.28.0-rc.0",
  "rows": [
    {
      "component": "Button",
      "codePath": "src/components/Button/index.tsx",
      "importFrom": "@tajawal/ct-web-design-system",
      "figma": {
        "fileKey": "8nasqgUrdKsT8JgQRBHwPB",
        "nodeId": "601:5",
        "nodeName": "Button/Primary",
        "nodeType": "COMPONENT_SET"
      },
      "source": "story",
      "status": "proposed",
      "evidence": {
        "nameScore": 0.92,
        "collisionWith": ["VoucherCodeField", "IconButton", "Autocomplete"],
        "verifiedAt": "2026-07-26T00:00:00.000Z"
      }
    }
  ]
}
```

- `source`: `story` (harvested from `parameters.design.figma.url`) | `matched` (name-matched against
  published components) | `manual` (a human pasted the link).
- `status`: `proposed` | `confirmed` | `rejected` | `unmapped`. **Only `confirmed` rows are ever
  published or used by an audit.** This is the load-bearing invariant — it is what stops the current
  bad data from propagating into Code Connect.
- `evidence` exists so a human reviewing a row can see *why* it was proposed, and so a wrong
  auto-confirm is diagnosable later.

## L0 — Seed, verify, review

1. **Harvest** — parse `ct-web-design-system/stories/*.stories.tsx` for
   `parameters.design.figma.url`; extract `fileKey` + `nodeId`. Enumerate `src/components/*` for the
   full component list so unmapped components are visible as `status: unmapped` rather than absent.
   Local file reads only, no network, no Storybook scraping.
2. **Collision check** — any `nodeId` claimed by more than one component demotes every claimant to
   `proposed` and records `collisionWith`. Zero API calls; immediately flags 37 components across 9
   nodes.
3. **Verify against Figma** — one batched `GET /v1/files/:key/nodes?ids=<all>` per file key (2 calls
   for 19 nodes). For each node record real `name` and `type`. Auto-confirm only when the node is a
   `COMPONENT`/`COMPONENT_SET` **and** its name matches the component name above threshold **and**
   there is no collision. Everything else stays `proposed`.
4. **Fill gaps** — `GET /v1/files/:key/components` for published components; name-match against
   `unmapped` rows; propose (`source: matched`). Never auto-confirm a `matched` row.
5. **Review queue** — the dashboard panel that *replaces* the annotation canvas. A table: component |
   proposed Figma node (thumbnail via `GET /v1/images?ids=`) | code path | evidence | confirm /
   reject / paste-correct-link. The human confirms ~48 rows once, seeing the Figma render and the
   component name side by side.

This is the honest use of a UI: **reviewing machine-proposed rows**, not drawing rectangles.

**L0 ships value before L1 exists** — a report reading "≥28 of your 47 design links are wrong, here
are the collisions" is independently worth having, and steps 1–2 produce it with no token at all.

## L1 — Publish (fixes D)

- Generate `codeconnect/<Component>.figma.tsx` from `confirmed` rows only, importing from
  `@tajawal/ct-web-design-system`.
- **Props: none initially.** `figma.connect(Button, url, { example: () => <Button /> })`. A bare
  mapping already fixes "Claude invents markup" — it makes `get_design_context` name the real
  component. Prop enums (`appearance`, `variant`, `size` — already in the catalog's variant lists)
  are a second pass, and only for the ~25 components actually used.
- Run `npx figma connect publish` from the dashboard; surface stdout/stderr in the UI.
- Verification: `get_code_connect_map` returns the published rows, and `get_design_context` on a
  known frame names real DS components.

## L2 — Screen conformance (fixes A)

Reuses the existing Capture machinery — screenshot + flat `nodeTree` stay valuable; the create/list/
screenshot endpoints and the project picker are kept as-is.

- For a captured frame, resolve each node to a DS component via the mapping. Prefer Figma's own
  `components` / `componentId` back-references from `/v1/files/:key/nodes` over layer-name matching;
  fall back to name matching.
- Grep the branch's changed files for `import { X } from '@tajawal/ct-web-design-system'`.
- Report two classes of finding: **expected-but-missing** (design uses DS `Banner`, code imports no
  `Banner`) and **local look-alike** (code defines `StyledBanner`/`CustomBanner` where DS `Banner`
  was expected).
- Output: a markdown conformance report plus a dashboard panel, run against a branch so it is
  PR-reviewable.

Honest ceiling: this is component-identity resolution, not pixel diffing. It catches "wrong
component", never "wrong padding".

## L3 — Staleness (fixes B)

- `GET /v1/files/:key/components` → published components' `updated_at`.
- `git log -1 --format=%cI -- <codePath>` in the DS repo → code's last touch.
- Figma newer than code beyond a threshold → `design-ahead`.
- Blast radius: grep each configured app repo for imports of that component. Output reads
  "`Button` changed in Figma 2026-05-04; DS code last touched 2026-02-11; used in 12 files across
  transport + flights."
- One panel, sorted by staleness × usage.

## What gets deleted

Deletion is part of the deliverable, not a follow-up:

- The annotation canvas in `src/almosafer/FigmaCaptureSection.jsx` (467 lines) → review queue +
  conformance panels.
- `annotations.json`, `POST /api/figma-capture/:slug/annotations`, `POST /:slug/context`, and
  `contextMarkdown()` in `server/figma-capture.mjs`.
- `design-system-catalog.json` (1422 lines) and `scripts/refresh-design-catalog.mjs` — a regex over
  an unminified webpack bundle fetched from GitHub Pages. Replaced by reading the local DS repo
  (`src/components/*`, `stories/*`, `registery/registry.json`). Deletes a genuinely fragile
  dependency on a build artifact's minification settings.
- `scanProjectComponents()` and `/api/figma-capture/project-components` — the heuristic PascalCase
  export scanner existed to populate the annotation picker. L2 needs import-site grepping, not an
  export inventory.

Kept: capture create/list/screenshot endpoints, Figma token handling (env-or-file, never echoed),
project picker via `/api/projects`.

## Module boundaries

| Module | Responsibility | Depends on |
|---|---|---|
| `lib/design-map.mjs` | Harvest, collision-check, verify, read/write `design-map.json`. Pure — no Express. | DS repo path, Figma token |
| `lib/codeconnect.mjs` | Render `.figma.tsx` from confirmed rows; shell out to `figma connect publish`. | `design-map.json` |
| `lib/conformance.mjs` | Frame nodes + mapping + branch imports → findings. Pure. | `design-map.json`, capture, repo path |
| `lib/staleness.mjs` | Figma `updated_at` + git mtimes + usage grep → rows. Pure. | `design-map.json`, repo paths |
| `server/figma-capture.mjs` | HTTP only; delegates to the four modules above. | all |

The four `lib/` modules are independently testable with no HTTP and no browser — each takes paths
and data in, returns data out. This matches the repo's existing `lib/` convention (established by
the tidy phases in recent history).

## Testing

Per repo convention (`test/` mirrors the source tree), one focused test per pure module:

- `design-map`: collision detection over a fixture with a known 7-way collision; the auto-confirm
  gate refuses a colliding row even with a perfect name score.
- `conformance`: a fixture frame + mapping + a file importing a local look-alike → expects exactly
  one `local-look-alike` finding.
- `staleness`: fixture timestamps on both sides → correct `design-ahead` classification and no
  false positive when code is newer.
- `codeconnect`: rendering skips non-`confirmed` rows. This is the invariant that protects the
  Figma file from the bad seed data, so it gets an explicit test.

Figma API calls are injected as a fetch-shaped function so tests need no token and no network.

## Risks and assumptions

1. **The DS Figma file may have no *published* components.** Unverified — no `FIGMA_TOKEN` on this
   machine, so `/v1/files/:key/components` could not be queried. If the file is loose frames rather
   than a published library, L0 step 4 (gap filling) and L3 both lose their data source. Fallback:
   poll `/v1/files/:key/nodes` for the confirmed node IDs, which still yields names, types, and
   change detection. **Verify this first** — it is the only finding that reshapes a layer.
2. **`figma connect publish` may require edit access to a designer-owned file.** If denied, L1
   degrades to repo-local mappings; L0/L2/L3 are unaffected. Verify before building L1.
3. **The local DS clone is stale** — branch `CMS-5277`, last commit 2026-03-01, ~5 months old. L3's
   git timestamps are meaningless without a `git fetch` first; the staleness reader must fetch (or
   refuse to report on a stale clone rather than emit wrong numbers).
4. **Name matching is a heuristic.** Mitigated by never auto-confirming a `matched` row and by
   keeping a human confirm step. The threshold will need tuning against the real 48 rows.
5. **`design-map.json` is a shadow copy** of what should live in the DS repo. Accepted per finding 4;
   the file layout keeps upstreaming to a file move.

## Sequencing

L0 → L1 → L2 → L3, each independently shippable and independently useful. L0 steps 1–2 need no
Figma token and produce the headline drift report; everything else can follow.

**The first implementation plan covers L0 only** (plus the deletions it makes redundant: the
annotation canvas, `annotations.json`, the catalog scraper). L0 is the whole substrate — L1/L2/L3 are
each a thin read over `design-map.json` and get their own plan once L0's confirmed rows exist. Trying
to plan all four at once would mean designing three consumers of a data shape that hasn't survived
contact with the real 48 rows yet.
