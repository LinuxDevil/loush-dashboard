import React, { useEffect, useState } from 'react'
import { api, toast } from '../lib/api.js'
import Skeleton from '../ui/Skeleton.jsx'

// ---------- Setup — every piece of config this app needs, entered visually ----------
//
// Configuring this dashboard used to mean hand-editing JSON in three places, and the only reason it
// "worked out of the box" was another company's production config compiled into the source. Now that
// everything org-specific is user config, there has to be somewhere to put it.
//
// SECRETS: this component can never display a credential, because no endpoint will return one. The
// server answers `set: true|false` and nothing else. A token field is therefore always blank on load
// — that is not a bug, it is the whole design. Submitting a blank field LEAVES the stored value
// alone; clearing one requires the explicit Remove button. If the field round-tripped the value it
// would be visible in devtools, in a screenshot, and in any cached response.

const MONO = "'IBM Plex Mono', monospace"
const HEAD = "'Space Grotesk', sans-serif"
const RED = '#e5484d', GOLD = '#e5a03a', GREEN = '#3fb96a', DIM = '#8a807a', ACCENT = '#d97757'
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const card = { background: 'rgba(28,24,21,.55)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: 16 }
const inp = { width: '100%', padding: '8px 11px', borderRadius: 8, border: '1px solid rgba(255,255,255,.14)', background: 'rgba(0,0,0,.3)', color: '#eee3da', font: `400 13px ${MONO}`, outline: 'none', boxSizing: 'border-box' }
const btn = { padding: '7px 13px', borderRadius: 8, border: '1px solid rgba(255,255,255,.16)', background: 'rgba(28,24,21,.9)', color: '#d8cfc7', cursor: 'pointer', font: '500 12.5px sans-serif' }
const primary = { ...btn, background: ACCENT, color: '#12100e', border: 'none', fontWeight: 600 }
const danger = { ...btn, color: RED, borderColor: RED + '55' }

const Field = ({ label, hint, children }) => (
  <label style={{ display: 'block', marginBottom: 12 }}>
    <div style={{ font: `600 10px ${MONO}`, letterSpacing: '.08em', textTransform: 'uppercase', color: DIM, marginBottom: 5 }}>{label}</div>
    {children}
    {hint && <div style={{ font: '400 11px sans-serif', color: DIM, marginTop: 4, lineHeight: 1.5 }}>{hint}</div>}
  </label>
)
const Section = ({ title, sub, children, right }) => (
  <div style={{ ...card, marginBottom: 16 }}>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
      <h3 style={{ margin: 0, font: `600 15px ${HEAD}`, color: '#f6efe9' }}>{title}</h3>
      <span style={{ font: `400 11px ${MONO}`, color: DIM, flex: 1 }}>{sub}</span>
      {right}
    </div>
    {children}
  </div>
)
const Dot = ({ ok, warn }) => <span style={{ width: 8, height: 8, borderRadius: 4, display: 'inline-block', background: ok ? GREEN : warn ? GOLD : DIM, flexShrink: 0 }} />
const emails = s => String(s || '').split(/[\s,;]+/).map(x => x.trim()).filter(Boolean)

export default function SetupSection() {
  const [d, setD] = useState(null)
  const [err, setErr] = useState(null)
  const load = () => api.get('/api/setup').then(setD).catch(e => setErr(e.message))
  useEffect(() => { load() }, [])

  if (err) return <div style={card}><b style={{ color: RED }}>Could not load setup</b><div style={{ color: DIM, marginTop: 8 }}>{err}</div></div>
  if (!d) return <Skeleton tiles={2} rows={10} />

  return (
    <div style={{ maxWidth: 940 }}>
      <p style={{ color: DIM, font: '400 12.5px sans-serif', lineHeight: 1.6, margin: '0 0 16px' }}>
        Everything below is written to files on this machine. <b style={{ color: '#e8e0d8' }}>Credentials are
        write-only</b> — no endpoint in this app will return a stored token, so these fields are always blank
        on load and submitting a blank one leaves the saved value untouched.
      </p>
      <Credentials d={d} reload={load} />
      <Projects d={d} reload={load} />
      <WorkWeek d={d} reload={load} />
      <StoryPoints d={d} reload={load} />
      <OrgTools d={d} reload={load} />
      <Notifications d={d} reload={load} />
    </div>
  )
}

// ---------- credentials ----------
function Credentials({ d, reload }) {
  const c = d.credentials
  const [email, setEmail] = useState('')
  const [token, setToken] = useState('')
  const [host, setHost] = useState(d.eng.jiraHost || '')
  const [busy, setBusy] = useState(false)
  const [test, setTest] = useState(null)

  const save = async () => {
    setBusy(true)
    try {
      if (host !== (d.eng.jiraHost || '')) await api.put('/api/setup/eng', { jiraHost: host })
      const body = {}
      if (email) body.jiraEmail = email
      if (token) body.jiraToken = token
      if (Object.keys(body).length) {
        const r = await api.put('/api/setup/credentials', body)
        if (r.warning) toast(r.warning, 'error')
      }
      setEmail(''); setToken('')
      toast('saved', 'success')
      reload()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  const clear = async field => {
    if (!confirm(`Remove the stored JIRA ${field === 'jiraToken' ? 'API token' : 'email'}?`)) return
    try { await api.put('/api/setup/credentials', { [field]: '' }); toast('removed', 'success'); reload() }
    catch (e) { toast(e.message, 'error') }
  }
  const runTest = async () => {
    setBusy(true); setTest(null)
    try { setTest(await api.post('/api/setup/test/jira', { jiraHost: host })) }
    catch (e) { setTest({ ok: false, error: e.message }) } finally { setBusy(false) }
  }

  return (
    <Section title="Credentials" sub="JIRA + GitHub — needed only for the Delivery section"
      right={<span style={{ font: `400 11px ${MONO}`, color: DIM }}>{c.file.path.replace(/^.*\//, '')}</span>}>

      {!c.file.gitignored && c.file.exists && (
        <div style={{ ...card, borderColor: RED, background: RED + '14', marginBottom: 14 }}>
          <b style={{ color: RED }}>⚠ {c.file.path.replace(/^.*\//, '')} is not in .gitignore</b>
          <div style={{ color: '#e7c0c1', font: '400 12px sans-serif', marginTop: 4 }}>
            Your API token is committable right now. This is exactly how ten employee email addresses
            reached this repo's history. Add it to .gitignore before your next commit.
          </div>
        </div>
      )}
      {c.envOverride && (
        <div style={{ ...card, borderColor: GOLD + '66', background: GOLD + '10', marginBottom: 14, font: '400 12px sans-serif', color: '#e8d7b8' }}>
          <b>Environment variables are set</b> (JIRA_EMAIL / JIRA_API_TOKEN) and take precedence over this file.
          Anything saved here will be ignored until they are unset.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 14 }}>
        <div>
          <Field label="JIRA host" hint="Bare hostname, no https://">
            <input value={host} onChange={e => setHost(e.target.value)} placeholder="your-org.atlassian.net" style={inp} />
          </Field>
          <Field label={<>JIRA email</>} hint={<span><Dot ok={c.email.set} /> {c.email.set ? `stored (${c.email.source})` : 'not set'}</span>}>
            <input value={email} onChange={e => setEmail(e.target.value)} placeholder={c.email.set ? '•••••• (leave blank to keep)' : 'you@example.com'} style={inp} autoComplete="off" />
          </Field>
        </div>
        <div>
          <Field label="JIRA API token"
            hint={<span><Dot ok={c.token.set} /> {c.token.set ? `stored (${c.token.source}) · file mode ${c.file.mode}` : 'not set'} — create one at id.atlassian.com → Security → API tokens</span>}>
            <input type="password" value={token} onChange={e => setToken(e.target.value)} placeholder={c.token.set ? '•••••• (leave blank to keep)' : 'paste token'} style={inp} autoComplete="new-password" />
          </Field>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
            {c.email.set && c.email.source === 'file' && <button style={danger} onClick={() => clear('jiraEmail')}>Remove email</button>}
            {c.token.set && c.token.source === 'file' && <button style={danger} onClick={() => clear('jiraToken')}>Remove token</button>}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
        <button style={primary} disabled={busy} onClick={save}>Save</button>
        <button style={btn} disabled={busy} onClick={runTest}>Test connection</button>
        {test && <span style={{ font: `400 12px ${MONO}`, color: test.ok ? GREEN : RED }}>
          {test.ok ? `✓ authenticated as ${test.account}` : `✗ ${test.error || 'failed'}`}
        </span>}
      </div>

      <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,.07)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, font: '400 12.5px sans-serif', color: '#c8bdb4' }}>
          <Dot ok={d.gh.authed} warn={d.gh.installed && !d.gh.authed} />
          <b>GitHub CLI</b>
          <span style={{ color: DIM, font: `400 11.5px ${MONO}` }}>
            {d.gh.authed ? `authenticated${d.gh.user ? ' as ' + d.gh.user : ''}`
              : d.gh.installed ? 'installed but not authenticated' : 'not installed'}
          </span>
        </div>
        <div style={{ color: DIM, font: '400 11.5px sans-serif', marginTop: 5, lineHeight: 1.5 }}>
          GitHub access is the <code style={{ fontFamily: MONO }}>gh</code> CLI's own login — this app never stores a
          GitHub token, so there is nothing to enter here. {d.gh.authed ? '' : <>Run <code style={{ fontFamily: MONO, color: '#e8e0d8' }}>gh auth login</code> in a terminal, then reload.</>}
        </div>
      </div>
    </Section>
  )
}

// ---------- projects ----------
const blankProject = { key: '', name: '', githubRepo: '', jql: '', spField: '', devEmails: [], qaEmails: [], productEmails: [], writes: false }

function Projects({ d, reload }) {
  const [edit, setEdit] = useState(null)
  const [busy, setBusy] = useState(false)
  const list = d.eng.projects || []

  const save = async () => {
    setBusy(true)
    try { await api.put('/api/setup/project', edit); toast(`saved ${edit.key.toUpperCase()}`, 'success'); setEdit(null); reload() }
    catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  const del = async key => {
    if (!confirm(`Remove project ${key}? This only edits projects.json — nothing in JIRA or GitHub is touched.`)) return
    try { await api.del('/api/setup/project?key=' + encodeURIComponent(key)); toast(`removed ${key}`, 'success'); reload() }
    catch (e) { toast(e.message, 'error') }
  }

  return (
    <Section title="Projects" sub="one JIRA board + GitHub repo each"
      right={<button style={btn} onClick={() => setEdit({ ...blankProject })}>+ Add project</button>}>
      {!list.length && !edit && (
        <div style={{ color: DIM, font: '400 12.5px sans-serif', lineHeight: 1.6 }}>
          No projects configured. The Delivery section will report “not configured” rather than showing
          anything — which is the honest answer. Everything in <b style={{ color: '#e8e0d8' }}>Working Set</b>,
          Harness and Capabilities works without this.
        </div>
      )}
      {list.map(p => (
        <div key={p.key} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '9px 0', borderBottom: '1px solid rgba(255,255,255,.06)', flexWrap: 'wrap' }}>
          <span style={{ font: `600 12px ${MONO}`, color: ACCENT, minWidth: 46 }}>{p.key}</span>
          <span style={{ font: '500 13px sans-serif', color: '#e8e0d8', flex: 1, minWidth: 120 }}>{p.name || p.key}</span>
          <span style={{ font: `400 11px ${MONO}`, color: DIM }}>{p.githubRepo || 'no repo'}</span>
          <span title="dev / qa / product" style={{ font: `400 11px ${MONO}`, color: DIM }}>
            {(p.devEmails || []).length}/{(p.qaEmails || []).length}/{(p.productEmails || []).length}
          </span>
          <span title={p.writes ? 'this project may transition tickets and comment on PRs' : 'read-only: the dashboard copies a line for you to send'}
            style={{ font: `600 9px ${MONO}`, padding: '2px 6px', borderRadius: 4, color: p.writes ? GOLD : DIM, border: `1px solid ${(p.writes ? GOLD : DIM)}55` }}>
            {p.writes ? 'WRITES' : 'READ-ONLY'}
          </span>
          <button style={btn} onClick={() => setEdit({ ...blankProject, ...p })}>Edit</button>
          <button style={danger} onClick={() => del(p.key)}>Remove</button>
        </div>
      ))}

      {edit && (
        <div style={{ ...card, marginTop: 14, background: 'rgba(0,0,0,.22)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 14 }}>
            <Field label="JIRA project key" hint="Uppercase, e.g. ABC — used to match ticket ids in branch names">
              <input value={edit.key} onChange={e => setEdit({ ...edit, key: e.target.value.toUpperCase() })} placeholder="ABC" style={inp} />
            </Field>
            <Field label="Display name"><input value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} placeholder="Web Storefront" style={inp} /></Field>
            <Field label="GitHub repo" hint="owner/name"><input value={edit.githubRepo} onChange={e => setEdit({ ...edit, githubRepo: e.target.value })} placeholder="your-org/your-repo" style={inp} /></Field>
            <Field label="Story-point field" hint="Optional JIRA custom field id, e.g. customfield_10016"><input value={edit.spField || ''} onChange={e => setEdit({ ...edit, spField: e.target.value })} placeholder="(auto)" style={inp} /></Field>
          </div>
          <Field label="JQL" hint="Leave blank for the default: recently-updated or not-yet-done tickets in this project">
            <input value={edit.jql || ''} onChange={e => setEdit({ ...edit, jql: e.target.value })} placeholder="(default)" style={inp} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 14 }}>
            {[['devEmails', 'Developers'], ['qaEmails', 'QA'], ['productEmails', 'Product']].map(([k, label]) => (
              <Field key={k} label={label} hint="comma or newline separated">
                <textarea value={(edit[k] || []).join('\n')} onChange={e => setEdit({ ...edit, [k]: emails(e.target.value) })}
                  rows={3} placeholder="name@example.com" style={{ ...inp, resize: 'vertical' }} />
              </Field>
            ))}
          </div>
          <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', justifyContent: 'flex-start', margin: '4px 0 14px', cursor: 'pointer' }}>
            <input type="checkbox" checked={!!edit.writes} onChange={e => setEdit({ ...edit, writes: e.target.checked })} style={{ width: 'auto', flex: '0 0 auto', marginTop: 3 }} />
            <span style={{ font: '400 12.5px sans-serif', color: '#c8bdb4', lineHeight: 1.5 }}>
              <b style={{ color: '#e8e0d8' }}>Allow writes to JIRA and GitHub</b> — lets the dashboard transition tickets
              and comment on PRs for this project. Off by default: it copies a line for you to send instead.
            </span>
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={primary} disabled={busy} onClick={save}>Save project</button>
            <button style={btn} onClick={() => setEdit(null)}>Cancel</button>
          </div>
        </div>
      )}
    </Section>
  )
}

// ---------- work week ----------
function WorkWeek({ d, reload }) {
  const [w, setW] = useState(() => ({ ...d.eng.work }))
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try { const r = await api.put('/api/setup/eng', { work: w }); toast(`work week saved — ${r.workDescription}`, 'success'); reload() }
    catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  const toggleDay = i => setW({ ...w, weekend: w.weekend.includes(i) ? w.weekend.filter(x => x !== i) : [...w.weekend, i].sort() })

  return (
    <Section title="Work week" sub={d.eng.workDescription}>
      <p style={{ color: GOLD, font: '400 12px sans-serif', margin: '0 0 14px', lineHeight: 1.6 }}>
        This is the most load-bearing setting in the app. Every duration in Delivery — cycle time, lead
        time, stage budgets, off-hours and weekend-work flags — is measured in working time using these
        values. Set the weekend wrong and the dashboard will tell you that you work weekends.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 14 }}>
        <Field label="UTC offset (hours)" hint="Fixed offset, no daylight saving">
          <input type="number" value={w.tzOffsetHours} min={-12} max={14} onChange={e => setW({ ...w, tzOffsetHours: Number(e.target.value) })} style={inp} />
        </Field>
        <Field label="Day starts"><input type="number" value={w.startHour} min={0} max={23} onChange={e => setW({ ...w, startHour: Number(e.target.value) })} style={inp} /></Field>
        <Field label="Day ends"><input type="number" value={w.endHour} min={1} max={24} onChange={e => setW({ ...w, endHour: Number(e.target.value) })} style={inp} /></Field>
        <Field label="Week starts on">
          <select value={w.weekStartDay} onChange={e => setW({ ...w, weekStartDay: Number(e.target.value) })} style={inp}>
            {DAYS.map((n, i) => <option key={i} value={i}>{n}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Weekend days" hint="Click to toggle. Highlighted days are NOT counted as working time.">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {DAYS.map((n, i) => (
            <button key={i} onClick={() => toggleDay(i)} style={{
              ...btn, padding: '6px 12px',
              background: w.weekend.includes(i) ? GOLD + '22' : 'rgba(28,24,21,.9)',
              borderColor: w.weekend.includes(i) ? GOLD + '77' : 'rgba(255,255,255,.16)',
              color: w.weekend.includes(i) ? GOLD : '#d8cfc7',
            }}>{n}</button>
          ))}
        </div>
      </Field>
      <button style={primary} disabled={busy} onClick={save}>Save work week</button>
    </Section>
  )
}

