import React, { useEffect, useState } from 'react'
import { api, toast } from '../lib/api.js'
import Skeleton from '../ui/Skeleton.jsx'

// ---------- Setup — every piece of config this app needs, entered visually ----------

const MONO = "var(--mono)"
const HEAD = "var(--head)"
const RED = 'var(--red)', GOLD = 'var(--amber)', GREEN = 'var(--green)', DIM = 'var(--text-secondary)', ACCENT = 'var(--accent)'
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const card = { background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 6, padding: 16 }
const inp = { width: '100%', padding: '8px 11px', borderRadius: 8, border: '1px solid var(--border-default)', background: 'var(--bg-inset)', color: 'var(--text-primary)', font: `400 13px ${MONO}`, outline: 'none', boxSizing: 'border-box' }
const btn = { padding: '7px 13px', borderRadius: 8, border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--text-primary)', cursor: 'pointer', font: '500 13px sans-serif' }
const primary = { ...btn, background: ACCENT, color: 'var(--bg-base)', border: 'none', fontWeight: 600 }
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
      <h3 style={{ margin: 0, font: `600 14px ${HEAD}`, color: 'var(--text-primary)' }}>{title}</h3>
      <span style={{ font: `400 11px ${MONO}`, color: DIM, flex: 1 }}>{sub}</span>
      {right}
    </div>
    {children}
  </div>
)
const Dot = ({ ok, warn }) => <span style={{ width: 8, height: 8, borderRadius: 4, display: 'inline-block', background: ok ? GREEN : warn ? GOLD : DIM, flexShrink: 0 }} />
const emails = s => String(s || '').split(/[\s,;]+/).map(x => x.trim()).filter(Boolean)

function Paths() {
  const [m, setM] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => { api.get('/api/meta').then(setM).catch(e => setErr(e.message)) }, [])
  const rows = [
    ['home', m?.home, 'your home directory'],
    ['Claude config', m?.claudeDir, 'skills, commands, agents, settings.json and the transcripts this dashboard reads'],
    ['current project', m?.project, 'the checkout most screens default to'],
    ['backups', m?.backups, 'every file this app overwrites is copied here first'],
  ]
  return (
    <div style={card}>
      <b>Paths</b>
      <div style={{ color: DIM, font: '400 12px sans-serif', margin: '6px 0 10px' }}>
        Where this dashboard reads and writes. Nothing here is editable — these come from the server.
      </div>
      {err && <div style={{ color: RED, font: '400 12px monospace' }}>{err}</div>}
      {!m && !err && <div style={{ color: DIM, font: '400 12px monospace' }}>loading…</div>}
      {m && rows.map(([label, value, gloss]) => (
        <div key={label} style={{ display: 'flex', gap: 12, padding: '4px 0', font: '400 12px monospace', alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span style={{ color: DIM, width: 130, flexShrink: 0 }}>{label}</span>
          {}
          <span style={{ color: value ? 'var(--text-primary)' : DIM }}>{value || 'unknown'}</span>
          <span style={{ color: DIM, flexBasis: '100%', fontSize: 11 }}>{gloss}</span>
        </div>
      ))}
    </div>
  )
}

export default function SetupSection() {
  const [d, setD] = useState(null)
  const [err, setErr] = useState(null)
  const load = () => api.get('/api/setup').then(setD).catch(e => setErr(e.message))
  useEffect(() => { load() }, [])

  if (err) return <div style={card}><b style={{ color: RED }}>Could not load setup</b><div style={{ color: DIM, marginTop: 8 }}>{err}</div></div>
  if (!d) return <Skeleton tiles={2} rows={10} />

  return (
    <div style={{ maxWidth: 940 }}>
      <p style={{ color: DIM, font: '400 13px sans-serif', lineHeight: 1.6, margin: '0 0 16px' }}>
        Everything below is written to files on this machine. <b style={{ color: 'var(--text-primary)' }}>Credentials are
        write-only</b> — no endpoint in this app will return a stored token, so these fields are always blank
        on load and submitting a blank one leaves the saved value untouched.
      </p>
      <Credentials d={d} reload={load} />
      <Integrations d={d} reload={load} />
      <Projects d={d} reload={load} />
      <WorkWeek d={d} reload={load} />
      <StoryPoints d={d} reload={load} />
      <OrgTools d={d} reload={load} />
      <Notifications d={d} reload={load} />
      <ModelPricing />
      <Paths />
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
          <div style={{ color: 'var(--red)', font: '400 12px sans-serif', marginTop: 4 }}>
            Your API token is committable right now. This is exactly how ten employee email addresses
            reached this repo's history. Add it to .gitignore before your next commit.
          </div>
        </div>
      )}
      {c.envOverride && (
        <div style={{ ...card, borderColor: GOLD + '66', background: GOLD + '10', marginBottom: 14, font: '400 12px sans-serif', color: 'var(--amber)' }}>
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

      <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border-default)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, font: '400 13px sans-serif', color: 'var(--text-secondary)' }}>
          <Dot ok={d.gh.authed} warn={d.gh.installed && !d.gh.authed} />
          <b>GitHub CLI</b>
          <span style={{ color: DIM, font: `400 12px ${MONO}` }}>
            {d.gh.authed ? `authenticated${d.gh.user ? ' as ' + d.gh.user : ''}`
              : d.gh.installed ? 'installed but not authenticated' : 'not installed'}
          </span>
        </div>
        <div style={{ color: DIM, font: '400 12px sans-serif', marginTop: 5, lineHeight: 1.5 }}>
          GitHub access is the <code style={{ fontFamily: MONO }}>gh</code> CLI's own login — this app never stores a
          GitHub token, so there is nothing to enter here. {d.gh.authed ? '' : <>Run <code style={{ fontFamily: MONO, color: 'var(--text-primary)' }}>gh auth login</code> in a terminal, then reload.</>}
        </div>
      </div>
    </Section>
  )
}

