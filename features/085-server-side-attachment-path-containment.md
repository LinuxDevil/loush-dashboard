# Server-side attachment path containment

**Category:** Chat & Permissions

- **Source**: CloudCLI / siteboon-claude-code-ui (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: Validates and constrains uploaded-image/file paths server-side before they're referenced in a prompt, closing a hole where an unbounded-size raw body is accepted with no path containment check.
- **Where to add**: `server/index.mjs`'s `/api/chat/upload` route and the message-send path.
- **Caveats**: AGPL-3.0-or-later, but small enough (~20 lines) to reimplement rather than copy; flagged as closing a real existing gap in Loush.

---

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
