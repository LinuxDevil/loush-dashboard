import React, { useEffect, useMemo, useState } from 'react'
import Markdown from './Markdown.jsx'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { json as jsonLang } from '@codemirror/lang-json'
import { javascript } from '@codemirror/lang-javascript'
import { html as htmlLang } from '@codemirror/lang-html'
import { marked } from 'marked'
import { api } from '../lib/api.js'
import { usePager } from './Pager.jsx'

const IMG_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp'])
export const typeIcon = ext =>
  ({ md: '📝', html: '🌐', htm: '🌐', svg: '🎨', png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', webp: '🖼️', csv: '📊', json: '📦', jsonl: '📜', jsx: '⚛️', tsx: '⚛️', js: '🟨', ts: '🔷', py: '🐍', sh: '🐚', pdf: '📕' }[ext] || '📄')

function langFor(ext) {
  if (ext === 'json' || ext === 'jsonl') return [jsonLang()]
  if (['js', 'ts', 'jsx', 'tsx', 'mjs'].includes(ext)) return [javascript({ jsx: true, typescript: true })]
  if (ext === 'html' || ext === 'htm') return [htmlLang()]
  return [markdown()]
}

export function CodeView({ content, ext }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="code-view">
      <button className="mini copy" onClick={() => { navigator.clipboard.writeText(content); setCopied(true); setTimeout(() => setCopied(false), 1500) }}>
        {copied ? 'copied ✓' : 'copy'}
      </button>
      <CodeMirror value={content} height="100%" theme="dark" readOnly extensions={langFor(ext)} />
    </div>
  )
}

function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += c }
    else if (c === '"') q = true
    else if (c === ',') { row.push(cur); cur = '' }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = '' }
    else if (c !== '\r') cur += c
  }
  if (cur || row.length) { row.push(cur); rows.push(row) }
  return rows.filter(r => r.length > 1 || r[0] !== '')
}

export function DataTable({ header, rows }) {
  const [sort, setSort] = useState(null)
  const sorted = useMemo(() => {
    if (!sort) return rows
    const s = [...rows].sort((a, b) => {
      const x = a[sort.col], y = b[sort.col]
      const nx = parseFloat(x), ny = parseFloat(y)
      const cmp = !isNaN(nx) && !isNaN(ny) ? nx - ny : String(x).localeCompare(String(y))
      return sort.dir * cmp
    })
    return s
  }, [rows, sort])
  const { slice, pager } = usePager(sorted, 100)
  return (
    <div className="table-wrap">
      <table className="data">
        <thead><tr>{header.map((h, i) => (
          <th key={i} onClick={() => setSort(s => ({ col: i, dir: s?.col === i ? -s.dir : 1 }))}>
            {h}{sort?.col === i ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}
          </th>))}</tr></thead>
        <tbody>{slice.map((r, i) => <tr key={i}>{header.map((_, j) => <td key={j}>{typeof r[j] === 'object' ? JSON.stringify(r[j]) : String(r[j] ?? '')}</td>)}</tr>)}</tbody>
      </table>
      {pager}
    </div>
  )
}

function JsonView({ content, ext }) {
  try {
    const parsed = JSON.parse(content)
    if (Array.isArray(parsed) && parsed.length && parsed.every(x => x && typeof x === 'object' && !Array.isArray(x))) {
      const header = [...new Set(parsed.flatMap(Object.keys))]
      return <DataTable header={header} rows={parsed.map(o => header.map(h => o[h]))} />
    }
    return <CodeView content={JSON.stringify(parsed, null, 2)} ext="json" />
  } catch {
    return <CodeView content={content} ext={ext} />
  }
}

// ponytail: needs internet (react + babel from CDN inside the iframe); on failure the user flips to source view.
function JsxLive({ content }) {
  const srcdoc = `<!doctype html><html><head>
<script src="https://unpkg.com/react@18/umd/react.development.js"><\/script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"><\/script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"><\/script>
<style>body{font-family:sans-serif;margin:16px}</style></head>
<body><div id="root"></div>
<script type="text/babel" data-presets="react,typescript" data-type="module">
${content.replace(/<\/script>/g, '<\\/script>').replace(/^\s*import\s.*$/gm, '// $&  (imports stripped for sandbox)').replace(/^\s*export\s+default\s+/m, 'window.__C = ')}
;(function(){
  const C = window.__C || Object.values(window).reverse().find(v => typeof v === 'function' && /^[A-Z]/.test(v.name))
  if (!C) document.getElementById('root').innerText = 'No component found — showing nothing. Use the Source toggle.'
  else ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(C))
})()
<\/script></body></html>`
  return <iframe className="frame" sandbox="allow-scripts" srcDoc={srcdoc} title="jsx preview" />
}

export function Viewer({ item, raw }) {
  const [content, setContent] = useState(null)
  const [err, setErr] = useState(null)
  const ext = item.ext
  const isImg = IMG_EXT.has(ext)
  const url = '/api/artifacts/raw?path=' + encodeURIComponent(item.path)

  useEffect(() => {
    setContent(null); setErr(null)
    if (isImg || ext === 'pdf') return
    api.get('/api/artifacts/content?path=' + encodeURIComponent(item.path))
      .then(d => setContent(d.content)).catch(e => setErr(e.message))
  }, [item.path])

  if (isImg) return <div className="img-wrap"><img src={url} alt={item.name} /></div>
  if (ext === 'pdf') return <iframe className="frame" src={url} title={item.name} />
  if (err) return <p className="muted center">{err}</p>
  if (content === null) return <p className="muted center">loading…</p>
  if (raw) return <CodeView content={content} ext={ext === 'svg' || ext === 'html' ? 'html' : ext} />

  if (ext === 'md') return <Markdown source={content} className="md pad" />
  if (ext === 'html' || ext === 'htm') return <iframe className="frame" sandbox="allow-scripts" src={url} title={item.name} />
  if (ext === 'svg') return <div className="img-wrap"><img src={url} alt={item.name} /></div>
  if (ext === 'csv') { const rows = parseCSV(content); return rows.length ? <DataTable header={rows[0]} rows={rows.slice(1)} /> : <p className="muted">empty csv</p> }
  if (ext === 'json') return <JsonView content={content} ext={ext} />
  if (ext === 'jsx' || ext === 'tsx') return <JsxLive content={content} />
  return <CodeView content={content} ext={ext} />
}