// ---------- Figma + Google Sheets ----------
function Integrations({ d, reload }) {
  const figma = d.credentials.figma || {}
  const sheets = d.credentials.sheets || {}
  const canManageFigma = !figma.envLocked && !!d.eng.companyTools?.enabled
  const [key, setKey] = useState('')
  const [sa, setSa] = useState('')
  const [sheet, setSheet] = useState('')
  const [busy, setBusy] = useState(false)
  const [fTest, setFTest] = useState(null)
  const [sTest, setSTest] = useState(null)

  const run = async fn => { setBusy(true); try { await fn() } catch (e) { toast(e.message, 'error') } finally { setBusy(false) } }

  const saveFigma = () => run(async () => {
    await api.put('/api/figma-capture/token', { token: key })
    setKey(''); toast('Figma key saved', 'success'); reload()
  })
  const clearFigma = () => confirm('Remove the stored Figma API key?') && run(async () => {
    await api.put('/api/figma-capture/token', { token: '' }); toast('removed', 'success'); reload()
  })
  const testFigma = () => run(async () => {
    setFTest(null)
    try { setFTest(await api.post('/api/setup/test/figma', {})) } catch (e) { setFTest({ ok: false, error: e.message }) }
  })

  const saveSheets = () => run(async () => {
    const r = await api.put('/api/setup/credentials', { sheetsServiceAccount: sa.trim() })
    if (r.warning) toast(r.warning, 'error')
    setSa(''); toast('service account saved', 'success'); reload()
  })
  const clearSheets = () => confirm('Remove the stored Google service-account key?') && run(async () => {
    await api.put('/api/setup/credentials', { sheetsServiceAccount: '' }); toast('removed', 'success'); reload()
  })
  const testSheets = () => run(async () => {
    setSTest(null)
    try { setSTest(await api.post('/api/setup/test/sheets', { sheet: sheet.trim() })) } catch (e) { setSTest({ ok: false, error: e.message }) }
  })

  return (
    <Section title="Figma & Google Sheets" sub="used by the ticket dossier pipeline — optional">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 20 }}>

        <div>
          <Field label="Figma personal access token"
            hint={<span><Dot ok={figma.set} /> {figma.set ? `stored (${figma.source})` : 'not set'} — create one at Figma → Settings → Security → Personal access tokens. Read-only file access is enough.</span>}>
            <input type="password" value={key} onChange={e => setKey(e.target.value)} disabled={!canManageFigma}
              autoComplete="new-password" placeholder={figma.set ? '•••••• (leave blank to keep)' : 'figd_...'}
              style={{ ...inp, opacity: canManageFigma ? 1 : 0.5 }} />
          </Field>
          {figma.envLocked && (
            <div style={{ font: '400 12px sans-serif', color: GOLD, marginBottom: 10, lineHeight: 1.5 }}>
              <b>FIGMA_TOKEN is set in the server environment</b> and wins over anything saved here. Unset it there to manage the key from this page.
            </div>
          )}
          {!figma.envLocked && !d.eng.companyTools?.enabled && (
            <div style={{ font: '400 12px sans-serif', color: GOLD, marginBottom: 10, lineHeight: 1.5 }}>
              The key is stored by the Figma Capture routes, which only exist while <b>Company tools</b> is
              on. Enable it below and restart the server to edit the key here.
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button style={primary} disabled={busy || !canManageFigma || !key} onClick={saveFigma}>Save key</button>
            <button style={btn} disabled={busy || !figma.set} onClick={testFigma}>Test</button>
            {figma.set && figma.source === 'file' && canManageFigma && <button style={danger} disabled={busy} onClick={clearFigma}>Remove</button>}
          </div>
          {fTest && <div style={{ font: `400 12px ${MONO}`, color: fTest.ok ? GREEN : RED, marginTop: 8 }}>
            {fTest.ok ? `✓ authenticated as ${fTest.account}` : `✗ ${fTest.error || 'failed'}`}
          </div>}
        </div>

        <div>
          <Field label="Google service-account key"
            hint={<span><Dot ok={sheets.set} /> {sheets.set ? `stored (${sheets.source})` : 'not set'} — paste the JSON key file, or the path to where you saved it. Google Cloud → IAM → Service Accounts → Keys → Add key → JSON.</span>}>
            <textarea value={sa} onChange={e => setSa(e.target.value)} rows={3} autoComplete="off"
              placeholder={sheets.set ? '•••••• (leave blank to keep)' : '{"type":"service_account", …}   ·   or ~/keys/dossier.json'}
              style={{ ...inp, resize: 'vertical', fontFamily: MONO }} />
          </Field>
          {sheets.account && (
            <div style={{ ...card, background: 'var(--bg-inset)', padding: 10, marginBottom: 10 }}>
              <div style={{ font: '400 12px sans-serif', color: DIM, marginBottom: 4 }}>Share every sheet you want read with this address (Viewer is enough):</div>
              <div style={{ font: `600 12px ${MONO}`, color: 'var(--text-primary)', wordBreak: 'break-all' }}>{sheets.account}</div>
            </div>
          )}
          <Field label="Sheet to test against" hint="Optional — paste a sheet URL to check it is actually shared with the address above.">
            <input value={sheet} onChange={e => setSheet(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" style={inp} />
          </Field>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button style={primary} disabled={busy || !sa.trim()} onClick={saveSheets}>Save key</button>
            <button style={btn} disabled={busy || !sheets.set} onClick={testSheets}>Test</button>
            {sheets.set && sheets.source === 'file' && <button style={danger} disabled={busy} onClick={clearSheets}>Remove</button>}
          </div>
          {sTest && <div style={{ font: `400 12px ${MONO}`, color: sTest.ok ? GREEN : RED, marginTop: 8, lineHeight: 1.6 }}>
            {sTest.ok
              ? <>✓ key accepted by Google{sTest.sheet ? ` — read “${sTest.sheet}”` : ''}<br /><span style={{ color: DIM }}>service account: {sTest.account}</span></>
              : <>✗ {sTest.error || 'failed'}</>}
          </div>}
        </div>
      </div>
    </Section>
  )
}

// ---------- projects ----------
const blankProject ={ key: '', name: '', githubRepo: '', jql: '', spField: '', devEmails: [], qaEmails: [], productEmails: [], writes: false }

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
        <div style={{ color: DIM, font: '400 13px sans-serif', lineHeight: 1.6 }}>
          No projects configured. The Delivery section will report “not configured” rather than showing
          anything — which is the honest answer. Everything in <b style={{ color: 'var(--text-primary)' }}>Working Set</b>,
          Harness and Capabilities works without this.
        </div>
      )}
      {list.map(p => (
        <div key={p.key} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '9px 0', borderBottom: '1px solid var(--border-default)', flexWrap: 'wrap' }}>
          <span style={{ font: `600 12px ${MONO}`, color: ACCENT, minWidth: 46 }}>{p.key}</span>
          <span style={{ font: '500 13px sans-serif', color: 'var(--text-primary)', flex: 1, minWidth: 120 }}>{p.name || p.key}</span>
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
        <div style={{ ...card, marginTop: 14, background: 'var(--bg-inset)' }}>
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
            <span style={{ font: '400 13px sans-serif', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              <b style={{ color: 'var(--text-primary)' }}>Allow writes to JIRA and GitHub</b> — lets the dashboard transition tickets
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
              background: w.weekend.includes(i) ? GOLD + '22' : 'var(--bg-surface)',
              borderColor: w.weekend.includes(i) ? GOLD + '77' : 'var(--bg-surface-active)',
              color: w.weekend.includes(i) ? GOLD : 'var(--text-primary)',
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
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--bg-inset)', padding: '6px 8px', borderRadius: 8 }}>
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
  const flag = d.eng.companyTools || { enabled: false, emails: [] }
  const ds = d.eng.designSystem || {}
  const [enabled, setEnabled] = useState(!!flag.enabled)
  const [emails, setEmails] = useState((flag.emails || []).join('\n'))
  const [dsSource, setDsSource] = useState(ds.storybook || ds.package || '')
  const [busy, setBusy] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const asDesignSystem = () => {
    const v = dsSource.trim()
    if (!v) return null
    return /^https?:\/\//i.test(v) ? { storybook: v, package: null } : { package: v, storybook: null }
  }
  const save = async () => {
    setBusy(true)
    try {
      const r = await api.put('/api/setup/eng', {
        companyTools: { enabled, emails: emails.split(/[\s,;]+/).filter(Boolean) },
        designSystem: asDesignSystem(),
      })
      toast(r.restartRequired ? 'saved — restart the server for the tab to appear/disappear' : 'saved', 'success')
      reload()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  const extract = async () => {
    setExtracting(true)
    try {
      const r = await api.post('/api/setup/design-system/extract', asDesignSystem() || {})
      toast(`extracted ${r.count} components from ${r.source}`, 'success')
      reload()
    } catch (e) { toast(e.message, 'error') } finally { setExtracting(false) }
  }
  return (
    <Section title="Company tools" sub="org-specific bundle — Constitution + Figma Capture">
      <p style={{ color: DIM, font: '400 12px sans-serif', margin: '0 0 14px', lineHeight: 1.6 }}>
        The <b style={{ color: 'var(--text-primary)' }}>Constitution</b> reader needs a <code style={{ fontFamily: MONO }}>.wakeel/constitution/</code> knowledge
        base in the repo, and <b style={{ color: 'var(--text-primary)' }}>Figma Capture</b> needs a component catalog extracted from your own
        design system. Both are useless without that layout, so they are off unless this is on. The
        server gates the same flag at mount time — with it off those routes do not exist at all.
      </p>
      <label style={{ display: 'flex', gap: 9, alignItems: 'center', justifyContent: 'flex-start', width: 'fit-content', marginBottom: 12, cursor: 'pointer' }}>
        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} style={{ width: 'auto', flex: '0 0 auto', margin: 0 }} />
        <span style={{ font: '400 13px sans-serif', color: 'var(--text-primary)' }}>Enable the <b style={{ color: 'var(--text-primary)' }}>Company tools</b> tab</span>
      </label>
      <Field label="Restrict to these identities" hint="Optional. Leave empty to enable for whoever is running the dashboard; otherwise the configured JIRA email (or JIRA_EMAIL) must be listed.">
        <textarea value={emails} onChange={e => setEmails(e.target.value)} rows={2} placeholder="you@example.com" style={{ ...inp, resize: 'vertical' }} />
      </Field>
      <Field label="Design system" hint="Your design system — an npm package name (or a path to one), whose exported components and variants are extracted from its type declarations. A https:// URL is treated as a static Storybook build instead. Nothing ships by default; the catalog is generated on this machine.">
        <input value={dsSource} onChange={e => setDsSource(e.target.value)}
          placeholder="@your-org/design-system   ·   or https://your-org.github.io/ds/" style={{ ...inp, fontFamily: MONO }} />
      </Field>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button style={primary} disabled={busy} onClick={save}>Save</button>
        <button disabled={extracting || !dsSource.trim()} onClick={extract}>
          {extracting ? 'extracting…' : 'Extract components'}
        </button>
        <span style={{ font: `400 11px ${MONO}`, color: GOLD }}>tab toggle takes effect on server restart</span>
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
        <span style={{ font: '400 13px sans-serif', color: 'var(--text-secondary)' }}>Desktop notifications for new error / warning Inbox items</span>
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

// ---------- model pricing ----------
const RATE_KEYS = ['in', 'out', 'cacheRead', 'cacheWrite5m', 'cacheWrite1h']
const RATE_LABEL = { in: 'input', out: 'output', cacheRead: 'cache read', cacheWrite5m: 'cache write 5m', cacheWrite1h: 'cache write 1h' }
const rateInp = { ...inp, font: `400 12px ${MONO}`, padding: '6px 8px', textAlign: 'right' }

const blankRule = () => ({ match: '', in: 0, out: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 })

function ModelPricing() {
  const [rules, setRules] = useState(null)
  const [source, setSource] = useState(null)
  const [unpriced, setUnpriced] = useState([])
  const [open, setOpen] = useState({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const load = () => api.get('/api/pricing')
    .then(p => { setRules(p.rules.map(r => ({ ...r }))); setSource(p.source) })
    .catch(e => setErr(e.message))
  useEffect(() => { load() }, [])
  useEffect(() => { api.get('/api/usage').then(u => setUnpriced(u.unpricedModels || [])).catch(() => {}) }, [rules])

  const set = (i, k, v) => setRules(rs => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)))
  const setIntro = (i, k, v) => setRules(rs => rs.map((r, j) => (j === i ? { ...r, intro: { ...r.intro, [k]: v } } : r)))
  const num = v => (v === '' ? '' : Number(v))

  const toggleIntro = (i, on) => setRules(rs => rs.map((r, j) => {
    if (j !== i) return r
    if (!on) { const { intro, intro_until, ...rest } = r; return rest }
    return { ...r, intro_until: '', intro: { in: 0, out: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 } }
  }))

  const save = async () => {
    setBusy(true); setErr('')
    try {
      const clean = rules.map(r => {
        const out = r.id != null && r.id !== '' ? { id: r.id } : { match: r.match }
        for (const k of RATE_KEYS) out[k] = Number(r[k]) || 0
        if (r.intro_until) {
          out.intro_until = r.intro_until
          out.intro = {}
          for (const k of RATE_KEYS) out.intro[k] = Number(r.intro?.[k]) || 0
        }
        return out
      })
      const p = await api.put('/api/pricing', { rules: clean })
      setRules(p.rules.map(r => ({ ...r }))); setSource(p.source)
      toast('Rates saved — every cost on every screen recomputes from these')
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const reset = async () => {
    setBusy(true); setErr('')
    try {
      const p = await api.put('/api/pricing', { rules: null })
      setRules(p.rules.map(r => ({ ...r }))); setSource(p.source)
      toast('Reset to the rates shipped with this build')
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  if (err && !rules) return <Section title="Model pricing" sub="could not load"><div style={{ color: RED, font: `400 12px ${MONO}` }}>{err}</div></Section>
  if (!rules) return <Section title="Model pricing" sub="loading…"><div style={{ color: DIM, font: `400 12px ${MONO}` }}>loading…</div></Section>

  return (
    <Section
      title="Model pricing"
      sub={source === 'stored' ? 'your edited rates' : 'rates shipped with this build'}
      right={<span style={{ display: 'flex', gap: 8 }}>
        <button style={btn} onClick={() => setRules(rs => [...rs, blankRule()])} disabled={busy}>Add rule</button>
        <button style={danger} onClick={reset} disabled={busy || source !== 'stored'} title={source === 'stored' ? 'discard your edits' : 'already on the shipped rates'}>Reset</button>
        <button style={primary} onClick={save} disabled={busy}>Save</button>
      </span>}
    >
      <div style={{ color: DIM, font: '400 12px sans-serif', lineHeight: 1.6, marginBottom: 12 }}>
        USD per 1,000,000 tokens <b style={{ color: 'var(--text-primary)' }}>of that category</b> — output and cache
        rates are listed per model, not derived from the input rate. The first matching rule wins:
        exact <code style={{ font: `400 11px ${MONO}` }}>id</code> matches are tried before
        substring <code style={{ font: `400 11px ${MONO}` }}>match</code> rules, so a dated snapshot can be
        priced separately without a generic rule shadowing it. <b style={{ color: 'var(--text-primary)' }}>A model
        with no rule here is left unpriced</b> — it contributes 0 rather than being billed at some other
        model&apos;s rate, and is listed below so it cannot go unnoticed. Update these by hand when
        Anthropic publishes new rates; sessions already on screen recompute immediately.
      </div>

      {unpriced.length > 0 && (
        <div style={{ ...card, background: 'var(--bg-inset)', borderColor: GOLD + '55', padding: 12, marginBottom: 12 }}>
          <b style={{ color: GOLD, font: `600 12px ${MONO}` }}>{unpriced.length} model{unpriced.length > 1 ? 's' : ''} in your history have no rate</b>
          <div style={{ color: DIM, font: '400 11px sans-serif', margin: '4px 0 6px' }}>
            Their tokens are counted but their cost is not — every total below is short by whatever these
            actually cost. Add a rule for each, or accept the gap knowingly.
          </div>
          <div style={{ font: `400 11px ${MONO}`, color: 'var(--text-primary)' }}>{unpriced.join(', ')}</div>
        </div>
      )}

      {err && <div style={{ color: RED, font: `400 12px ${MONO}`, marginBottom: 10 }}>{err}</div>}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 720 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', font: `600 10px ${MONO}`, letterSpacing: '.08em', textTransform: 'uppercase', color: DIM, padding: '0 6px 6px 0' }}>model</th>
              {RATE_KEYS.map(k => (
                <th key={k} style={{ textAlign: 'right', font: `600 10px ${MONO}`, letterSpacing: '.06em', textTransform: 'uppercase', color: DIM, padding: '0 6px 6px', whiteSpace: 'nowrap' }}>{RATE_LABEL[k]}</th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {rules.map((r, i) => {
              const exact = r.id != null && r.id !== ''
              const hasIntro = !!r.intro_until || r.intro_until === ''
              return (
                <React.Fragment key={i}>
                  <tr>
                    <td style={{ padding: '3px 6px 3px 0' }}>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <select
                          value={exact ? 'id' : 'match'}
                          onChange={e => setRules(rs => rs.map((x, j) => {
                            if (j !== i) return x
                            const sel = x.id ?? x.match ?? ''
                            const { id, match, ...rest } = x
                            return e.target.value === 'id' ? { ...rest, id: sel } : { ...rest, match: sel }
                          }))}
                          style={{ ...inp, width: 78, padding: '5px 4px', font: `400 11px ${MONO}` }}
                          aria-label={`selector kind for rule ${i + 1}`}
                        >
                          <option value="match">match</option>
                          <option value="id">exact</option>
                        </select>
                        <input
                          style={{ ...inp, font: `400 12px ${MONO}`, padding: '6px 8px', minWidth: 200 }}
                          value={exact ? r.id : (r.match ?? '')}
                          onChange={e => set(i, exact ? 'id' : 'match', e.target.value)}
                          placeholder="claude-opus-5"
                          aria-label={`model for rule ${i + 1}`}
                        />
                      </div>
                    </td>
                    {RATE_KEYS.map(k => (
                      <td key={k} style={{ padding: '3px 6px' }}>
                        <input type="number" min="0" step="0.01" style={{ ...rateInp, width: 88 }}
                          value={r[k]} onChange={e => set(i, k, num(e.target.value))}
                          aria-label={`${RATE_LABEL[k]} rate for ${r.id || r.match || `rule ${i + 1}`}`} />
                      </td>
                    ))}
                    <td style={{ padding: '3px 0 3px 6px', whiteSpace: 'nowrap' }}>
                      <button style={{ ...btn, padding: '5px 8px', font: `500 11px ${MONO}` }}
                        onClick={() => setOpen(o => ({ ...o, [i]: !o[i] }))}
                        title="time-limited introductory rates">{open[i] ? '▾' : '▸'} promo</button>
                      <button style={{ ...btn, padding: '5px 8px', marginLeft: 4, color: RED, borderColor: RED + '44' }}
                        onClick={() => setRules(rs => rs.filter((_, j) => j !== i))}
                        aria-label={`remove rule ${i + 1}`}>✕</button>
                    </td>
                  </tr>
                  {open[i] && (
                    <tr>
                      <td colSpan={RATE_KEYS.length + 2} style={{ padding: '0 0 10px' }}>
                        <div style={{ ...card, background: 'var(--bg-inset)', padding: 10 }}>
                          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                            <label style={{ display: 'flex', gap: 6, alignItems: 'center', font: `400 11px ${MONO}`, color: DIM }}>
                              <input type="checkbox" checked={hasIntro} onChange={e => toggleIntro(i, e.target.checked)} />
                              introductory rates until
                            </label>
                            <input
                              style={{ ...inp, width: 130, font: `400 12px ${MONO}`, padding: '6px 8px' }}
                              placeholder="YYYY-MM-DD" value={r.intro_until ?? ''} disabled={!hasIntro}
                              onChange={e => set(i, 'intro_until', e.target.value)}
                              aria-label={`promo cutoff date for ${r.id || r.match || `rule ${i + 1}`}`} />
                            <span style={{ font: '400 11px sans-serif', color: DIM, flex: 1, minWidth: 220 }}>
                              Usage on or before this date prices at the rates below; after it, at the standard
                              rates above. Each day is priced at the rate in effect that day, so history stays
                              correct once the promo ends. Leave the date empty for no promo.
                            </span>
                          </div>
                          {hasIntro && (
                            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                              {RATE_KEYS.map(k => (
                                <label key={k} style={{ font: `400 10px ${MONO}`, color: DIM }}>
                                  <div style={{ marginBottom: 3 }}>{RATE_LABEL[k]}</div>
                                  <input type="number" min="0" step="0.01" style={{ ...rateInp, width: 88 }}
                                    value={r.intro?.[k] ?? 0} onChange={e => setIntro(i, k, num(e.target.value))}
                                    aria-label={`introductory ${RATE_LABEL[k]} rate for ${r.id || r.match || `rule ${i + 1}`}`} />
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </Section>
  )
}
