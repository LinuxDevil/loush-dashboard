import React, { useEffect, useMemo, useRef, useState } from 'react';
import Markdown from '../ui/Markdown.jsx';
import { marked } from 'marked';
import {
  HEAD,
  BODY,
  MONO,
  BB,
  GREEN,
  GOLD,
  RED,
  PURPLE,
  STEEL,
  DIM,
  HI,
  PANEL,
  AVATARS,
  Card,
  CardHead,
  H1,
  Empty,
  Legend,
  Spinner,
  Kpi,
  MiniStat,
  DataTable,
  Pager,
  usePaged,
  pagerBtn,
  TicketLink,
  PRLink,
  PrBadge,
  Checks,
  ProjTag,
  sel,
  miniBtn,
  primaryBtn,
  inp,
  useCopy,
  fx,
  lc,
  fdate,
  fdt,
  initials,
  colorFor,
} from '../eng/ui.jsx';
import { of, stat, pos, pctl, MIN_N, spread, delta as statDelta } from '../eng/stats.js';
import { CountUp } from '../ui/anim.jsx';
import { Scatter, Lines, Split, typeColor } from '../eng/charts.jsx';
import { TimeLens, resolveWindow, prevWindow, shippedIn } from '../eng/TimeLens.jsx';
import { useUrlState } from '../eng/urlState.js';
import Provenance from '../eng/Provenance.jsx';
import AttentionQueue from '../eng/AttentionQueue.jsx';
import ReviewFlow from '../eng/ReviewFlow.jsx';
import Quality from '../eng/Quality.jsx';
import Investment from '../eng/Investment.jsx';
import Predictability from '../eng/Predictability.jsx';
import Compare from '../eng/Compare.jsx';
import Epics from '../eng/Epics.jsx';
import CIHealth from '../eng/CI.jsx';
import Load from '../eng/Load.jsx';
import ReadyBlocked from '../eng/ReadyBlocked.jsx';
import Export from '../eng/Export.jsx';
import CmdK from '../eng/CmdK.jsx';
import { metricsFor, buildRadars, MemberCard, MemberDetail } from '../eng/MemberInsights.jsx';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const BOARD_ORDER = [
  'PM Backlog',
  'Backlog',
  'To Do',
  'In Progress',
  'In Code Review',
  'Ready for QA',
  'Design QA',
  'In QA (Dev)',
  'In QA',
  'Reopen',
  'Re Open',
  'Reopened',
  'Ready for Release',
  'Live',
  'QA Blocked',
  'Closed',
];
const onTeam = (i) => !!(i.assigneeTeam || i.devAssignee);
const accColor = (a) => (a >= 85 ? GREEN : a >= 75 ? GOLD : RED);

const SP_DAYS = [
  [1, 0.4],
  [2, 0.8],
  [3, 1.5],
  [5, 3],
  [8, 6],
  [13, 10],
  [21, 22],
];
const estDaysOf = (p) => (SP_DAYS.find((x) => x[0] === p) || [0, 0])[1];
const stageBudget = (status, pts) => {
  const n = lc(status);
  if (n === 'in progress') return Math.max(0.5, estDaysOf(pts) || 1.5);
  if (n === 'in code review' || n === 'design qa' || n === 'ready for qa' || n === 'in qa (dev)' || n === 'in qa')
    return 1;
  if (n === 'qa blocked') return 0.5;
  return null;
};
const WAITING = [
  'In Code Review',
  'Ready for QA',
  'Design QA',
  'In QA (Dev)',
  'In QA',
  'QA Blocked',
  'Ready for Release',
];

// ---------- identity: "mine" is a real filter, not a dropdown of colleagues ----------
function useMe(members) {
  const [me, setMe] = useState(null);
  const [gh, setGh] = useState(() => localStorage.getItem('eng.me.gh') || '');
  useEffect(() => {
    fetch('/api/eng/me')
      .then((r) => r.json())
      .catch(() => ({}))
      .then((m) => {
        setMe({ email: m.email || '', accountId: m.accountId || '', gh: gh || m.login || '' });
      });
  }, [gh]);
  const resolved = useMemo(() => {
    if (!me) return null;
    const m =
      members.find((x) => x.id === me.accountId) ||
      members.find((x) => (x.email || '').toLowerCase() === (me.email || '').toLowerCase());
    return { ...me, name: m?.name || '' };
  }, [me, members]);
  const setGhHandle = (v) => {
    localStorage.setItem('eng.me.gh', v);
    setGh(v);
  };
  return [resolved, setGhHandle];
}

