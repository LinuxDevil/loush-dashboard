export const isObj = v => v != null && typeof v === 'object' && !Array.isArray(v)
export const str = v => (typeof v === 'string' ? v : null)
export const arr = v => (Array.isArray(v) ? v : [])
export const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)
