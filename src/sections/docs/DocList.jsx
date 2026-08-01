import React from 'react'
import { fmtDate, fmtSize, tildify } from '../../lib/api.js'
import { typeIcon } from '../../ui/viewers.jsx'

// The file list. Paths are relative to the docs root — the root itself is printed once, in the
// header, rather than repeated on every row where it would push the filename off the edge.
export default function DocList({ root, files, q, onQ, selected, dirty, onSelect }) {
  return (
    <div className="list-pane docs-list">
      <div className="list-head">
        <h2>Documents <span className="muted">({files.length})</span></h2>
      </div>
      <code className="docs-root" title={root}>{tildify(root)}</code>
      <div className="filters">
        <input placeholder="filter by name…" value={q} onChange={e => onQ(e.target.value)} />
      </div>
      <div className="docs-rows">
        {!files.length && <p className="muted center" style={{ padding: 20 }}>no documents here</p>}
        {files.map(f => (
          <div key={f.path} className={'row docs-row' + (selected === f.path ? ' selected' : '')}
            onClick={() => onSelect(f.path)} title={f.path}>
            <div className="docs-row-name">
              <span>{typeIcon(f.path.split('.').pop().toLowerCase())}</span>
              <span className="docs-row-path">{f.path}</span>
              {/* The unsaved marker lives next to the filename, because the tab you are about to
                  click away from is where you need to see it. */}
              {selected === f.path && dirty && <span className="docs-dirty" title="unsaved changes">●</span>}
            </div>
            <div className="docs-row-meta">{fmtSize(f.bytes)} · {fmtDate(f.mtime)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