export default function EngDashboard({ onExit }) {
  const [url, setUrl] = useUrlState({
    route: 'queue',
    project: '',
    win: '30d',
    from: '',
    to: '',
    member: '',
    ticket: '',
    mine: '',
  });
  const [projects, setProjects] = useState([]);
  const [snap, setSnap] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [config, setConfig] = useState(null);
  const [palette, setPalette] = useState(false);
  const route = url.route;
  const project = url.project || null;

  const pollRef = useRef(null);
  const stopPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };
  useEffect(() => stopPoll, []);

  const applySnap = (d) => {
    setSnap(d);
    if (d.projects) setProjects(d.projects);
    setErr(d.available ? null : d.reason || d.error || 'unavailable');
  };

  const startPolling = (key) => {
    stopPoll();
    const qs = key ? `?project=${key}` : '';
    pollRef.current = setInterval(() => {
      fetch(`/api/eng/snapshot${qs}`)
        .then((r) => r.json())
        .then((d) => {
          applySnap(d);
          if (!d.refreshing) stopPoll();
        })
        .catch(() => {});
    }, 3000);
  };

  const load = (refresh, proj) => {
    const key = proj !== undefined ? proj : project;
    setBusy(true);
    const qs = key ? `?project=${key}` : '';
    fetch(refresh ? `/api/eng/refresh${qs}` : `/api/eng/snapshot${qs}`, refresh ? { method: 'POST' } : undefined)
      .then((r) => r.json())
      .then((d) => {
        applySnap(d);
        if (!key && d.team?.key) setUrl({ project: d.team.key });
        // Non-blocking refresh: POST returns immediately with refreshing=true. Poll until the
        // background refresh completes, then update once more with the fresh data.
        if (d.refreshing) {
          setBusy(false);
          startPolling(key);
        }
      })
      .catch((e) => setErr(String(e)))
      .finally(() => setBusy(false));
  };
  useEffect(() => {
    load(false);
  }, []);
  const selectProject = (key) => {
    setUrl({ project: key, member: '' });
    load(false, key);
  };
  const patchIssue = (key, fields) =>
    setSnap((s) => ({ ...s, issues: s.issues.map((i) => (i.key === key ? { ...i, ...fields } : i)) }));

  const S = snap;
  const members = S?.members || [];
  const [me, setGh] = useMe(members);
  const win = useMemo(
    () => resolveWindow(url.win, S?.sprints, url.from, url.to),
    [url.win, url.from, url.to, S?.sprints]
  );

  const NAV = [
    ['queue', 'Queue', '⚑'],
    ['ready', 'Ready / Blocked', '⇉'],
    ['overview', 'Overview', '▦'],
    ['review', 'Review', '⟨⟩'],
    ['quality', 'Quality', '◈'],
    ['investment', 'Investment', '◑'],
    ['sprints', 'Predictability', '◔'],
    ['epics', 'Epics', '⬡'],
    ['ci', 'CI', '⚙'],
    ['projects', 'Projects', '⊞'],
    ['load', 'Load', '☰'],
    ['sprint', 'Board', '▤'],
    ['members', 'Members', '◍'],
    ['okrs', 'OKRs', '◎'],
    ['export', 'Export', '↧'],
  ];
  const shell = (children) => (
    <div style={{ minHeight: '100vh', color: 'var(--text-primary)', fontFamily: BODY, background: 'var(--bg-base)' }}>
      <TopBar
        team={S?.team}
        projects={projects}
        project={project}
        onProject={selectProject}
        nav={NAV}
        onAdd={() => setConfig({ mode: 'new' })}
        onEdit={() => project && project !== 'all' && setConfig({ mode: 'edit', key: project })}
        route={route}
        setRoute={(r) => setUrl({ route: r })}
        url={url}
        setUrl={setUrl}
        win={win}
        sprints={S?.sprints}
        me={me}
        setGh={setGh}
        onExit={onExit}
        onPalette={() => setPalette(true)}
        queueN={(S?.triage || []).length}
      />
      <div
        style={{
          position: 'relative',
          maxWidth: 1320,
          margin: '0 auto',
          padding: '14px 22px 64px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        {S?.available && <Provenance snap={S} onRefresh={() => load(true)} busy={busy} />}
        {children}
        {busy && <LoadingOverlay />}
      </div>
      {config && (
        <ProjectConfig
          mode={config.mode}
          project={config.mode === 'edit' ? projects.find((p) => p.key === config.key) : null}
          onClose={() => setConfig(null)}
          onSaved={(list) => {
            setProjects(list);
            setConfig(null);
          }}
          onSelect={selectProject}
        />
      )}
      {S?.available && (
        <CmdK
          snap={S}
          open={palette}
          setOpen={setPalette}
          routes={NAV.map((n) => [n[0], n[1]])}
          onRoute={(r) => setUrl({ route: r })}
          onOpenTicket={(k) => setUrl({ route: 'sprint', ticket: k })}
        />
      )}
      <style>{`@keyframes pulse{0%,100%{opacity:.35}50%{opacity:.6}} @keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (!S) return shell(<Loading />);
  if (!S.available)
    return shell(<NotWired reason={err} onSaved={() => load(false)} onAddProject={() => setConfig({ mode: 'new' })} />);

  const issues = S.issues || [],
    prs = S.prs || [];
  const shipped = issues.filter((i) => shippedIn(win, i) && onTeam(i));
  const active = issues.filter((i) => i.active && onTeam(i));
  const prByNum = Object.fromEntries(prs.map((p) => [p.num, p]));
  const prsFor = (i) => (i.prNums || []).map((n) => prByNum[n]).filter(Boolean);
  const openTicket = (k) => setUrl({ route: 'sprint', ticket: k });
  const common = {
    snap: S,
    S,
    issues,
    prs,
    members,
    win,
    shipped,
    active,
    prsFor,
    onOpenTicket: openTicket,
    reload: (r) => load(!!r),
  };

  return shell(
    route === 'queue' ? (
      <AttentionQueue
        snap={S}
        me={me}
        mine={url.mine === '1'}
        setMine={(v) => setUrl({ mine: v ? '1' : '' })}
        project={project}
        onOpenTicket={openTicket}
        reload={() => load(true)}
      />
    ) : route === 'ready' ? (
      <ReadyBlocked project={project} onOpenTicket={openTicket} />
    ) : route === 'overview' ? (
      <Overview {...common} />
    ) : route === 'review' ? (
      <ReviewFlow snap={S} project={project} />
    ) : route === 'quality' ? (
      <Quality snap={S} issues={issues} members={members} patch={patchIssue} reload={() => load(false)} />
    ) : route === 'investment' ? (
      <Investment snap={S} issues={issues} onOpenTicket={openTicket} />
    ) : route === 'sprints' ? (
      <Predictability snap={S} onOpenTicket={openTicket} />
    ) : route === 'epics' ? (
      <Epics snap={S} reload={(r) => load(!!r)} onOpenTicket={openTicket} />
    ) : route === 'ci' ? (
      <CIHealth snap={S} />
    ) : route === 'projects' ? (
      <Compare
        snap={S}
        win={win}
        onProject={(k) => {
          selectProject(k);
          setUrl({ route: 'queue', project: k });
        }}
      />
    ) : route === 'load' ? (
      <Load snap={S} />
    ) : route === 'sprint' ? (
      <Sprint
        {...common}
        open={url.ticket}
        setOpen={(k) => setUrl({ ticket: k || '' })}
        member={url.member}
        setMember={(m) => setUrl({ member: m })}
      />
    ) : route === 'members' ? (
      <Members
        {...common}
        member={url.member || members[0]?.id}
        setMember={(m) => setUrl({ member: m })}
        me={me}
        onExport={() => setUrl({ route: 'export' })}
      />
    ) : route === 'okrs' ? (
      <Okrs {...common} />
    ) : (
      <Export snap={S} win={win} me={me} />
    )
  );
}

// ---------------- chrome ----------------
function TopBar({
  team,
  projects,
  project,
  onProject,
  onAdd,
  onEdit,
  route,
  setRoute,
  nav,
  url,
  setUrl,
  win,
  sprints,
  me,
  setGh,
  onExit,
  onPalette,
  queueN,
}) {
  const [idOpen, setIdOpen] = useState(false);
  const repoShort = (r) => (r || '').split('/')[1] || r;
  const activeName =
    project === 'all' ? 'All projects' : projects.find((p) => p.key === project)?.name || team?.name || '';
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 20,
        background: 'var(--bg-base)',
        borderBottom: '1px solid var(--border-default)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '10px 22px 0',
          maxWidth: 1320,
          margin: '0 auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              background: 'var(--accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: 'none',
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <path
                d="M4 20V11M10 20V4M16 20v-6M22 20V8"
                strokeWidth="2.6"
                strokeLinecap="round"
                style={{ stroke: 'var(--bg-surface-active)' }}
              />
            </svg>
          </div>
          <div>
            <div
              style={{
                font: `700 14px ${HEAD}`,
                letterSpacing: '-0.01em',
                color: 'var(--text-primary)',
                lineHeight: 1,
              }}
            >
              Engineering Metrics
            </div>
            <div
              style={{
                font: `500 10px ${MONO}`,
                letterSpacing: '0.08em',
                color: 'var(--text-secondary)',
                marginTop: 3,
                textTransform: 'uppercase',
                height: 11,
              }}
            >
              {activeName}
            </div>
          </div>
        </div>
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            justifyContent: 'flex-end',
          }}
        >
          <TimeLens value={url.win} from={url.from} to={url.to} onChange={setUrl} sprints={sprints} resolved={win} />
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '2px 2px 2px 4px',
              borderRadius: 6,
              background: 'var(--bg-surface-hover)',
              border: '1px solid var(--border-default)',
            }}
          >
            <span
              style={{
                font: `500 9px ${MONO}`,
                letterSpacing: '0.06em',
                color: 'var(--text-secondary)',
                textTransform: 'uppercase',
                paddingLeft: 4,
              }}
            >
              project
            </span>
            <select
              value={project || ''}
              onChange={(e) => onProject(e.target.value)}
              style={{ ...sel, border: 'none', background: 'transparent', paddingRight: 6 }}
            >
              <option value="all">All projects</option>
              {projects.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.jiraProjectKey} ↔ {repoShort(p.githubRepo)}
                </option>
              ))}
            </select>
            {project && project !== 'all' && (
              <button
                onClick={onEdit}
                title="Configure this project"
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 7,
                  border: '1px solid var(--border-default)',
                  background: 'var(--bg-surface)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  fontSize: 12,
                  padding: 0,
                }}
              >
                ⚙
              </button>
            )}
            <button
              onClick={onAdd}
              title="Add a project"
              style={{
                width: 24,
                height: 24,
                borderRadius: 7,
                border: '1px solid var(--border-default)',
                background: 'var(--bg-surface)',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                font: `600 14px ${BODY}`,
                padding: 0,
              }}
            >
              +
            </button>
          </div>
          <button onClick={onPalette} title="jump to a ticket or PR" style={{ ...miniBtn, font: `500 11px ${MONO}` }}>
            ⌘K
          </button>
          <button
            onClick={() => setIdOpen((o) => !o)}
            title="who is “mine”"
            style={{ ...miniBtn, color: me?.gh ? GREEN : GOLD }}
          >
            {me?.gh ? '@' + me.gh : 'set me'}
          </button>
          <button
            onClick={onExit}
            title="back to Claude Code dashboard"
            style={{
              cursor: 'pointer',
              font: `500 12px ${BODY}`,
              color: 'var(--text-secondary)',
              padding: '6px 10px',
              borderRadius: 8,
              border: '1px solid var(--border-default)',
              background: 'transparent',
            }}
          >
            ← Claude
          </button>
        </div>
      </div>
      {idOpen && (
        <div style={{ maxWidth: 1320, margin: '8px auto 0', padding: '0 22px' }}>
          <div
            style={{ ...PANEL, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}
          >
            <span style={{ font: `400 12px ${BODY}`, color: 'var(--text-secondary)' }}>
              JIRA: <b style={{ color: HI }}>{me?.name || me?.email || '—'}</b> · GitHub login (used to resolve “Mine”
              on PR rows):
            </span>
            <input
              defaultValue={me?.gh || ''}
              placeholder="your gh login"
              onKeyDown={(e) => e.key === 'Enter' && (setGh(e.target.value.trim()), setIdOpen(false))}
              style={{ ...inp, width: 180, padding: '5px 9px', fontSize: 12 }}
            />
            <span style={{ font: `400 10px ${MONO}`, color: DIM }}>
              stored locally · nothing about anyone else is ever fetched
            </span>
          </div>
        </div>
      )}
      <nav
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          padding: '8px 22px 6px',
          maxWidth: 1320,
          margin: '0 auto',
          overflowX: 'auto',
        }}
      >
        {nav.map(([id, label, icon]) => {
          const a = route === id;
          return (
            <button
              key={id}
              onClick={() => setRoute(id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 10px',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                font: `500 13px ${BODY}`,
                background: a ? 'var(--bg-surface-active)' : 'transparent',
                color: a ? 'var(--text-primary)' : 'var(--text-secondary)',
                whiteSpace: 'nowrap',
              }}
            >
              <span style={{ fontSize: 11, opacity: 0.9 }}>{icon}</span>
              {label}
              {id === 'queue' && queueN > 0 && (
                <span
                  style={{
                    font: `700 9px ${MONO}`,
                    padding: '1px 5px',
                    borderRadius: 4,
                    background: 'var(--red-bg)',
                    color: RED,
                  }}
                >
                  {queueN}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

// ---------------- OVERVIEW — percentiles, a scatter, and the mine-vs-waiting split ----------------
function Overview({ S, issues, shipped, active, members, prs, win, onOpenTicket }) {
  const [copy, copied] = useCopy();
  const prev = prevWindow(win);
  const shippedPrev = issues.filter((i) => shippedIn(prev, i) && onTeam(i));
  const cyc = of(shipped, (i) => pos(i.delivery));
  const cycPrev = of(shippedPrev, (i) => pos(i.delivery));
  const lead = of(shipped, (i) => pos(i.leadDays));
  const gap = of(
    shipped.filter((i) => i.delivery > 0 && i.leadDays > 0),
    (i) => i.leadDays - i.delivery
  );
  const R = S.review || {};
  const qa = of(shipped, (i) => i.qaCycles);
  const openPrs = prs.filter((p) => p.state !== 'Merged' && p.state !== 'Closed');
  const staleN = issues.filter((i) => i.stale).length;
  const escRate = (S.quality?.escapeRate || []).slice(-1)[0]?.rate;

  const kpis = [
    {
      label: 'Cycle time',
      value: cyc.n ? fx(cyc.p50) + 'd' : '—',
      color: BB,
      sub: spread(cyc),
      n: cyc.n,
      thin: cyc.n < MIN_N,
      delta: statDelta(cyc, cycPrev),
      arr: shipped.map((i) => i.delivery).filter(Boolean),
    },
    {
      label: 'Lead time',
      value: lead.n ? fx(lead.p50) + 'd' : '—',
      color: STEEL,
      sub: `${spread(lead)} · created → live (the queue half)`,
      n: lead.n,
      thin: lead.n < MIN_N,
      arr: shipped.map((i) => i.leadDays),
    },
    {
      label: '1st review',
      value: R.firstReview?.p50 == null ? '—' : fx(R.firstReview.p50) + 'd',
      color: PURPLE,
      sub: `p90 ${fx(R.firstReview?.p90)}d · from the REQUEST, not the push`,
      n: prs.filter((p) => p.firstReviewFromRequestDays != null).length,
    },
    {
      label: 'Merge time',
      value: R.mergeTime?.p50 == null ? '—' : fx(R.mergeTime.p50) + 'd',
      color: GREEN,
      sub: `p90 ${fx(R.mergeTime?.p90)}d`,
      n: prs.filter((p) => p.mergeDays != null).length,
    },
    {
      label: 'QA cycles',
      value: qa.n ? fx(qa.p50) : '—',
      color: GOLD,
      sub: `p90 ${fx(qa.p90)} re-test loops`,
      n: qa.n,
      thin: qa.n < MIN_N,
      arr: shipped.map((i) => i.qaCycles),
    },
    {
      label: 'Escape rate',
      value: escRate == null ? '—' : fx(escRate, 0) + '%',
      color: escRate > 10 ? RED : GREEN,
      sub: 'bugs that reached production',
    },
  ];
  const chips = [
    { v: String(shipped.length), l: 'shipped', c: GREEN },
    { v: String(active.length), l: 'in flight', c: PURPLE },
    { v: String(openPrs.length), l: 'open PRs', c: GOLD },
    { v: String(staleN), l: 'stale', c: staleN ? RED : DIM },
  ];

  const points = shipped
    .filter((i) => i.delivery > 0 && (i.liveAt || i.closedAt))
    .map((i) => ({
      x: Date.parse(i.liveAt || i.closedAt),
      y: i.delivery,
      color: typeColor(i.type),
      type: i.type,
      label: i.key,
      sub: i.assignee?.name,
      key: i.key,
    }));

  const stages = ['In Progress', 'In Code Review', 'Ready for QA', 'In QA (Dev)', 'QA Blocked'].map((st) => {
    const vals = issues.map((i) => i.daysIn?.[st]).filter((v) => v > 0.01);
    const s = stat(vals);
    const budgets = issues
      .filter((i) => (i.daysIn?.[st] || 0) > 0.01)
      .map((i) => stageBudget(st, i.pts))
      .filter(Boolean);
    const budget = budgets.length ? pctl(budgets, 0.5) : stageBudget(st, 3);
    return { st, s, budget, over: s.p90 != null && budget ? +(s.p90 / budget).toFixed(1) : null };
  });
  const stMax = Math.max(1, ...stages.map((x) => x.s.p90 || 0), ...stages.map((x) => x.budget || 0));

  const trend = [];
  for (let k = 5; k >= 0; k--) {
    const d = new Date();
    d.setMonth(d.getMonth() - k);
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const set = issues.filter((i) => i.live && i.liveAt && i.liveAt.slice(0, 7) === m);
    trend.push({
      label: MONTHS[d.getMonth()].slice(0, 3),
      cyc: set.length ? of(set, (i) => pos(i.delivery)).p50 : null,
      lead: set.length ? of(set, (i) => pos(i.leadDays)).p50 : null,
      n: set.length,
    });
  }
  const activePage = usePaged(active, 12);
  const activeSum = shipped.reduce((a, i) => a + i.activeDays, 0);
  const waitSum = shipped.reduce((a, i) => a + i.waitDays, 0);

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <H1
        kicker={win.label}
        title="Team Overview"
        right={
          <div style={{ display: 'flex', gap: 8 }}>
            {chips.map((c, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  padding: '7px 12px',
                  borderRadius: 6,
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-default)',
                }}
              >
                <span style={{ font: `700 14px ${HEAD}`, color: c.c }}>
                  <CountUp value={Number(c.v)} />
                </span>
                <span style={{ font: `400 11px ${BODY}`, color: 'var(--text-secondary)' }}>{c.l}</span>
              </div>
            ))}
          </div>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 10 }}>
        {kpis.map((k, i) => (
          <Kpi key={i} {...k} onCopy={k.arr ? () => copy(JSON.stringify(k.arr), 'k' + i) : undefined} />
        ))}
      </div>

      <Card>
        <CardHead
          title="Cycle time — every ticket, not an average"
          meta={`one dot per shipped ticket · coloured by type · click a dot above p85 · ${cyc.n} tickets`}
          right={
            <button
              style={miniBtn}
              onClick={() =>
                copy(
                  JSON.stringify(
                    shipped.map((i) => ({ key: i.key, cycle: i.delivery, live: i.liveAt, type: i.type })),
                    null,
                    2
                  ),
                  'sc'
                )
              }
            >
              {copied === 'sc' ? '✓ copied' : '{ }'}
            </button>
          }
        />
        <Scatter points={points} p85={cyc.p85} p50={cyc.p50} onPick={(p) => onOpenTicket(p.key)} />
        <div style={{ display: 'flex', gap: 14, marginTop: 8, flexWrap: 'wrap' }}>
          {[...new Set(shipped.map((i) => i.type))].slice(0, 6).map((t) => (
            <Legend key={t} c={typeColor(t)} label={t} />
          ))}
          <span style={{ marginLeft: 'auto', font: `400 11px ${MONO}`, color: DIM }}>
            {points.filter((p) => cyc.p85 != null && p.y > cyc.p85).length} tickets above p85 — those are the
            escalations
          </span>
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 12 }}>
        <Card>
          <CardHead title="Time in stage vs its budget" meta="p50 / p90 per ticket · not a volume bar" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            {stages.map(({ st, s, budget, over }) => (
              <div key={st}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3 }}>
                  <span style={{ width: 118, flexShrink: 0, font: `500 12px ${BODY}`, color: 'var(--text-secondary)' }}>
                    {st}
                  </span>
                  <div
                    style={{
                      flex: 1,
                      position: 'relative',
                      height: 10,
                      borderRadius: 5,
                      background: 'var(--bg-surface-hover)',
                      overflow: 'visible',
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        height: '100%',
                        width: `${((s.p50 || 0) / stMax) * 100}%`,
                        borderRadius: 5,
                        background: colorFor(st),
                        opacity: 0.9,
                      }}
                    />
                    <div
                      style={{
                        position: 'absolute',
                        left: `${((s.p50 || 0) / stMax) * 100}%`,
                        top: 0,
                        height: '100%',
                        width: `${(Math.max(0, (s.p90 || 0) - (s.p50 || 0)) / stMax) * 100}%`,
                        borderRadius: 5,
                        background: colorFor(st),
                        opacity: 0.32,
                      }}
                    />
                    {budget && (
                      <div
                        title={`budget ${budget}d`}
                        style={{
                          position: 'absolute',
                          left: `${(budget / stMax) * 100}%`,
                          top: -3,
                          width: 2,
                          height: 16,
                          background: over > 1 ? RED : GREEN,
                        }}
                      />
                    )}
                  </div>
                  <span
                    style={{
                      width: 96,
                      textAlign: 'right',
                      font: `600 11px ${MONO}`,
                      color: s.n < MIN_N ? 'var(--text-secondary)' : HI,
                    }}
                  >
                    {fx(s.p50)} / {fx(s.p90)}d
                  </span>
                </div>
                <div style={{ marginLeft: 128, font: `400 10px ${MONO}`, color: over > 1.5 ? RED : DIM }}>
                  n={s.n} · budget {budget}d{over ? ` · p90 is ${over}× the budget` : ''}
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border-default)' }}>
            <div
              style={{
                font: `600 10px ${MONO}`,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'var(--text-secondary)',
                marginBottom: 6,
              }}
            >
              Mine vs the queue — shipped in this window
            </div>
            <Split active={activeSum} wait={waitSum} height={11} />
            <div style={{ display: 'flex', gap: 18, marginTop: 7 }}>
              <Legend c={GREEN} label="Active effort (In Progress)" v={fx(activeSum) + 'd'} />
              <Legend c={GOLD} label="Waiting (review · QA · release)" v={fx(waitSum) + 'd'} />
            </div>
            <div style={{ font: `400 10px ${MONO}`, color: DIM, marginTop: 5 }}>
              Cycle time is presented everywhere as a property of the developer.{' '}
              {activeSum + waitSum ? Math.round((waitSum / (activeSum + waitSum)) * 100) : 0}% of it was queue.
            </div>
          </div>
        </Card>

        <Card>
          <CardHead title="Lead vs cycle — 6 months" meta="p50 · the gap is time it sat waiting on us" />
          <Lines
            labels={trend.map((t) => t.label)}
            yFmt={(v) => v + 'd'}
            series={[
              {
                label: 'lead (created → live)',
                color: PURPLE,
                values: trend.map((t) => ({ y: t.lead, note: `n=${t.n}` })),
              },
              {
                label: 'cycle (In Progress → live)',
                color: BB,
                values: trend.map((t) => ({ y: t.cyc, note: `n=${t.n}` })),
              },
            ]}
          />
          <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
            <Legend c={PURPLE} label="lead time" v={fx(lead.p50) + 'd'} />
            <Legend c={BB} label="cycle time" v={fx(cyc.p50) + 'd'} />
            <span style={{ marginLeft: 'auto', font: `400 11px ${MONO}`, color: GOLD }}>
              {gap.n ? `${fx(gap.p50)}d sat in the backlog before anyone started (median, same ${gap.n} tickets)` : ''}
            </span>
          </div>
        </Card>
      </div>

      <div style={{ ...PANEL, padding: '14px 16px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            marginBottom: 12,
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <div style={{ font: `600 14px ${HEAD}`, color: HI }}>Active work · in progress now</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ font: `400 11px ${MONO}`, color: DIM }}>{active.length} active</span>
            {activePage.pages > 1 && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ font: `400 11px ${MONO}`, color: DIM }}>
                  {activePage.page + 1}/{activePage.pages}
                </span>
                <button
                  disabled={activePage.page === 0}
                  onClick={() => activePage.setPage(activePage.page - 1)}
                  style={pagerBtn(activePage.page === 0)}
                >
                  ‹
                </button>
                <button
                  disabled={activePage.page >= activePage.pages - 1}
                  onClick={() => activePage.setPage(activePage.page + 1)}
                  style={pagerBtn(activePage.page >= activePage.pages - 1)}
                >
                  ›
                </button>
              </span>
            )}
          </div>
        </div>
        {active.length === 0 ? (
          <Empty text="Nothing in an active status right now." />
        ) : (
          <ColumnsBoard items={activePage.slice} onOpen={(i) => onOpenTicket(i.key)} />
        )}
      </div>
    </section>
  );
}

// ---------------- shared board bits ----------------
function colsFor(items) {
  const present = [...new Set(items.map((i) => i.status).filter(Boolean))];
  const plc = new Set(present.map(lc));
  const ordered = BOARD_ORDER.filter((s) => plc.has(lc(s)));
  const oset = new Set(ordered.map(lc));
  return [...ordered, ...present.filter((s) => !oset.has(lc(s)))];
}
function IssueTip({ i, children }) {
  const [pos, setPos] = useState(null);
  const rec = i.rec;
  const c = rec?.atRisk ? RED : rec && rec.remaining < 0.5 ? GOLD : GREEN;
  const when = rec
    ? new Date(rec.moveBy).toLocaleString([], {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '';
  const below = pos && pos.top < 210;
  const box = pos
    ? {
        position: 'fixed',
        left: Math.min(pos.left, (typeof window !== 'undefined' ? window.innerWidth : 1400) - 274),
        [below ? 'top' : 'bottom']: below ? pos.bottom + 8 : `calc(100vh - ${pos.top - 8}px)`,
        zIndex: 2147483647,
        width: 258,
        padding: '10px 12px',
        borderRadius: 6,
        background: 'var(--bg-surface)',
        border: `1px solid ${rec ? c : BB}66`,
        boxShadow: 'var(--shadow-md)',
        pointerEvents: 'none',
      }
    : null;
  return (
    <span
      onMouseEnter={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setPos({ left: r.left, top: r.top, bottom: r.bottom });
      }}
      onMouseLeave={() => setPos(null)}
      style={{ position: 'relative', cursor: 'help' }}
    >
      {children}
      {pos && (
        <span style={box}>
          <div
            style={{
              font: `600 10px ${MONO}`,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--text-secondary)',
              marginBottom: 6,
            }}
          >
            {i.key} · in {i.status}
          </div>
          <TipRow label="In this column" value={`${fx(i.inCurrent)}d`} />
          <TipRow
            label="Estimate"
            value={i.estAcc == null ? `${i.pts || 0}pt` : `${i.pts}pt · ${fx(i.estAcc, 0)}% accurate`}
            c={i.estAcc == null ? 'var(--text-primary)' : accColor(i.estAcc)}
          />
          {rec ? (
            <TipRow
              label="Move next"
              value={rec.atRisk ? `→ ${rec.next} · overdue` : `→ ${rec.next} by ${when}`}
              c={c}
            />
          ) : (
            <TipRow label="Status" value="done — no action" />
          )}
          {rec && (
            <div style={{ font: `400 10px ${MONO}`, color: DIM, margin: '5px 0 6px' }}>
              {rec.atRisk
                ? `${fx(Math.abs(rec.remaining))}d over budget`
                : `${fx(rec.remaining)}d of ${fx(rec.budget)}d budget left`}
            </div>
          )}
          <Split active={i.activeDays} wait={i.waitDays} showLabels />
        </span>
      )}
    </span>
  );
}
const TipRow = ({ label, value, c = 'var(--text-primary)' }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '2px 0' }}>
    <span style={{ font: `400 11px ${BODY}`, color: 'var(--text-secondary)' }}>{label}</span>
    <span style={{ font: `600 11px ${MONO}`, color: c, textAlign: 'right' }}>{value}</span>
  </div>
);

function BoardCard({ i, onOpen }) {
  const c = i.rec?.atRisk ? RED : i.rec && i.rec.remaining < 0.5 ? GOLD : 'var(--bg-surface-active)';
  const f = (n) => (n ? n.split(' ')[0] : '—');
  return (
    <IssueTip i={i}>
      <div
        className={onOpen ? 'press' : undefined}
        onClick={onOpen ? () => onOpen(i) : undefined}
        style={{
          padding: '9px 10px',
          borderRadius: 6,
          background: 'var(--bg-surface)',
          border: `1px solid ${c}`,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          cursor: onOpen ? 'pointer' : undefined,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <TicketLink i={i} style={{ font: `600 11px ${MONO}` }} />
          <ProjTag k={i.project} />
          <span style={{ marginLeft: 'auto', font: `500 9px ${MONO}`, color: DIM }}>{fx(i.inCurrent)}d</span>
          {i.rec?.atRisk && <span style={{ font: `600 9px ${MONO}`, color: RED }}>⚠</span>}
        </div>
        {i.parent && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
            <span style={{ font: `600 8px ${MONO}`, color: DIM, flexShrink: 0 }}>↳</span>
            <TicketLink
              i={{ key: i.parent.key, host: i.host }}
              color="var(--text-secondary)"
              style={{ font: `500 9px ${MONO}`, borderBottom: 'none' }}
            >
              {i.parent.key}
            </TicketLink>
            <span
              style={{
                font: `400 9px ${BODY}`,
                color: DIM,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {i.parent.summary}
            </span>
          </div>
        )}
        <div
          style={{
            font: `500 12px ${BODY}`,
            color: 'var(--text-primary)',
            lineHeight: 1.35,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {i.summary}
        </div>
        <Split active={i.activeDays} wait={i.waitDays} height={5} />
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <RoleChip label="Dev" name={f(i.devAssignee?.name)} c={BB} />
          <RoleChip label="QA" name={f(i.qaAssignee?.name)} c={GOLD} />
          <RoleChip label="Now" name={f(i.assignee?.name)} c={GREEN} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ font: `400 10px ${MONO}`, color: 'var(--text-secondary)' }}>
            {i.sprint?.name || 'no sprint'}
          </span>
          <span
            style={{
              font: `600 9px ${MONO}`,
              color: 'var(--text-secondary)',
              padding: '1px 6px',
              borderRadius: 4,
              background: 'var(--bg-surface-active)',
            }}
          >
            {i.pts || 0} pt
          </span>
        </div>
      </div>
    </IssueTip>
  );
}
const RoleChip = ({ label, name, c }) => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      font: `500 9px ${MONO}`,
      padding: '1px 6px',
      borderRadius: 5,
      background: 'var(--bg-base)',
      border: '1px solid var(--border-default)',
    }}
  >
    <span style={{ color: c, fontWeight: 700 }}>{label}</span>
    <span style={{ color: name === '—' ? 'var(--text-tertiary)' : 'var(--text-secondary)' }}>{name}</span>
  </span>
);

function ColumnsBoard({ items, minCol = 232, onOpen }) {
  const cols = colsFor(items);
  if (!items.length) return <Empty text="Nothing here." />;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        overflow: 'auto',
        maxHeight: 'calc(100vh - 250px)',
        paddingBottom: 6,
      }}
    >
      {cols.map((col) => {
        const its = items.filter((i) => lc(i.status) === lc(col));
        return (
          <div
            key={col}
            style={{ flex: `0 0 ${minCol}px`, width: minCol, display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            <div
              style={{
                position: 'sticky',
                top: 0,
                zIndex: 1,
                background: 'var(--bg-surface)',
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                padding: '2px 4px 6px',
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: colorFor(col) }} />
              <span style={{ font: `600 11px ${BODY}`, color: 'var(--text-secondary)' }}>{col}</span>
              <span style={{ font: `500 10px ${MONO}`, color: DIM }}>{its.length}</span>
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                minHeight: 40,
                padding: 6,
                borderRadius: 6,
                background: 'var(--bg-base)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              {its.map((i) => (
                <BoardCard key={i.key} i={i} onOpen={onOpen} />
              ))}
              {its.length === 0 && (
                <div
                  style={{
                    padding: '10px 6px',
                    font: `400 11px ${MONO}`,
                    color: 'var(--bg-surface-active)',
                    textAlign: 'center',
                  }}
                >
                  —
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
function sprintStats(items) {
  const done = items.filter((i) => i.live);
  const cyc = of(done, (i) => pos(i.delivery));
  return [
    ['Tickets', String(items.length), HI],
    ['Story pts', String(items.reduce((a, i) => a + (i.pts || 0), 0)), BB],
    ['Done', `${done.length}/${items.length}`, GREEN],
    ['Bugs', String(items.filter((i) => i.isBug).length), items.some((i) => i.isBug) ? RED : 'var(--text-secondary)'],
    ['Cycle p50/p90', cyc.n ? `${fx(cyc.p50)}/${fx(cyc.p90)}d` : '—', PURPLE],
    [
      'At risk',
      String(items.filter((i) => i.rec?.atRisk).length),
      items.some((i) => i.rec?.atRisk) ? GOLD : 'var(--text-secondary)',
    ],
  ];
}

// ---------------- BOARD (the `board` route is deleted — Sprint strictly dominated it) ----------------
function Sprint({ issues, members, open, setOpen, member, setMember }) {
  const [sid, setSid] = useState(null);
  const memberIds = useMemo(() => new Set(members.map((m) => m.id)), [members]);
  const devScoped = useMemo(
    () => issues.filter((i) => (i.devAssignee && memberIds.has(i.devAssignee.id)) || memberIds.has(i.assignee?.id)),
    [issues, memberIds]
  );
  const order = useMemo(() => {
    const groups = {};
    for (const i of devScoped) {
      const k = i.sprint?.name || '__none__';
      (groups[k] ||= {
        name: i.sprint?.name || null,
        state: i.sprint?.state || '',
        id: i.sprint?.id || 0,
        items: [],
      }).items.push(i);
    }
    return Object.values(groups).sort((a, b) => {
      const aA = /active/i.test(a.state) ? 1 : 0,
        bA = /active/i.test(b.state) ? 1 : 0;
      if (aA !== bA) return bA - aA;
      const an = a.name ? 1 : 0,
        bn = b.name ? 1 : 0;
      if (an !== bn) return bn - an;
      return (b.id || 0) - (a.id || 0) || (b.name || '').localeCompare(a.name || '');
    });
  }, [devScoped]);
  const grp = order.find((g) => (g.name || '__none__') === sid) || order[0];
  const who = member || 'all';
  const items = grp
    ? grp.items.filter((i) => who === 'all' || i.devAssignee?.id === who || i.assignee?.id === who)
    : [];
  const stats = sprintStats(items);
  const openIssue = issues.find((i) => i.key === open);

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <H1
        kicker="sprint board · dev team"
        title="Board"
        right={
          <div style={{ display: 'flex', gap: 8 }}>
            <select
              value={who}
              onChange={(e) => setMember(e.target.value === 'all' ? '' : e.target.value)}
              style={{ ...sel, padding: '9px 14px', font: `600 13px ${BODY}` }}
            >
              <option value="all">All dev team</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <select
              value={grp ? grp.name || '__none__' : ''}
              onChange={(e) => setSid(e.target.value)}
              style={{ ...sel, padding: '9px 14px', font: `600 13px ${BODY}` }}
            >
              {order.map((g) => (
                <option key={g.name || '__none__'} value={g.name || '__none__'}>
                  {g.name || 'No sprint'}
                  {/active/i.test(g.state) ? ' · active' : ''}
                </option>
              ))}
            </select>
          </div>
        }
      />
      {!grp ? (
        <Card>
          <Empty text="No dev-team tickets in any sprint." />
        </Card>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${stats.length},1fr)`, gap: 8 }}>
            {stats.map((s, i) => (
              <div key={i} style={{ ...PANEL, padding: '11px 13px' }}>
                <div style={{ font: `700 16px ${HEAD}`, color: s[2] }}>{s[1]}</div>
                <div
                  style={{ font: `400 9px ${MONO}`, color: DIM, textTransform: 'uppercase', letterSpacing: '0.04em' }}
                >
                  {s[0]}
                </div>
              </div>
            ))}
          </div>
          <div style={{ ...PANEL, padding: '14px 16px' }}>
            <div style={{ font: `400 11px ${MONO}`, color: DIM, marginBottom: 10 }}>
              {items.length} ticket{items.length === 1 ? '' : 's'} · the green/gold bar on every card is MINE vs WAITING
              · click for full detail
            </div>
            <ColumnsBoard items={items} onOpen={(i) => setOpen(i.key)} />
          </div>
        </>
      )}
      {openIssue && <TicketDetail issue={openIssue} onClose={() => setOpen(null)} />}
    </section>
  );
}

