import React, { useEffect, useState } from 'react'
import { api, toast } from '../api.js'
import { PANEL, HEAD, MONO, BODY, ACCENT, MUTE, INK, GREEN, PURPLE } from './theme.jsx'
import { useEngSelf } from './data.jsx'
import { parseLadder } from './ladder.mjs'

const EVID = { red: '#bc8cff', yellow: ACCENT, green: '#3fb950' }
const DEFAULT_AREAS = ['Technical', 'Delivery', 'Direction', 'Talent', 'Culture']

export default function CompetencyPanel() {
  const [c, setC] = useState(null)
  const [ladderText, setLadderText] = useState('')
  const { data: eng } = useEngSelf()
  useEffect(() => { api.get('/api/career/config').then(cfg => {
    const comp = cfg.competency || { levelSelfAssessed: '', ratings: {}, ladder: [] }
    setC(comp)
    setLadderText((comp.ladder || []).map(r => `${r.level} | ${r.area} | ${r.expectation}`).join('\n'))
  }).catch(e => toast(e.message, 'error')) }, [])
  if (!c) return <div style={{ ...PANEL, color: '#8b949e' }}>Loading…</div>

  const areas = [...new Set([...DEFAULT_AREAS, ...Object.keys(c.ratings || {})])]
  const setRating = (area, score) => setC({ ...c, ratings: { ...c.ratings, [area]: { ...(c.ratings[area] || {}), score1to5: score } } })
  const setNote = (area, note) => setC({ ...c, ratings: { ...c.ratings, [area]: { ...(c.ratings[area] || {}), note } } })
  const applyLadder = () => setC({ ...c, ladder: parseLadder(ladderText, c.ladder) })
  const setEvidence = (i, ev) => { const ladder = [...c.ladder]; ladder[i] = { ...ladder[i], evidenceState: ev }; setC({ ...c, ladder }) }
  const setLinks = (i, v) => { const ladder = [...c.ladder]; ladder[i] = { ...ladder[i], bragLinks: v.split(',').map(s => s.trim()).filter(Boolean) }; setC({ ...c, ladder }) }
  const save = async () => { try { await api.post('/api/career/config', { competency: c }); toast('saved', 'success') } catch (e) { toast(e.message, 'error') } }

  const redRows = (c.ladder || []).filter(r => r.evidenceState === 'red')

  const ev = eng?.dora
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {ev && (
        <div style={PANEL}>
          <div style={{ font: `600 13px ${HEAD}`, color: ACCENT, marginBottom: 4 }}>Delivery evidence <span style={{ color: MUTE, font: `400 11px ${MONO}` }}>· reference only — from JIRA/GitHub, not a rating</span></div>
          <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', marginTop: 8 }}>
            {[['shipped (90d)', ev.throughput90, GREEN], ['PRs authored', (eng.prs || []).length, ACCENT], ['cycle median', `${ev.cycleMedian}d`, INK], ['est accuracy', `${ev.estAcc}%`, INK], ['PR review rounds', ev.prReviewRounds, INK], ['change-fail', `${Math.round(ev.changeFailRate * 100)}%`, PURPLE]].map(([l, v, col]) =>
              <div key={l}><div style={{ font: `600 18px ${MONO}`, color: col }}>{v}</div><div style={{ font: `400 10.5px ${BODY}`, color: MUTE }}>{l}</div></div>)}
          </div>
        </div>
      )}
      {redRows.length ? <div style={{ ...PANEL, borderColor: EVID.red + '55' }}>
        <div style={{ font: `600 13px ${HEAD}`, color: EVID.red }}>Gaps to close ({redRows.length})</div>
        {redRows.map((r, i) => <div key={i} style={{ font: `400 12px ${MONO}`, color: '#cbb', marginTop: 4 }}>{r.level} · {r.area} — {r.expectation}</div>)}
      </div> : null}

      {/* RATINGS zone — never coloured by evidence */}
      <div style={PANEL}>
        <div style={{ font: `600 13px ${HEAD}`, color: ACCENT, marginBottom: 4 }}>Self-assessment</div>
        <div style={{ font: `400 11px ${MONO}`, color: '#8b949e', marginBottom: 10 }}>Self-ratings are yours; the evidence tags below are nudges, not proof. No rating cell is coloured by git/PR evidence.</div>
        <label style={{ font: `400 11px ${MONO}`, color: '#8b949e' }}>Level self-assessed: <input value={c.levelSelfAssessed || ''} onChange={e => setC({ ...c, levelSelfAssessed: e.target.value })} placeholder="e.g. Senior / L5" style={{ font: `500 12px ${MONO}`, background: '#161b22', color: '#e6edf3', border: '1px solid #8b949e55', borderRadius: 6, padding: '3px 8px', marginLeft: 6 }} /></label>
        <div style={{ marginTop: 10 }}>
          {areas.map(area => { const rt = c.ratings[area] || {}; return <div key={area} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
            <div style={{ width: 90, font: `500 12px ${MONO}` }}>{area}</div>
            {[1, 2, 3, 4, 5].map(n => <button key={n} onClick={() => setRating(area, n)} style={{ width: 26, height: 26, borderRadius: 6, cursor: 'pointer', font: `600 11px ${MONO}`, color: rt.score1to5 === n ? '#0d1117' : '#e6edf3', background: rt.score1to5 === n ? ACCENT : 'transparent', border: `1px solid ${ACCENT}55` }}>{n}</button>)}
            <input value={rt.note || ''} onChange={e => setNote(area, e.target.value)} placeholder="note" style={{ flex: 1, font: `400 11px ${MONO}`, background: '#161b22', color: '#cbb', border: '1px solid #8b949e33', borderRadius: 6, padding: '3px 8px' }} />
          </div> })}
        </div>
      </div>

      {/* EVIDENCE / LADDER zone — visually separate */}
      <div style={PANEL}>
        <div style={{ font: `600 13px ${HEAD}`, color: ACCENT, marginBottom: 4 }}>Expectation ladder (paste your real rows)</div>
        <div style={{ font: `400 11px ${MONO}`, color: '#8b949e', marginBottom: 8 }}>One row per line: <code>level | area | expectation</code>. Evidence tags are a nudge only.</div>
        <textarea value={ladderText} onChange={e => setLadderText(e.target.value)} rows={4} placeholder="Senior | Direction | Drives cross-team technical decisions" style={{ width: '100%', boxSizing: 'border-box', font: `400 12px ${MONO}`, background: '#161b22', color: '#e6edf3', border: '1px solid #8b949e55', borderRadius: 8, padding: 8 }} />
        <button onClick={applyLadder} style={{ marginTop: 6, font: `600 11px ${MONO}`, color: ACCENT, background: 'transparent', border: `1px solid ${ACCENT}55`, borderRadius: 6, padding: '3px 10px', cursor: 'pointer' }}>parse rows</button>
        <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
          {(c.ladder || []).map((r, i) => <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderTop: '1px solid #21262d' }}>
            <div style={{ flex: 1, font: `400 12px ${MONO}` }}><b>{r.level}</b> · {r.area} — <span style={{ color: '#8b949e' }}>{r.expectation}</span></div>
            {['red', 'yellow', 'green'].map(ev => <button key={ev} onClick={() => setEvidence(i, ev)} title={ev} style={{ width: 16, height: 16, borderRadius: '50%', cursor: 'pointer', border: r.evidenceState === ev ? '2px solid #fff' : '1px solid #0006', background: EVID[ev] }} />)}
            <input value={(r.bragLinks || []).join(', ')} onChange={e => setLinks(i, e.target.value)} placeholder="brag links" style={{ width: 120, font: `400 10.5px ${MONO}`, background: '#161b22', color: '#cbb', border: '1px solid #8b949e33', borderRadius: 6, padding: '2px 6px' }} />
          </div>)}
        </div>
      </div>

      <button onClick={save} style={{ font: `600 12px ${MONO}`, color: '#0d1117', background: ACCENT, border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', justifySelf: 'start' }}>Save</button>
    </div>
  )
}
