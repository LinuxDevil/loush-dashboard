import React from 'react'
import { HEAD, BODY, MONO, BB, GREEN, GOLD, RED, PURPLE, DIM, HI, Card, CardHead, Empty, H1, DataTable, Kpi, miniBtn, useCopy, fdt, fx } from './ui.jsx'

// §11 — a red main blocks all six of the Lead's engineers at once and was 100% invisible. Flaky = the SAME
// head SHA produced both a failure and a success. Red main also feeds a severity-0 row into the Attention Queue.
export default function CI({ snap }) {
  const [copy, copied] = useCopy()
  const repos = snap.ci || []
  const red = repos.filter(r => r.red)
  const flaky = repos.flatMap(r => (r.flaky || []).map(f => ({ ...f, repo: r.repo, project: r.project })))
  const bug = f => `## Flaky test: ${f.job}\n\nWorkflow: ${f.workflow}\nRepo: ${f.repo}\n\nThis job failed and then passed on the SAME head SHA ${f.flakes} time(s) in the last 50 default-branch runs.\nSHAs: ${(f.shas || []).join(', ')}\n\nA flaky job is a broken signal: it teaches the team to re-run instead of read the failure.`

  return <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <H1 kicker="default branch · last 50 runs" title="CI Health" right={<span style={{ font: `400 11px ${MONO}`, color: DIM }}>30m cache · gh api</span>} />

    {!snap.ghAvailable && <Card style={{ borderColor: 'rgba(242,119,122,0.3)' }}><span style={{ font: `500 12px ${BODY}`, color: RED }}>gh is not authenticated — this page is EMPTY, not green. Run `gh auth login`.</span></Card>}
    {!!red.length && <Card style={{ borderColor: 'rgba(242,119,122,0.45)', background: 'rgba(242,119,122,0.07)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ font: `700 16px ${HEAD}`, color: RED }}>⚑ main is RED</span>
        {red.map(r => <span key={r.repo} style={{ font: `500 12px ${BODY}`, color: '#e7c0c1' }}>
          {r.repo}@{r.branch} — broken by <b>{r.brokeIt || 'unknown'}</b> ({r.lastRun?.name}) ·{' '}
          <a href={r.lastRun?.url} target="_blank" rel="noopener noreferrer" style={{ color: RED }}>open run ↗</a>
        </span>)}
      </div>
    </Card>}

    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, repos.length)},1fr)`, gap: 12 }}>
      {!repos.length && <Card><Empty text="No CI data — no configured repo returned runs." /></Card>}
      {repos.map(r => <Card key={r.repo}>
        <CardHead title={r.repo.split('/')[1] || r.repo} meta={`${r.branch} · ${r.total} runs`} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8, marginBottom: 12 }}>
          <Kpi label="Failure rate" value={r.failureRate == null ? '—' : fx(r.failureRate, 0) + '%'} color={(r.failureRate || 0) > 20 ? RED : (r.failureRate || 0) > 10 ? GOLD : GREEN} sub={`${r.failures} of ${r.total} runs red`} />
          <Kpi label="Time to green" value={r.medianTimeToGreenHours == null ? '—' : fx(r.medianTimeToGreenHours, 1) + 'h'} color={GOLD} sub="median working hours red → green" />
          <Kpi label="Run duration" value={r.medianRunMins == null ? '—' : fx(r.medianRunMins, 0) + 'm'} color={BB} sub="median" />
          <Kpi label="Status" value={r.red ? 'RED' : 'green'} color={r.red ? RED : GREEN} sub={r.lastRun ? `last: ${r.lastRun.name} · ${fdt(r.lastRun.at)}` : ''} />
        </div>
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
          {(r.runs || []).slice(0, 20).reverse().map(run => <a key={run.id} href={run.url} target="_blank" rel="noopener noreferrer" title={`${run.name} · ${run.conclusion} · ${run.actor} · ${fdt(run.at)}`}
            style={{ width: 12, height: 20, borderRadius: 3, background: run.conclusion === 'success' ? GREEN : run.conclusion === 'failure' ? RED : '#4c5768', opacity: 0.85, display: 'block' }} />)}
        </div>
        <div style={{ font: `400 9.5px ${MONO}`, color: DIM, marginTop: 6 }}>oldest → newest · {r.flakyShaCount || 0} SHA(s) both failed and passed</div>
      </Card>)}
    </div>

    <DataTable title="Flaky jobs" meta="failed then passed on the SAME head SHA — a broken signal, not a broken build" minWidth={720} pageSize={8}
      rows={flaky} getKey={f => f.repo + f.job} initialSort={{ key: 'flakes', dir: -1 }} raw={flaky}
      columns={[
        { key: 'job', label: 'Job', width: '1.8fr', sort: f => f.job, filter: f => f.job + ' ' + f.workflow, render: f => <span style={{ font: `600 12px ${BODY}`, color: HI, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>{f.job}</span> },
        { key: 'wf', label: 'Workflow', width: '1.2fr', sort: f => f.workflow, render: f => <span style={{ font: `400 11px ${MONO}`, color: '#93a6bb' }}>{f.workflow}</span> },
        { key: 'repo', label: 'Repo', width: '1fr', sort: f => f.repo, render: f => <span style={{ font: `400 11px ${MONO}`, color: DIM }}>{f.repo.split('/')[1]}</span> },
        { key: 'flakes', label: 'Flakes', width: '70px', align: 1, sort: f => f.flakes, render: f => <span style={{ font: `700 13px ${MONO}`, color: GOLD }}>{f.flakes}</span> },
        { key: 'shas', label: 'SHAs', width: '1.2fr', sort: f => (f.shas || []).length, render: f => <span style={{ font: `400 10px ${MONO}`, color: DIM }}>{(f.shas || []).join(' ')}</span> },
        { key: 'act', label: '', width: '150px', align: 1, render: f => <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <a href={f.lastUrl} target="_blank" rel="noopener noreferrer" style={{ ...miniBtn, textDecoration: 'none', display: 'inline-block' }}>Open</a>
          <button style={miniBtn} onClick={e => { e.stopPropagation(); copy(bug(f), f.job) }}>{copied === f.job ? '✓' : 'File bug'}</button></span> },
      ]} />
  </section>
}
