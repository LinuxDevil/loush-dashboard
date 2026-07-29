import React, { useEffect, useState } from 'react';
import ResourceSection from './sections/ResourceSection.jsx';
import CustomizeSection from './sections/CustomizeSection.jsx';
import McpSection from './sections/McpSection.jsx';
import HooksSection from './sections/HooksSection.jsx';
import ArtifactsSection from './sections/ArtifactsSection.jsx';
import Overview from './sections/Overview.jsx';
import LiveSection from './sections/LiveSection.jsx';
import EngineeringSection from './sections/EngineeringSection.jsx';
import ProjectsSection from './sections/ProjectsSection.jsx';
import ChatSection from './sections/ChatSection.jsx';
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
import CapabilityLedger, { Inventory } from './sections/CapabilityLedger.jsx';
import SessionsSection from './sections/SessionsSection.jsx';
import ForensicsSection from './sections/ForensicsSection.jsx';
import UsagePanel from './sections/UsagePanel.jsx';
import TeamBaseline from './sections/TeamBaseline.jsx';
import Palette from './ui/Palette.jsx';
import { api, forceFresh } from './lib/api.js';

// THE GAMIFICATION LAYER IS GONE — deleted, not hidden. The topbar carried a "Lv N · 🔥Nd" chip whose
// level was derived from all-time assistant MESSAGE COUNT, so the fastest way to level up was a long,
// thrashing, unproductive conversation. A token-count level plus a streak is one product decision away
// from a per-engineer leaderboard, at which point every number on this screen stops being trusted.
// src/Gamification.jsx is deleted. Overview's XP bar, streak flame and 10 achievement badges are deleted.

// The four-shell portal is DISSOLVED. Cursor and Career move out of the topbar (one click from an IC's
// Overview is precisely what made this app feel like surveillance) into a sidebar-footer "switch
// dashboard" menu. The Engineering Metrics dashboard that used to fold into `delivery` is DELETED —
// Delivery keeps the panels that read the snapshot directly (funnel, ROI, DORA, 1:1 prep).
const BASE_SECTIONS = [
  {
    id: 'overview',
    label: 'Overview',
    icon: '◧',
    kicker: 'Dashboard',
    title: 'What needs a human today',
    el: <Overview />,
  },
  // Directly under Overview because it answers the one question you have before any other when
  // you open this app: is something running right now, and does it need me. Everything else here
  // is retrospective; this is the only screen about the present tense.
  {
    id: 'live',
    label: 'Now',
    icon: '◉',
    kicker: 'Dashboard',
    title: 'Now — sessions running right now',
    el: <LiveSection />,
  },
  // The only section in this app scoped to your CODE rather than your harness or your JIRA board, and
  // the only one that needs zero external config. It sits directly under Overview because Overview's
  // top fold is a "not configured" card for anyone without JIRA + gh, and this is not.
  {
    id: 'workingset',
    label: 'Working Set',
    icon: '◈',
    kicker: 'Dashboard',
    title: 'Working Set — what the agent did to your code',
    el: <WorkingSet />,
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
  // Delivery answers "how is the board doing"; this answers "I have a key, what do I do with it".
  // The distinction is load-bearing: everything in Delivery needs a ~65s snapshot, and this needs
  // nothing but the key. Sits directly after Delivery because it is the same subject, one level in.
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
        ]}
      />
    ),
  },
  // ROI ledger leads. The Inventory table and its frontmatter linter are demoted OFF the landing page
  // to the end of this hub, reframed as what they are: an authoring aid, not a metric.
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
  // Harness had grown to ten children — a junk drawer nobody scans past the third item, with
  // Governance (which now owns the project access matrix) buried two clicks deep. Split by the
  // question each screen answers: Harness keeps "how is my harness set up and what did it do",
  // Governance is promoted to top level because it is the control surface, and the two items
  // that were only ever there by adjacency (Library, MCP) move to Capabilities where the rest of
  // the installed-things live.
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
          { label: 'Config', el: <HarnessSection /> },
          { label: 'Team baseline', el: <TeamBaseline /> },
        ]}
      />
    ),
  },
  // Top level, not a hub child: this is where approvals, the audit log and the per-project rwx
  // access matrix live. A security surface that takes two clicks to find is one that goes unread.
  {
    id: 'governance',
    label: 'Governance',
    icon: '⚖',
    kicker: 'Control',
    title: 'Governance — versions, approvals, access & audit',
    el: <GovernanceSection />,
  },
  // Prompt Quality joins Authoring (from main). Constitution and Figma Capture do NOT return as
  // top-level entries — they moved into COMPANY_SECTION below, behind the Company_Tools flag.
  // The Memory browse UI stays deleted (server/memory.mjs is kept; Overview's recall tile uses it).
  {
    id: 'authoring',
    label: 'Authoring',
    icon: '✍',
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
  // Everything org-specific is user config now, so there has to be somewhere to enter it. Credentials
  // here are write-only: no endpoint returns a stored token, so the fields are always blank on load.
  {
    id: 'setup',
    label: 'Setup',
    icon: '⚒',
    kicker: 'Configuration',
    title: 'Setup — projects, credentials, work week',
    el: <SetupSection />,
  },
];