// ---------------- MEMBERS — operational facts only. The "Delivery skills" radar is DELETED. ----------------
function Members({ issues, prs, members, member, setMember, prsFor, win, me, onExport }) {
  const mine = issues.filter((i) => i.assignee?.id === member);
  const cur = members.find((m) => m.id === member);
  const isMe = me?.accountId && member === me.accountId;
  const myPrs = useMemo(() => {
    const seen = new Set(),
      out = [];
    for (const i of mine)
      for (const p of prsFor(i))
        if (!seen.has(p.num)) {
          seen.add(p.num);
          out.push(p);
        }
    return out.sort((a, b) =>
      (b.mergedAt || b.closedAt || b.createdAt || '').localeCompare(a.mergedAt || a.closedAt || a.createdAt || '')
    );
  }, [member, issues.length]);
  const metrics = useMemo(
    () => members.map((m) => ({ ...metricsFor(m.id, issues, prs, win), name: m.name })),
    [members, issues, prs, win]
  );
  const radars = useMemo(() => buildRadars(metrics), [metrics]);
  const sel = metrics.find((x) => x.id === member) || metrics[0];
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <H1
        kicker="operational facts · no score, no ranking"
        title="Members"
        right={
          <div style={{ display: 'flex', gap: 8 }}>
            {isMe && (
              <button style={miniBtn} onClick={onExport}>
                Build my impact export →
              </button>
            )}
            <select
              value={member || ''}
              onChange={(e) => setMember(e.target.value)}
              style={{ ...sel, padding: '9px 14px', font: `600 13px ${BODY}`, minWidth: 200 }}
            >
              {members.length === 0 && <option value="">No dev-team members</option>}
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · {m.count} issues
                </option>
              ))}
            </select>
          </div>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 10 }}>
        {metrics.length === 0 && <Empty text="No dev-team members." />}
        {metrics.map((m) => (
          <MemberCard
            key={m.id}
            name={m.name}
            m={m}
            radar={radars[m.id]}
            active={m.id === sel?.id}
            onClick={() => setMember(m.id)}
          />
        ))}
      </div>

      {sel && <MemberDetail name={sel.name} m={sel} radar={radars[sel.id]} win={win} />}

      <div style={{ font: `400 11px ${BODY}`, color: DIM, lineHeight: 1.6 }}>
        Every number here is a JIRA ticket or a GitHub PR the subject can open about themselves, scoped to{' '}
        <b style={{ color: 'var(--text-secondary)' }}>{win.label}</b>. The radar is{' '}
        <b style={{ color: 'var(--text-secondary)' }}>relative</b> — each axis is this person's rank inside this team
        over this window, not an absolute score — and it is flagged low-confidence below {MIN_N} shipped tickets. Cards
        are alphabetical, because a sort order is a scoreboard. Read it to coach and unblock, never to rank.
      </div>

      <DataTable
        title={`Work items · ${cur?.name || '—'}`}
        minWidth={620}
        pageSize={10}
        rows={mine}
        getKey={(r) => r.key}
        initialSort={{ key: 'status', dir: 1 }}
        raw={mine}
        columns={[
          {
            key: 'issue',
            label: 'Issue',
            width: '88px',
            sort: (r) => r.key,
            filter: (r) => r.key + ' ' + r.summary,
            render: (r) => (
              <IssueTip i={r}>
                <TicketLink i={r} style={{ font: `500 12px ${MONO}` }} />
              </IssueTip>
            ),
          },
          {
            key: 'summary',
            label: 'Summary',
            width: '1.7fr',
            sort: (r) => r.summary,
            render: (r) => (
              <span
                style={{
                  font: `400 12px ${BODY}`,
                  color: 'var(--text-secondary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  display: 'block',
                }}
              >
                {r.summary}
              </span>
            ),
          },
          {
            key: 'status',
            label: 'Status',
            width: '96px',
            align: 1,
            sort: (r) => r.status,
            filter: (r) => r.status,
            render: (r) => (
              <span
                style={{
                  font: `600 9px ${MONO}`,
                  padding: '2px 7px',
                  borderRadius: 5,
                  whiteSpace: 'nowrap',
                  background: r.statusColor + '26',
                  color: r.statusColor,
                }}
              >
                {r.status}
              </span>
            ),
          },
          {
            key: 'split',
            label: 'Mine / waiting',
            width: '110px',
            sort: (r) => r.waitDays,
            render: (r) => <Split active={r.activeDays} wait={r.waitDays} />,
          },
          {
            key: 'cycle',
            label: 'Cycle',
            width: '66px',
            align: 1,
            sort: (r) => r.delivery,
            render: (r) => (
              <span style={{ font: `600 12px ${MONO}`, color: HI }}>{r.delivery ? fx(r.delivery) + 'd' : '—'}</span>
            ),
          },
          {
            key: 'prs',
            label: 'PRs',
            width: '54px',
            align: 1,
            sort: (r) => (r.prNums || []).length,
            render: (r) => <span style={{ font: `500 12px ${MONO}`, color: PURPLE }}>{(r.prNums || []).length}</span>,
          },
        ]}
      />

      <DataTable
        title="Pull requests"
        meta="linked to their tickets · checks on every row"
        minWidth={700}
        pageSize={8}
        rows={myPrs}
        getKey={(p) => p.num}
        initialSort={{ key: 'merge', dir: -1 }}
        raw={myPrs}
        columns={[
          {
            key: 'ticket',
            label: 'Ticket',
            width: '86px',
            sort: (p) => p.ticket,
            filter: (p) => p.ticket + ' ' + p.title,
            render: (p) => <span style={{ font: `500 12px ${MONO}`, color: BB }}>{p.ticket}</span>,
          },
          {
            key: 'state',
            label: 'State',
            width: '112px',
            sort: (p) => p.state,
            render: (p) => <PrBadge state={p.state} />,
          },
          {
            key: 'checks',
            label: 'Checks',
            width: '60px',
            align: 1,
            sort: (p) => p.checks || '',
            render: (p) => <Checks state={p.checks} />,
          },
          {
            key: 'title',
            label: 'Title',
            width: '1.9fr',
            sort: (p) => p.title,
            render: (p) => (
              <span
                style={{
                  font: `400 12px ${BODY}`,
                  color: 'var(--text-secondary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  display: 'block',
                }}
              >
                <PRLink pr={p}>#{p.num}</PRLink> {p.title}
              </span>
            ),
          },
          {
            key: 'cycles',
            label: 'Rounds',
            width: '72px',
            align: 1,
            sort: (p) => p.cycles,
            render: (p) => (
              <span style={{ font: `600 12px ${MONO}`, color: p.cycles > 1 ? GOLD : 'var(--text-secondary)' }}>
                {p.cycles}
              </span>
            ),
          },
          {
            key: 'merge',
            label: 'Merge',
            width: '76px',
            align: 1,
            sort: (p) => p.mergeDays ?? 1e9,
            render: (p) => (
              <span style={{ font: `500 12px ${MONO}`, color: p.mergeDays == null ? DIM : HI }}>
                {p.mergeDays == null ? '—' : fx(p.mergeDays) + 'd'}
              </span>
            ),
          },
        ]}
      />
    </section>
  );
}

