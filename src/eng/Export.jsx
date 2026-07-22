import React, { useEffect, useState } from 'react'
import { marked } from 'marked'
import { HEAD, BODY, MONO, BB, GREEN, DIM, HI, PANEL, Card, H1, miniBtn, primaryBtn, inp, useCopy } from './ui.jsx'
import { PRESETS, report, toSlack } from './reports.js'

// §6 — preview → hand-edit → copy / download. Nothing is uploaded anywhere; "Copy as Slack" hands you the
// text and a human sends it. (There is no server route that posts arbitrary text to the webhook — the only
// Slack endpoint on the box sends a fixed test string — so this stays a copy, which is the safer default.)
export default function Export({ snap, win, me }) {
  const [preset, setPreset] = useState('standup')
  const [md, setMd] = useState('')
  const [edited, setEdited] = useState(false)
  const [copy, copied] = useCopy()
  useEffect(() => { if (!edited) setMd(report(preset, { snap, win, me })) }, [preset, snap, win, me, edited])
  const regen = () => { setEdited(false); setMd(report(preset, { snap, win, me })) }
  const download = () => {
    const b = new Blob([md], { type: 'text/markdown' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(b)
    a.download = `${preset}-${new Date().toISOString().slice(0, 10)}.md`
    a.click(); URL.revokeObjectURL(a.href)
  }
  return <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <H1 kicker="one generator · five documents" title="Export" right={<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      <button style={miniBtn} onClick={regen} disabled={!edited}>Reset</button>
      <button style={miniBtn} onClick={() => copy(md, 'md')}>{copied === 'md' ? '✓ copied' : 'Copy markdown'}</button>
      <button style={miniBtn} onClick={() => copy(toSlack(md), 'slack')}>{copied === 'slack' ? '✓ copied' : 'Copy as Slack'}</button>
      <button style={primaryBtn} onClick={download}>Download .md</button>
    </div>} />

    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {PRESETS.map(p => <button key={p.id} onClick={() => { setPreset(p.id); setEdited(false) }} style={{
        padding: '8px 14px', borderRadius: 9, cursor: 'pointer', textAlign: 'left', border: `1px solid ${preset === p.id ? BB : 'rgba(255,255,255,0.12)'}`,
        background: preset === p.id ? 'rgba(255,255,255,0.12)' : 'transparent',
      }}>
        <div style={{ font: `600 12.5px ${BODY}`, color: preset === p.id ? '#f0e7e0' : '#9a9089' }}>{p.label}</div>
        <div style={{ font: `400 9.5px ${MONO}`, color: DIM }}>{p.who}</div>
      </button>)}
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'start' }}>
      <div style={{ ...PANEL, padding: '12px 14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ font: `600 12px ${HEAD}`, color: HI }}>Hand-edit</span>
          <span style={{ font: `400 10px ${MONO}`, color: edited ? GREEN : DIM }}>{edited ? 'edited — Reset to regenerate' : 'generated from the snapshot'}</span>
        </div>
        <textarea value={md} onChange={e => { setMd(e.target.value); setEdited(true) }} rows={26}
          style={{ ...inp, resize: 'vertical', fontFamily: MONO, fontSize: 11.5, lineHeight: 1.6 }} />
      </div>
      <div style={{ ...PANEL, padding: '12px 16px' }}>
        <div style={{ font: `600 12px ${HEAD}`, color: HI, marginBottom: 8 }}>Preview</div>
        <div className="md" style={{ maxHeight: 520, overflow: 'auto', color: '#c8bdb4', font: `400 12.5px/1.65 ${BODY}` }} dangerouslySetInnerHTML={{ __html: marked.parse(md || '') }} />
      </div>
    </div>
  </section>
}
