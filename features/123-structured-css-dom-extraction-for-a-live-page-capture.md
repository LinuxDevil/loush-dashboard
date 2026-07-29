# Structured CSS/DOM extraction for a live-page capture

**Category:** Capability Ledger, Frameworks, Skills & Setup

- **Source**: A / Perfect-Web-Clone ("Nexting") (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: A headless-browser extractor producing structured design data from a live page: full stylesheets/`@keyframes`/CSS variables/media queries, value→usage-count histograms for colors/fonts/spacing, hover/focus/active interaction-state capture, light/dark theme detection, and section/block segmentation with bounding boxes.
- **Where to add**: new `server/page-capture.mjs`, sibling to `server/figma-capture.mjs`, writing into the same `.claude/figma-captures/<slug>/` layout so the existing Captures UI picks it up. Start with just the `StyleSummary` histograms over `getComputedStyle`.
- **Caveats**: **No LICENSE file** (README MIT badge is not a real grant). Do not copy code — reimplement the schema/algorithm independently, or get written permission first.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
