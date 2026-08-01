import React, { useEffect, useState } from 'react';
import ResourceSection from './sections/ResourceSection.jsx';
import CustomizeSection from './sections/CustomizeSection.jsx';
import McpSection from './sections/McpSection.jsx';
import HooksSection from './sections/HooksSection.jsx';
import ArtifactsSection from './sections/ArtifactsSection.jsx';
import Overview from './sections/Overview.jsx';
import HealthSection from './sections/HealthSection.jsx';
import UsageDetail from './sections/UsageDetail.jsx';
import LiveSection from './sections/LiveSection.jsx';
import TeamsSection from './sections/TeamsSection.jsx';
import ProjectsSection from './sections/ProjectsSection.jsx';
import ChatSection from './sections/ChatSection.jsx';
import CompareSection from './sections/CompareSection.jsx';
import ResearchSection from './sections/ResearchSection.jsx';
import DocsSection from './sections/DocsSection.jsx';
import HarnessSection from './sections/HarnessSection.jsx';
import ContextExplorerSection from './sections/ContextExplorerSection.jsx';
import GovernanceSection from './sections/GovernanceSection.jsx';
import ReliabilitySection from './sections/ReliabilitySection.jsx';
import LibrarySection from './sections/LibrarySection.jsx';
import PromptStudio from './sections/PromptStudio.jsx';
import PromptQuality from './sections/PromptQuality.jsx';
import FlowSection from './sections/FlowSection.jsx';
import RunsSection from './sections/RunsSection.jsx';
import Hub from './ui/Hub.jsx';
import InsightsSection from './sections/InsightsSection.jsx';
import InboxSection from './sections/InboxSection.jsx';
import BugsSection from './sections/BugsSection.jsx';
import QualitySection from './sections/QualitySection.jsx';
import BoardSection from './sections/BoardSection.jsx';
import QuickActions from './sections/QuickActions.jsx';
import DeliverySection from './sections/DeliverySection.jsx';
import WorkingSet from './sections/WorkingSet.jsx';
import SetupSection from './sections/SetupSection.jsx';
import TicketSection from './sections/TicketSection.jsx';
import ConstitutionSection from './company/ConstitutionSection.jsx';
import FigmaCaptureSection from './company/FigmaCaptureSection.jsx';
import DesignMapSection from './company/DesignMapSection.jsx';
import CapabilityLedger, { Inventory } from './sections/CapabilityLedger.jsx';
import SessionsSection from './sections/SessionsSection.jsx';
import ForensicsSection from './sections/ForensicsSection.jsx';
import UsagePanel from './sections/UsagePanel.jsx';
import TeamBaseline from './sections/TeamBaseline.jsx';
import Palette from './ui/Palette.jsx';
import TodoDock from './ui/TodoDock.jsx';
import TodosSection from './sections/TodosSection.jsx';
import { api, forceFresh } from './lib/api.js';


