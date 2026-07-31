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
// The buffer is the thing this screen protects. Four rules follow from that:
//
//   · Switching files with unsaved work ASKS first. Silently dropping a buffer is the one bug that
//     loses writing the user cannot get back.
//   · An AI edit never lands in the buffer unreviewed, and never lands on disk at all — the server
//     returns proposed text, the diff is accepted or rejected here, and only `save` writes.
//   · An AI edit is only offered on a SAVED buffer. `/api/docs/ai-edit` builds its prompt, its
//     selection check and its returned text from the file on disk, so against a dirty buffer the two
//     disagree in two ways: a selection of freshly typed text comes back as a confusing
//     `409 selection-not-in-file`, and a whole-document proposal is disk-based text whose diff, if
//     accepted, reverts every unsaved edit. Requiring a save keeps the proposal's baseline and the
//     buffer the same string, so accepting a diff can never discard work. The alternative — sending
//     the buffer as the document body — would make the endpoint edit text it was handed rather than
//     text it read, and "ai-edit never writes and always reflects the file" is the property that
//     makes the accept/reject flow trustworthy. Save first is the smaller change and the stronger one.
//   · Preview renders the BUFFER, not the file on disk, because what you just typed is the thing
//     you are trying to look at.
//
// ponytail: skipped per the brief — image editor, inline suggestion sidebar, collaborative drafts,
// and .docx/PDF pipelines. The first three need a second editing surface to be worth anything, and
// the document formats need a conversion pipeline that does not exist in this repo.

import React, { useEffect, useMemo, useRef, useState } from 'react'
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

  // The load is async and the user can click again before it lands. Without this guard a slow
  // response for A could arrive after B was selected, putting A's text in the buffer while `sel`
  // says B — and the next save would write A's content over B. Only the newest request may commit.
  const loadSeq = useRef(0)
  const open = path => {
    if (path === sel) return
    if (dirty && !window.confirm(`${sel} has unsaved changes. Discard them and open ${path}?`)) return
    const seq = ++loadSeq.current
    setSel(path); setSaved(null); setBuf(''); setSelText(''); setProposal(null); setMode('source')
    api.get('/api/docs/file?path=' + encodeURIComponent(path))
      .then(d => { if (seq !== loadSeq.current) return; setSaved(d.text); setBuf(d.text) })
      .catch(e => { if (seq !== loadSeq.current) return; flash(`could not open ${path}: ${e.message}`); setSel(null) })
  }

  const save = () => api.put('/api/docs/file?path=' + encodeURIComponent(sel), { text: buf })
    .then(d => { setSaved(buf); flash(`saved ${d.path} (${d.bytes} bytes)`); loadList() })
    .catch(e => flash('save failed: ' + e.message))

  // Requires a clean buffer — see the third rule in the header. The bar is disabled while dirty, so
  // this guard is only reachable through a race, but what it prevents is a proposal whose diff would
  // silently revert unsaved work.
  const aiBlocked = dirty ? 'save first — an AI edit is computed from the file on disk' : ''
  const runAiEdit = () => {
    if (aiBlocked) return flash(aiBlocked)
    setBusy(true)
    // `buf === saved` here, so the proposal's baseline is both the buffer and the file: the selection
    // is matched by content on the server against the same text the user is looking at.
    api.post('/api/docs/ai-edit', { path: sel, instruction, selection: selText || undefined })
      .then(d => setProposal({ text: d.text, original: buf, instruction }))
      .catch(e => flash('AI edit failed: ' + e.message))
      .finally(() => setBusy(false))
  }

  // The same rule from the other direction. The diff shown is against the buffer as it stood when
  // the request went out; typing while the model worked makes those keystrokes invisible in it, and
  // applying the proposal would drop them. Ask rather than discard.
  const acceptProposal = () => {
    const stale = buf !== proposal.original
    if (stale && !window.confirm('You have typed since this proposal was requested, and the diff does not show those edits. Apply it anyway and lose them?')) return
    setBuf(proposal.text); setProposal(null)
    flash('proposal applied to the editor — not yet saved')
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
              busy={busy} disabled={saved === null || !!aiBlocked} reason={aiBlocked} onRun={runAiEdit} />
            {proposal && (
              <ProposalReview original={proposal.original} proposed={proposal.text} instruction={proposal.instruction}
                onAccept={acceptProposal}
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