// ---------- story points ----------
function StoryPoints({ d, reload }) {
  const [rows, setRows] = useState(() => d.eng.storyPointDays.map(r => [...r]))
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try { await api.put('/api/setup/eng', { storyPointDays: rows.map(([a, b]) => [Number(a), Number(b)]) }); toast('saved', 'success'); reload() }
    catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  const set = (i, j, v) => setRows(rows.map((r, k) => (k === i ? (j === 0 ? [Number(v), r[1]] : [r[0], Number(v)]) : r)))

  return (
    <Section title="Story points → working days" sub="used for estimate accuracy and stage budgets">
      <p style={{ color: DIM, font: '400 12px sans-serif', margin: '0 0 14px', lineHeight: 1.6 }}>
        Org-specific by nature — a “5” means different things at different companies, and estimate
        accuracy is scored against an OKR target. Values between rows are interpolated.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(0,0,0,.25)', padding: '6px 8px', borderRadius: 8 }}>
            <input value={r[0]} onChange={e => set(i, 0, e.target.value)} style={{ ...inp, width: 52, padding: '4px 6px', textAlign: 'center' }} />
            <span style={{ color: DIM, font: `400 11px ${MONO}` }}>→</span>
            <input value={r[1]} onChange={e => set(i, 1, e.target.value)} style={{ ...inp, width: 58, padding: '4px 6px', textAlign: 'center' }} />
            <span style={{ color: DIM, font: `400 10px ${MONO}` }}>d</span>
            <button title="remove" style={{ ...btn, padding: '2px 7px', color: DIM }} onClick={() => setRows(rows.filter((_, k) => k !== i))}>×</button>
          </div>
        ))}
        <button style={btn} onClick={() => setRows([...rows, [rows.length ? rows[rows.length - 1][0] * 2 : 1, 1]])}>+ row</button>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button style={primary} disabled={busy} onClick={save}>Save table</button>
        <button style={btn} onClick={() => setRows(d.defaults.storyPointDays.map(r => [...r]))}>Reset to reference table</button>
      </div>
    </Section>
  )
}

