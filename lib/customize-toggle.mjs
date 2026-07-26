import fs from 'node:fs'

// Reversible enable/disable by renaming between `base` and `base + '.off'`. Claude only discovers a skill/
// command/agent/rules file when the real name exists, so this is the true on/off — not a cosmetic flag.
// Idempotent (already in the target state → noop) and refuses to clobber an existing target. fs is injectable
// so the invariant can be tested without touching real files.
export function toggleOffFile(base, enable, io = fs) {
  const off = base + '.off'
  const from = enable ? off : base
  const to = enable ? base : off
  if (!io.existsSync(from)) return { ok: true, noop: true, enabled: enable } // already where we want it
  if (io.existsSync(to)) throw Object.assign(new Error('target already exists'), { status: 409 })
  io.renameSync(from, to)
  return { ok: true, enabled: enable }
}
