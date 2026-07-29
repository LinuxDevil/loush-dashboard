# Editor-to-chat selection chips

**Category:** UI, Viewers & Editor Integration

- **Source**: Nimbalyst (RESEARCH_MERGED.md, Feature inventory; Recommended adoptions)
- **What**: The editor reports the user's current text/cell/node selection as `{id, label, description, icon, data, includeData}`; the chat UI renders these as removable chips above the input, injected into the next prompt. Guardrails: opt-in structured data, 32 KiB size cap, cyclic/non-JSON stripping, clear on tab close.
- **Where to add**: `src/ui/viewers.jsx` (emit selection) and `src/sections/ChatSection.jsx` (chip rendering + prompt assembly).
- **Caveats**: None noted.

---

Full context, licensing legend, and the upstream project research this was mined from: see `RESEARCH_MERGED.md` and `FEATURE_OPPORTUNITIES.md` at the repo root.
