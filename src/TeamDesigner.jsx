import React, { useEffect, useMemo, useState } from 'react'
import { api, fmtDate } from './api.js'

const MONO = "'IBM Plex Mono', monospace"
const HEAD = "'Space Grotesk', sans-serif"
const PANEL = { background: 'rgba(28,24,21,0.55)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 16, padding: '18px 20px', backdropFilter: 'blur(10px)' }
const VERDICT = {
  keep: { color: '#3fb96a', label: 'keep' },
  'just-a-prompt': { color: '#e5a03a', label: 'just a prompt — make it a skill/command' },
  unnecessary: { color: '#e5484d', label: 'unnecessary' },
  merge: { color: '#8b7cf6', label: 'merge with another member' },
}
const MODELS = ['', 'sonnet', 'opus', 'haiku', 'inherit']
const blankMember = lead => ({ name: lead ? 'lead' : '', isLead: !!lead, agentType: 'general-purpose', model: '', prompt: '', skills: [], connectors: [], inputs: '', outputs: '', artifacts: '', tasks: '' })
const blankDesign = () => ({ name: '', goal: '', project: '', adrs: '', members: [blankMember(true), blankMember(false)], review: null, reviewedAt: null })

// live "correctly configured" points — static heuristic; the AI review is the deep judge
export function configChecks(d) {
  const leads = d.members.filter(m => m.isLead).length
  const mates = d.members.filter(m => !m.isLead)
  const prompts = d.members.map(m => (m.prompt || '').trim())
  const overlap = (() => {
    const sets = mates.map(m => new Set((m.prompt || '').toLowerCase().split(/\W+/).filter(w => w.length > 3)))
    for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < sets.length; j++) {
      let inter = 0; for (const w of sets[i]) if (sets[j].has(w)) inter++
      if (sets[i].size > 8 && inter / Math.max(1, Math.min(sets[i].size, sets[j].size)) > 0.7) return [mates[i].name, mates[j].name]
    }
    return null
  })()
  return [
    ['has a goal', !!d.goal.trim(), 10, 'the lead needs a mission to decompose'],
    ['exactly one lead', leads === 1, 15, `${leads} leads defined`],
    ['2–6 teammates', mates.length >= 2 && mates.length <= 6, 15, `${mates.length} teammates — fewer is a prompt, more is chaos`],
    ['every member has a real brief', prompts.every(p => p.length >= 40), 20, 'each prompt ≥ 40 chars of actual instruction'],
    ['unique member names', new Set(d.members.map(m => m.name.trim())).size === d.members.length && d.members.every(m => /^[\w-]+$/.test(m.name.trim())), 10, 'slug-like, no duplicates'],
    ['every member declares outputs', d.members.every(m => (m.outputs || '').trim()), 15, 'no output contract → unverifiable work'],
    ['no near-duplicate briefs', !overlap, 15, overlap ? `${overlap[0]} ≈ ${overlap[1]} — merge them?` : 'roles look distinct'],
  ]
}

