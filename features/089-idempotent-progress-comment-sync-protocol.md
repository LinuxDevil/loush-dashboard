# Idempotent progress-comment sync protocol

**Category:** Tickets, Planning & Delivery

- **Source**: ccpm (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: A fixed 6-section progress-comment format posted to GitHub/JIRA, deduplicated via a `last_sync` frontmatter timestamp plus an HTML marker, so re-running sync never double-posts.
- **Where to add**: `server/eng.mjs` comment-posting paths; UI in `DeliverySection.jsx`
- **Caveats**: MIT-licensed.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
