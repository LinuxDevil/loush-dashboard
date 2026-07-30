import os from 'node:os'
import path from 'node:path'

export const DEFAULT_DASH_PORT = 5178

export const MAX_INSTANCES = 8

export function claudeDir(env = process.env) {
  return env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
}

export function instancesFile(env = process.env) {
  return path.join(claudeDir(env), 'loush-dashboard-instances.json')
}

const validPort = p => Number.isInteger(p) && p > 0 && p < 65536

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (e) { return e && e.code === 'EPERM' }
}

export function readInstances(env = process.env, { prune = true } = {}) {
  let parsed
  try { parsed = JSON.parse(fs.readFileSync(instancesFile(env), 'utf8')) } catch { return [] }
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.instances)) return []
  return parsed.instances
    .filter(i => i && typeof i === 'object' && validPort(i.port))
    .filter(i => !prune || pidAlive(i.pid))
    .slice(0, MAX_INSTANCES)
}

export function publishInstance({ port, host = '127.0.0.1', root = process.cwd(), env = process.env, pid = process.pid } = {}) {
  if (!validPort(port)) return null
  try {
    const others = readInstances(env).filter(i => i.pid !== pid && i.port !== port)
    const entry = { port, pid, host, startedAt: Date.now(), root: String(root) }
    const instances = [entry, ...others].slice(0, MAX_INSTANCES)
    const file = instancesFile(env)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.${pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, maxInstances: MAX_INSTANCES, instances }, null, 2))
    fs.renameSync(tmp, file)
    return instances
  } catch { return null }
}

export function unpublishInstance({ env = process.env, pid = process.pid } = {}) {
  try {
    const instances = readInstances(env, { prune: false }).filter(i => i.pid !== pid)
    const file = instancesFile(env)
    const tmp = `${file}.${pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, maxInstances: MAX_INSTANCES, instances }, null, 2))
    fs.renameSync(tmp, file)
    return instances
  } catch { return null }
}

export function resolveTargets(env = process.env) {
  const fromUrl = String(env.DASH_HOOK_URL || '').split(',').map(s => s.trim()).filter(Boolean)
  if (fromUrl.length) return { source: 'DASH_HOOK_URL', targets: fromUrl.slice(0, MAX_INSTANCES) }

  const envPort = Number(env.DASH_PORT)
  if (validPort(envPort)) return { source: 'DASH_PORT', targets: [`http://127.0.0.1:${envPort}`] }

  const instances = readInstances(env)
  if (instances.length) return { source: 'instances-file', targets: instances.map(i => `http://127.0.0.1:${i.port}`) }

  return { source: 'default', targets: [`http://127.0.0.1:${DEFAULT_DASH_PORT}`] }
}