// Org-specific bundle. These were deleted outright once — wrongly, because for the org that HAS a
// `.wakeel/constitution/` knowledge base and that design-system catalog they are load-bearing. They
// are now behind `companyTools` in projects.json, gated at MOUNT TIME on the server too, so with the
// flag off the routes do not exist rather than 404-ing from a nav entry that should not be there.
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
      ]}
    />
  ),
};
// Engineering metrics — escape rate, area hotspots, ownership concentration. Behind the
// `Engineering` key in projects.json, mirroring Company_Tools, and off by default: every number
// comes from the JIRA/GitHub snapshot, so without credentials it is an empty frame. Sits next to
// Delivery because it is the same subject read a level deeper.
const ENGINEERING_SECTION = {
  id: 'engineering',
  label: 'Engineering',
  icon: '◭',
  kicker: 'Delivery',
  title: 'Engineering — escape rate, hotspots & ownership risk',
  el: <EngineeringSection />,
};

const sectionsFor = (features) => {
  const out = [...BASE_SECTIONS];
  if (features?.engineering) {
    // Immediately after Delivery/Ticket rather than appended, so it reads as part of the
    // delivery story instead of a bolt-on at the bottom of the rail.
    const at = out.findIndex(s => s.id === 'ticket');
    out.splice(at >= 0 ? at + 1 : out.length, 0, ENGINEERING_SECTION);
  }
  if (features?.companyTools) out.push(COMPANY_SECTION);
  return out;
};

// There is one shell now. The Cursor and Career dashboards were separate SPAs behind this menu;
// both are deleted, so the switcher has nothing to switch to. What remains is the harness-health strip.
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

// Theme lives on <html data-theme>, which is what the token block in styles.css keys off. The initial
// value is set by an inline script in index.html so there is no flash of the wrong palette; this hook
// only owns the toggle and the persistence.
function useTheme() {
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute('data-theme') || 'dark');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('theme', theme);
    } catch {
      /* private mode — session-only theme is fine */
    }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}

export default function App() {
  const [theme, toggleTheme] = useTheme();
  const [navOpen, setNavOpen] = useState(false);
  const [section, setSection] = useState('overview');
  const [inboxCount, setInboxCount] = useState(0);
  const [stale, setStale] = useState(null);
  const [tick, setTick] = useState(0);
  const [visited, setVisited] = useState({ overview: true });
  const [toasts, setToasts] = useState([]);
  // Feature flags decide which nav entries exist at all. The server gates the same flag at mount
  // time, so this is presentation only — a stale client cannot reach a disabled route.
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
  const staleMin = stale ? Math.floor((Date.now() - stale) / 60000) : 0;
  useEffect(() => {
    const navChat = () => nav('chat');
    window.addEventListener('nav-chat', navChat);
    // inbox badge + desktop notifications for new error/warning items (277 real items, not harness trivia)
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
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            className={section === s.id ? 'active' : ''}
            title={s.label}
            onClick={() => {
              nav(s.id);
              setNavOpen(false);
            }}
          >
            <span className="nav-icon">{s.icon}</span> {s.label}
            {s.id === 'inbox' && inboxCount > 0 && <span className="nav-badge">{inboxCount}</span>}
          </button>
        ))}
        <SidebarFoot />
      </nav>
      <main className="content">
        {/* 48px bar: breadcrumb left, status + controls right. The section title is the breadcrumb
            leaf — a second heading row under it was 60px of chrome saying the same thing twice. */}
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
                  borderRadius: 6,
                  padding: '10px 12px',
                  font: '400 11px var(--mono)',
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