const BASE_SECTIONS = [
  {
    id: 'overview',
    label: 'Overview',
    icon: '◧',
    kicker: 'Dashboard',
    title: 'What needs a human today',
    el: <Overview />,
  },
  {
    id: 'live',
    label: 'Now',
    icon: '◉',
    kicker: 'Dashboard',
    title: 'Now — sessions running right now',
    el: <LiveSection />,
  },
  {
    id: 'workingset',
    label: 'Working Set',
    icon: '◈',
    kicker: 'Dashboard',
    title: 'Working Set — what the agent did to your code',
    el: <WorkingSet />,
  },
  {
    id: 'todos',
    label: 'Todos',
    icon: '☑',
    kicker: 'Dashboard',
    title: 'Todos — one day, seven stages, filed by file',
    el: <TodosSection />,
  },
  {
    id: 'inbox',
    label: 'Inbox',
    icon: '◎',
    kicker: 'Dashboard',
    title: 'Attention inbox — work + harness',
    el: <InboxSection />,
  },
  {
    id: 'delivery',
    label: 'Delivery',
    icon: '▤',
    kicker: 'Delivery',
    title: 'Delivery — JIRA, GitHub, CI',
    el: <DeliverySection />,
  },
  {
    id: 'ticket',
    label: 'Ticket',
    icon: '◨',
    kicker: 'Delivery',
    title: 'Ticket — open a key, plan the work',
    el: <TicketSection />,
  },
  { id: 'projects', label: 'Projects', icon: '⊞', kicker: 'Workspaces', title: 'Projects', el: <ProjectsSection /> },
  {
    id: 'chat',
    label: 'Chat',
    icon: '⌨',
    kicker: 'Live',
    title: 'Talk to Claude Code',
    el: (
      <Hub
        items={[
          { label: 'Chat', el: <ChatSection /> },
          { label: 'Compare', el: <CompareSection /> },
          { label: 'Deep Research', el: <ResearchSection /> },
          { label: 'Documents', el: <DocsSection /> },
          { label: 'Insights', el: <InsightsSection /> },
        ]}
      />
    ),
  },
  {
    id: 'workflows',
    label: 'Workflows',
    icon: '▦',
    kicker: 'Workflows',
    title: 'Agent work — board, runs, quality & bugs',
    el: (
      <Hub
        items={[
          { label: 'Quick Actions', el: <QuickActions /> },
          { label: 'Task Board', el: <BoardSection /> },
          { label: 'Loush Runs', el: <RunsSection /> },
          { label: 'Quality', el: <QualitySection /> },
          { label: 'Bugs', el: <BugsSection /> },
          { label: 'Reliability', el: <ReliabilitySection /> },
          { label: 'Agent Teams', el: <TeamsSection /> },
        ]}
      />
    ),
  },
  {
    id: 'capabilities',
    label: 'Capabilities',
    icon: '✦',
    kicker: 'Capabilities',
    title: 'Capabilities — what you pay for, and what actually fires',
    el: (
      <Hub
        items={[
          { label: 'ROI ledger', el: <CapabilityLedger /> },
          { label: 'Skills', el: <ResourceSection kind="skills" title="Skills" /> },
          { label: 'Commands', el: <ResourceSection kind="commands" title="Prompts / Commands" /> },
          { label: 'Agents', el: <ResourceSection kind="agents" title="Agents" /> },
          { label: 'Flow', el: <FlowSection /> },
          { label: 'Inventory (linter)', el: <Inventory /> },
          { label: 'Customize', el: <CustomizeSection /> },
          { label: 'Library', el: <LibrarySection /> },
          { label: 'MCP', el: <McpSection /> },
        ]}
      />
    ),
  },
  {
    id: 'harness',
    label: 'Harness',
    icon: '⚙',
    kicker: 'Harness engineering',
    title: 'Harness — sessions, forensics, usage & config',
    el: (
      <Hub
        items={[
          { label: 'Sessions', el: <SessionsSection /> },
          { label: 'Context Explorer', el: <ContextExplorerSection /> },
          { label: 'Forensics', el: <ForensicsSection /> },
          { label: 'Usage', el: <UsagePanel /> },
          { label: 'Usage detail', el: <UsageDetail /> },
          { label: 'Health', el: <HealthSection /> },
          { label: 'Config', el: <HarnessSection /> },
          { label: 'Team baseline', el: <TeamBaseline /> },
        ]}
      />
    ),
  },
  {
    id: 'governance',
    label: 'Governance',
    icon: '⚖',
    kicker: 'Control',
    title: 'Governance — versions, approvals, access & audit',
    el: <GovernanceSection />,
  },
  {
    id: 'authoring',
    label: 'Authoring',
    icon: '✍︎',
    kicker: 'Authoring',
    title: 'Authoring — prompt studio & prompt quality',
    el: (
      <Hub
        items={[
          { label: 'Prompt Studio', el: <PromptStudio /> },
          { label: 'Prompt Quality', el: <PromptQuality source="claude" /> },
        ]}
      />
    ),
  },
  { id: 'hooks', label: 'Hooks', icon: '⑂', kicker: 'Automation', title: 'Hooks', el: <HooksSection /> },
  { id: 'artifacts', label: 'Artifacts', icon: '⬡', kicker: 'Output', title: 'Artifacts', el: <ArtifactsSection /> },
  {
    id: 'setup',
    label: 'Setup',
    icon: '⚒',
    kicker: 'Configuration',
    title: 'Setup — projects, credentials, work week',
    el: <SetupSection />,
  },
];