function MemberCard({ m, onChange, onRemove, skills, connectors }) {
  const set = (k, v) => onChange({ ...m, [k]: v })
  const togglePick = (k, name) => set(k, m[k].includes(name) ? m[k].filter(x => x !== name) : [...m[k], name])
  const pickList = (k, options, label) => (
    <details style={{ font: `400 11px ${MONO}`, color: '#8a807a' }}>
      <summary style={{ cursor: 'pointer' }}>{label} <span style={{ color: '#e8a06a' }}>{m[k].length ? m[k].join(', ') : 'none'}</span></summary>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, margin: '6px 0' }}>
        {options.map(o => (
          <span key={o} onClick={() => togglePick(k, o)} style={{ cursor: 'pointer', padding: '2px 8px', borderRadius: 6, font: `400 10.5px ${MONO}`, background: m[k].includes(o) ? 'rgba(217,119,87,0.18)' : 'rgba(255,255,255,0.04)', color: m[k].includes(o) ? '#e8a06a' : '#8a807a' }}>{o}</span>
        ))}
      </div>
    </details>
  )
  return (
    <div style={{ ...PANEL, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8, borderColor: m.isLead ? 'rgba(139,124,246,0.3)' : 'rgba(255,255,255,0.06)' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input value={m.name} onChange={e => set('name', e.target.value)} placeholder={m.isLead ? 'lead' : 'member-name'} style={{ width: 150 }} />
        {m.isLead && <span style={{ font: `600 8px ${MONO}`, letterSpacing: '0.08em', padding: '2px 6px', borderRadius: 5, background: 'rgba(139,124,246,0.2)', color: '#a78bfa' }}>LEAD</span>}
        <input value={m.agentType} onChange={e => set('agentType', e.target.value)} placeholder="agent type" style={{ width: 150 }} title="subagent type, e.g. general-purpose" />
        <select value={m.model} onChange={e => set('model', e.target.value)}>{MODELS.map(x => <option key={x} value={x}>{x || 'model: default'}</option>)}</select>
        {!m.isLead && <button className="mini danger" style={{ marginTop: 0, marginLeft: 'auto' }} onClick={onRemove}>remove</button>}
      </div>
      <textarea rows={3} value={m.prompt} onChange={e => set('prompt', e.target.value)} placeholder="brief — what this member owns, how it works, when it's done" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        <input value={m.inputs} onChange={e => set('inputs', e.target.value)} placeholder="inputs (what it consumes)" />
        <input value={m.outputs} onChange={e => set('outputs', e.target.value)} placeholder="outputs (what it returns)" />
        <input value={m.artifacts} onChange={e => set('artifacts', e.target.value)} placeholder="artifacts (files/reports)" />
      </div>
      <textarea rows={2} value={m.tasks} onChange={e => set('tasks', e.target.value)} placeholder="initial task list — one per line" />
      {pickList('skills', skills, 'skills:')}
      {pickList('connectors', connectors, 'connectors (MCP):')}
    </div>
  )
}

export const kickoffPrompt = d => {
  const mates = d.members.filter(m => !m.isLead)
  return [
    `Create an agent team named "${d.name}" to accomplish: ${d.goal}`,
    '',
    'Spawn these teammates and coordinate them through the shared task list:',
    ...mates.map(m => [
      `- ${m.name} (${m.agentType}${m.model ? `, model ${m.model}` : ''}): ${m.prompt}`,
      m.inputs && `  inputs: ${m.inputs}`,
      m.outputs && `  outputs: ${m.outputs}`,
      m.artifacts && `  artifacts to produce: ${m.artifacts}`,
      m.skills.length ? `  use skills: ${m.skills.join(', ')}` : '',
      m.connectors.length ? `  MCP connectors: ${m.connectors.join(', ')}` : '',
      m.tasks.trim() && `  initial tasks:\n${m.tasks.trim().split('\n').map(t => `    - ${t.trim()}`).join('\n')}`,
    ].filter(Boolean).join('\n')),
    d.adrs.trim() ? `\nArchitecture decisions to honour (record deviations as ADRs):\n${d.adrs.trim().split('\n').map(a => `- ${a.trim()}`).join('\n')}` : '',
    '\nAs lead: keep the task list current, review each teammate\'s output against its declared output contract before marking done.',
  ].filter(Boolean).join('\n')
}

function Review({ r }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <svg width="74" height="74" viewBox="0 0 74 74">
          <circle cx="37" cy="37" r="30" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="7" />
          <circle cx="37" cy="37" r="30" fill="none" stroke={r.score >= 70 ? '#3fb96a' : r.score >= 45 ? '#e5a03a' : '#e5484d'} strokeWidth="7" strokeLinecap="round"
            strokeDasharray={`${(r.score / 100) * 188.5} 188.5`} transform="rotate(-90 37 37)" />
          <text x="37" y="43" textAnchor="middle" style={{ font: `600 20px ${HEAD}`, fill: '#f6efe9' }}>{r.score}</text>
        </svg>
        <div style={{ flex: 1, font: "400 13px 'IBM Plex Sans'", color: '#c8bdb4', lineHeight: 1.55 }}>{r.summary}</div>
      </div>
      <div>
        <div style={{ font: `600 12px ${HEAD}`, marginBottom: 6 }}>Configuration points</div>
        {(r.config || []).map((c, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, font: `400 11.5px ${MONO}`, padding: '3px 0' }}>
            <span style={{ color: c.pass ? '#3fb96a' : '#e5484d' }}>{c.pass ? '✓' : '✗'}</span>
            <span style={{ color: '#c8bdb4' }}>{c.check}</span>
            <span style={{ color: '#7a716a' }}>· {c.note}</span>
          </div>
        ))}
      </div>
      <div>
        <div style={{ font: `600 12px ${HEAD}`, marginBottom: 6 }}>Members</div>
        {(r.members || []).map((m, i) => {
          const v = VERDICT[m.verdict] || VERDICT.keep
          return (
            <details key={i} style={{ padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <summary style={{ cursor: 'pointer', font: `500 12.5px ${MONO}`, color: '#eee3da' }}>
                {m.name} <span style={{ color: v.color }}>● {v.label}</span> <span style={{ color: '#7a716a', font: `400 11px ${MONO}` }}>— {m.reason}</span>
              </summary>
              <div style={{ margin: '8px 0 4px 14px', display: 'flex', flexDirection: 'column', gap: 4, font: `400 11.5px ${MONO}`, color: '#b0a69e' }}>
                <div><span style={{ color: '#7a716a' }}>in → </span>{m.inputs}</div>
                <div><span style={{ color: '#7a716a' }}>out → </span>{m.outputs}</div>
                {m.artifacts?.length > 0 && <div><span style={{ color: '#7a716a' }}>artifacts: </span>{m.artifacts.join(' · ')}</div>}
                {m.tasks?.length > 0 && <div><span style={{ color: '#7a716a' }}>tasks:</span> {m.tasks.map((t, j) => <div key={j} style={{ marginLeft: 14 }}>{j + 1}. {t}</div>)}</div>}
                {m.skills?.length > 0 && <div><span style={{ color: '#7a716a' }}>skills: </span>{m.skills.join(', ')}</div>}
                {m.connectors?.length > 0 && <div><span style={{ color: '#7a716a' }}>connectors: </span>{m.connectors.join(', ')}</div>}
                {m.adrs?.length > 0 && <div><span style={{ color: '#7a716a' }}>ADRs to record: </span>{m.adrs.join(' · ')}</div>}
              </div>
            </details>
          )
        })}
      </div>
      <div className="hx-2" style={{ gap: 14 }}>
        <div>
          <div style={{ font: `600 12px ${HEAD}`, marginBottom: 6 }}>Collaboration</div>
          {(r.collaboration || []).map((e, i) => (
            <div key={i} style={{ font: `400 11px ${MONO}`, color: '#b0a69e', padding: '3px 0' }}>
              <span style={{ color: '#e8a06a' }}>{e.from}</span> <span style={{ color: '#5a514a' }}>→</span> <span style={{ color: '#7cc4f7' }}>{e.to}</span> · {e.what}
            </div>
          ))}
        </div>
        <div>
          <div style={{ font: `600 12px ${HEAD}`, marginBottom: 6 }}>Risks</div>
          {(r.risks || []).map((x, i) => <div key={i} style={{ font: `400 11px ${MONO}`, color: '#e5a03a', padding: '3px 0' }}>⚠ {x}</div>)}
        </div>
      </div>
    </div>
  )
}

