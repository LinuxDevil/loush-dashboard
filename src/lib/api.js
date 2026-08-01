let freshUntil = 0
export const forceFresh = () => { freshUntil = Date.now() + 3000 }

async function req(url, opts) {
  if (!opts && Date.now() < freshUntil) url += (url.includes('?') ? '&' : '?') + 'fresh=1'
  try {
    const r = await fetch(url, opts && { ...opts, headers: { 'content-type': 'application/json' }, body: opts.body && JSON.stringify(opts.body) })
    const cachedAt = Number(r.headers.get('x-cached-at'))
    if (cachedAt) window.dispatchEvent(new CustomEvent('api-cache', { detail: { url, at: cachedAt } }))
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw Object.assign(new Error(j.error || j.reason || r.statusText), { detail: j.detail, body: j })
    return j
  } catch (e) {
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
export const toast = (message, kind = 'info') => window.dispatchEvent(new CustomEvent('app-toast', { detail: { message, kind } }))
export const fmtDate = ms => new Date(ms).toLocaleString()
export const fmtSize = b => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : b > 1024 ? (b / 1024).toFixed(1) + ' KB' : b + ' B')
export const tildify = p => String(p || '').replace(/^([A-Za-z]:)?[\\/](Users|home)[\\/][^\\/]+/, '~')
