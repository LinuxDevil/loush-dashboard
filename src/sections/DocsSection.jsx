// Documents — a writing surface over the files in one docs root.
//
// ---------------------------------------------------------------------------------------------
// Derived in part from Odysseus (https://github.com/odysseus-dev/odysseus), Copyright (c) the
// Odysseus contributors, licensed under AGPL-3.0. This file is AGPL-3.0-only (NOTICE, clause 1).
// Consulted: `static/js/document.js` — the editor's AI-edit interaction (an instruction typed
// against the current textarea selection, the model's answer brought back for the user to take or
// leave) and its source/preview split.
// Modified 2026-07-31 by Ali Mohammad: rewritten for this codebase as one React section over
// `server/docs.mjs`. Odysseus prompts with `window.prompt` and applies the answer to the buffer;
// here the answer goes through an accept/reject diff first. Its image editor, inline suggestion
// sidebar, collaborative drafts and .docx/PDF pipelines are not ported (AGPL §5(a) notice of
// modification).
// ---------------------------------------------------------------------------------------------
//
// The buffer is the thing this screen protects. Three rules follow from that:
//
//   · Switching files with unsaved work ASKS first. Silently dropping a buffer is the one bug that
//     loses writing the user cannot get back.
//   · An AI edit never lands in the buffer unreviewed, and never lands on disk at all — the server
//     returns proposed text, the diff is accepted or rejected here, and only `save` writes.
//   · Preview renders the BUFFER, not the file on disk, because what you just typed is the thing
//     you are trying to look at.
//
// ponytail: skipped per the brief — image editor, inline suggestion sidebar, collaborative drafts,
// and .docx/PDF pipelines. The first three need a second editing surface to be worth anything, and
// the document formats need a conversion pipeline that does not exist in this repo.

import React, { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api.js'
import Skeleton from '../ui/Skeleton.jsx'
import { ViewerModeToggle, DiffPane } from '../ui/ViewerModes.jsx'
import { modeAvailability, resolveMode } from '../lib/viewerModes.js'
import DocList from './docs/DocList.jsx'
import DocEditor from './docs/DocEditor.jsx'
import DocPreview from './docs/DocPreview.jsx'
import AiEditBar from './docs/AiEditBar.jsx'
import ProposalReview from './docs/ProposalReview.jsx'

const extOf = p => String(p || '').split('.').pop().toLowerCase()

export default function DocsSection() {
  const [root, setRoot] = useState('')
  const [files, setFiles] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [rootError, setRootError] = useState('')
  const [q, setQ] = useState('')

  const [sel, setSel] = useState(null)
  const [saved, setSaved] = useState(null)     // last text read from or written to disk
  const [buf, setBuf] = useState('')
  const [selText, setSelText] = useState('')
  const [mode, setMode] = useState('source')   // a writing surface opens on the text, not a preview

  const [instruction, setInstruction] = useState('')
  const [proposal, setProposal] = useState(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')

  const dirty = saved !== null && buf !== saved
  const flash = m => { setStatus(m); setTimeout(() => setStatus(s => (s === m ? '' : s)), 5000) }

  const loadList = () => api.get('/api/docs')
    .then(d => { setRoot(d.root); setFiles(d.files || []); setRootError(d.error || '') })
    .catch(e => flash('could not list documents: ' + e.message))
    .finally(() => setLoaded(true))
  useEffect(() => { loadList() }, [])

  // The buffer only lives in this tab, so a reload loses it. The browser's own prompt is the only
  // place that warning can appear.
  useEffect(() => {
    if (!dirty) return
    const warn = e => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const open = path => {
    if (path === sel) return
    if (dirty && !window.confirm(`${sel} has unsaved changes. Discard them and open ${path}?`)) return
    setSel(path); setSaved(null); setBuf(''); setSelText(''); setProposal(null); setMode('source')
    api.get('/api/docs/file?path=' + encodeURIComponent(path))
      .then(d => { setSaved(d.text); setBuf(d.text) })
      .catch(e => { flash(`could not open ${path}: ${e.message}`); setSel(null) })
  }

  const save = () => api.put('/api/docs/file?path=' + encodeURIComponent(sel), { text: buf })
    .then(d => { setSaved(buf); flash(`saved ${d.path} (${d.bytes} bytes)`); loadList() })
    .catch(e => flash('save failed: ' + e.message))

  const runAiEdit = () => {
    setBusy(true)
    // The selection is sent as text and matched by content on the server, so a proposal computed
    // against an excerpt that has since changed is refused there rather than spliced in blind.
    api.post('/api/docs/ai-edit', { path: sel, instruction, selection: selText || undefined })
      .then(d => setProposal({ text: d.text, original: buf, instruction }))
      .catch(e => flash('AI edit failed: ' + e.message))
      .finally(() => setBusy(false))
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return needle ? files.filter(f => f.path.toLowerCase().includes(needle)) : files
  }, [files, q])

  const ext = extOf(sel)
  const meta = files.find(f => f.path === sel)
  const availability = useMemo(
    () => modeAvailability({ ext, size: meta?.bytes ?? null, hasBaseline: saved !== null, dirty }),
    [ext, meta?.bytes, saved, dirty])
  const active = resolveMode(mode, availability).mode

  if (!loaded) return <Skeleton tiles={0} rows={8} />

  return (
    <div className="section docs">
      <DocList root={root} files={filtered} q={q} onQ={setQ} selected={sel} dirty={dirty} onSelect={open} />
      <div className="detail-pane docs-pane">
        {rootError === 'docs-root-missing' && (
          <div className="status">the docs root does not exist yet — set DASH_DOCS_ROOT or create {root}</div>
        )}
        {!sel ? <p className="muted center">select a document</p> : (
          <>
            <div className="detail-head docs-head">
              <code className="path">{sel}</code>
              <span className={dirty ? 'docs-state dirty' : 'docs-state'}>{dirty ? 'unsaved changes' : 'saved'}</span>
              <ViewerModeToggle file={{ ext }} mode={mode} onMode={setMode} availability={availability} />
              <button className="mini" disabled={!dirty} onClick={save}>save</button>
              <button className="mini" disabled={!dirty} onClick={() => { setBuf(saved); setProposal(null) }}>revert</button>
            </div>
            {status && <div className="status">{status}</div>}
            <AiEditBar instruction={instruction} onInstruction={setInstruction} selection={selText}
              busy={busy} disabled={saved === null} onRun={runAiEdit} />
            {proposal && (
              <ProposalReview original={proposal.original} proposed={proposal.text} instruction={proposal.instruction}
                onAccept={() => { setBuf(proposal.text); setProposal(null); flash('proposal applied to the editor — not yet saved') }}
                onReject={() => { setProposal(null); flash('proposal discarded — nothing was written') }} />
            )}
            <div className="docs-body">
              {saved === null ? <p className="muted center">loading…</p>
                : active === 'source' ? <DocEditor value={buf} ext={ext} onChange={setBuf} onSelection={setSelText} />
                : active === 'preview' ? <DocPreview text={buf} ext={ext} />
                : <DiffPane before={saved} after={buf} />}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