// ---------------- TICKET DETAIL ----------------
const Sec = ({ title, right, children }) => (
  <div style={{ ...PANEL, padding: '13px 15px' }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
      <div style={{ font: `600 12px ${HEAD}`, color: HI, letterSpacing: '0.02em' }}>{title}</div>
      {right}
    </div>
    {children}
  </div>
);
function insightsFor(i) {
  const out = [];
  if (i.rec) {
    const when = new Date(i.rec.moveBy).toLocaleString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
    out.push(
      i.rec.atRisk
        ? {
            c: RED,
            t: `Overdue in ${i.status} — move to ${i.rec.next} now (${fx(Math.abs(i.rec.remaining))}d over budget)`,
          }
        : {
            c: i.rec.remaining < 0.5 ? GOLD : GREEN,
            t: `Move to ${i.rec.next} by ${when} · ${fx(i.rec.remaining)}d of ${fx(i.rec.budget)}d left`,
          }
    );
  } else if (i.live) out.push({ c: GREEN, t: 'Shipped — no action needed' });
  if (i.waitDays > i.activeDays && i.waitDays > 1)
    out.push({
      c: GOLD,
      t: `${fx(i.waitDays)}d of the ${fx(
        i.activeDays + i.waitDays
      )}d elapsed was WAITING (review / QA), not development`,
    });
  if (i.rework > 0) out.push({ c: GOLD, t: `Reworked / reopened ${i.rework}×` });
  if (i.qaCycles > 1) out.push({ c: GOLD, t: `${i.qaCycles} QA cycles` });
  if (i.stale) out.push({ c: RED, t: i.staleNote || 'Status out of date vs PR' });
  if (i.active && !(i.prNums || []).length) out.push({ c: BB, t: 'No PR linked yet' });
  if (i.estAcc != null && i.estAcc < 75)
    out.push({ c: RED, t: `Estimate error — ${fx(i.estAcc, 0)}% accuracy on a ${i.pts}pt ticket` });
  if (!out.length) out.push({ c: 'var(--text-secondary)', t: 'On track — nothing flagged' });
  return out;
}
/**
 * Status and assignee, written back to JIRA from here.
 *
 * The list of moves comes from JIRA's own workflow rather than from our status model, so what is
 * offered is exactly what will be accepted — a hand-written list would show moves that 400. It is
 * fetched when the menu is opened, not with the ticket, because it depends on who is asking.
 */
function JiraPicker({ label, value, options, loading, error, disabled, disabledWhy, onPick, onOpen }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const toggle = () => {
    if (disabled) return;
    const next = !open;
    setOpen(next);
    setQ('');
    if (next) onOpen();
  };
  // A JIRA project can have 200 assignable people. A scroll list of 200 is a list you give up on.
  const shown = q.trim() ? options.filter((o) => o.name.toLowerCase().includes(q.trim().toLowerCase())) : options;
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        onClick={toggle}
        title={disabled ? disabledWhy : `change ${label} in JIRA`}
        style={{ ...miniBtn, opacity: disabled ? 0.45 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
      >
        {value} ▾
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 4,
            zIndex: 5,
            minWidth: 190,
            maxHeight: 260,
            overflowY: 'auto',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: 7,
            boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
            padding: 4,
          }}
        >
          {loading && <div style={{ font: `400 11px ${MONO}`, color: DIM, padding: '6px 8px' }}>loading…</div>}
          {error && <div style={{ font: `400 11px ${MONO}`, color: RED, padding: '6px 8px' }}>{error}</div>}
          {!loading && !error && options.length > 12 && (
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`filter ${options.length}…`}
              style={{
                width: '100%',
                marginBottom: 4,
                font: `400 11px ${MONO}`,
                padding: '5px 8px',
                borderRadius: 5,
                border: '1px solid var(--border-default)',
                background: 'var(--bg-base)',
                color: 'var(--text-primary)',
              }}
            />
          )}
          {!loading && !error && shown.length === 0 && (
            <div style={{ font: `400 11px ${MONO}`, color: DIM, padding: '6px 8px' }}>
              {options.length ? 'no match' : 'nothing available'}
            </div>
          )}
          {shown.slice(0, 50).map((o) => (
            <button
              key={o.id ?? o.name}
              onClick={() => {
                setOpen(false);
                onPick(o);
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '5px 8px',
                borderRadius: 5,
                border: 0,
                background: 'transparent',
                cursor: 'pointer',
                font: `400 12px ${BODY}`,
                color: 'var(--text-primary)',
              }}
            >
              {o.name}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

function TicketDetail({ issue: i, onClose }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState('');
  const [edit, setEdit] = useState(null);
  const [copy, copied] = useCopy();
  // JIRA write state: what this ticket can be moved to and who it can go to, loaded on demand.
  const [acts, setActs] = useState(null);
  const [actsErr, setActsErr] = useState(null);
  const load = () =>
    fetch(`/api/eng/ticket/${i.key}?project=${i.project}`)
      .then((r) => r.json())
      .then((x) => (x.error ? setErr(x.error) : setD(x)))
      .catch((e) => setErr(String(e)));
  useEffect(() => {
    setD(null);
    setErr(null);
    setEdit(null);
    setActs(null);
    setActsErr(null);
    load();
  }, [i.key, i.project]);
  const loadActs = () => {
    if (acts) return;
    setActsErr(null);
    fetch(`/api/eng/ticket/${i.key}/actions?project=${i.project}`)
      .then((r) => r.json())
      .then((x) => (x.error ? setActsErr(x.error) : setActs(x)))
      .catch((e) => setActsErr(String(e)));
  };
  // The board's snapshot is minutes old, so after a write the drawer trusts its own re-read of the
  // ticket rather than the row it was opened from — otherwise the move appears to have not landed.
  const write = (path, body, kind) => {
    setBusy(kind);
    setErr(null);
    fetch(`/api/eng/ticket/${i.key}/${path}?project=${i.project}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then((r) => r.json())
      .then((x) => {
        if (x.error) return setErr(x.error);
        setActs(null);
        return load();
      })
      .catch((e) => setErr(String(e)))
      .finally(() => setBusy(''));
  };
  const status = d?.status || i.status;
  const assignee = d ? d.assignee : i.assignee;
  const writesOff = acts && acts.writes === false;
  const setArt = (kind, a) => setD((s) => ({ ...s, artifacts: { ...(s?.artifacts || {}), [kind]: a } }));
  const gen = (kind) => {
    setBusy(kind);
    setErr(null);
    fetch(`/api/eng/ticket/${i.key}/generate?project=${i.project}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind }),
    })
      .then((r) => r.json())
      .then((a) => (a.error ? setErr(a.error) : setArt(kind, a)))
      .catch((e) => setErr(String(e)))
      .finally(() => setBusy(''));
  };
  const save = (kind, md) =>
    fetch(`/api/eng/ticket/${i.key}/artifact`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, md }),
    })
      .then((r) => r.json())
      .then((a) => {
        setArt(kind, a);
        setEdit(null);
      })
      .catch((e) => setErr(String(e)));

  const bars = Object.entries(i.daysIn || {})
    .filter(([, v]) => v > 0.01)
    .sort((a, b) => b[1] - a[1]);
  const barMax = Math.max(0.5, ...bars.map((b) => b[1]));
  const kd = [
    ['Type', i.type],
    ['Status', status],
    ['Points', i.pts || '—'],
    ['Sprint', i.sprint?.name || '—'],
    ['Dev', i.devAssignee?.name || '—'],
    ['QA', i.qaAssignee?.name || '—'],
    [
      'Assignee',
      <JiraPicker
        key="as"
        label="assignee"
        value={busy === 'assignee' ? 'saving…' : assignee?.name || 'Unassigned'}
        options={[
          { id: null, name: 'Unassign' },
          ...(acts?.assignees || []).filter((u) => u.id !== assignee?.id),
        ]}
        loading={!acts && !actsErr}
        error={actsErr || (writesOff ? acts.why : null)}
        disabled={busy === 'assignee'}
        onOpen={loadActs}
        onPick={(o) => write('assignee', { accountId: o.id }, 'assignee')}
      />,
    ],
    ['Parent', i.parent?.key || '—'],
  ];
  const metrics = [
    ['Cycle', i.delivery != null ? fx(i.delivery) + 'd' : '—', BB],
    ['Lead', i.leadDays != null ? fx(i.leadDays) + 'd' : '—', STEEL],
    ['Mine', fx(i.activeDays) + 'd', GREEN],
    ['Waiting', fx(i.waitDays) + 'd', GOLD],
    ['QA cycles', String(i.qaCycles), GOLD],
    [
      'Est acc',
      i.estAcc == null ? '—' : fx(i.estAcc, 0) + '%',
      i.estAcc == null ? 'var(--text-secondary)' : accColor(i.estAcc),
    ],
  ];
  const artMeta = {
    ac: { title: 'Acceptance Criteria', noun: 'acceptance criteria' },
    tests: { title: 'Test Cases', noun: 'test cases' },
  };
  const nudge = `${i.assignee?.name || 'team'}: ${i.key} "${i.summary}" has been in ${i.status} for ${fx(
    i.inCurrent
  )} working days${i.rec?.atRisk ? ` — ${fx(Math.abs(i.rec.remaining))}d over its ${fx(i.rec.budget)}d budget` : ''}. ${
    i.url || ''
  }`;

  // ponytail: reuses the app's existing .drawer-overlay / .drawer pair (styles.css) instead of a
  return (
    <div className="drawer-overlay" onClick={onClose} style={{ zIndex: 90 }}>
      <div
        className="drawer"
        onClick={(e) => e.stopPropagation()}
        style={{
          zIndex: 91,
          width: 560,
          maxWidth: '96vw',
          overflowY: 'auto',
          background: 'var(--bg-elevated)',
          padding: '18px 20px 60px',
          gap: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <TicketLink i={i} style={{ font: `600 12px ${MONO}` }} />
              <ProjTag k={i.project} />
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: colorFor(status) }} />
              <JiraPicker
                label="status"
                value={busy === 'transition' ? 'moving…' : status}
                options={(acts?.transitions || []).filter((t) => t.name && t.name !== status)}
                loading={!acts && !actsErr}
                error={actsErr || (writesOff ? acts.why : null)}
                disabled={busy === 'transition'}
                onOpen={loadActs}
                onPick={(t) => write('transition', { to: t.name }, 'transition')}
              />
            </div>
            <div style={{ font: `700 16px ${HEAD}`, color: 'var(--text-primary)', marginTop: 6, lineHeight: 1.3 }}>
              {i.summary}
            </div>
          </div>
          <button style={miniBtn} onClick={() => copy(nudge, 'n')}>
            {copied === 'n' ? '✓' : 'Copy nudge'}
          </button>
          <button onClick={onClose} style={{ ...miniBtn, width: 30, height: 28, padding: 0 }}>
            ✕
          </button>
        </div>

        <Sec title="Key data">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px' }}>
            {kd.map(([k, v]) => (
              <div
                key={k}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 8,
                  borderBottom: '1px solid var(--border-subtle)',
                  padding: '3px 0',
                }}
              >
                <span style={{ font: `400 11px ${BODY}`, color: 'var(--text-secondary)' }}>{k}</span>
                <span
                  style={{
                    font: `600 11px ${MONO}`,
                    color: 'var(--text-primary)',
                    textAlign: 'right',
                    // A control in this slot brings a dropdown with it; clipping the row would
                    // clip the menu, so only plain text gets the ellipsis treatment.
                    ...(typeof v === 'object'
                      ? {}
                      : { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
                  }}
                >
                  {v}
                </span>
              </div>
            ))}
          </div>
        </Sec>

        <Sec title="Metrics">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 12 }}>
            {metrics.map(([l, v, c]) => (
              <div
                key={l}
                style={{
                  padding: '8px 10px',
                  borderRadius: 6,
                  background: 'var(--bg-base)',
                  border: '1px solid var(--border-default)',
                }}
              >
                <div style={{ font: `700 16px ${HEAD}`, color: c }}>{v}</div>
                <div style={{ font: `400 9px ${MONO}`, color: DIM, textTransform: 'uppercase' }}>{l}</div>
              </div>
            ))}
          </div>
          <div style={{ marginBottom: 12 }}>
            <Split active={i.activeDays} wait={i.waitDays} height={10} showLabels />
            <div style={{ font: `400 10px ${MONO}`, color: DIM, marginTop: 4 }}>
              {i.waitDays > 0
                ? `${Math.round(
                    (i.waitDays / (i.activeDays + i.waitDays || 1)) * 100
                  )}% of the elapsed working time was queue — review, QA or release — not development.`
                : 'No waiting time recorded.'}
            </div>
          </div>
          {bars.map(([k, v]) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '2px 0' }}>
              <span
                style={{
                  width: 120,
                  flexShrink: 0,
                  font: `500 11px ${BODY}`,
                  color: WAITING.includes(k) ? GOLD : 'var(--text-secondary)',
                }}
              >
                {k}
              </span>
              <div
                style={{
                  flex: 1,
                  height: 7,
                  borderRadius: 4,
                  background: 'var(--bg-surface-hover)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{ height: '100%', width: `${(v / barMax) * 100}%`, background: colorFor(k), borderRadius: 4 }}
                />
              </div>
              <span style={{ width: 40, textAlign: 'right', font: `600 11px ${MONO}`, color: HI }}>{fx(v)}d</span>
            </div>
          ))}
        </Sec>

        <Sec title="Insights">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {insightsFor(i).map((s, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span style={{ color: s.c, fontSize: 10 }}>●</span>
                <span style={{ font: `400 12px ${BODY}`, color: 'var(--text-secondary)' }}>{s.t}</span>
              </div>
            ))}
          </div>
        </Sec>

        {err && <div style={{ font: `400 12px ${BODY}`, color: RED }}>Failed to load detail: {err}</div>}
        {!d && !err && (
          <div
            style={{
              ...PANEL,
              padding: '13px 15px',
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              color: 'var(--text-secondary)',
            }}
          >
            <Spinner />
            <span style={{ font: `500 12px ${BODY}` }}>Loading content, history & PR context…</span>
          </div>
        )}

        {d && (
          <>
            <Sec title="Ticket content">
              {d.description ? (
                <div
                  style={{
                    font: `400 12px/1.6 ${BODY}`,
                    color: 'var(--text-secondary)',
                    whiteSpace: 'pre-wrap',
                    maxHeight: 260,
                    overflow: 'auto',
                  }}
                >
                  {d.description}
                </div>
              ) : (
                <Empty text="No description." />
              )}
            </Sec>

            {/* Comments were a hairline-rule continuation of the description, so a thread read as
                more ticket body. As cards they are visibly other people talking. */}
            {d.comments?.length > 0 && (
              <Sec title={`Comments (${d.comments.length})`}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {d.comments.slice(-8).map((c, idx) => (
                    <div
                      key={c.id ?? idx}
                      style={{
                        border: '1px solid var(--border-default)',
                        background: 'var(--bg-base)',
                        borderRadius: 8,
                        padding: '10px 12px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span
                          style={{
                            width: 20,
                            height: 20,
                            borderRadius: 5,
                            flexShrink: 0,
                            display: 'grid',
                            placeItems: 'center',
                            background: 'var(--bg-surface-active)',
                            color: 'var(--text-secondary)',
                            font: `700 8px ${HEAD}`,
                          }}
                        >
                          {initials(c.author || '?')}
                        </span>
                        <span style={{ font: `600 11px ${BODY}`, color: 'var(--text-primary)' }}>
                          {c.author || 'unknown'}
                        </span>
                        <span style={{ marginLeft: 'auto', font: `400 10px ${MONO}`, color: DIM }}>{fdate(c.at)}</span>
                      </div>
                      <div
                        style={{
                          font: `400 12px/1.6 ${BODY}`,
                          color: 'var(--text-secondary)',
                          whiteSpace: 'pre-wrap',
                          overflowWrap: 'anywhere',
                        }}
                      >
                        {c.body}
                      </div>
                    </div>
                  ))}
                </div>
                {d.comments.length > 8 && (
                  <div style={{ font: `400 10px ${MONO}`, color: DIM, marginTop: 8 }}>
                    showing the last 8 of {d.comments.length}
                  </div>
                )}
              </Sec>
            )}

            {d.prs?.length > 0 && (
              <Sec title={`Linked PRs (${d.prs.length})`}>
                {d.prs.map((p) => (
                  <div key={p.num} style={{ padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <PRLink pr={{ repo: p.repo, num: p.num }} />
                      <span style={{ font: `500 9px ${MONO}`, color: DIM }}>
                        {p.state} · {p.changedFiles || 0} files
                      </span>
                    </div>
                    <div style={{ font: `400 11px ${BODY}`, color: 'var(--text-secondary)' }}>{p.title}</div>
                  </div>
                ))}
              </Sec>
            )}

            <Sec title="History">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflow: 'auto' }}>
                {!d.history?.length ? (
                  <Empty text="No transitions recorded." />
                ) : (
                  d.history.map((h, idx) => (
                    <div key={idx} style={{ display: 'flex', gap: 8, font: `400 11px ${MONO}` }}>
                      <span style={{ color: DIM, flexShrink: 0, width: 104 }}>{fdt(h.at)}</span>
                      <span style={{ color: 'var(--text-secondary)' }}>
                        {h.field === 'status' ? '' : h.field + ': '}
                        {h.from ? `${h.from} → ` : ''}
                        <span style={{ color: 'var(--text-primary)' }}>{h.to}</span>
                      </span>
                    </div>
                  ))
                )}
              </div>
            </Sec>

            {['ac', 'tests'].map((kind) => {
              const a = d.artifacts?.[kind];
              const editing = edit?.kind === kind;
              return (
                <Sec
                  key={kind}
                  title={artMeta[kind].title}
                  right={
                    <div style={{ display: 'flex', gap: 6 }}>
                      {a && !editing && (
                        <button style={miniBtn} onClick={() => setEdit({ kind, md: a.md })}>
                          edit
                        </button>
                      )}
                      <button style={miniBtn} disabled={busy === kind} onClick={() => gen(kind)}>
                        {busy === kind ? 'generating…' : a ? 'regenerate' : 'generate'}
                      </button>
                    </div>
                  }
                >
                  {busy === kind && (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--text-secondary)' }}>
                      <Spinner />
                      <span style={{ font: `500 12px ${BODY}` }}>Asking claude…</span>
                    </div>
                  )}
                  {!a && busy !== kind && !editing && (
                    <Empty text={`No ${artMeta[kind].noun} yet — generate from the ticket content.`} />
                  )}
                  {editing ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <textarea
                        value={edit.md}
                        onChange={(e) => setEdit({ kind, md: e.target.value })}
                        rows={12}
                        style={{ ...inp, resize: 'vertical', fontFamily: MONO, fontSize: 12 }}
                      />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button style={primaryBtn} onClick={() => save(kind, edit.md)}>
                          save
                        </button>
                        <button style={miniBtn} onClick={() => setEdit(null)}>
                          cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    a && (
                      <>
                        {a.stale && (
                          <div style={{ font: `400 10px ${MONO}`, color: GOLD, marginBottom: 6 }}>
                            ⚠ ticket changed since this was generated — regenerate to refresh
                          </div>
                        )}
                        <Markdown source={a.md} />
                        <div style={{ font: `400 10px ${MONO}`, color: DIM, marginTop: 8 }}>
                          {a.edited ? 'hand-edited' : `generated by ${a.model || 'claude'}`} · {fdate(a.at)}
                        </div>
                      </>
                    )
                  )}
                </Sec>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------- OKRS — no private quarter toggle. It inherits the global Time Lens. ----------------
function Okrs({ S, issues, shipped, prs, win }) {
  const q = `Q${Math.floor(new Date(win.to).getMonth() / 3) + 1}`;
  const quarter = (S.okrs?.[q] ? q : Object.keys(S.okrs || {})[0]) || 'Q3';
  const merged = prs.filter((p) => p.mergedAt);
  const live = issues.filter((i) => i.live);
  const baselineDev = (() => {
    if (!live.length) return of(shipped, (i) => pos(i.dev)).p50 || 1;
    const key = (i) => i.year * 12 + i.month;
    const minK = Math.min(...live.map(key));
    const cohort = live.filter((i) => key(i) === minK);
    return of(cohort, (i) => pos(i.dev)).p50 || of(live, (i) => pos(i.dev)).p50 || 1;
  })();
  const auto = {
    devTime: of(shipped, (i) => pos(i.dev)).p50,
    crTime: of(shipped, (i) => pos(i.cr)).p50,
    estAcc: of(
      shipped.filter((i) => i.estAcc != null),
      (i) => i.estAcc
    ).p50,
    qaCycles: of(shipped, (i) => i.qaCycles).p50,
    stale: issues.filter((i) => i.stale).length,
    cycle: of(shipped, (i) => pos(i.delivery)).p50,
    firstReview: S.review?.firstReview?.p50,
    mergeTime: S.review?.mergeTime?.p50,
    reworkRate: issues.length ? (issues.filter((i) => i.rework > 0).length / issues.length) * 100 : 0,
  };
  const n = {
    devTime: shipped.filter((i) => i.dev > 0).length,
    crTime: shipped.filter((i) => i.cr > 0).length,
    estAcc: shipped.filter((i) => i.estAcc != null).length,
    qaCycles: shipped.length,
    cycle: shipped.filter((i) => i.delivery > 0).length,
    stale: issues.length,
    firstReview: prs.length,
    mergeTime: merged.length,
    reworkRate: issues.length,
  };
  const baseline = { devTime: baselineDev };
  const objs = (S.okrs?.[quarter] || []).map((o) => {
    const measures = o.measures.map((m) => {
      const raw = auto[m.auto];
      const noData = raw == null;
      const v = noData ? 0 : raw;
      const unit = m.unit || '';
      const target =
        m.reducePct != null ? +((baseline[m.baselineOf] || 0) * (1 - m.reducePct / 100)).toFixed(2) : m.target;
      const dec = unit === '%' ? 0 : m.auto === 'stale' ? 0 : 1;
      const suffix = unit === '%' ? '%' : unit === 'd' ? 'd' : '';
      let pct;
      if (noData) pct = 0;
      else if (m.dir === 'up') pct = target ? Math.min(100, (v / target) * 100) : 0;
      else if (target === 0) pct = v <= 0 ? 100 : Math.max(0, 100 - v * 33);
      else pct = v <= target ? 100 : Math.max(0, Math.min(100, (target / v) * 100));
      const thin = (n[m.auto] || 0) < MIN_N;
      const color =
        noData || thin ? 'var(--text-secondary)' : pct >= 90 ? GREEN : pct >= 60 ? BB : pct >= 40 ? GOLD : RED;
      return {
        ...m,
        src: 'p50',
        n: n[m.auto] || 0,
        thin,
        note:
          (m.reducePct != null ? `${m.note} (baseline ${fx(baseline[m.baselineOf])}d)` : m.note) +
          (noData ? ' · no data in this window' : ''),
        curTxt: noData ? '—' : fx(v, dec) + suffix,
        tgtTxt: fx(target, dec) + suffix,
        pct: Math.round(pct),
        color,
      };
    });
    const vals = measures.map((m) => m.pct);
    return { ...o, measures, pct: Math.round(pctl(vals, 0.5) ?? 0) };
  });
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <H1
        kicker={`${quarter} · measured over ${win.label}`}
        title="Objectives & Key Results"
        right={
          <span style={{ font: `400 11px ${MONO}`, color: GOLD, maxWidth: 380, textAlign: 'right', lineHeight: 1.5 }}>
            Every measure is a MEDIAN over the Time Lens window. The old private Q3/Q4 toggle is gone — it relabelled
            objectives without moving the data.
          </span>
        }
      />
      {objs.map((o, oi) => (
        <div key={oi} style={{ ...PANEL, padding: '18px 20px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 18,
              flexWrap: 'wrap',
              marginBottom: 14,
            }}
          >
            <div style={{ maxWidth: 600 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 5 }}>
                <span
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 8,
                    background: o.color + '26',
                    color: o.color,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 13,
                  }}
                >
                  ◎
                </span>
                <span style={{ font: `700 16px ${HEAD}`, color: HI }}>{o.title}</span>
              </div>
              <div style={{ font: `400 12px ${BODY}`, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{o.def}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
              <div style={{ textAlign: 'right' }}>
                <div style={{ font: `700 20px ${HEAD}`, color: o.color }}>{o.pct}%</div>
                <div style={{ font: `400 10px ${MONO}`, color: DIM }}>objective</div>
              </div>
              <svg width="60" height="60" viewBox="0 0 60 60">
                <circle
                  cx="30"
                  cy="30"
                  r="24"
                  fill="none"
                  strokeWidth="6"
                  style={{ stroke: 'var(--text-secondary)' }}
                />
                <circle
                  cx="30"
                  cy="30"
                  r="24"
                  fill="none"
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeDasharray="150.8"
                  strokeDashoffset={(150.8 * (1 - o.pct / 100)).toFixed(1)}
                  transform="rotate(-90 30 30)"
                  style={{ stroke: o.color }}
                />
              </svg>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {o.measures.map((m, mi) => (
              <div
                key={mi}
                style={{
                  padding: '12px 14px',
                  borderRadius: 6,
                  background: 'var(--bg-base)',
                  border: '1px solid var(--border-default)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 12,
                    marginBottom: 9,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                      <span style={{ font: `500 13px ${BODY}`, color: 'var(--text-primary)' }}>{m.t}</span>
                      <span
                        style={{
                          font: `600 8px ${MONO}`,
                          letterSpacing: '0.04em',
                          padding: '1px 6px',
                          borderRadius: 4,
                          background: 'var(--bg-surface-active)',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        {m.src} · n={m.n}
                      </span>
                      {m.thin && (
                        <span style={{ font: `600 8px ${MONO}`, color: GOLD }}>n&lt;{MIN_N} — not a trend</span>
                      )}
                    </div>
                    <div style={{ font: `400 11px ${MONO}`, color: DIM }}>{m.note}</div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <span style={{ font: `700 14px ${HEAD}`, color: HI }}>{m.curTxt}</span>
                    <span style={{ font: `400 11px ${MONO}`, color: DIM }}> / {m.tgtTxt}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                  <div
                    style={{
                      flex: 1,
                      height: 6,
                      borderRadius: 4,
                      background: 'var(--bg-surface-hover)',
                      overflow: 'hidden',
                    }}
                  >
                    <div style={{ height: '100%', width: `${m.pct}%`, borderRadius: 4, background: m.color }} />
                  </div>
                  <span style={{ width: 38, textAlign: 'right', font: `600 11px ${MONO}`, color: m.color }}>
                    {m.pct}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      {objs.length === 0 && (
        <Card>
          <Empty text="No objectives defined for this quarter." />
        </Card>
      )}
    </section>
  );
}

// ---------------- config / empty states ----------------
const ROLES = ['dev', 'qa', 'product'];
function ProjectConfig({ mode, project, onClose, onSaved, onSelect }) {
  const isEdit = mode === 'edit';
  const [f, setF] = useState({
    name: project?.name || '',
    jiraProjectKey: project?.jiraProjectKey || '',
    githubRepo: project?.githubRepo || '',
    jiraHost: project?.jiraHost || '',
  });
  const [members, setMembers] = useState(() => {
    const out = [];
    for (const [role, arr] of [
      ['dev', project?.dev],
      ['qa', project?.qa],
      ['product', project?.product],
    ])
      for (const email of arr || []) out.push({ email, role });
    return out.length ? out : [{ email: '', role: 'dev' }];
  });
  const [err, setErr] = useState(null),
    [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setM = (i, k, v) => setMembers(members.map((m, j) => (j === i ? { ...m, [k]: v } : m)));
  const submit = () => {
    setBusy(true);
    setErr(null);
    const url = isEdit ? `/api/eng/projects/${project.key}` : '/api/eng/projects';
    const body = {
      name: f.name,
      githubRepo: f.githubRepo,
      jiraHost: f.jiraHost || undefined,
      members: members.filter((m) => m.email.trim()),
      ...(isEdit ? {} : { jiraProjectKey: f.jiraProjectKey }),
    };
    fetch(url, {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'failed');
        onSaved(d.projects);
        onSelect((isEdit ? project.jiraProjectKey : f.jiraProjectKey).toUpperCase());
      })
      .catch((e) => setErr(String(e.message || e)))
      .finally(() => setBusy(false));
  };
  const field = (label, key, ph, dis) => (
    <label style={{ display: 'block' }}>
      <div
        style={{
          font: `600 10px ${MONO}`,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          color: 'var(--text-secondary)',
          marginBottom: 5,
        }}
      >
        {label}
      </div>
      <input
        value={f[key]}
        onChange={set(key)}
        placeholder={ph}
        disabled={dis}
        style={{ ...inp, opacity: dis ? 0.5 : 1 }}
      />
    </label>
  );
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'var(--bg-base)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ ...PANEL, width: 500, maxWidth: '94vw', maxHeight: '90vh', overflowY: 'auto', padding: 22 }}
      >
        <div style={{ font: `700 16px ${HEAD}`, color: 'var(--text-primary)', marginBottom: 4 }}>
          {isEdit ? `Configure ${project.jiraProjectKey}` : 'Add a project'}
        </div>
        <div style={{ font: `400 12px ${BODY}`, color: 'var(--text-secondary)', marginBottom: 16 }}>
          Ties a GitHub repo to a JIRA board and defines the team by role. Persisted server-side.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {field('Name', 'name', 'e.g. Transport Web')}
            {field('JIRA project key', 'jiraProjectKey', 'e.g. TRN', isEdit)}
          </div>
          {field('GitHub repo (owner/name)', 'githubRepo', 'e.g. your-org/your-repo')}
          {field('JIRA host', 'jiraHost', 'your-org.atlassian.net')}
        </div>
        <div
          style={{
            font: `600 10px ${MONO}`,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            color: 'var(--text-secondary)',
            margin: '18px 0 8px',
          }}
        >
          Team members & roles
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {members.map((m, i) => (
            <div key={i} style={{ display: 'flex', gap: 7 }}>
              <input
                value={m.email}
                onChange={(e) => setM(i, 'email', e.target.value)}
                placeholder="name@example.com"
                style={{ ...inp, flex: 1 }}
              />
              <select
                value={m.role}
                onChange={(e) => setM(i, 'role', e.target.value)}
                style={{ ...inp, width: 108, flex: 'none', cursor: 'pointer' }}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <button
                onClick={() => setMembers(members.filter((_, j) => j !== i))}
                style={{
                  width: 34,
                  flexShrink: 0,
                  borderRadius: 6,
                  border: '1px solid var(--border-default)',
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={() => setMembers([...members, { email: '', role: 'dev' }])}
          style={{
            marginTop: 8,
            padding: '6px 12px',
            borderRadius: 8,
            border: '1px dashed var(--border-default)',
            background: 'transparent',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            font: `500 12px ${BODY}`,
          }}
        >
          + Add member
        </button>
        {err && <div style={{ marginTop: 12, font: `400 12px ${BODY}`, color: RED }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9, marginTop: 18 }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 15px',
              borderRadius: 6,
              border: '1px solid var(--border-default)',
              background: 'transparent',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              font: `500 13px ${BODY}`,
            }}
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy || (!isEdit && (!f.jiraProjectKey || !f.githubRepo))}
            style={{
              ...primaryBtn,
              padding: '8px 15px',
              fontSize: 13,
              background: busy ? 'var(--bg-surface-active)' : primaryBtn.background,
            }}
          >
            {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Add project'}
          </button>
        </div>
      </div>
    </div>
  );
}
function CredsForm({ onSaved }) {
  const [f, setF] = useState({ email: '', token: '' }),
    [err, setErr] = useState(null),
    [busy, setBusy] = useState(false);
  const submit = () => {
    setBusy(true);
    setErr(null);
    fetch('/api/eng/creds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(f),
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'failed');
        onSaved();
      })
      .catch((e) => setErr(String(e.message || e)))
      .finally(() => setBusy(false));
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 4 }}>
      <input
        value={f.email}
        onChange={(e) => setF({ ...f, email: e.target.value })}
        placeholder="atlassian email"
        style={inp}
      />
      <input
        value={f.token}
        onChange={(e) => setF({ ...f, token: e.target.value })}
        placeholder="API token"
        type="password"
        style={inp}
      />
      {err && <div style={{ font: `400 12px ${BODY}`, color: RED }}>{err}</div>}
      <button
        onClick={submit}
        disabled={busy || !f.email || !f.token}
        style={{ ...primaryBtn, alignSelf: 'flex-start', padding: '8px 16px', fontSize: 13 }}
      >
        {busy ? 'Saving…' : 'Save & connect'}
      </button>
    </div>
  );
}
function Loading() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <span className="skel" style={{ width: 220, height: 30, borderRadius: 6 }} />
        <span className="skel" style={{ width: 260, height: 30, borderRadius: 6 }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 10 }}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <span key={i} className="skel" style={{ height: 78, borderRadius: 6 }} />
        ))}
      </div>
      <span className="skel" style={{ height: 260, borderRadius: 8 }} />
      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 12 }}>
        <span className="skel" style={{ height: 200, borderRadius: 8 }} />
        <span className="skel" style={{ height: 200, borderRadius: 8 }} />
      </div>
    </div>
  );
}
function LoadingOverlay() {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 40,
        background: 'var(--bg-base)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: 130,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 16px',
          borderRadius: 6,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-default)',
        }}
      >
        <Spinner />
        <span style={{ font: `500 12px ${BODY}`, color: 'var(--text-primary)' }}>Updating…</span>
      </div>
    </div>
  );
}
function NotWired({ reason, onSaved, onAddProject }) {
  return (
    <div style={{ ...PANEL, padding: 28, maxWidth: 560, margin: '40px auto' }}>
      <div style={{ font: `700 16px ${HEAD}`, color: 'var(--text-primary)', marginBottom: 8 }}>
        Connect JIRA to go live
      </div>
      <div style={{ font: `400 13px ${BODY}`, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 16 }}>
        GitHub is already live via the <code style={{ color: BB }}>gh</code> CLI. Paste an Atlassian email + API token
        below — saved server-side, gitignored.
        {reason && reason !== 'no-jira-token' ? <div style={{ color: RED, marginTop: 6 }}>Error: {reason}</div> : null}
      </div>
      <CredsForm onSaved={onSaved} />
      <div
        style={{
          borderTop: '1px solid var(--border-default)',
          paddingTop: 16,
          marginTop: 18,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div style={{ font: `400 12px ${BODY}`, color: 'var(--text-secondary)' }}>
          No project yet, or need a different board?
        </div>
        <button onClick={onAddProject} style={miniBtn}>
          + Add project
        </button>
      </div>
    </div>
  );
}