// ---------- org-specific tool bundles ----------
function OrgTools({ d, reload }) {
  const flag = d.eng.almosaferTools || { enabled: false, emails: [] }
  const [enabled, setEnabled] = useState(!!flag.enabled)
  const [emails, setEmails] = useState((flag.emails || []).join('\n'))
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      const r = await api.put('/api/setup/eng', { almosaferTools: { enabled, emails: emails.split(/[\s,;]+/).filter(Boolean) } })
      toast(r.restartRequired ? 'saved — restart the server for the tab to appear/disappear' : 'saved', 'success')
      reload()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  return (
    <Section title="Almosafer tools" sub="org-specific bundle — Constitution + Figma Capture">
      <p style={{ color: DIM, font: '400 12px sans-serif', margin: '0 0 14px', lineHeight: 1.6 }}>
        The <b style={{ color: '#e8e0d8' }}>Constitution</b> reader needs a <code style={{ fontFamily: MONO }}>.wakeel/constitution/</code> knowledge
        base in the repo, and <b style={{ color: '#e8e0d8' }}>Figma Capture</b> ships against a specific design-system catalog. Both are
        useless outside the org that has that layout, so they are off unless this is on. The server
        gates the same flag at mount time — with it off those routes do not exist at all.
      </p>
      <label style={{ display: 'flex', gap: 9, alignItems: 'center', justifyContent: 'flex-start', width: 'fit-content', marginBottom: 12, cursor: 'pointer' }}>
        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} style={{ width: 'auto', flex: '0 0 auto', margin: 0 }} />
        <span style={{ font: '400 12.5px sans-serif', color: '#c8bdb4' }}>Enable the <b style={{ color: '#e8e0d8' }}>Almosafer tools</b> tab</span>
      </label>
      <Field label="Restrict to these identities" hint="Optional. Leave empty to enable for whoever is running the dashboard; otherwise the configured JIRA email (or JIRA_EMAIL) must be listed.">
        <textarea value={emails} onChange={e => setEmails(e.target.value)} rows={2} placeholder="you@example.com" style={{ ...inp, resize: 'vertical' }} />
      </Field>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button style={primary} disabled={busy} onClick={save}>Save</button>
        <span style={{ font: `400 11px ${MONO}`, color: GOLD }}>takes effect on server restart</span>
      </div>
    </Section>
  )
}

