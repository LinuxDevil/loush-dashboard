// Deep Research — multi-step web research with source reading and report generation.
//
// STUB. Owned by the `research` agent; brief in docs/odysseus-port/3.md.
// Wired into server/index.mjs already, so filling this in requires no shared-file edits.

export default function mount(app) {
  app.get('/api/research', (req, res) => res.status(501).json({ error: 'research not built yet' }))
}
