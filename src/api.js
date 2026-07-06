// staleness tracking: heavy aggregate endpoints are TTL-cached server-side and answer with x-cached-at.
// The oldest timestamp seen per render cycle drives the topbar chip; api.refresh() forces ?fresh=1 briefly.
let freshUntil = 0
export const forceFresh = () => { freshUntil = Date.now() + 3000 }

async function req(url, opts) {
  if (!opts && Date.now() < freshUntil) url += (url.includes('?') ? '&' : '?') + 'fresh=1'
  try {
    const r = await fetch(url, opts && { ...opts, headers: { 'content-type': 'application/json' }, body: opts.body && JSON.stringify(opts.body) })
    const cachedAt = Number(r.headers.get('x-cached-at'))
    if (cachedAt) window.dispatchEvent(new CustomEvent('api-cache', { detail: { url, at: cachedAt } }))
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error || r.statusText)
    return j
  } catch (e) {
    // Most GET callers swallow errors (.catch(()=>{})) and get stuck on a skeleton. Surface one
    // global toast so a failed read is at least visible. Mutations alert() themselves — skip those.
    if (!opts) window.dispatchEvent(new CustomEvent('api-error', { detail: { url, message: e.message } }))
    throw e
  }
}
export const api = {
  get: url => req(url),
  put: (url, body) => req(url, { method: 'PUT', body }),
  patch: (url, body) => req(url, { method: 'PATCH', body }),
  post: (url, body) => req(url, { method: 'POST', body }),
  del: url => req(url, { method: 'DELETE' }),
}
// Non-blocking toast in place of alert(). kind: 'info' | 'success' | 'error'. App renders it.
export const toast = (message, kind = 'info') => window.dispatchEvent(new CustomEvent('app-toast', { detail: { message, kind } }))
export const fmtDate = ms => new Date(ms).toLocaleString()
export const fmtSize = b => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : b > 1024 ? (b / 1024).toFixed(1) + ' KB' : b + ' B')
export const tildify = p => String(p || '').replace(/^([A-Za-z]:)?[\\/](Users|home)[\\/][^\\/]+/, '~')
