// Documents — writing-first editor with AI edits, Markdown/HTML/CSV, syntax highlighting.
//
// STUB. Owned by the `documents` agent; brief in docs/odysseus-port/4.md.
// Wired into server/index.mjs already, so filling this in requires no shared-file edits.

export default function mount(app) {
  app.get('/api/docs', (req, res) => res.status(501).json({ error: 'documents not built yet' }))
}