export default function TeamDesigner({ onClose }) {
  const [designs, setDesigns] = useState([])
  const [cur, setCur] = useState(null) // index into designs, or design object for new
  const [skills, setSkills] = useState([])
  const [connectors, setConnectors] = useState([])
  const [projects, setProjects] = useState([])
  const [reviewing, setReviewing] = useState(false)
  useEffect(() => {
    api.get('/api/team/designs').then(setDesigns).catch(() => {})
    api.get('/api/res/skills').then(s => setSkills([...new Set(s.map(x => x.name))])).catch(() => {})
    api.get('/api/mcp').then(m => setConnectors([...new Set(m.map(x => x.name))])).catch(() => {})
    api.get('/api/projects').then(ps => setProjects(ps.filter(p => p.exists))).catch(() => {})
  }, [])
  const persist = list => { setDesigns(list); api.put('/api/team/designs', { designs: list }).catch(e => alert(e.message)) }
  const saveCur = d => {
    setCur(d)
    const i = designs.findIndex(x => x.name === d.name && d.name)
    persist(i >= 0 ? designs.map((x, j) => j === i ? d : x) : d.name ? [...designs, d] : designs)
  }
  const checks = useMemo(() => cur ? configChecks(cur) : [], [cur])
  const staticScore = checks.reduce((s, [, ok, w]) => s + (ok ? w : 0), 0)

  const runReview = async () => {
    setReviewing(true)
    try {
      const r = await api.post('/api/team/design/review', { design: { ...cur, review: undefined } })
      saveCur({ ...cur, review: r.review, reviewedAt: Date.now(), reviewCost: r.cost })
    } catch (e) { alert(e.message) } finally { setReviewing(false) }
  }
  const launch = () => {
    sessionStorage.setItem('ctx-bundle-prompt', kickoffPrompt(cur))
    window.dispatchEvent(new Event('nav-chat'))
  }

  if (!cur) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button className="primary" onClick={() => setCur(blankDesign())}>+ Design a team</button>
        <span style={{ font: `400 10.5px ${MONO}`, color: '#7a716a' }}>designs live in ~/.claude/team-designs.json · AI review runs a real claude -p pass and costs a few cents</span>
        <button className="mini" style={{ marginTop: 0, marginLeft: 'auto' }} onClick={onClose}>‹ back to teams</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 14 }}>
        {designs.map((d, i) => (
          <div key={d.name + i} style={{ ...PANEL, cursor: 'pointer' }} onClick={() => setCur(d)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ font: `600 15px ${HEAD}` }}>{d.name}</span>
              {d.review && <span style={{ marginLeft: 'auto', font: `600 12px ${MONO}`, color: d.review.score >= 70 ? '#3fb96a' : d.review.score >= 45 ? '#e5a03a' : '#e5484d' }}>AI {d.review.score}/100</span>}
            </div>
            <div style={{ font: "400 12px 'IBM Plex Sans'", color: '#b0a69e', margin: '6px 0', lineHeight: 1.5 }}>{d.goal || 'no goal'}</div>
            <div style={{ font: `400 10.5px ${MONO}`, color: '#7a716a' }}>{d.members.filter(m => !m.isLead).length} teammates + lead{d.reviewedAt ? ` · reviewed ${fmtDate(d.reviewedAt)}` : ''}</div>
            <button className="mini danger" style={{ marginTop: 8 }} onClick={e => { e.stopPropagation(); confirm('Delete design?') && persist(designs.filter((_, j) => j !== i)) }}>delete</button>
          </div>
        ))}
        {designs.length === 0 && <div style={{ font: `400 11px ${MONO}`, color: '#5a514a' }}>no designs yet — compose one, let the AI score it, then launch it as a real team</div>}
      </div>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="mini" style={{ marginTop: 0 }} onClick={() => setCur(null)}>‹ designs</button>
        <input value={cur.name} onChange={e => setCur({ ...cur, name: e.target.value })} placeholder="team name (slug)" style={{ width: 200 }} />
        <select value={cur.project} onChange={e => setCur({ ...cur, project: e.target.value })}>
          <option value="">project: pick for launch</option>
          {projects.map(p => <option key={p.path} value={p.path}>{p.name}</option>)}
        </select>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={() => saveCur(cur)} disabled={!cur.name.trim()}>Save</button>
          <button onClick={runReview} disabled={reviewing || !cur.name.trim()}>{reviewing ? 'AI reviewing… (~1 min)' : '✦ AI review'}</button>
          <button className="mini" style={{ marginTop: 0 }} onClick={() => navigator.clipboard.writeText(kickoffPrompt(cur)).then(() => alert('kickoff prompt copied'))}>copy kickoff</button>
          <button className="primary" onClick={launch} disabled={!cur.goal.trim()} title="opens Chat prefilled with the kickoff prompt — send it from a session in the target project">Launch team →</button>
        </span>
      </div>
      <div className="hx-2a">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <textarea rows={2} value={cur.goal} onChange={e => setCur({ ...cur, goal: e.target.value })} placeholder="goal — what should this team accomplish?" />
          {cur.members.map((m, i) => (
            <MemberCard key={i} m={m} skills={skills} connectors={connectors}
              onChange={next => setCur({ ...cur, members: cur.members.map((x, j) => j === i ? next : x) })}
              onRemove={() => setCur({ ...cur, members: cur.members.filter((_, j) => j !== i) })} />
          ))}
          <button className="mini" style={{ marginTop: 0, alignSelf: 'flex-start' }} onClick={() => setCur({ ...cur, members: [...cur.members, blankMember(false)] })}>+ add member</button>
          <textarea rows={2} value={cur.adrs} onChange={e => setCur({ ...cur, adrs: e.target.value })} placeholder="ADRs / architecture decisions the team must honour — one per line" />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ ...PANEL }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
              <div style={{ font: `600 15px ${HEAD}` }}>Config checklist</div>
              <span style={{ font: `600 13px ${MONO}`, color: staticScore >= 70 ? '#3fb96a' : staticScore >= 45 ? '#e5a03a' : '#e5484d' }}>{staticScore}/100</span>
              <span style={{ font: `400 10px ${MONO}`, color: '#7a716a' }}>static · live</span>
            </div>
            {checks.map(([label, ok, w, note]) => (
              <div key={label} style={{ display: 'flex', gap: 8, font: `400 11.5px ${MONO}`, padding: '3px 0' }}>
                <span style={{ color: ok ? '#3fb96a' : '#e5484d' }}>{ok ? '✓' : '✗'}</span>
                <span style={{ color: '#c8bdb4' }}>{label}</span>
                <span style={{ color: '#7a716a', marginLeft: 'auto', textAlign: 'right' }}>{ok ? `+${w}` : note}</span>
              </div>
            ))}
          </div>
          <div style={{ ...PANEL }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
              <div style={{ font: `600 15px ${HEAD}` }}>AI review</div>
              {cur.reviewedAt && <span style={{ font: `400 10px ${MONO}`, color: '#7a716a' }}>{fmtDate(cur.reviewedAt)}{cur.reviewCost ? ` · $${cur.reviewCost.toFixed(3)}` : ''}</span>}
            </div>
            {cur.review ? <Review r={cur.review} /> : <div style={{ font: `400 11px ${MONO}`, color: '#5a514a' }}>run ✦ AI review — a real claude pass judges each member (keep / just-a-prompt / merge), derives inputs/outputs, artifacts, task lists, skills, connectors and ADRs per member, plus the collaboration map</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