const COMPANY_SECTION = {
  id: 'company',
  label: 'Company tools',
  icon: '◉',
  kicker: 'Org tools',
  title: 'Company tools — constitution & design capture',
  el: (
    <Hub
      items={[
        { label: 'Constitution', el: <ConstitutionSection /> },
        { label: 'Figma Capture', el: <FigmaCaptureSection /> },
        { label: 'Design Map', el: <DesignMapSection /> },
      ]}
    />
  ),
};
const NAV_GROUPS = [
  { label: 'WORK', ids: ['overview', 'live', 'workingset', 'todos', 'inbox', 'delivery', 'ticket', 'projects', 'chat', 'workflows'] },
  { label: 'INTELLIGENCE', ids: ['capabilities', 'harness', 'authoring', 'hooks', 'artifacts'] },
  { label: 'ADMIN', ids: ['governance', 'setup', 'company'] },
];
const groupSections = (sections) => {
  const claimed = new Set(NAV_GROUPS.flatMap((g) => g.ids));
  return NAV_GROUPS.map((g, i) => ({
    label: g.label,
    items: [
      ...g.ids.map((id) => sections.find((s) => s.id === id)).filter(Boolean),
      ...(i === 0 ? sections.filter((s) => !claimed.has(s.id)) : []),
    ],
  })).filter((g) => g.items.length);
};

const sectionsFor = (features) => {
  const out = [...BASE_SECTIONS];
  if (features?.companyTools) out.push(COMPANY_SECTION);
  return out;
};
// Every id that may legally appear in `?dash=`, including the flag-gated one — the flag has not
// loaded yet when the URL is first read, and refusing `company` on that basis would send someone
// with a bookmark to Overview.
const KNOWN_SECTION_IDS = new Set([...BASE_SECTIONS, COMPANY_SECTION].map((s) => s.id));

function SidebarFoot() {
  const [h, setH] = useState(null);
  const [alerts, setAlerts] = useState([]);
  useEffect(() => {
    const load = () => {
      api
        .get('/api/harness')
        .then((d) => setH(d.valid))
        .catch(() => {});
      api
        .get('/api/gov/costs?days=1')
        .then((d) => setAlerts(d.alerts || []))
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, []);
  const ok = (!h || h.ok) && !alerts.some((a) => a.level === 'error');
  const issue = h && !h.ok ? h.conflicts[0] : alerts[0]?.text;
  return (
    <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div
        className="sidebar-foot"
        style={{ marginTop: 0 }}
        title={[...(h?.conflicts || []), ...alerts.map((a) => a.text)].join('\n')}
      >
        <div className="live" style={ok && !alerts.length ? {} : { color: ok ? 'var(--amber)' : 'var(--red)' }}>
          {h && !h.ok
            ? `${h.conflicts.length} conflict${h.conflicts.length === 1 ? '' : 's'}`
            : alerts.length
            ? 'budget alert'
            : 'harness valid'}
        </div>
        {issue ? issue.slice(0, 46) : 'settings schema · backups synced'}
      </div>
    </div>
  );
}

function useTheme() {
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute('data-theme') || 'dark');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('theme', theme);
    } catch {
    }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}

