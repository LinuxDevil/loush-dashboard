async function req(url, opts) {
  const r = await fetch(url, opts && { ...opts, headers: { 'content-type': 'application/json' }, body: opts.body && JSON.stringify(opts.body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || r.statusText)
  return j
}
export const api = {
  get: url => req(url),
  put: (url, body) => req(url, { method: 'PUT', body }),
  patch: (url, body) => req(url, { method: 'PATCH', body }),
  post: (url, body) => req(url, { method: 'POST', body }),
  del: url => req(url, { method: 'DELETE' }),
}
export const fmtDate = ms => new Date(ms).toLocaleString()
export const fmtSize = b => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : b > 1024 ? (b / 1024).toFixed(1) + ' KB' : b + ' B')
