// Compare — blind side-by-side model testing and synthesis.
//
// STUB. Owned by the `compare` agent; brief in docs/odysseus-port/2.md.
// Wired into server/index.mjs already, so filling this in requires no shared-file edits.

export default function mount(app) {
  app.get('/api/compare', (req, res) => res.status(501).json({ error: 'compare not built yet' }))
}
