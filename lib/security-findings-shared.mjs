export const ID_DESCRIPTION_CHARS = 200

export const MAX_RAW_EXCERPT = 500

export const isObj = v => v != null && typeof v === 'object' && !Array.isArray(v)

export const str = v => (typeof v === 'string' && v.trim() !== '' ? v : null)

export const num = v => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}

export const excerpt = v => {
  const s = typeof v === 'string' ? v : (() => { try { return JSON.stringify(v) } catch { return String(v) } })()
  if (s == null) return { text: null, excerptTruncated: false }
  return s.length > MAX_RAW_EXCERPT
    ? { text: s.slice(0, MAX_RAW_EXCERPT), excerptTruncated: true }
    : { text: s, excerptTruncated: false }
}

export const malformedEntry = (where, reason, raw) => {
  const { text, excerptTruncated } = excerpt(raw)
  return { where, reason, raw: text, excerptTruncated }
}

export const fileExtension = file => {
  const s = typeof file === 'string' ? file : ''
  const dot = s.lastIndexOf('.')
  return dot === -1 ? '' : s.slice(dot).toLowerCase()
}

export const normSeverity = v => {
  const s = str(v)
  return s == null ? null : s.trim().toUpperCase()
}
