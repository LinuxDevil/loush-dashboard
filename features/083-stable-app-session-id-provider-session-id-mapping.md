# Stable app-session-id ↔ provider-session-id mapping

**Category:** Chat & Permissions

- **Source**: CloudCLI / siteboon-claude-code-ui (RESEARCH_MERGED.md, Recommended adoptions)
- **What**: Allocates the dashboard's own session id up front, keeps the underlying Claude session id server-side only, remaps outbound frames — enabling deep-linkable `#/chat/:id` URLs and optimistic navigation.
- **Where to add**: `server/chat-ws.mjs` + a small JSON session index; routes in `App.jsx`.
- **Caveats**: AGPL-3.0-or-later, design-level port only.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