export default function App() {
  const [theme, toggleTheme] = useTheme();
  const [navOpen, setNavOpen] = useState(false);
  const initial = new URLSearchParams(window.location.search).get('dash') || 'claude';
  // `?dash=` is the section. It was only ever read for `eng`, so a refresh anywhere else dropped
  // you back on Overview and the address bar said nothing about where you were — which also made
  // every section unlinkable. `eng` keeps its meaning (Delivery, on the Engineering dashboard)
  // because links to it exist in the wild.
  const [section, setSection] = useState(
    initial === 'eng' ? 'delivery' : KNOWN_SECTION_IDS.has(initial) ? initial : 'overview',
  );
  const [inboxCount, setInboxCount] = useState(0);
  const [stale, setStale] = useState(null);
  const [tick, setTick] = useState(0);
  // Sections mount lazily on first visit, so the section named in the URL has to count as visited
  // — otherwise a deep link selects it in the sidebar and renders an empty pane, which is exactly
  // what happened the first time `?dash=` accepted anything other than `eng`.
  const [visited, setVisited] = useState(
    initial === 'eng' ? { overview: true, delivery: true } : { overview: true, [initial]: true },
  );
  const [toasts, setToasts] = useState([]);
  const [features, setFeatures] = useState({});
  useEffect(() => {
    api
      .get('/api/features')
      .then(setFeatures)
      .catch(() => setFeatures({}));
  }, []);
  const SECTIONS = React.useMemo(() => sectionsFor(features), [features]);
  useEffect(() => {
    const onCache = (e) => setStale((s) => (s === null ? e.detail.at : Math.min(s, e.detail.at)));
    let lastAt = 0,
      lastUrl = '';
    const push = (detail) => {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t.slice(-3), { id, ...detail }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 7000);
    };
    const onErr = (e) => {
      const now = Date.now();
      if (e.detail.url === lastUrl && now - lastAt < 4000) return;
      lastAt = now;
      lastUrl = e.detail.url;
      push({ ...e.detail, kind: 'error' });
    };
    const onToast = (e) => push(e.detail);
    window.addEventListener('api-cache', onCache);
    window.addEventListener('api-error', onErr);
    window.addEventListener('app-toast', onToast);
    return () => {
      window.removeEventListener('api-cache', onCache);
      window.removeEventListener('api-error', onErr);
      window.removeEventListener('app-toast', onToast);
    };
  }, []);
  useEffect(() => setStale(null), [section, tick]);
  const refresh = () => {
    forceFresh();
    setStale(null);
    setVisited({ [section]: true });
    setTick((t) => t + 1);
  };
  const nav = (id) => {
    setVisited((v) => (v[id] ? v : { ...v, [id]: true }));
    setSection(id);
  };
  // Written on navigation, not on mount: a pasted `?dash=eng&route=members` must survive long
  // enough for the Engineering dashboard to read `route` off it. Leaving a section drops that
  // section's own params, which belong to it and mean nothing anywhere else. replaceState, not
  // push — the sidebar is not a history stack, and Back should leave the app, not walk it.
  const firstNav = React.useRef(true);
  useEffect(() => {
    if (firstNav.current) { firstNav.current = false; return; }
    window.history.replaceState(null, '', `${window.location.pathname}?dash=${section}`);
  }, [section]);
  useEffect(() => {
    const onPop = () => {
      const d = new URLSearchParams(window.location.search).get('dash');
      const id = d === 'eng' ? 'delivery' : d;
      if (id && KNOWN_SECTION_IDS.has(id)) nav(id);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const staleMin = stale ? Math.floor((Date.now() - stale) / 60000) : 0;
  useEffect(() => {
    const navChat = () => nav('chat');
    window.addEventListener('nav-chat', navChat);
    const seen = new Set();
    let first = true;
    const poll = () =>
      api
        .get('/api/inbox')
        .then((items) => {
          const open = items.filter((i) => !i.done);
          setInboxCount(open.length);
          api
            .get('/api/notify')
            .then((cfg) => {
              for (const i of open) {
                if (i.severity === 'info' || seen.has(i.key)) continue;
                seen.add(i.key);
                if (
                  !first &&
                  cfg.desktop &&
                  typeof Notification !== 'undefined' &&
                  Notification.permission === 'granted'
                )
                  new Notification('claude-dashboard', { body: i.text });
              }
              first = false;
            })
            .catch(() => {});
        })
        .catch(() => {});
    poll();
    const t = setInterval(poll, 60_000);
    return () => {
      clearInterval(t);
      window.removeEventListener('nav-chat', navChat);
    };
  }, []);
  const cur = SECTIONS.find((s) => s.id === section);
  return (
    <div className="app">
      {navOpen && <div className="nav-scrim" onClick={() => setNavOpen(false)} />}
      <nav className={navOpen ? 'sidebar open' : 'sidebar'}>
        <div className="brand">
          <div className="brand-mark">L</div>
          <div className="brand-name">Loush</div>
          <span className="brand-beta">BETA</span>
        </div>
        {groupSections(SECTIONS).map((g) => (
          <div className="nav-group" key={g.label}>
            <div className="nav-group-label">{g.label}</div>
            {g.items.map((s) => (
              <button
                key={s.id}
                className={section === s.id ? 'active' : ''}
                title={s.label}
                onClick={() => {
                  nav(s.id);
                  setNavOpen(false);
                }}
              >
                <span className="nav-dot" />
                <span className="nav-icon">{s.icon}</span> {s.label}
                {s.id === 'inbox' && inboxCount > 0 && <span className="nav-badge">{inboxCount}</span>}
              </button>
            ))}
          </div>
        ))}
        <SidebarFoot />
      </nav>
      <main className="content">
        {}
        <header className="topbar">
          <button className="icon-btn nav-toggle" aria-label="menu" onClick={() => setNavOpen((o) => !o)}>
            ☰
          </button>
          <div className="crumb">
            <span className="kicker">{cur.kicker}</span>
            <i>›</i>
            <b>{cur.title}</b>
          </div>
          <div className="topbar-right">
            <button
              className="top-chip"
              onClick={refresh}
              title="aggregates are cached server-side (no tokens spent) — click to recompute this section now"
              style={{ color: staleMin >= 5 ? 'var(--amber)' : undefined }}
            >
              ↻ {stale === null ? 'refresh' : staleMin < 1 ? 'cached · fresh' : `cached · ${staleMin}m old`}
            </button>
            <button
              className="icon-btn"
              onClick={toggleTheme}
              title={`switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              aria-label="toggle theme"
            >
              {theme === 'dark' ? '☀' : '☾'}
            </button>
            <div className="div" />
            <div className="avatar">AM</div>
          </div>
        </header>
        {SECTIONS.filter((s) => visited[s.id]).map((s) => (
          <div
            key={s.id + ':' + tick}
            className={s.id === section ? 'enter' : undefined}
            style={s.id === section ? undefined : { display: 'none' }}
          >
            {React.cloneElement(s.el, { onNav: nav })}
          </div>
        ))}
      </main>
      <Palette sections={SECTIONS} onNav={nav} />
      {}
      <TodoDock onNav={nav} />
      {toasts.length > 0 && (
        <div
          style={{
            position: 'fixed',
            bottom: 16,
            right: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            zIndex: 9999,
            maxWidth: 360,
          }}
        >
          {toasts.map((t) => {
            const c = t.kind === 'error' ? 'var(--red)' : t.kind === 'success' ? 'var(--green)' : 'var(--blue)';
            return (
              <div
                key={t.id}
                onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}
                style={{
                  cursor: 'pointer',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-default)',
                  borderLeft: `2px solid ${c}`,
                  borderRadius: 10,
                  padding: '12px 14px',
                  font: '400 11.5px var(--mono)',
                  color: 'var(--text-primary)',
                  boxShadow: 'var(--shadow-md)',
                }}
              >
                <div style={{ color: c, fontWeight: 600 }}>
                  {t.kind === 'error' ? (t.url ? 'request failed' : 'error') : t.kind === 'success' ? 'done' : 'note'} ·
                  click to dismiss
                </div>
                <div style={{ color: 'var(--text-secondary)', marginTop: 3 }}>
                  {t.message}
                  {t.url ? <span style={{ color: 'var(--text-tertiary)' }}> ({String(t.url).split('?')[0]})</span> : ''}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