// ---------- notifications ----------
function Notifications({ d, reload }) {
  const [desktop, setDesktop] = useState(d.notify.desktop)
  const [hook, setHook] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async (extra = {}) => {
    setBusy(true)
    try {
      await api.put('/api/setup/notify', { desktop, ...(hook ? { slackWebhook: hook } : {}), ...extra })
      setHook(''); toast('saved', 'success'); reload()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  return (
    <Section title="Notifications" sub="Inbox alerts — optional">
      <label style={{ display: 'flex', gap: 9, alignItems: 'center', justifyContent: 'flex-start', width: 'fit-content', marginBottom: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={desktop} onChange={e => setDesktop(e.target.checked)} style={{ width: 'auto', flex: '0 0 auto', margin: 0 }} />
        <span style={{ font: '400 12.5px sans-serif', color: '#c8bdb4' }}>Desktop notifications for new error / warning Inbox items</span>
      </label>
      <Field label="Slack webhook"
        hint={<span><Dot ok={d.notify.slackWebhookSet} /> {d.notify.slackWebhookSet ? 'stored (write-only, never displayed)' : 'not set'} — posts to a channel; it never @-mentions anyone on your behalf</span>}>
        <input type="password" value={hook} onChange={e => setHook(e.target.value)} autoComplete="new-password"
          placeholder={d.notify.slackWebhookSet ? '•••••• (leave blank to keep)' : 'https://hooks.slack.com/services/...'} style={inp} />
      </Field>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button style={primary} disabled={busy} onClick={() => save()}>Save</button>
        {d.notify.slackWebhookSet && <>
          <button style={btn} disabled={busy} onClick={() => api.post('/api/notify/test').then(r => toast(r.ok ? 'Slack accepted the test message' : `Slack answered ${r.status}`, r.ok ? 'success' : 'error')).catch(e => toast(e.message, 'error'))}>Send test</button>
          <button style={danger} disabled={busy} onClick={() => confirm('Remove the stored Slack webhook?') && save({ slackWebhook: '' })}>Remove webhook</button>
        </>}
      </div>
    </Section>
  )
}
