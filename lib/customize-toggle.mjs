import fs from 'node:fs'

export function toggleOffFile(base, enable, io = fs) {
  const off = base + '.off'
  const from = enable ? off : base
  const to = enable ? base : off
  if (!io.existsSync(from)) return { ok: true, noop: true, enabled: enable }
  if (io.existsSync(to)) throw Object.assign(new Error('target already exists'), { status: 409 })
  io.renameSync(from, to)
  return { ok: true, enabled: enable }
}
