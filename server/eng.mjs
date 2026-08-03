import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  loadEngConfig,
  workMsWith,
  workDaysWith,
  addWorkTimeWith,
  offHoursWith,
  isWeekendWith,
  weekKeyWith,
  describeWork,
  invalidateEngConfig,
} from '../lib/eng-config.mjs';
import { estAccuracy, escapeRateSeries, busFactor } from '../lib/eng-metrics.mjs';
import { adfToText, isAdf, markdownToAdf } from '../lib/adf.mjs';
import { partitionByReadiness, unblockImpact } from '../lib/task-graph.mjs';
import { withMarker, planSync, SECTIONS } from '../lib/progress-sync.mjs';
import { PROJECTS_FILE, SECRETS_FILE, LEGACY_SECRETS, ENG_STATE } from '../lib/paths.mjs';

const DAY = 864e5;
// ---------- external-data cache policy ----------
// One window for everything fetched from JIRA and GitHub. Previously three different numbers —
// 2h for the snapshot, 30m for CI, 10m for a ticket — which meant the same screen could mix data
// of three different ages with nothing saying so.
//
// This is a REFRESH trigger, not an expiry: the cache is stale-while-revalidate, so past the
// window a request is still answered immediately from cache and a refresh runs behind it. What
// the window actually decides is how old data may get before anyone goes looking for newer.
//
// What that costs, stated plainly because it is the real tradeoff: CI is the most time-sensitive
// thing here, and at 24h a check that went red this morning can read green until something forces
// a refresh. `?fresh=1` on /api/eng/snapshot waits for a live fetch, POST /api/eng/refresh clears
// the cache outright, every cached answer
// carries `cachedAt`/`ageMs` and renders amber in the provenance strip, and ENG_CACHE_TTL_HOURS
// overrides it without a code change.
const CACHE_TTL_HOURS = Number(process.env.ENG_CACHE_TTL_HOURS) || 24;
export const DATA_TTL = Math.max(60_000, CACHE_TTL_HOURS * 3600_000);
const H = 3600e3;

// ---------- projects (§0) — ALL of this is user config now, one JIRA board + repo each ----------
const engCfg = () => loadEngConfig(PROJECTS_FILE);
const WORK = () => engCfg().work;
function normalizeProject(p) {
  const key = (p.key || p.jiraProjectKey || '').toUpperCase();
  const pk = (p.jiraProjectKey || key).toUpperCase();
  return {
    key,
    name: p.name || key,
    jiraHost: p.jiraHost || engCfg().jiraHost || '',
    jiraProjectKey: pk,
    githubRepo: p.githubRepo || '',
    ticketRegex: new RegExp(`${pk}-\\d+`, 'i'),
    jql: p.jql || `project = ${pk} AND (updated >= -180d OR statusCategory != Done) ORDER BY updated DESC`,
    spField: p.spField || null,
    devEmails: (p.devEmails && p.devEmails.length ? p.devEmails : engCfg().defaultDevEmails).map((e) =>
      e.toLowerCase()
    ),
    qaEmails: (p.qaEmails || []).map((e) => e.toLowerCase()),
    productEmails: (p.productEmails || []).map((e) => e.toLowerCase()),
    writes: p.writes === true,
  };
}
function projectsFile() {
  try {
    return JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8'));
  } catch {
    return null;
  }
}
function extraProjects() {
  return engCfg().projects;
}
function loadProjects() {
  const map = new Map();
  for (const p of extraProjects()) {
    const k = (p.key || p.jiraProjectKey || '').toUpperCase();
    if (!k) continue;
    map.set(k, { ...(map.get(k) || {}), ...p, key: k });
  }
  return [...map.values()].map(normalizeProject);
}
function upsertProject(rec) {
  const j = projectsFile();
  const extra = extraProjects();
  const k = (rec.key || '').toUpperCase();
  const idx = extra.findIndex((p) => (p.key || p.jiraProjectKey || '').toUpperCase() === k);
  if (idx >= 0) extra[idx] = { ...extra[idx], ...rec, key: k };
  else extra.push({ ...rec, key: k });
  const base = j && !Array.isArray(j) ? j : {};
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify({ ...base, projects: extra }, null, 2));
  invalidateEngConfig();
}
function rostersFrom(members) {
  if (!Array.isArray(members)) return {};
  const g = (r) => members.filter((m) => m.role === r && m.email).map((m) => m.email.trim().toLowerCase());
  return { devEmails: g('dev'), qaEmails: g('qa'), productEmails: g('product') };
}
const projectPill = (p) => ({
  key: p.key,
  name: p.name,
  jiraProjectKey: p.jiraProjectKey,
  githubRepo: p.githubRepo,
  jiraHost: p.jiraHost,
  dev: p.devEmails,
  qa: p.qaEmails,
  product: p.productEmails,
});
const projectList = () => loadProjects().map(projectPill);

// ---------- working-time engine (§time) ----------
const workMs = (from, to) => workMsWith(WORK(), from, to);
const workDays = (from, to) => workDaysWith(WORK(), from, to);
const addWorkTime = (from, budgetMs) => addWorkTimeWith(WORK(), from, budgetMs);
const offHours = (t) => offHoursWith(WORK(), t);
const isWeekend = (t) => isWeekendWith(WORK(), t);
const WORKDAY_MS_OF = () => WORK().dayMs;

// ---------- percentiles (§2 — the client does its own too; these are the ones the server needs) ----------
function pctl(arr, p) {
  const a = arr.filter((v) => v != null && !Number.isNaN(v)).sort((x, y) => x - y);
  if (!a.length) return null;
  const i = (a.length - 1) * p;
  const lo = Math.floor(i),
    hi = Math.ceil(i);
  return +(a[lo] + (a[hi] - a[lo]) * (i - lo)).toFixed(2);
}
const median = (a) => pctl(a, 0.5);
const round1 = (v) => (v == null ? null : +v.toFixed(1));
const round2 = (v) => (v == null ? null : +v.toFixed(2));
const monthKey = (t) => new Date(t).toISOString().slice(0, 7);
const weekKey = (t) => weekKeyWith(WORK(), t);

// ---------- story points -> estimated working-days (org reference table) ----------
function estDaysFromPts(pts) {
  if (!pts || pts <= 0) return 0;
  const SP_DAYS = engCfg().storyPointDays;
  for (const [p, d] of SP_DAYS) if (pts === p) return d;
  if (pts < SP_DAYS[0][0]) return (SP_DAYS[0][1] * pts) / SP_DAYS[0][0];
  for (let i = 0; i < SP_DAYS.length - 1; i++) {
    const [p0, d0] = SP_DAYS[i],
      [p1, d1] = SP_DAYS[i + 1];
    if (pts > p0 && pts < p1) return d0 + ((d1 - d0) * (pts - p0)) / (p1 - p0);
  }
  const [pl, dl] = SP_DAYS[SP_DAYS.length - 1];
  return (dl * pts) / pl;
}

// ---------- status model (§2) — matched case-insensitively; statusCategory is the fallback ----------
const ACTIVE = ['in progress', 'in code review', 'design qa', 'in qa (dev)', 'in qa', 'reopen', 'reopened'];
const WAITING = [
  'pm backlog',
  'to do',
  'ready for qa',
  'qa blocked',
  'on hold',
  'paused',
  'ready for release',
  'backlog',
];
const PAUSED = ['on hold', 'paused'];
const DONE = ['live', 'closed', "won't fix", 'done', 'resolved'];
const REVIEWY = ['in code review', 'design qa', 'in qa (dev)', 'in qa', 'qa blocked', 'ready for qa'];
// A QA cycle is a FAILED round: the ticket sat in one of these and came back out to be worked
// again. Counting ENTRIES instead scored the normal path — Ready for QA → In QA — as two cycles on
// a ticket QA had not even looked at yet, so "2 QA cycles" appeared on almost everything.
const QA_STATUSES = ['ready for qa', 'in qa (dev)', 'in qa'];
const QA_BOUNCE_TO = ['in progress', 'reopen', 'reopened'];
const norm = (s) => (s || '').trim().toLowerCase();
function kindOf(name, category) {
  const n = norm(name);
  if (ACTIVE.includes(n)) return 'active';
  if (WAITING.includes(n)) return 'wait';
  if (DONE.includes(n)) return 'done';
  const c = norm(category);
  return c === 'done' ? 'done' : c === 'indeterminate' ? 'active' : 'wait';
}
const STATUS_COLOR = {
  'in progress': '#8ec8ff',
  'in code review': '#a894f0',
  'design qa': '#f2a2c4',
  'ready for qa': '#f5c451',
  'in qa (dev)': '#5fd39a',
  'in qa': '#5fd39a',
  'qa blocked': '#f2777a',
  'ready for release': '#7c9bd6',
  live: '#5fd39a',
  'to do': '#7f8ea1',
  closed: '#5fd39a',
  reopen: '#f2777a',
};
const colorFor = (name) => STATUS_COLOR[norm(name)] || '#7f8ea1';

// ---------- JIRA auth ----------
export function creds() {
  let email = process.env.JIRA_EMAIL || '',
    token = process.env.JIRA_API_TOKEN || '';
  for (const file of [SECRETS_FILE, LEGACY_SECRETS]) {
    try {
      const f = JSON.parse(fs.readFileSync(file, 'utf8'));
      email = email || f.jiraEmail || f.email || '';
      token = token || f.jiraToken || f.token || f.jiraAPIKey || '';
    } catch {}
  }
  return { email, token };
}
function acliProfile() {
  try {
    const y = fs.readFileSync(path.join(os.homedir(), '.config', 'acli', 'jira_config.yaml'), 'utf8');
    const prof = (y.match(/current_profile:\s*(\S+)/) || [])[1];
    if (!prof) return null;
    return { profile: prof, cloudId: prof.split(':')[0], account: `jira:${prof}` };
  } catch {
    return null;
  }
}
function readAcliBundle(account) {
  try {
    const r = spawnSync('security', ['find-generic-password', '-s', 'acli', '-a', account, '-w'], { timeout: 8000 });
    if (r.status !== 0) return null;
    const b64 = r.stdout
      .toString()
      .trim()
      .replace(/^go-keyring-base64:/, '');
    return JSON.parse(zlib.gunzipSync(Buffer.from(b64, 'base64')).toString());
  } catch {
    return null;
  }
}
async function jiraAuth(cfg) {
  const { email, token } = creds();
  if (email && token)
    return {
      base: `https://${cfg.jiraHost}/rest/api/3`,
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64'),
        Accept: 'application/json',
      },
    };
  const prof = acliProfile();
  if (prof) {
    let b = readAcliBundle(prof.account);
    if (b && new Date(b.expiry).getTime() < Date.now() + 90_000) {
      spawnSync('acli', ['jira', 'workitem', 'search', '--jql', `project = ${cfg.jiraProjectKey}`, '--limit', '1'], {
        timeout: 30_000,
      });
      b = readAcliBundle(prof.account);
    }
    if (b?.access_token)
      return {
        base: `https://api.atlassian.com/ex/jira/${prof.cloudId}/rest/api/3`,
        headers: { Authorization: 'Bearer ' + b.access_token, Accept: 'application/json' },
      };
  }
  throw new Error('no-jira-creds');
}

async function jira(a, pathAndQuery) {
  const r = await fetch(`${a.base}${pathAndQuery}`, { headers: a.headers });
  if (!r.ok) throw new Error(`jira ${r.status}: ${(await r.text()).slice(0, 180)}`);
  return r.json();
}

const FIELDS = new Map();
async function resolveFields(a, cfg) {
  if (FIELDS.has(cfg.key)) return FIELDS.get(cfg.key);
  const all = await jira(a, '/field');
  const byName = (re) => all.filter((f) => re.test(f.name)).map((f) => f.id);
  const spCands = [...new Set([cfg.spField, ...byName(/story point/i)].filter(Boolean))];
  const mostUsed = await pickPopulated(a, cfg, spCands);
  const F = {
    sp: spCands.sort((x, y) => (mostUsed[y] || 0) - (mostUsed[x] || 0))[0] || null,
    sprint: (all.find((f) => /^sprint$/i.test(f.name)) || {}).id,
  };
  FIELDS.set(cfg.key, F);
  return F;
}
async function pickPopulated(a, cfg, ids) {
  if (!ids.length) return {};
  const body = {
    jql: `project = ${cfg.jiraProjectKey} AND updated >= -120d ORDER BY updated DESC`,
    fields: ids,
    maxResults: 100,
  };
  const r = await fetch(`${a.base}/search/jql`, {
    method: 'POST',
    headers: { ...a.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) return {};
  const j = await r.json();
  const cnt = {};
  for (const is of j.issues || [])
    for (const id of ids) {
      const v = is.fields[id];
      if (v != null && v !== '') cnt[id] = (cnt[id] || 0) + 1;
    }
  return cnt;
}

async function jiraIssues(cfg) {
  const a = await jiraAuth(cfg);
  const F = await resolveFields(a, cfg);
  const fields = [
    'summary',
    'issuetype',
    'status',
    'assignee',
    'reporter',
    'labels',
    'components',
    'issuelinks',
    'parent',
    'created',
    'updated',
    'resolutiondate',
    'duedate',
    'fixVersions',
    F.sp,
    F.sprint,
  ].filter(Boolean);
  const out = [];
  let token = null;
  do {
    const body = {
      jql: cfg.jql,
      fields,
      expand: 'changelog',
      maxResults: 100,
      ...(token ? { nextPageToken: token } : {}),
    };
    const r = await fetch(`${a.base}/search/jql`, {
      method: 'POST',
      headers: { ...a.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`jira search ${r.status}: ${(await r.text()).slice(0, 180)}`);
    const j = await r.json();
    for (const is of j.issues || []) out.push(is);
    token = j.nextPageToken || null;
    if (out.length > 800) break; // ponytail: hard cap, widen if a team genuinely runs bigger
  } while (token);
  await mapLimit(out, 8, async (is) => {
    const histories = is.changelog?.histories;
    if (!histories || (is.changelog.total && is.changelog.total > histories.length)) {
      try {
        is.changelog = (await jira(a, `/issue/${is.id}?expand=changelog&fields=none`)).changelog;
      } catch {}
    }
  });
  return { issues: out, F };
}
async function mapLimit(arr, n, fn) {
  const it = arr[Symbol.iterator]();
  const work = Array.from({ length: n }, async () => {
    for (const x of it) await fn(x);
  });
  await Promise.all(work);
}

// ---------- per-issue metrics from the changelog (§3), in working time ----------
function statusSegments(issue) {
  const created = Date.parse(issue.fields.created);
  const changes = [];
  const sprintEvents = [];
  for (const h of issue.changelog?.histories || [])
    for (const it of h.items || []) {
      if (it.field === 'status')
        changes.push({
          at: Date.parse(h.created),
          from: it.fromString,
          to: it.toString,
          author: h.author ? { id: h.author.accountId, name: h.author.displayName } : null,
        });
      else if (it.field === 'Sprint')
        sprintEvents.push({
          at: Date.parse(h.created),
          from: it.fromString || '',
          to: it.toString || '',
          fromIds: idList(it.from),
          toIds: idList(it.to),
          author: h.author?.displayName || '',
        });
    }
  changes.sort((a, b) => a.at - b.at);
  sprintEvents.sort((a, b) => a.at - b.at);
  const days = {};
  let firstInProg = null,
    liveAt = null,
    qaBounces = 0,
    reworkN = 0,
    reopenN = 0,
    inProgEntries = 0,
    fixer = null;
  let cur = changes.length ? changes[0].from : issue.fields.status.name;
  let t0 = created,
    curSince = created;
  const add = (st, from, to) => {
    const k = st || 'Unknown';
    days[k] = (days[k] || 0) + workMs(from, to);
  };
  for (const c of changes) {
    add(c.from, t0, c.at);
    t0 = c.at;
    cur = c.to;
    curSince = c.at;
    const to = norm(c.to);
    const from = norm(c.from);
    if (to === 'in progress') {
      inProgEntries++;
      if (firstInProg == null) firstInProg = c.at;
      if (inProgEntries > 1) reworkN++;
    }
    if (to === 'reopen' || to === 'reopened') reopenN++;
    // Whoever hands it to QA is the fixer — that is an entry, and stays one.
    if (QA_STATUSES.includes(to) && c.author) fixer = c.author;
    if (QA_STATUSES.includes(from) && QA_BOUNCE_TO.includes(to)) qaBounces++;
    if (DONE.includes(to) && liveAt == null && (to === 'live' || to === 'closed' || to === 'done')) liveAt = c.at;
  }
  add(cur, t0, Date.now());
  if (firstInProg == null && norm(cur) === 'in progress') {
    firstInProg = created;
    curSince = created;
  }
  const daysIn = {};
  for (const k in days) daysIn[k] = days[k] / WORKDAY_MS_OF();
  const endT = liveAt || Date.now();
  const pausedMs = Object.entries(days).reduce((a, [k, v]) => a + (PAUSED.includes(norm(k)) ? v : 0), 0);
  const delivery = firstInProg == null ? null : Math.max(0, workMs(firstInProg, endT) - pausedMs) / WORKDAY_MS_OF();
  return {
    daysIn,
    delivery,
    firstInProg,
    liveAt,
    curStatus: cur,
    curSince,
    qaCycles: qaBounces,
    rework: reworkN + reopenN,
    fixer,
    sprintEvents,
  };
}
const idList = (s) =>
  String(s || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
const nameList = (s) =>
  String(s || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

function num(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'object') return v.value ?? 0;
  return Number(v) || 0;
}
function parseSprintOne(one) {
  if (!one) return null;
  if (typeof one === 'object')
    return one.name
      ? {
          id: one.id ?? null,
          name: one.name,
          state: one.state || '',
          startDate: one.startDate || null,
          endDate: one.endDate || null,
          completeDate: one.completeDate || null,
          boardId: one.boardId ?? null,
        }
      : null;
  const s = String(one);
  const g = (re) => (s.match(re) || [])[1] || null;
  const name = g(/name=([^,\]]+)/);
  const iso = (v) => (v && v !== '<null>' ? v : null);
  return name
    ? {
        id: g(/id=(\d+)/) ? +g(/id=(\d+)/) : null,
        name,
        state: g(/state=([^,\]]+)/) || '',
        startDate: iso(g(/startDate=([^,\]]+)/)),
        endDate: iso(g(/endDate=([^,\]]+)/)),
        completeDate: iso(g(/completeDate=([^,\]]+)/)),
        boardId: g(/boardId=(\d+)/) ? +g(/boardId=(\d+)/) : null,
      }
    : null;
}
const parseSprints = (raw) => (raw ? (Array.isArray(raw) ? raw : [raw]) : []).map(parseSprintOne).filter(Boolean);
function parseSprint(raw) {
  const a = parseSprints(raw);
  return a.length ? a[a.length - 1] : null;
}

function recFor(status, pts, curSince) {
  const n = norm(status);
  let next = null,
    budget = 0;
  if (n === 'in progress') {
    next = 'In Code Review';
    budget = Math.max(0.5, estDaysFromPts(pts) || 1.5);
  } else if (n === 'in code review') {
    next = 'Ready for QA';
    budget = 1;
  } else if (n === 'design qa') {
    next = 'In QA (Dev)';
    budget = 1;
  } else if (n === 'ready for qa' || n === 'in qa (dev)' || n === 'in qa') {
    next = 'Ready for Release';
    budget = 1;
  } else if (n === 'qa blocked') {
    next = 'In Progress';
    budget = 0.5;
  } else return null;
  const moveBy = addWorkTime(curSince, budget * WORKDAY_MS_OF());
  const spent = workDays(curSince, Date.now());
  const remaining = +(budget - spent).toFixed(2);
  return { next, budget: +budget.toFixed(2), moveBy: new Date(moveBy).toISOString(), remaining, atRisk: remaining < 0 };
}

function computeIssue(issue, F, prsByTicket, cfg) {
  const f = issue.fields;
  const seg = statusSegments(issue);
  const dwell = (want) => {
    const e = Object.entries(seg.daysIn).find(([k]) => norm(k) === want);
    return e ? e[1] : null;
  };
  const dev = dwell('in progress');
  const cr = dwell('in code review');
  const pts = num(f[F.sp]);
  const est = estDaysFromPts(pts);
  const actual = dev || seg.delivery;
  const estAcc = estAccuracy(est, actual);
  const status = f.status.name;
  const kind = kindOf(status, f.status.statusCategory?.key);
  const live = norm(status) === 'live' || kind === 'done';
  const when = seg.liveAt || Date.parse(f.resolutiondate || f.updated || f.created);
  const d = new Date(when);
  const prs = prsByTicket[issue.key] || [];
  const anyMerged = prs.some((p) => p.state === 'Merged');
  const stale = REVIEWY.includes(norm(status)) && anyMerged;
  const staleNote = stale ? `PR #${prs.find((p) => p.state === 'Merged')?.num} merged — status out of date` : '';
  let activeDays = 0,
    waitDays = 0,
    sawActive = false;
  for (const [k, v] of Object.entries(seg.daysIn)) {
    const kk = kindOf(k);
    if (kk === 'active') {
      activeDays += v;
      sawActive = true;
    } else if (kk === 'wait') waitDays += v;
  }
  const isBug = /bug|defect/i.test(f.issuetype?.name || '');
  const area = f.components?.[0]?.name || null;
  const assignee = f.assignee
    ? { name: f.assignee.displayName, email: f.assignee.emailAddress || '', id: f.assignee.accountId }
    : null;
  let linkedKey = f.parent?.key || null;
  if (isBug && !linkedKey)
    for (const l of f.issuelinks || []) {
      const o = l.outwardIssue || l.inwardIssue;
      if (o) {
        linkedKey = o.key;
        break;
      }
    }
  const links = (f.issuelinks || [])
    .map((l) => {
      const o = l.outwardIssue || l.inwardIssue;
      if (!o) return null;
      return {
        key: o.key,
        dir: l.outwardIssue ? 'outward' : 'inward',
        type: l.type?.name || '',
        rel: (l.outwardIssue ? l.type?.outward : l.type?.inward) || '',
        status: o.fields?.status?.name || '',
      };
    })
    .filter(Boolean);
  const assigneeHistory = [];
  for (const h of issue.changelog?.histories || [])
    for (const it of h.items || [])
      if (it.field === 'assignee' && it.to) assigneeHistory.push({ id: it.to, name: it.toString || '' });
  if (assignee) assigneeHistory.push({ id: assignee.id, name: assignee.name });
  return {
    key: issue.key,
    project: cfg.key,
    host: cfg.jiraHost,
    type: f.issuetype?.name || 'Task',
    summary: f.summary,
    isBug,
    area,
    labels: f.labels || [],
    duedate: f.duedate || null,
    fixVersions: (f.fixVersions || []).map((v) => v.name),
    links,
    url: `https://${cfg.jiraHost}/browse/${issue.key}`,
    status,
    statusKind: kind,
    statusColor: colorFor(status),
    sprint: parseSprint(f[F.sprint]),
    sprints: parseSprints(f[F.sprint]),
    sprintEvents: seg.sprintEvents,
    assignee,
    assigneeHistory,
    devAssignee: null,
    qaAssignee: null,
    inCurrent: +workDays(seg.curSince, Date.now()).toFixed(2),
    reporter: f.reporter
      ? { name: f.reporter.displayName, email: f.reporter.emailAddress || '', id: f.reporter.accountId }
      : null,
    qaReported: false,
    owner: assignee,
    ownerId: assignee?.id || null,
    fixer: seg.fixer,
    fixerId: seg.fixer?.id || null,
    linkedKey,
    pts,
    est: +est.toFixed(2),
    dev: round2(dev),
    cr: round2(cr),
    delivery: round2(seg.delivery),
    estAcc: estAcc == null ? null : +estAcc.toFixed(1),
    qaCycles: seg.qaCycles,
    rework: seg.rework,
    daysIn: Object.fromEntries(Object.entries(seg.daysIn).map(([k, v]) => [k, +v.toFixed(2)])),
    activeDays: sawActive ? +activeDays.toFixed(2) : null,
    waitDays: +waitDays.toFixed(2),
    started: seg.firstInProg != null,
    live,
    active: kind === 'active',
    month: d.getMonth(),
    year: d.getFullYear(),
    created: f.created,
    closedAt: f.resolutiondate || (seg.liveAt ? new Date(seg.liveAt).toISOString() : null),
    curSince: new Date(seg.curSince).toISOString(),
    firstInProg: seg.firstInProg ? new Date(seg.firstInProg).toISOString() : null,
    liveAt: seg.liveAt ? new Date(seg.liveAt).toISOString() : null,
    leadDays: +workDays(Date.parse(f.created), seg.liveAt || Date.now()).toFixed(2),
    rec: live ? null : recFor(status, pts, seg.curSince),
    parent: f.parent ? { key: f.parent.key, summary: f.parent.fields?.summary || '' } : null,
    prNums: prs.map((p) => p.num),
    stale,
    staleNote,
  };
}

// ---------- bug ownership overrides (manual, persisted) ----------
const BUGS_FILE = ENG_STATE.bugOwnership;
function readBugOwn() {
  try {
    return JSON.parse(fs.readFileSync(BUGS_FILE, 'utf8'));
  } catch {
    return {};
  }
}
function writeBugOwn(o) {
  fs.writeFileSync(BUGS_FILE, JSON.stringify(o, null, 2));
}
function resolveRoles(issues, cfg) {
  const emailById = {};
  for (const i of issues) {
    if (i.assignee?.email) emailById[i.assignee.id] = i.assignee.email.toLowerCase();
    if (i.reporter?.email) emailById[i.reporter.id] = i.reporter.email.toLowerCase();
  }
  const dev = new Set(cfg.devEmails),
    qa = new Set(cfg.qaEmails),
    prod = new Set(cfg.productEmails);
  for (const i of issues) {
    let da = null,
      qaa = null;
    for (const p of i.assigneeHistory || []) {
      const e = emailById[p.id];
      if (!e) continue;
      if (dev.has(e)) da = p;
      if (qa.has(e)) qaa = p;
    }
    i.devAssignee = da;
    i.qaAssignee = qaa;
    const ae = (i.assignee?.email || '').toLowerCase() || emailById[i.assignee?.id] || '';
    i.assigneeTeam = dev.has(ae) ? 'dev' : qa.has(ae) ? 'qa' : prod.has(ae) ? 'product' : null;
    if (i.isBug) {
      const re = (i.reporter?.email || '').toLowerCase() || emailById[i.reporter?.id] || '';
      i.qaReported = qa.has(re);
    }
    delete i.assigneeHistory;
  }
}
function resolveOwnership(issues) {
  const byKey = {};
  for (const i of issues) byKey[i.key] = i;
  const accounts = {};
  for (const i of issues) {
    for (const p of [i.assignee, i.fixer, i.owner]) if (p?.id) accounts[p.id] = p.name;
  }
  const ov = readBugOwn();
  for (const i of issues) {
    if (i.isBug && i.linkedKey && byKey[i.linkedKey]?.assignee) {
      i.owner = byKey[i.linkedKey].assignee;
      i.ownerId = i.owner.id;
    }
    const o = ov[i.key];
    if (o) {
      if (o.ownerId) {
        i.owner = { id: o.ownerId, name: accounts[o.ownerId] || 'Assigned' };
        i.ownerId = o.ownerId;
        i.ownerManual = true;
      }
      if (o.fixerId) {
        i.fixer = { id: o.fixerId, name: accounts[o.fixerId] || 'Assigned' };
        i.fixerId = o.fixerId;
        i.fixerManual = true;
      }
    }
  }
}

// ---------- GitHub PRs via the authed gh CLI (GraphQL, paginated) ----------
const BOT = (login) => !login || login === 'github-actions' || /\[bot\]$/.test(login);
function gh(args, timeout = 60000) {
  const r = spawnSync('gh', args, { timeout, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error('gh: ' + (r.stderr || '').toString().slice(0, 200));
  return r.stdout.toString();
}
function ghAvailable() {
  try {
    return spawnSync('gh', ['auth', 'status'], { timeout: 8000 }).status === 0;
  } catch {
    return false;
  }
}
let ghLoginMemo;
function ghLogin() {
  if (ghLoginMemo !== undefined) return ghLoginMemo;
  try {
    const r = spawnSync('gh', ['api', 'user', '--jq', '.login'], { timeout: 8000 });
    ghLoginMemo = r.status === 0 ? r.stdout.toString().trim() || null : null;
  } catch {
    ghLoginMemo = null;
  }
  return ghLoginMemo;
}
let meMemo;
async function whoAmI() {
  if (meMemo) return meMemo;
  let email = creds().email || null,
    accountId = null;
  try {
    const me = await jira(await jiraAuth(firstProject()), '/myself');
    accountId = me.accountId || null;
    email = me.emailAddress || email;
  } catch {}
  meMemo = { login: ghLogin(), email, accountId };
  return meMemo;
}

const prQuery = (owner, name) =>
  `query($cur:String){repository(owner:"${owner}",name:"${name}"){defaultBranchRef{name} pullRequests(first:50,after:$cur,orderBy:{field:UPDATED_AT,direction:DESC}){pageInfo{hasNextPage endCursor} nodes{number title headRefName baseRefName state createdAt mergedAt closedAt additions deletions changedFiles author{login} assignees(first:5){nodes{login}} reviews(first:30){nodes{state author{login} submittedAt}} comments{totalCount} reviewThreads{totalCount} files(first:30){nodes{path additions deletions}} reviewRequests(first:10){nodes{requestedReviewer{__typename ... on User{login} ... on Team{name}}}} timelineItems(itemTypes:[REVIEW_REQUESTED_EVENT],first:20){nodes{... on ReviewRequestedEvent{createdAt requestedReviewer{__typename ... on User{login} ... on Team{name}}}}} commits(last:1){nodes{commit{statusCheckRollup{state}}}}}}}}`;
const GQL = prQuery('<owner>', '<name>');
const ghCommandFor = (repo) => `gh api graphql -f query='${prQuery(...String(repo).split('/'))}'`;
const reviewerLogin = (r) => r?.login || r?.name || '';

function fetchPRs(cfg) {
  const [owner, name] = cfg.githubRepo.split('/');
  if (!owner || !name) return [];
  const q = prQuery(owner, name);
  const prs = [];
  let cur = '';
  for (let page = 0; page < 6; page++) {
    // ponytail: 300 most-recent PRs; bump the cap if history matters
    const args = ['api', 'graphql', '-f', `query=${q}`];
    if (cur) args.push('-F', `cur=${cur}`);
    const j = JSON.parse(gh(args));
    const defaultBranch = j.data.repository.defaultBranchRef?.name || null;
    const conn = j.data.repository.pullRequests;
    for (const p of conn.nodes) {
      const m = (p.headRefName || '').match(cfg.ticketRegex) || (p.title || '').match(cfg.ticketRegex);
      if (!m) continue;
      const ticket = m[0].toUpperCase();
      const reviews = (p.reviews.nodes || []).map((r) => ({
        state: r.state,
        login: r.author?.login,
        at: r.submittedAt,
      }));
      const realReviews = reviews.filter((r) => !BOT(r.login) && r.at);
      const created = Date.parse(p.createdAt);
      const firstReview = realReviews.map((r) => Date.parse(r.at)).sort((a, b) => a - b)[0];
      const changesReq = reviews.filter((r) => r.state === 'CHANGES_REQUESTED').length;
      const approved = reviews.some((r) => r.state === 'APPROVED');
      let state = 'Open';
      if (p.mergedAt) state = 'Merged';
      else if (p.state === 'CLOSED') state = 'Closed';
      else if (approved) state = 'Approved';
      else if (changesReq > 0) state = 'Changes requested';
      const reviewers = [...new Set(realReviews.map((r) => r.login))];
      const requested = (p.reviewRequests?.nodes || [])
        .map((n) => reviewerLogin(n.requestedReviewer))
        .filter((l) => l && !BOT(l));
      const reviewRequests = (p.timelineItems?.nodes || [])
        .map((n) => ({ login: reviewerLogin(n.requestedReviewer), at: n.createdAt }))
        .filter((r) => r.login && r.at && !BOT(r.login));
      const firstReqAt = reviewRequests.map((r) => Date.parse(r.at)).sort((a, b) => a - b)[0];
      const checks = p.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state || null;
      const approvedAt = reviews
        .filter((r) => r.state === 'APPROVED' && r.at)
        .map((r) => Date.parse(r.at))
        .sort((a, b) => a - b)[0];
      prs.push({
        num: p.number,
        project: cfg.key,
        repo: cfg.githubRepo,
        ticket,
        title: p.title,
        branch: p.headRefName,
        state,
        url: `https://github.com/${cfg.githubRepo}/pull/${p.number}`,
        checks,
        author: p.author?.login || '',
        createdAt: p.createdAt,
        mergedAt: p.mergedAt,
        closedAt: p.closedAt,
        baseRefName: p.baseRefName || null,
        defaultBranch,
        additions: p.additions,
        deletions: p.deletions,
        changedFiles: p.changedFiles,
        comments: (p.comments?.totalCount || 0) + (p.reviewThreads?.totalCount || 0),
        firstReviewDays: firstReview ? +workDays(created, firstReview).toFixed(2) : null,
        firstReviewFromRequestDays:
          firstReview && firstReqAt && firstReview >= firstReqAt ? +workDays(firstReqAt, firstReview).toFixed(2) : null,
        mergeDays: p.mergedAt ? +workDays(created, Date.parse(p.mergedAt)).toFixed(2) : null,
        openDays: +workDays(created, p.mergedAt ? Date.parse(p.mergedAt) : Date.now()).toFixed(1),
        approvedAt: approvedAt ? new Date(approvedAt).toISOString() : null,
        approvedUnmergedDays:
          !p.mergedAt && p.state !== 'CLOSED' && approvedAt ? +workDays(approvedAt, Date.now()).toFixed(2) : null,
        cycles: 1 + changesReq,
        changesRequested: changesReq,
        reviewers,
        assignees: (p.assignees?.nodes || []).map((a) => a.login).filter(Boolean),
        files: (p.files.nodes || []).map((f) => ({ path: f.path, add: f.additions, del: f.deletions })),
        reviewEvents: realReviews.map((r) => ({ state: r.state, login: r.login, at: r.at })),
        requestedReviewers: [...new Set(requested)],
        reviewRequests,
        unanswered: [...new Set(requested)].filter((l) => !reviewers.includes(l)),
      });
    }
    if (!conn.pageInfo.hasNextPage) break;
    cur = conn.pageInfo.endCursor;
  }
  return prs;
}

// ---------- CI health (§11) — NEW gh calls, existing auth. Cached separately, shorter TTL. ----------
const CI_FILE_TTL = DATA_TTL;
const ciCache = new Map(); // project key -> {at, data}
const ghJSON = (pathQ, timeout = 30000) => JSON.parse(gh(['api', pathQ], timeout));
function ciFor(cfg, errs) {
  const hit = ciCache.get(cfg.key);
  if (hit && Date.now() - hit.at < CI_FILE_TTL) return hit.data;
  if (!cfg.githubRepo || !ghAvailable()) return null;
  const data = safe(
    () => {
      const repo = ghJSON(`/repos/${cfg.githubRepo}`);
      const branch = repo.default_branch || 'main';
      const runs = (ghJSON(`/repos/${cfg.githubRepo}/actions/runs?branch=${branch}&per_page=50`).workflow_runs || [])
        .filter((r) => r.conclusion)
        .map((r) => ({
          id: r.id,
          name: r.name || r.workflow_id,
          sha: r.head_sha,
          actor: r.actor?.login || '',
          attempt: r.run_attempt || 1,
          conclusion: r.conclusion,
          at: r.created_at,
          done: r.updated_at,
          url: r.html_url,
          mins: +((Date.parse(r.updated_at) - Date.parse(r.created_at)) / 60000 || 0).toFixed(1),
        }))
        .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
      const fails = runs.filter((r) => r.conclusion === 'failure');
      const greens = [];
      let redAt = null;
      for (const r of runs) {
        if (r.conclusion === 'failure' && redAt == null) redAt = Date.parse(r.at);
        else if (r.conclusion === 'success' && redAt != null) {
          greens.push(+(workMs(redAt, Date.parse(r.at)) / H).toFixed(2));
          redAt = null;
        }
      }
      const bySha = {};
      for (const r of runs) (bySha[r.sha] ||= []).push(r);
      const flakyShas = Object.entries(bySha).filter(
        ([, rs]) => rs.some((r) => r.conclusion === 'failure') && rs.some((r) => r.conclusion === 'success')
      );
      const jobCount = {};
      for (const [sha, rs] of flakyShas.slice(0, 8)) {
        // ponytail: cap the per-run jobs fan-out
        for (const r of rs.filter((x) => x.conclusion === 'failure')) {
          const jobs = safe(() => ghJSON(`/repos/${cfg.githubRepo}/actions/runs/${r.id}/jobs`).jobs || [], [], errs);
          for (const j of jobs.filter((j) => j.conclusion === 'failure')) {
            const k = j.name;
            const e = (jobCount[k] ||= { job: k, workflow: r.name, flakes: 0, shas: [], lastUrl: j.html_url });
            e.flakes++;
            if (!e.shas.includes(sha)) e.shas.push(sha.slice(0, 7));
          }
        }
      }
      const last = runs[runs.length - 1] || null;
      return {
        project: cfg.key,
        repo: cfg.githubRepo,
        branch,
        runs: runs.slice(-20).reverse(),
        total: runs.length,
        failures: fails.length,
        failureRate: runs.length ? +((fails.length / runs.length) * 100).toFixed(1) : null,
        medianTimeToGreenHours: median(greens),
        medianRunMins: median(runs.map((r) => r.mins)),
        red: !!last && last.conclusion === 'failure',
        brokeIt: last && last.conclusion === 'failure' ? last.actor : null,
        lastRun: last,
        flaky: Object.values(jobCount)
          .sort((a, b) => b.flakes - a.flakes)
          .slice(0, 10),
        flakyShaCount: flakyShas.length,
      };
    },
    null,
    errs
  );
  ciCache.set(cfg.key, { at: Date.now(), data });
  return data;
}

// ---------- triage (§1) — one pass, typed risk records. 100% of it is already-computed signal. ----------
const TRIAGE_FILE = ENG_STATE.triage;
function readTriage() {
  try {
    return JSON.parse(fs.readFileSync(TRIAGE_FILE, 'utf8'));
  } catch {
    return {};
  }
}
function writeTriage(o) {
  fs.writeFileSync(TRIAGE_FILE, JSON.stringify(o, null, 2));
}
const jiraLink = (i) => i.url || `https://${i.host}/browse/${i.key}`;

function triage(issues, prs, ci = []) {
  const out = [];
  const push = (r) =>
    out.push({ id: `${r.kind}:${r.subjectKey}`, overBudgetBy: null, ageWorkDays: null, owner: null, ...r });
  for (const c of ci)
    if (c?.red)
      push({
        kind: 'red-main',
        severity: 0,
        subject: `${c.repo}@${c.branch} is red`,
        subjectKey: c.repo,
        project: c.project,
        owner: c.brokeIt ? { name: c.brokeIt } : null,
        deepLink: c.lastRun?.url || `https://github.com/${c.repo}/actions`,
        ageWorkDays: c.lastRun ? +workDays(Date.parse(c.lastRun.at), Date.now()).toFixed(2) : null,
        detail: c.lastRun ? `${c.lastRun.name} failed` : '',
      });
  for (const i of issues) {
    if (i.live) continue;
    const age = i.inCurrent;
    if (i.rec?.atRisk)
      push({
        kind: 'over-budget',
        severity: 1,
        subject: `${i.key} ${i.summary}`,
        subjectKey: i.key,
        project: i.project,
        owner: i.assignee,
        ageWorkDays: age,
        overBudgetBy: +(-i.rec.remaining).toFixed(2),
        deepLink: jiraLink(i),
        detail: `${i.status} ${age}d — budget ${i.rec.budget}d, move to ${i.rec.next}`,
      });
    if (i.stale)
      push({
        kind: 'stale-status',
        severity: 1,
        subject: `${i.key} ${i.summary}`,
        subjectKey: i.key,
        project: i.project,
        owner: i.assignee,
        ageWorkDays: age,
        deepLink: jiraLink(i),
        detail: i.staleNote,
      });
    if (norm(i.status) === 'qa blocked')
      push({
        kind: 'qa-blocked',
        severity: 1,
        subject: `${i.key} ${i.summary}`,
        subjectKey: i.key,
        project: i.project,
        owner: i.assignee,
        ageWorkDays: age,
        deepLink: jiraLink(i),
        detail: `QA Blocked ${age}d`,
      });
    if (i.active && !i.prNums.length && age > 1)
      push({
        kind: 'no-pr',
        severity: 2,
        subject: `${i.key} ${i.summary}`,
        subjectKey: i.key,
        project: i.project,
        owner: i.assignee,
        ageWorkDays: age,
        deepLink: jiraLink(i),
        detail: `active ${age}d, no PR`,
      });
    if (i.qaCycles >= 3)
      push({
        kind: 'qa-loops',
        severity: 2,
        subject: `${i.key} ${i.summary}`,
        subjectKey: i.key,
        project: i.project,
        owner: i.assignee,
        ageWorkDays: age,
        deepLink: jiraLink(i),
        detail: `${i.qaCycles} QA cycles`,
      });
  }
  for (const p of prs) {
    if (p.state === 'Merged' || p.state === 'Closed') continue;
    const owner = p.author ? { name: p.author, login: p.author } : null;
    if (p.openDays > 2 && !p.reviewEvents.length)
      push({
        kind: 'pr-no-review',
        severity: 1,
        subject: `#${p.num} ${p.title}`,
        subjectKey: `${p.repo}#${p.num}`,
        project: p.project,
        owner,
        ageWorkDays: p.openDays,
        overBudgetBy: +(p.openDays - 2).toFixed(2),
        deepLink: p.url,
        detail: p.requestedReviewers.length
          ? `open ${p.openDays}d, requested ${p.requestedReviewers.join(', ')} — zero reviews`
          : `open ${p.openDays}d, no reviewer requested`,
        waitingOn: p.requestedReviewers,
      });
    if (p.approvedUnmergedDays != null && p.approvedUnmergedDays > 1)
      push({
        kind: 'pr-approved-unmerged',
        severity: 2,
        subject: `#${p.num} ${p.title}`,
        subjectKey: `${p.repo}#${p.num}`,
        project: p.project,
        owner,
        ageWorkDays: p.approvedUnmergedDays,
        overBudgetBy: +(p.approvedUnmergedDays - 1).toFixed(2),
        deepLink: p.url,
        detail: `approved ${p.approvedUnmergedDays}d ago, still not merged`,
      });
    if (p.changesRequested >= 2)
      push({
        kind: 'pr-rework',
        severity: 2,
        subject: `#${p.num} ${p.title}`,
        subjectKey: `${p.repo}#${p.num}`,
        project: p.project,
        owner,
        ageWorkDays: p.openDays,
        deepLink: p.url,
        detail: `${p.changesRequested} rounds of changes requested`,
      });
    if (p.checks === 'FAILURE' || p.checks === 'ERROR')
      push({
        kind: 'pr-red-checks',
        severity: 2,
        subject: `#${p.num} ${p.title}`,
        subjectKey: `${p.repo}#${p.num}`,
        project: p.project,
        owner,
        ageWorkDays: p.openDays,
        deepLink: p.url,
        detail: 'checks failing',
      });
  }
  const wip = {};
  for (const i of issues)
    if (i.active && i.assignee)
      (wip[i.assignee.id] ||= { who: i.assignee, keys: [], project: i.project }).keys.push(i.key);
  for (const w of Object.values(wip))
    if (w.keys.length > 2)
      push({
        kind: 'wip-overload',
        severity: 2,
        subject: `${w.who.name} has ${w.keys.length} tickets in flight`,
        subjectKey: w.who.id,
        project: w.project,
        owner: w.who,
        ageWorkDays: null,
        deepLink: null,
        detail: w.keys.join(', '),
        keys: w.keys,
      });
  const dis = readTriage();
  const now = Date.now();
  const live = out.filter((r) => {
    const d = dis[r.id];
    return !(d && (!d.until || Date.parse(d.until) > now));
  });
  live.sort((a, b) => a.severity - b.severity || (b.ageWorkDays || 0) - (a.ageWorkDays || 0));
  return live;
}

// ---------- review flow, keyed on REVIEWER (§4) — never a slowest-reviewer leaderboard ----------
function reviewFlow(prs) {
  const now = Date.now();
  const within = (at, d) => at && now - Date.parse(at) < d * DAY;
  const R = {};
  const rec = (login) =>
    (R[login] ||= {
      login,
      awaiting: 0,
      oldestWaitDays: null,
      given30: 0,
      given90: 0,
      received30: 0,
      received90: 0,
      lat30: [],
      lat90: [],
    });
  for (const p of prs) {
    const open = p.state !== 'Merged' && p.state !== 'Closed';
    if (open)
      for (const l of p.unanswered) {
        const r = rec(l);
        const askedAt =
          p.reviewRequests
            .filter((x) => x.login === l)
            .map((x) => Date.parse(x.at))
            .sort((a, b) => a - b)[0] || Date.parse(p.createdAt);
        const wait = +workDays(askedAt, now).toFixed(2);
        r.awaiting++;
        if (r.oldestWaitDays == null || wait > r.oldestWaitDays) r.oldestWaitDays = wait;
      }
    const seen = new Set();
    for (const e of p.reviewEvents) {
      if (seen.has(e.login)) continue;
      seen.add(e.login);
      const r = rec(e.login);
      if (within(e.at, 90)) r.given90++;
      if (within(e.at, 30)) r.given30++;
      const askedAt =
        p.reviewRequests
          .filter((x) => x.login === e.login)
          .map((x) => Date.parse(x.at))
          .sort((a, b) => a - b)[0] || Date.parse(p.createdAt);
      const lat = Date.parse(e.at) >= askedAt ? +workDays(askedAt, Date.parse(e.at)).toFixed(2) : null;
      if (lat != null && within(e.at, 90)) r.lat90.push(lat);
      if (lat != null && within(e.at, 30)) r.lat30.push(lat);
    }
    if (p.author && !BOT(p.author)) {
      const a = rec(p.author);
      if (within(p.createdAt, 90)) a.received90 += p.reviewEvents.length;
      if (within(p.createdAt, 30)) a.received30 += p.reviewEvents.length;
    }
  }
  const reviewers = Object.values(R)
    .map((r) => ({
      login: r.login,
      awaiting: r.awaiting,
      oldestWaitDays: r.oldestWaitDays,
      given30: r.given30,
      given90: r.given90,
      received30: r.received30,
      received90: r.received90,
      p50_30: pctl(r.lat30, 0.5),
      p90_30: pctl(r.lat30, 0.9),
      p50_90: pctl(r.lat90, 0.5),
      p90_90: pctl(r.lat90, 0.9),
      n30: r.lat30.length,
      n90: r.lat90.length,
    }))
    .sort((a, b) => b.awaiting - a.awaiting || b.given90 - a.given90);
  const totals = reviewers.map((r) => r.given90).sort((a, b) => b - a);
  const sum = totals.reduce((a, b) => a + b, 0);
  const share = (n) => (sum ? +((totals.slice(0, n).reduce((a, b) => a + b, 0) / sum) * 100).toFixed(1) : null);
  const openPrs = prs.filter((p) => p.state !== 'Merged' && p.state !== 'Closed');
  return {
    reviewers,
    concentration: {
      total90: sum,
      reviewerCount: reviewers.filter((r) => r.given90 > 0).length,
      top1Share: share(1),
      top2Share: share(2),
      flagged: (share(2) || 0) > 60,
    },
    noReviewerRequested: openPrs
      .filter((p) => !p.requestedReviewers.length && !p.reviewEvents.length)
      .map((p) => ({ num: p.num, repo: p.repo, title: p.title, openDays: p.openDays, author: p.author, url: p.url })),
    unanswered: openPrs
      .filter((p) => p.unanswered.length)
      .map((p) => ({
        num: p.num,
        repo: p.repo,
        title: p.title,
        openDays: p.openDays,
        author: p.author,
        url: p.url,
        waitingOn: p.unanswered,
      })),
    firstReview: {
      p50: pctl(
        prs.map((p) => p.firstReviewFromRequestDays),
        0.5
      ),
      p90: pctl(
        prs.map((p) => p.firstReviewFromRequestDays),
        0.9
      ),
    },
    mergeTime: {
      p50: pctl(
        prs.map((p) => p.mergeDays),
        0.5
      ),
      p90: pctl(
        prs.map((p) => p.mergeDays),
        0.9
      ),
    },
  };
}

// ---------- quality (§5) — escape rate, area hotspots, ownership concentration. No blame panel. ----------
const top2Seg = (p) => String(p).split('/').slice(0, 2).join('/');
function quality(issues, prs) {
  const byKey = {};
  for (const i of issues) byKey[i.key] = i;
  const prByNum = {};
  for (const p of prs) prByNum[`${p.project}#${p.num}`] = p;
  const bugs = issues.filter((i) => i.isBug);
  const escaped = [],
    caught = [];
  for (const b of bugs) {
    const parent = b.linkedKey ? byKey[b.linkedKey] : null;
    const parentLive = parent?.liveAt ? Date.parse(parent.liveAt) : null;
    const isEscaped = !!parentLive && Date.parse(b.created) > parentLive;
    b.escaped = isEscaped;
    (isEscaped ? escaped : caught).push(b);
  }
  const escapeReport = escapeRateSeries({
    bugs: bugs.map((b) => {
      const parent = b.linkedKey ? byKey[b.linkedKey] : null;
      return {
        escaped: !!b.escaped,
        created: Date.parse(b.created) || null,
        parentLiveAt: parent?.liveAt ? Date.parse(parent.liveAt) : null,
      };
    }),
    shipped: issues.filter((i) => i.live && !i.isBug && i.liveAt).map((i) => ({ liveAt: Date.parse(i.liveAt) })),
  });
  const escapeRate = escapeReport.series;
  const areaBugs = {},
    areaShipped = {};
  const pathsOf = (i) => {
    const set = new Set();
    for (const n of i?.prNums || [])
      for (const f of prByNum[`${i.project}#${n}`]?.files || []) set.add(top2Seg(f.path));
    return [...set];
  };
  for (const i of issues)
    if (i.live && !i.isBug) for (const a of pathsOf(i)) areaShipped[a] = (areaShipped[a] || 0) + 1;
  for (const b of bugs) {
    const parent = b.linkedKey ? byKey[b.linkedKey] : null;
    for (const a of [...new Set([...pathsOf(parent), ...pathsOf(b)])])
      (areaBugs[a] ||= { area: a, bugs: 0, escaped: 0, keys: [] }).bugs++;
    for (const a of [...new Set([...pathsOf(parent), ...pathsOf(b)])]) {
      if (b.escaped) areaBugs[a].escaped++;
      areaBugs[a].keys.push(b.key);
    }
  }
  const hotspots = Object.values(areaBugs)
    .map((a) => ({
      ...a,
      keys: a.keys.slice(0, 20),
      shipped: areaShipped[a.area] || 0,
      bugsPerShipped: areaShipped[a.area] ? +(a.bugs / areaShipped[a.area]).toFixed(2) : null,
    }))
    .sort((a, b) => b.bugs - a.bugs)
    .slice(0, 10);
  const comp = {};
  for (const i of issues) {
    if (!i.area || !i.live || !i.assignee) continue;
    const c = (comp[i.area] ||= { area: i.area, total: 0, by: {} });
    c.total++;
    c.by[i.assignee.name] = (c.by[i.assignee.name] || 0) + 1;
  }
  const ownership = Object.values(comp)
    .map((c) => {
      const rows = Object.entries(c.by)
        .map(([who, n]) => ({ who, n, share: +((n / c.total) * 100).toFixed(1) }))
        .sort((a, b) => b.n - a.n);
      const bf = busFactor({ total: c.total, rows });
      return {
        area: c.area,
        total: c.total,
        contributors: rows.length,
        rows,
        top: rows[0] || null,
        busFactor: bf.busFactor,
        busFactorReason: bf.reason,
        busFactorMinN: bf.minN,
      };
    })
    .sort((a, b) => b.total - a.total);
  return {
    escapeRate,
    escapeMeta: { measurable: escapeReport.measurable, linkablePct: escapeReport.linkablePct, note: escapeReport.note },
    hotspots,
    ownership,
    totals: {
      bugs: bugs.length,
      escaped: escaped.length,
      qaCaught: caught.length,
      reopens: issues.filter((i) => i.rework > 0).length,
    },
  };
}

// ---------- investment mix (§7) — delivered points AND activeDays, bucketed. Rules from projects.json. ----------
const DEFAULT_BUCKETS = {
  bug: { types: ['bug', 'defect'] },
  ai: { labels: ['ai', 'ai-experiment', 'ai-experimentation', 'claude', 'cursor', 'genai', 'llm'] },
  toil: {
    types: ['task', 'chore', 'support', 'maintenance', 'sub-task'],
    labels: ['tech-debt', 'techdebt', 'tech_debt', 'toil', 'ktlo', 'ops', 'refactor', 'chore'],
  },
  feature: { types: ['story', 'epic', 'feature', 'improvement', 'new feature'] },
};
const effortBuckets = () => {
  const j = projectsFile();
  return (!Array.isArray(j) && j?.effortBuckets) || DEFAULT_BUCKETS;
};
function bucketOf(i, B) {
  const type = norm(i.type),
    labels = (i.labels || []).map(norm);
  const hits = (b) =>
    (B[b]?.types || []).some((t) => type.includes(norm(t))) ||
    (B[b]?.labels || []).some((l) => labels.includes(norm(l)));
  if (i.isBug || hits('bug')) return i.escaped ? 'bug-escaped' : 'bug-qa';
  if (hits('ai')) return 'ai';
  if (hits('toil')) return 'toil';
  if (hits('feature')) return 'feature';
  return 'feature';
}
const BUCKETS = ['feature', 'bug-escaped', 'bug-qa', 'toil', 'ai'];
function investment(issues) {
  const B = effortBuckets();
  const byMonth = {};
  for (const i of issues) {
    if (!i.live || !i.liveAt) continue;
    const m = monthKey(Date.parse(i.liveAt));
    const row = (byMonth[m] ||= {
      month: m,
      pts: 0,
      days: 0,
      reworkPts: 0,
      reworkDays: 0,
      buckets: Object.fromEntries(BUCKETS.map((b) => [b, { pts: 0, days: 0, n: 0 }])),
    });
    const b = bucketOf(i, B);
    row.buckets[b].pts += i.pts;
    row.buckets[b].days += i.activeDays;
    row.buckets[b].n++;
    row.pts += i.pts;
    row.days += i.activeDays;
    if (i.rework > 0) {
      row.reworkPts += i.pts;
      row.reworkDays += i.activeDays;
    }
  }
  const months = Object.values(byMonth)
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-6);
  for (const m of months) {
    m.pts = +m.pts.toFixed(1);
    m.days = +m.days.toFixed(1);
    m.reworkPts = +m.reworkPts.toFixed(1);
    m.reworkDays = +m.reworkDays.toFixed(1);
    for (const b of BUCKETS) {
      m.buckets[b].pts = +m.buckets[b].pts.toFixed(1);
      m.buckets[b].days = +m.buckets[b].days.toFixed(1);
    }
  }
  const cur = months[months.length - 1],
    prev = months[months.length - 2];
  const tax = (m) =>
    m && m.pts
      ? +(((m.buckets['bug-escaped'].pts + m.buckets['bug-qa'].pts + m.buckets.toil.pts) / m.pts) * 100).toFixed(1)
      : null;
  return { buckets: BUCKETS, months, rules: B, bugTaxPct: tax(cur), bugTaxPrevPct: tax(prev) };
}

// ---------- sprint predictability (§8) — from the Sprint changelog items statusSegments now keeps ----------
function sprintNamesAt(i, t) {
  const evs = i.sprintEvents || [];
  const before = evs.filter((e) => e.at <= t);
  if (before.length) return nameList(before[before.length - 1].to);
  if (evs.length) return nameList(evs[0].from);
  return (i.sprints || []).map((s) => s.name);
}
function sprintStats(issues) {
  const reg = {};
  for (const i of issues)
    for (const s of i.sprints || [])
      if (s.name) {
        const e = (reg[`${i.project}§${s.name}`] ||= { ...s, project: i.project });
        for (const k of ['startDate', 'endDate', 'completeDate', 'id', 'state']) if (!e[k] && s[k]) e[k] = s[k];
      }
  const byProject = {};
  for (const s of Object.values(reg)) if (s.startDate) (byProject[s.project] ||= []).push(s);
  const issuesOf = {};
  for (const i of issues) (issuesOf[i.project] ||= []).push(i);
  const sprints = Object.values(byProject).flatMap((a) =>
    a.sort((x, y) => Date.parse(y.startDate) - Date.parse(x.startDate)).slice(0, 6)
  );
  return sprints.map((s) => {
    const start = Date.parse(s.startDate);
    const end = Date.parse(s.completeDate || s.endDate || new Date().toISOString());
    const committed = [],
      added = [],
      delivered = [],
      addedDelivered = [],
      carried = [],
      preDone = [];
    for (const i of issuesOf[s.project] || []) {
      const inNow = (i.sprints || []).some((x) => x.name === s.name);
      const everIn =
        inNow ||
        (i.sprintEvents || []).some((e) => nameList(e.to).includes(s.name) || nameList(e.from).includes(s.name));
      if (!everIn) continue;
      const liveAt = i.liveAt ? Date.parse(i.liveAt) : null;
      if (liveAt != null && liveAt < start) {
        preDone.push(i);
        continue;
      }
      const atStart = sprintNamesAt(i, start).includes(s.name);
      const atEnd = sprintNamesAt(i, end).includes(s.name);
      const done = liveAt != null && liveAt <= end;
      if (atStart) {
        committed.push(i);
        (done ? delivered : carried).push(i);
      } else if (atEnd || inNow) {
        added.push(i);
        if (done) addedDelivered.push(i);
      }
    }
    const pts = (a) => +a.reduce((x, i) => x + (i.pts || 0), 0).toFixed(1);
    const cpts = pts(committed),
      dpts = pts(delivered),
      adpts = pts(addedDelivered);
    return {
      id: s.id,
      name: s.name,
      project: s.project,
      state: s.state,
      startDate: s.startDate,
      endDate: s.endDate,
      completeDate: s.completeDate,
      committed: committed.length,
      committedPts: cpts,
      added: added.length,
      addedPts: pts(added),
      delivered: delivered.length,
      deliveredPts: dpts,
      addedDelivered: addedDelivered.length,
      addedDeliveredPts: adpts,
      shipped: delivered.length + addedDelivered.length,
      shippedPts: +(dpts + adpts).toFixed(1),
      carriedOver: carried.length,
      carriedOverPts: pts(carried),
      preDone: preDone.length,
      committedPointed: committed.filter((i) => i.pts > 0).length,
      injectionPct: cpts ? +((pts(added) / cpts) * 100).toFixed(1) : null,
      sayDoPct: cpts ? +((dpts / cpts) * 100).toFixed(1) : null,
      sayDoCountPct: committed.length ? +((delivered.length / committed.length) * 100).toFixed(1) : null,
      keys: {
        committed: committed.map((i) => i.key),
        added: added.map((i) => i.key),
        delivered: delivered.map((i) => i.key),
        carriedOver: carried.map((i) => i.key),
        preDone: preDone.map((i) => i.key),
      },
    };
  });
}

// ---------- epic rollup + forecast (§10) ----------
const EPIC_FILE = ENG_STATE.epicTargets;
function readEpicTargets() {
  try {
    return JSON.parse(fs.readFileSync(EPIC_FILE, 'utf8'));
  } catch {
    return {};
  }
}
function writeEpicTargets(o) {
  fs.writeFileSync(EPIC_FILE, JSON.stringify(o, null, 2));
}
function epicRollup(issues) {
  const byKey = {};
  for (const i of issues) byKey[i.key] = i;
  const targets = readEpicTargets();
  const since = Date.now() - 56 * DAY;
  const vel = issues
    .filter((i) => i.live && i.liveAt && Date.parse(i.liveAt) >= since)
    .reduce((a, i) => a + (i.pts || 0), 0);
  const perDay = vel / Math.max(1, workDays(since, Date.now()));
  const groups = {};
  for (const i of issues)
    if (i.parent?.key)
      (groups[i.parent.key] ||= { key: i.parent.key, summary: i.parent.summary, kids: [] }).kids.push(i);
  const bugsByParent = {};
  for (const i of issues) if (i.isBug && i.linkedKey) (bugsByParent[i.linkedKey] ||= []).push(i);
  return Object.values(groups)
    .filter((g) => g.kids.some((k) => !k.live))
    .map((g) => {
      const done = g.kids.filter((k) => k.live);
      const ptsDone = +done.reduce((a, k) => a + (k.pts || 0), 0).toFixed(1);
      const ptsRemaining = +g.kids
        .filter((k) => !k.live)
        .reduce((a, k) => a + (k.pts || 0), 0)
        .toFixed(1);
      const starts = g.kids.map((k) => Date.parse(k.firstInProg || k.created)).filter(Boolean);
      const startedAt = starts.length ? Math.min(...starts) : null;
      const escapedBugs = g.kids.flatMap((k) => bugsByParent[k.key] || []).filter((b) => b.escaped);
      const forecast =
        perDay > 0 && ptsRemaining > 0
          ? new Date(addWorkTime(Date.now(), (ptsRemaining / perDay) * WORKDAY_MS_OF())).toISOString()
          : ptsRemaining === 0
          ? new Date().toISOString()
          : null;
      const epic = byKey[g.key];
      const due = targets[g.key]?.targetDate || epic?.duedate || null;
      const slipDays = due && forecast ? +workDays(Date.parse(due), Date.parse(forecast)).toFixed(1) : null;
      return {
        key: g.key,
        summary: g.summary,
        project: epic?.project || g.kids[0]?.project || null,
        url: epic ? jiraLink(epic) : null,
        total: g.kids.length,
        done: done.length,
        pctComplete: g.kids.length ? +((done.length / g.kids.length) * 100).toFixed(1) : 0,
        ptsDone,
        ptsRemaining,
        daysInFlight: startedAt ? +workDays(startedAt, Date.now()).toFixed(1) : null,
        escapedBugs: escapedBugs.length,
        escapedBugKeys: escapedBugs.map((b) => b.key),
        velocityPtsPerDay: +perDay.toFixed(2),
        forecastDate: forecast,
        targetDate: due,
        targetManual: !!targets[g.key]?.targetDate,
        slipDays,
        risk: slipDays == null ? 'unknown' : slipDays > 5 ? 'red' : slipDays > 0 ? 'amber' : 'green',
        keys: g.kids.map((k) => k.key),
      };
    })
    .sort((a, b) => (b.slipDays ?? -99) - (a.slipDays ?? -99));
}

// ---------- sustainable pace (§14) — TEAM AGGREGATE ONLY. min-N=5 enforced HERE, not in the UI. ----------
const MIN_N = 5;
function loadStats(prs, issues, members) {
  const weeks = {};
  for (const p of prs) {
    if (!p.createdAt || BOT(p.author)) continue;
    const t = Date.parse(p.createdAt);
    const w = (weeks[weekKey(t)] ||= { week: weekKey(t), n: 0, off: 0, weekend: 0, authors: new Set() });
    w.n++;
    if (offHours(t)) w.off++;
    if (isWeekend(t)) w.weekend++;
    if (p.author) w.authors.add(p.author);
  }
  const rows = Object.values(weeks)
    .sort((a, b) => a.week.localeCompare(b.week))
    .slice(-12)
    .map((w) => {
      const suppressed = w.authors.size < MIN_N;
      return {
        week: w.week,
        prs: suppressed ? null : w.n,
        contributors: w.authors.size,
        suppressed,
        offHoursPct: suppressed ? null : +((w.off / w.n) * 100).toFixed(1),
        weekendPct: suppressed ? null : +((w.weekend / w.n) * 100).toFixed(1),
      };
    });
  const active = issues.filter((i) => i.active).length;
  const heads = members.length;
  return {
    minN: MIN_N,
    weeks: rows,
    wipPerEngineer: heads >= MIN_N ? +(active / heads).toFixed(2) : null,
    headcount: heads,
    note: 'Team aggregate only. No per-person rows exist in this payload, by construction.',
  };
}

// ---------- snapshot (cached per project: in-memory TTL, warm-started from disk) ----------
const snaps = new (class extends Map {
  delete(k) {
    const r = super.delete(k);
    queueMicrotask(persistDisk);
    return r;
  }
  clear() {
    super.clear();
    queueMicrotask(persistDisk);
  }
})();
const SNAP_TTL = DATA_TTL; // the JIRA+GitHub aggregate
const SNAP_FILE = path.join(os.homedir(), '.claude', 'eng-snapshot.json'); // alongside career.json
const SNAP_SCHEMA = 1;
const SNAP_MAX_AGE = 14 * DAY;
function loadDisk() {
  let j;
  try {
    j = JSON.parse(fs.readFileSync(SNAP_FILE, 'utf8'));
  } catch {
    return false;
  }
  if (!j || j.v !== SNAP_SCHEMA || typeof j.snaps !== 'object') return false;
  const fresh = (at) => typeof at === 'number' && at > 0 && Date.now() - at < SNAP_MAX_AGE;
  const sane = (d) => d && d.available && Array.isArray(d.issues) && Array.isArray(d.prs) && Array.isArray(d.members);
  for (const [k, e] of Object.entries(j.snaps))
    if (e && fresh(e.at) && sane(e.data)) snaps.set(k, { at: e.at, data: e.data });
  for (const [k, e] of Object.entries(j.ci || {}))
    if (e && fresh(e.at) && Date.now() - e.at < CI_FILE_TTL) ciCache.set(k, { at: e.at, data: e.data });
  return snaps.size > 0;
}
function persistDisk() {
  try {
    fs.mkdirSync(path.dirname(SNAP_FILE), { recursive: true });
    const pick = (m) => Object.fromEntries([...m].map(([k, e]) => [k, { at: e.at, data: e.data }]));
    const tmp = `${SNAP_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(
      tmp,
      JSON.stringify({ v: SNAP_SCHEMA, writtenAt: new Date().toISOString(), snaps: pick(snaps), ci: pick(ciCache) })
    );
    fs.renameSync(tmp, SNAP_FILE);
  } catch (e) {
    console.error('[eng] snapshot persist failed:', e.message);
  }
}
let ghOkMemo = { at: 0, ok: false };
function ghAuthed() {
  if (Date.now() - ghOkMemo.at > 60_000) ghOkMemo = { at: Date.now(), ok: ghAvailable() };
  return ghOkMemo.ok;
}
const GH_UNAUTHED = 'gh CLI not authenticated (`gh auth status` failed) — PR, review and CI panels are empty, not zero';
function authErrors() {
  const at = new Date().toISOString(),
    errs = [];
  if (!ghAuthed()) errs.push({ source: 'gh', message: GH_UNAUTHED, at });
  const { email, token } = creds();
  if (!(email && token) && !acliProfile())
    errs.push({
      source: 'jira',
      message:
        'no JIRA credentials right now — showing the cached snapshot; the background refresh will fail until they are restored',
      at,
    });
  return errs;
}
const dedupeErrs = (errs) => [...new Map(errs.map((e) => [`${e.source}§${e.message}`, e])).values()];
const staleView = (data, at) => ({
  ...data,
  stale: true,
  refreshing: true,
  cachedAt: new Date(at).toISOString(),
  ageMs: Date.now() - at,
  errors: dedupeErrs([...(data.errors || []), ...authErrors()]),
});
function safe(fn, dflt, errs) {
  try {
    return fn();
  } catch (e) {
    console.error('[eng]', e.message);
    if (errs) errs.push({ source: 'gh', message: String(e.message).slice(0, 400), at: new Date().toISOString() });
    return dflt;
  }
}
const derive = (issues, prs, members, ci) => ({
  triage: triage(issues, prs, ci),
  review: reviewFlow(prs),
  quality: quality(issues, prs),
  investment: investment(issues),
  sprints: sprintStats(issues),
  epics: epicRollup(issues),
  load: loadStats(prs, issues, members),
  ci,
});
// fresh in memory → serve it · warm but past TTL (incl. anything seeded off disk) → serve it stale and
// refresh behind · genuinely cold → block on the live fetch, because a wrong answer is worse than a slow one
async function snapshot(cfg, { fresh = false } = {}) {
  // `fresh` blocks on a live fetch instead of answering from cache. With a 24h window this is
  // the difference between "I know it changed and I want to see it" and waiting a day, so it is
  // per-request rather than only the cache-clearing POST.
  if (fresh) return refresh(cfg);
  const hit = snaps.get(cfg.key);
  const refreshing = inflight.has(cfg.key);
  if (hit && Date.now() - hit.at < SNAP_TTL) return { ...hit.data, refreshing };
  if (hit) {
    refresh(cfg);
    return staleView(hit.data, hit.at);
  }
  return refresh(cfg);
}
const inflight = new Map();
function refresh(cfg) {
  const k = cfg.key;
  if (inflight.has(k)) return inflight.get(k);
  const p = computeSnapshot(cfg).finally(() => inflight.delete(k));
  inflight.set(k, p);
  p.catch((e) => console.error('[eng] refresh', k, e.message));
  return p;
}
async function computeSnapshot(cfg) {
  const errors = [];
  const gh0 = ghAuthed();
  if (!gh0) errors.push({ source: 'gh', message: GH_UNAUTHED, at: new Date().toISOString() });
  const prErrN = errors.length;
  const prs = gh0 ? safe(() => fetchPRs(cfg), [], errors) : [];
  const prsFailed = errors.length > prErrN;
  const prsByTicket = {};
  for (const p of prs) (prsByTicket[p.ticket] ||= []).push(p);
  const { issues: raw, F } = await jiraIssues(cfg);
  const issues = raw.map((is) => computeIssue(is, F, prsByTicket, cfg));
  resolveRoles(issues, cfg);
  resolveOwnership(issues);
  const dev = new Set(cfg.devEmails);
  const memMap = {};
  for (const i of issues)
    if (i.assignee) {
      const k = i.assignee.id;
      (memMap[k] ||= { ...i.assignee, count: 0 }).count++;
    }
  const allMembers = Object.values(memMap).sort((a, b) => b.count - a.count);
  const devMembers = allMembers.filter((m) => dev.has((m.email || '').toLowerCase()));
  const members = devMembers.length ? devMembers : allMembers; // ponytail: fall back if JIRA hides emails
  const ci = [ciFor(cfg, errors)].filter(Boolean);
  const data = {
    available: true,
    team: projectPill(cfg),
    projects: projectList(),
    generatedAt: new Date().toISOString(),
    stale: false,
    refreshing: false,
    ghAvailable: prs.length > 0 || gh0,
    issues,
    prs,
    members,
    okrs: OKRS,
    byProject: [{ key: cfg.key, name: cfg.name, issues, prs }],
    errors,
    writes: cfg.writes,
    provenance: {
      jql: cfg.jql,
      graphql: cfg.githubRepo ? prQuery(...cfg.githubRepo.split('/')) : GQL,
      ghCommand: cfg.githubRepo ? ghCommandFor(cfg.githubRepo) : null,
      workingTime: describeWork(WORK()),
      ttlMs: SNAP_TTL,
    },
    ...derive(issues, prs, members, ci),
  };
  snaps.set(cfg.key, { at: Date.now(), data });
  if (!prsFailed) persistDisk();
  return data;
}
async function snapshotAll({ fresh = false } = {}) {
  const projs = loadProjects();
  const parts = await Promise.all(
    projs.map((p) =>
      snapshot(p, { fresh }).catch((e) => ({ available: false, key: p.key, name: p.name, error: e.message }))
    )
  );
  const avail = parts.filter((p) => p.available);
  if (!avail.length) {
    const e = new Error(
      parts.every((p) => p.error === 'no-jira-creds') ? 'no-jira-creds' : parts[0]?.error || 'no-jira-creds'
    );
    throw e;
  }
  const issues = avail.flatMap((p) => p.issues);
  const prs = avail.flatMap((p) => p.prs);
  const mm = {};
  for (const p of avail)
    for (const m of p.members) {
      (mm[m.id] ||= { ...m, count: 0 }).count += m.count;
    }
  const members = Object.values(mm).sort((a, b) => b.count - a.count);
  const ci = avail.flatMap((p) => p.ci || []);
  const errors = dedupeErrs([
    ...avail.flatMap((p) => p.errors || []),
    ...parts
      .filter((p) => !p.available)
      .map((p) => ({
        source: 'project',
        project: p.key,
        message: `${p.name || p.key}: ${p.error}`,
        at: new Date().toISOString(),
      })),
  ]);
  const stale = avail.some((p) => p.stale);
  const refreshing = stale || avail.some((p) => p.refreshing);
  const gens = avail.map((p) => Date.parse(p.generatedAt)).filter((t) => t > 0);
  return {
    available: true,
    team: { key: 'all', name: 'All projects', jiraProjectKey: 'ALL', githubRepo: '' },
    projects: projectList(),
    generatedAt: new Date(gens.length ? Math.min(...gens) : Date.now()).toISOString(),
    stale,
    refreshing,
    ageMs: gens.length ? Date.now() - Math.min(...gens) : 0,
    ghAvailable: avail.some((p) => p.ghAvailable),
    issues,
    prs,
    members,
    okrs: OKRS,
    byProject: avail.map((p) => ({ key: p.team.key, name: p.team.name, issues: p.issues, prs: p.prs })),
    errors,
    writes: avail.some((p) => p.writes),
    provenance: {
      jql: loadProjects().map((p) => ({ project: p.key, jql: p.jql })),
      graphql: GQL,
      ghCommand: loadProjects()
        .filter((p) => p.githubRepo)
        .map((p) => ({ project: p.key, cmd: ghCommandFor(p.githubRepo) })),
      workingTime: describeWork(WORK()),
      ttlMs: SNAP_TTL,
    },
    ...derive(issues, prs, members, ci),
  };
}
async function snapFor(key, opts = {}) {
  if (key === 'all') return snapshotAll(opts);
  const projs = loadProjects();
  const k = String(key ?? '').toUpperCase();
  const cfg = projs.find((p) => p.key === k) || projs[0];
  // With no project configured this used to hand `undefined` to snapshot(), which then read
  // `cfg.key` and surfaced "Cannot read properties of undefined" to the client on every eng
  // route. That is a stack trace where an answer belongs — it names nothing the user can act on.
  if (!cfg) {
    const e = new Error(
      k
        ? `no project "${k}" is configured — add it in Setup, or pick one of: ${
            projs.map((p) => p.key).join(', ') || '(none configured yet)'
          }`
        : 'no JIRA/GitHub project is configured yet — add one in Setup'
    );
    e.status = 400;
    throw e;
  }
  return snapshot(cfg, opts);
}

// ---------- OKRs (§4) — every measure is AUTO, computed by the UI from live aggregates ----------
const OKRS = {
  Q3: [
    {
      title: 'Cut engineering effort per feature',
      def: 'Reduce hands-on development effort to ship a feature, without sacrificing quality.',
      owner: 'Web Engineering',
      color: '#5fd39a',
      measures: [
        {
          t: 'Reduce Avg Development Time 40% vs baseline',
          auto: 'devTime',
          note: 'Working days in In Progress · vs earliest-month baseline',
          reducePct: 40,
          baselineOf: 'devTime',
          unit: 'd',
          dir: 'down',
        },
        {
          t: 'Estimation accuracy above 85%',
          auto: 'estAcc',
          target: 85,
          unit: '%',
          dir: 'up',
          note: 'Story-point estimate vs actual dev time. SCALE CHANGED: accuracy is now min/max — symmetric, so finishing early is as inaccurate as finishing late, and padding an estimate no longer helps. 85% means landing within ~18% of the estimate. The previous formula scored any early finish >=50% and was trivially met by inflating estimates, so a target carried over from it is likely too high — re-baseline before treating a miss as a regression.',
        },
        {
          t: 'Code review time under 1 day',
          auto: 'crTime',
          note: 'Working days in In Code Review',
          target: 1.0,
          unit: 'd',
          dir: 'down',
        },
      ],
    },
    {
      title: 'Ship faster with fewer QA loops',
      def: 'Tighten the QA feedback loop so tickets spend less time bouncing between QA states.',
      owner: 'Web Engineering',
      color: '#8ec8ff',
      measures: [
        {
          t: 'Avg QA Cycles under 1.0',
          auto: 'qaCycles',
          note: 'kicked back out of QA to In Progress / Reopen',
          target: 1.0,
          unit: '',
          dir: 'down',
        },
        {
          t: 'Zero stale statuses',
          auto: 'stale',
          note: 'JIRA status vs merged-PR cross-check',
          target: 0,
          unit: '',
          dir: 'down',
        },
        {
          t: 'Cycle time under 4 days',
          auto: 'cycle',
          note: 'In Progress → Live, avg shipped',
          target: 4.0,
          unit: 'd',
          dir: 'down',
        },
      ],
    },
    {
      title: 'Tighten the PR feedback loop',
      def: 'Get PRs reviewed and merged faster, with fewer rework rounds.',
      owner: 'Web Engineering',
      color: '#a894f0',
      measures: [
        {
          t: 'Time to first review under 1 day',
          auto: 'firstReview',
          note: 'GitHub · opened → first review',
          target: 1.0,
          unit: 'd',
          dir: 'down',
        },
        {
          t: 'PR merge time under 3 days',
          auto: 'mergeTime',
          note: 'GitHub · opened → merged',
          target: 3.0,
          unit: 'd',
          dir: 'down',
        },
        {
          t: 'Rework rate under 15%',
          auto: 'reworkRate',
          note: 'Issues re-entering In Progress / Reopen',
          target: 15,
          unit: '%',
          dir: 'down',
        },
      ],
    },
  ],
  Q4: [
    {
      title: 'Sustain effort reduction gains',
      def: 'Hold the Q3 development-time improvements across the full surface.',
      owner: 'Web Engineering',
      color: '#8ec8ff',
      carried: 'Q3',
      measures: [
        {
          t: 'Reduce Avg Development Time 37% vs baseline',
          auto: 'devTime',
          note: 'Rolling · vs earliest-month baseline',
          reducePct: 37,
          baselineOf: 'devTime',
          unit: 'd',
          dir: 'down',
        },
        {
          t: 'Cycle time under 4 days',
          auto: 'cycle',
          note: 'In Progress → Live, avg shipped',
          target: 4.0,
          unit: 'd',
          dir: 'down',
        },
      ],
    },
    {
      title: 'Reach 90% estimation accuracy',
      def: 'Push planning quality to a 90% accuracy floor.',
      owner: 'Web Engineering',
      color: '#5fd39a',
      carried: 'Q3',
      measures: [
        {
          t: 'Avg Estimation Accuracy ≥ 90%',
          auto: 'estAcc',
          target: 90,
          unit: '%',
          dir: 'up',
          note: 'Story-point estimate vs actual. SCALE CHANGED (see above): 90% now means landing within ~11% of the estimate. Re-baseline this target — it was set against a formula that rewarded padding.',
        },
      ],
    },
  ],
};

// ---------- per-ticket detail + AI artifacts (Sprint analytics) ----------
const ARTIFACTS_FILE = ENG_STATE.artifacts;
function readArtifacts() {
  try {
    return JSON.parse(fs.readFileSync(ARTIFACTS_FILE, 'utf8'));
  } catch {
    return {};
  }
}
function writeArtifacts(o) {
  fs.writeFileSync(ARTIFACTS_FILE, JSON.stringify(o, null, 2));
}
const hashOf = (s) => crypto.createHash('sha256').update(s).digest('hex');
const cfgFor = (key) => {
  const k = String(key ?? '').toUpperCase();
  return loadProjects().find((p) => p.key === k) || null;
};
const cfgForTicket = (key, project) =>
  cfgFor(Array.isArray(project) ? project[0] : project) || cfgFor(String(key ?? '').split('-')[0]);
const firstProject = () => loadProjects()[0] || null;

const decodeEnt = (s) =>
  String(s)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
function htmlToText(html) {
  if (!html) return '';
  return decodeEnt(
    String(html)
      .replace(/<\s*(br|\/p|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, '\n')
      .replace(/<\s*li[^>]*>/gi, '• ')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
function historyOf(changelog) {
  const out = [];
  for (const h of changelog?.histories || [])
    for (const it of h.items || [])
      if (['status', 'assignee', 'Sprint'].includes(it.field))
        out.push({
          at: h.created,
          author: h.author?.displayName || '',
          field: it.field,
          from: it.fromString || '',
          to: it.toString || '',
        });
  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
function prCommits(cfg, num) {
  if (!cfg.githubRepo) return [];
  try {
    const j = JSON.parse(gh(['pr', 'view', String(num), '--repo', cfg.githubRepo, '--json', 'commits'], 20000));
    return (j.commits || [])
      .map((c) => (c.messageHeadline || '').trim())
      .filter(Boolean)
      .slice(0, 30);
  } catch {
    return [];
  }
}

function richText(v) {
  if (isAdf(v)) return adfToText(v).text;
  return htmlToText(v);
}

function snapWarm(cfg) {
  const hit = snaps.get(cfg.key);
  if (!hit) {
    try {
      refresh(cfg);
    } catch {}
    return null;
  }
  if (Date.now() - hit.at >= SNAP_TTL) {
    try {
      refresh(cfg);
    } catch {}
  }
  return hit.data;
}

const ticketCache = new Map(); // key -> {at, data}
const TICKET_TTL = DATA_TTL;
/**
 * @param {boolean} waitForPrs  true = the old behaviour (block until the snapshot exists). The
 *   Sprint-analytics drawer already has a warm snapshot by construction, so it costs nothing there;
 *   the key-first Ticket tab passes false and never blocks.
 */
async function ticketDetail(cfg, key, { waitForPrs = false, withCommits = false } = {}) {
  const hit = ticketCache.get(key);
  if (
    hit &&
    Date.now() - hit.at < TICKET_TTL &&
    (!waitForPrs || hit.data.prContext.loaded) &&
    (!withCommits || hit.data.prContext.commits)
  )
    return hit.data;
  const a = await jiraAuth(cfg);
  const iss = await jira(
    a,
    `/issue/${encodeURIComponent(
      key
    )}?expand=renderedFields,changelog&fields=summary,description,comment,status,issuetype,assignee,created,updated`
  );
  const rf = iss.renderedFields || {};
  const comments = (rf.comment?.comments || iss.fields.comment?.comments || []).map((c) => ({
    id: c.id ?? null,
    author: c.author?.displayName || '',
    at: c.created,
    body: richText(c.body),
  }));
  const snap = waitForPrs ? await snapshot(cfg).catch(() => null) : snapWarm(cfg);
  const prsRaw = (snap?.prs || []).filter((p) => p.ticket === key);
  const prs = prsRaw.map((p) => ({
    num: p.num,
    repo: p.repo,
    title: p.title,
    state: p.state,
    branch: p.branch,
    changedFiles: p.changedFiles,
    files: (p.files || []).map((f) => f.path).slice(0, 40),
    commits: withCommits ? prCommits(cfg, p.num) : [],
  }));
  const data = {
    key,
    summary: iss.fields.summary,
    type: iss.fields.issuetype?.name || '',
    status: iss.fields.status?.name || '',
    // Carried so a drawer that just wrote a transition or a reassignment can show the result
    // immediately — the board's own snapshot is minutes old and would contradict it.
    assignee: iss.fields.assignee
      ? { id: iss.fields.assignee.accountId, name: iss.fields.assignee.displayName || '' }
      : null,
    description: richText(rf.description ?? iss.fields.description),
    comments,
    history: historyOf(iss.changelog),
    prs,
    prContext: { loaded: !!snap, prs: prs.length, commits: withCommits },
  };
  ticketCache.set(key, { at: Date.now(), data });
  return data;
}

const GEN = {
  ac: 'You are a senior product engineer. From the JIRA ticket below, write clear, testable Acceptance Criteria as a markdown checklist — Given/When/Then where it helps, plain checklist otherwise. Cover the happy path, error/empty/loading states, and edge cases implied by the content. Output ONLY the acceptance criteria in markdown, no preamble.',
  tests:
    'You are a senior QA engineer. From the JIRA ticket below and its linked PR/commit context, write a concrete functional test plan as a markdown table with columns: #, Scenario, Steps, Expected. Include happy-path, negative, boundary and regression cases relevant to the changed files. Output ONLY the test plan in markdown, no preamble.',
};
function genPrompt(kind, d) {
  const prs = d.prs
    .map((p) => `PR #${p.num} (${p.state}) ${p.title}\nfiles: ${p.files.join(', ')}\ncommits: ${p.commits.join(' | ')}`)
    .join('\n\n');
  return `${GEN[kind]}\n\n# ${d.key} — ${d.summary}\nType: ${d.type} · Status: ${d.status}\n\n## Description\n${
    d.description || '(none)'
  }\n\n## Comments\n${
    d.comments.map((c) => `- ${c.author}: ${c.body}`).join('\n') || '(none)'
  }\n\n## Linked PR / commit context\n${prs || '(none)'}`;
}

const reqHash = (d) => hashOf(JSON.stringify([d.summary || '', d.description || '', d.type || '']));

function artifactsFor(d) {
  const art = readArtifacts()[d.key] || {};
  const h = reqHash(d);
  const one = (kind) => {
    const a = art[kind];
    if (!a) return null;
    if (a.reqHash === undefined)
      return {
        ...a,
        stale: null,
        staleReason: 'generated before staleness tracked the requirement — regenerate to start tracking',
      };
    const stale = a.reqHash !== h;
    const thin = a.prContextLoaded === false && d.prContext.loaded;
    return {
      ...a,
      stale,
      ...(thin && !stale
        ? { partialInput: 'generated before linked-PR context was available — regenerate to include it' }
        : {}),
    };
  };
  return { ac: one('ac'), tests: one('tests') };
}
function claudeMarkdown(prompt) {
  // ponytail: spawnSync blocks the handler — fine for a local single-user dashboard, same as career-analyze
  const r = spawnSync('claude', ['-p', prompt, '--output-format', 'json'], {
    timeout: 180_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error((r.stderr || 'claude failed').toString().slice(0, 200));
  const out = JSON.parse(r.stdout.toString());
  const md = out.result || out.text || '';
  if (!md) throw new Error('claude returned empty result');
  return { md, model: out.model || 'claude' };
}

export {
  snapshotAll,
  snapshot,
  snapFor,
  loadProjects,
  projectList,
  cfgFor,
  triage,
  readTriage,
  reviewFlow,
  quality,
  investment,
  sprintStats,
  epicRollup,
  loadStats,
  ciFor,
  workMs,
  workDays,
  addWorkTime,
  recFor,
  pctl,
  median,
  offHours,
  isWeekend,
  weekKey,
  GQL,
};
export {
  ticketDetail,
  cfgForTicket,
  firstProject,
  artifactsFor,
  reqHash,
  readArtifacts,
  writeArtifacts,
  genPrompt,
  statusSegments,
};

/**
 * A Confluence page's title and text, or null if it cannot be read.
 *
 * It lives here, next to `creds()`, because a second place that assembles an Atlassian
 * Authorization header is a second place that can get the credential precedence wrong — and
 * Confluence is the same host and the same token as the JIRA calls above it.
 */
export async function confluencePage(cfg, id) {
  const { email, token } = creds();
  if (!email || !token || !cfg?.jiraHost) return null;
  try {
    const r = await fetch(`https://${cfg.jiraHost}/wiki/api/v2/pages/${id}?body-format=storage`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`,
        Accept: 'application/json',
      },
    });
    if (!r.ok) return null;
    const j = await r.json();
    // Storage format is XHTML with Confluence macros in it. The macros are structure, not content —
    // an agent reading `<ac:structured-macro>` learns nothing — so only the text survives.
    const text = String(j.body?.storage?.value || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return { id, title: j.title || `page ${id}`, text: text.slice(0, 6000), truncated: text.length > 6000 };
  } catch {
    return null;
  }
}

// ---------- routes ----------
function warmBoot() {
  const warm = loadDisk();
  const cold = loadProjects().filter((p) => {
    const h = snaps.get(p.key);
    return !h || Date.now() - h.at >= SNAP_TTL;
  });
  console.log(
    warm
      ? `[eng] snapshot cache warm from disk: ${[...snaps.keys()].join(', ')}`
      : '[eng] no usable snapshot cache on disk — first call fetches live'
  );
  if (!cold.length) return;
  console.log(`[eng] refreshing ${cold.map((p) => p.key).join(', ')} in the background`);
  // ponytail: refresh() is async in signature only — gh()/ghAuthed() are spawnSync, so it runs to completion
  setImmediate(() => {
    for (const p of cold) refresh(p).catch(() => {});
  });
}

export default function mountEng(app) {
  warmBoot();
  app.get('/api/eng/projects', (req, res) => res.json(projectList()));
  app.post('/api/eng/projects', (req, res) => {
    const { name, jiraProjectKey, githubRepo, jiraHost, members } = req.body || {};
    const key = (jiraProjectKey || '').toUpperCase().trim();
    if (!/^[A-Z][A-Z0-9]+$/.test(key)) return res.status(400).json({ error: 'invalid JIRA project key' });
    if (!/^[\w.-]+\/[\w.-]+$/.test(githubRepo || ''))
      return res.status(400).json({ error: 'githubRepo must be owner/name' });
    if (loadProjects().find((p) => p.key === key))
      return res.status(409).json({ error: `project ${key} already exists` });
    upsertProject({
      key,
      name: name || key,
      jiraProjectKey: key,
      githubRepo,
      ...(jiraHost ? { jiraHost } : {}),
      ...rostersFrom(members),
    });
    snaps.delete(key);
    FIELDS.delete(key);
    res.json({ ok: true, projects: projectList() });
  });
  app.put('/api/eng/projects/:key', (req, res) => {
    const key = (req.params.key || '').toUpperCase();
    if (!loadProjects().find((p) => p.key === key)) return res.status(404).json({ error: 'no such project' });
    const { name, githubRepo, jiraHost, members } = req.body || {};
    if (githubRepo && !/^[\w.-]+\/[\w.-]+$/.test(githubRepo))
      return res.status(400).json({ error: 'githubRepo must be owner/name' });
    upsertProject({
      key,
      ...(name ? { name } : {}),
      ...(githubRepo ? { githubRepo } : {}),
      ...(jiraHost ? { jiraHost } : {}),
      ...rostersFrom(members),
    });
    snaps.delete(key);
    FIELDS.delete(key);
    res.json({ ok: true, projects: projectList() });
  });
  app.get('/api/eng/creds', (req, res) => {
    const { email, token } = creds();
    res.json({ hasCreds: !!(email && token), email });
  });
  app.get('/api/eng/me', async (req, res) => {
    try {
      res.json(await whoAmI());
    } catch {
      res.json({ login: null, email: null, accountId: null });
    }
  });
  app.post('/api/eng/creds', (req, res) => {
    const { email, token } = req.body || {};
    if (!email || !token) return res.status(400).json({ error: 'email and API token both required' });
    fs.writeFileSync(SECRETS_FILE, JSON.stringify({ jiraEmail: email, jiraToken: token }, null, 2));
    snaps.clear();
    res.json({ ok: true });
  });
  app.get('/api/eng/bug-ownership', (req, res) => res.json(readBugOwn()));
  app.post('/api/eng/bug-ownership', (req, res) => {
    const { key, ownerId, fixerId } = req.body || {};
    if (!key) return res.status(400).json({ error: 'key required' });
    const o = readBugOwn();
    o[key] = {
      ...(o[key] || {}),
      ...(ownerId !== undefined ? { ownerId: ownerId || null } : {}),
      ...(fixerId !== undefined ? { fixerId: fixerId || null } : {}),
    };
    if (!o[key].ownerId && !o[key].fixerId) delete o[key];
    writeBugOwn(o);
    snaps.clear();
    res.json({ ok: true, ownership: o[key] || null });
  });
  app.get('/api/eng/snapshot', async (req, res) => {
    // ?fresh=1 skips the cache window entirely and waits for a live fetch.
    try {
      res.json(await snapFor(req.query.project, { fresh: req.query.fresh === '1' }));
    } catch (e) {
      const projs = projectList();
      if (e.message === 'no-jira-creds')
        return res.json({ available: false, reason: 'no-jira-token', projects: projs, team: projs[0] });
      res.status(500).json({ available: false, error: e.message, projects: projs, team: projs[0] });
    }
  });
  app.post('/api/eng/refresh', async (req, res) => {
    const key = req.query.project;
    // Non-blocking refresh: kick off background refresh(es) without clearing the cache, then
    // return the current (stale) snapshot immediately with `refreshing: true`. The client polls
    // /api/eng/snapshot until `refreshing` flips to false. This replaces the old behavior of
    // clearing the cache and blocking on a 29s live fetch — the user sees data instantly and the
    // fresh data arrives in the background.
    try {
      // Send the response FIRST, then trigger the background refresh after a short delay.
      // refresh() uses spawnSync (gh CLI) which blocks the event loop — if called immediately
      // after res.json(), the response data may not have flushed from Node's internal write
      // queue to the OS socket yet, so the client would block too. setTimeout(50ms) lets the
      // event loop flush the response before spawnSync blocks. The client polls
      // /api/eng/snapshot until refreshing flips to false.
      const data = await snapFor(key);
      // Force refreshing: true in the response so the client starts polling. The actual
      // refresh() is deferred via setTimeout(50ms) to let the response flush first (spawnSync
      // in refresh() would block the event loop). Without this, the POST response might have
      // refreshing: false (the setTimeout hasn't fired yet) and the client wouldn't poll.
      res.json({ ...data, refreshing: true });
      setTimeout(() => {
        if (key === 'all' || !key) {
          for (const p of loadProjects()) refresh(p).catch(() => {});
        } else {
          const k = String(key ?? '').toUpperCase();
          const cfg = loadProjects().find((p) => p.key === k);
          if (cfg) refresh(cfg).catch(() => {});
        }
      }, 50);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---- §1 attention queue: the same records the snapshot carries, plus the dismissal store ----
  app.get('/api/eng/triage', async (req, res) => {
    try {
      const s = await snapFor(req.query.project);
      res.json({
        generatedAt: s.generatedAt,
        items: s.triage,
        dismissed: readTriage(),
        errors: s.errors,
        writes: s.writes,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  app.post('/api/eng/triage/dismiss', (req, res) => {
    const { id, until, forever } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id required' });
    const o = readTriage();
    o[id] = {
      at: new Date().toISOString(),
      until: forever ? null : until || new Date(addWorkTime(Date.now(), WORKDAY_MS_OF())).toISOString(),
    };
    writeTriage(o);
    res.json({ ok: true, dismissed: o[id] });
  });
  app.delete('/api/eng/triage/dismiss/:id', (req, res) => {
    const o = readTriage();
    delete o[req.params.id];
    writeTriage(o);
    res.json({ ok: true });
  });

  // ---- §11 CI health (its own route so a red main can be polled without the whole snapshot) ----
  app.get('/api/eng/ci', (req, res) => {
    const key = (req.query.project || 'all').toUpperCase();
    const errors = [];
    const projs = loadProjects().filter((p) => key === 'ALL' || p.key === key);
    const repos = projs.map((p) => ciFor(p, errors)).filter(Boolean);
    res.json({ ghAvailable: ghAvailable(), repos, errors, generatedAt: new Date().toISOString() });
  });

  // ---- §14 sustainable pace — TEAM AGGREGATE. min-N=5 applied above; no user/machine param exists. ----
  app.get('/api/eng/load', async (req, res) => {
    try {
      const s = await snapFor(req.query.project);
      res.json(s.load);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---- dependency-aware ready / blocked queue ----
  // A derived view over the snapshot's existing issue links — no new fetch, no new convention.
  app.get('/api/eng/queue', async (req, res) => {
    try {
      const s = await snapFor(req.query.project);
      const p = partitionByReadiness(s.issues);
      res.json({
        ...p,
        impact: unblockImpact(s.issues),
        // The snapshot's own staleness travels with the answer: a queue computed from a day-old
        // cache can name a blocker that has since been closed.
        generatedAt: s.generatedAt,
        stale: s.stale ?? false,
        team: s.team ?? null,
        source: 'jira issue links (fields.issuelinks) on the current snapshot',
      });
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  // ---- idempotent progress-comment sync ----
  // The plain /comment route posts unconditionally, so running a sync twice leaves two comments
  // on a ticket a real team reads. This one carries identity in the comment body and updates in
  // place. `?dryRun=1` returns the plan and the rendered body without writing anything.
  app.post('/api/eng/ticket/:key/progress', async (req, res) => {
    const key = String(req.params.key || '').toUpperCase();
    const cfg = cfgForTicket(key, req.query.project || req.body?.project);
    if (!cfg)
      return res.status(404).json({ error: `no project configured for "${key.split('-')[0]}" — add it in Setup` });
    const dryRun = req.query.dryRun === '1' || req.body?.dryRun === true;
    if (!cfg.writes && !dryRun)
      return res.status(403).json({
        error: 'writes disabled — set "writes": true on this project in projects.json (dryRun=1 still works)',
      });

    const data = req.body?.sections;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return res
        .status(400)
        .json({ error: 'sections required', expected: SECTIONS.map(([f, t]) => ({ field: f, title: t })) });
    }
    const { body, hash } = withMarker(key, data);

    try {
      const a = await jiraAuth(cfg);
      // Read the comments fresh rather than from ticketCache: a cached list from before an
      // earlier sync would show no marker and turn this into the duplicate post it prevents.
      let existing = null;
      try {
        const r = await fetch(`${a.base}/issue/${encodeURIComponent(key)}/comment?maxResults=100&orderBy=created`, {
          headers: a.headers,
        });
        if (r.ok) {
          const j = await r.json();
          existing = (j.comments || []).map((c) => ({
            id: c.id,
            body: isAdf(c.body) ? adfToText(c.body).text : String(c.body ?? ''),
          }));
          // JIRA pages comments. If there are more than we read, the marker could be in the
          // unread part, so we do not know — and planSync refuses on "do not know".
          if (typeof j.total === 'number' && j.total > existing.length) existing = null;
        }
      } catch {
        existing = null;
      }

      const plan = planSync(existing, key, hash);
      if (dryRun) return res.json({ ...plan, dryRun: true, body, hash });
      if (plan.action === 'refuse') {
        return res.status(409).json({ ...plan, error: `refusing to post: ${plan.detail}`, body });
      }
      if (plan.action === 'skip') return res.json({ ...plan, hash, url: `https://${cfg.jiraHost}/browse/${key}` });

      const adf = { body: markdownToAdf(body) };
      const url =
        plan.action === 'update'
          ? `${a.base}/issue/${encodeURIComponent(key)}/comment/${encodeURIComponent(plan.commentId)}`
          : `${a.base}/issue/${encodeURIComponent(key)}/comment`;
      const r = await fetch(url, {
        method: plan.action === 'update' ? 'PUT' : 'POST',
        headers: { ...a.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(adf),
      });
      if (!r.ok) throw new Error(`jira ${r.status}: ${(await r.text()).slice(0, 180)}`);
      const j = await r.json();
      ticketCache.delete(key);
      res.json({
        ...plan,
        ok: true,
        id: j.id,
        hash,
        url: `https://${cfg.jiraHost}/browse/${key}?focusedCommentId=${j.id}`,
      });
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  // ---- §10 epic target-date overrides ----
  app.get('/api/eng/epic-targets', (req, res) => res.json(readEpicTargets()));
  app.post('/api/eng/epic-targets', (req, res) => {
    const { key, targetDate } = req.body || {};
    if (!key) return res.status(400).json({ error: 'key required' });
    const o = readEpicTargets();
    if (targetDate) o[key] = { targetDate, at: new Date().toISOString() };
    else delete o[key];
    writeEpicTargets(o);
    snaps.clear();
    res.json({ ok: true, targets: o });
  });

  // ---- writes (§writes) — gated on projects.json "writes": true, operator's own credentials, one call each.
  app.post('/api/eng/pr/:num/comment', (req, res) => {
    const cfg = cfgFor(req.query.project || req.body?.project) || firstProject();
    if (!cfg) return res.status(400).json({ error: 'no project configured — add one in Setup' });
    if (!cfg.writes)
      return res.status(403).json({ error: 'writes disabled — set "writes": true on this project in projects.json' });
    const body = (req.body?.body || '').trim();
    if (!body) return res.status(400).json({ error: 'body required' });
    try {
      gh(['pr', 'comment', String(req.params.num), '--repo', cfg.githubRepo, '--body', body], 30000);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  app.post('/api/eng/pr/:num/request-review', (req, res) => {
    const cfg = cfgFor(req.query.project || req.body?.project) || firstProject();
    if (!cfg) return res.status(400).json({ error: 'no project configured — add one in Setup' });
    if (!cfg.writes)
      return res.status(403).json({ error: 'writes disabled — set "writes": true on this project in projects.json' });
    const login = (req.body?.login || '').trim();
    if (!login) return res.status(400).json({ error: 'login required' });
    try {
      gh(['pr', 'edit', String(req.params.num), '--repo', cfg.githubRepo, '--add-reviewer', login], 30000);
      snaps.delete(cfg.key);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  app.post('/api/eng/ticket/:key/transition', async (req, res) => {
    const cfg = cfgForTicket(req.params.key, req.query.project || req.body?.project);
    if (!cfg)
      return res
        .status(404)
        .json({ error: `no project configured for "${String(req.params.key).split('-')[0]}" — add it in Setup` });
    if (!cfg.writes)
      return res.status(403).json({ error: 'writes disabled — set "writes": true on this project in projects.json' });
    const to = (req.body?.to || '').trim();
    if (!to) return res.status(400).json({ error: 'to (status name) required' });
    try {
      const a = await jiraAuth(cfg);
      const key = req.params.key.toUpperCase();
      const { transitions } = await jira(a, `/issue/${encodeURIComponent(key)}/transitions`);
      const t = (transitions || []).find((t) => norm(t.to?.name) === norm(to) || norm(t.name) === norm(to));
      if (!t)
        return res
          .status(400)
          .json({ error: `no transition to "${to}"`, available: (transitions || []).map((t) => t.to?.name) });
      const r = await fetch(`${a.base}/issue/${encodeURIComponent(key)}/transitions`, {
        method: 'POST',
        headers: { ...a.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ transition: { id: t.id } }),
      });
      if (!r.ok) throw new Error(`jira ${r.status}: ${(await r.text()).slice(0, 180)}`);
      snaps.delete(cfg.key);
      ticketCache.delete(key);
      res.json({ ok: true, to: t.to?.name });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * What this ticket can be moved to, and who it can be given to — straight from JIRA.
   *
   * Deliberately not folded into the cached ticket detail: a workflow's available transitions
   * depend on who is asking and on the ticket's current status, so a five-minute-old cached list
   * would offer moves that fail. This is fetched when the control is opened, not on every read.
   */
  app.get('/api/eng/ticket/:key/actions', async (req, res) => {
    const cfg = cfgForTicket(req.params.key, req.query.project);
    if (!cfg)
      return res
        .status(404)
        .json({ error: `no project configured for "${String(req.params.key).split('-')[0]}" — add it in Setup` });
    if (!cfg.writes)
      return res.json({ writes: false, transitions: [], assignees: [], why: 'writes disabled for this project' });
    try {
      const a = await jiraAuth(cfg);
      const key = req.params.key.toUpperCase();
      const [tr, users] = await Promise.all([
        jira(a, `/issue/${encodeURIComponent(key)}/transitions`),
        jira(a, `/user/assignable/search?issueKey=${encodeURIComponent(key)}&maxResults=200`).catch(() => []),
      ]);
      res.json({
        writes: true,
        transitions: (tr.transitions || []).map((t) => ({ id: t.id, name: t.to?.name || t.name })),
        assignees: (Array.isArray(users) ? users : [])
          .filter((u) => u.accountId && u.active !== false)
          .map((u) => ({ id: u.accountId, name: u.displayName || u.emailAddress || u.accountId }))
          .sort((x, y) => x.name.localeCompare(y.name)),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/eng/ticket/:key/assignee', async (req, res) => {
    const cfg = cfgForTicket(req.params.key, req.query.project || req.body?.project);
    if (!cfg)
      return res
        .status(404)
        .json({ error: `no project configured for "${String(req.params.key).split('-')[0]}" — add it in Setup` });
    if (!cfg.writes)
      return res.status(403).json({ error: 'writes disabled — set "writes": true on this project in projects.json' });
    // `null` is a real answer here — it unassigns — so absent and null are not the same thing.
    const accountId = req.body?.accountId === null ? null : String(req.body?.accountId || '').trim();
    if (accountId === '') return res.status(400).json({ error: 'accountId required (or null to unassign)' });
    try {
      const a = await jiraAuth(cfg);
      const key = req.params.key.toUpperCase();
      const r = await fetch(`${a.base}/issue/${encodeURIComponent(key)}/assignee`, {
        method: 'PUT',
        headers: { ...a.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId }),
      });
      if (!r.ok) throw new Error(`jira ${r.status}: ${(await r.text()).slice(0, 180)}`);
      snaps.delete(cfg.key);
      ticketCache.delete(key);
      res.json({ ok: true, accountId });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/eng/ticket/:key', async (req, res) => {
    const cfg = cfgForTicket(req.params.key, req.query.project);
    if (!cfg)
      return res
        .status(404)
        .json({ error: `no project configured for "${String(req.params.key).split('-')[0]}" — add it in Setup` });
    try {
      const d = await ticketDetail(cfg, req.params.key.toUpperCase(), { waitForPrs: true });
      res.json({ ...d, artifacts: artifactsFor(d) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  app.post('/api/eng/ticket/:key/generate', async (req, res) => {
    const cfg = cfgForTicket(req.params.key, req.query.project || req.body?.project);
    if (!cfg)
      return res
        .status(404)
        .json({ error: `no project configured for "${String(req.params.key).split('-')[0]}" — add it in Setup` });
    try {
      const kind = req.body?.kind;
      if (!['ac', 'tests'].includes(kind)) return res.status(400).json({ error: 'kind must be ac|tests' });
      const key = req.params.key.toUpperCase();
      const d = await ticketDetail(cfg, key, { waitForPrs: true, withCommits: true });
      const prompt = genPrompt(kind, d);
      const { md, model } = claudeMarkdown(prompt);
      const store = readArtifacts();
      store[key] = {
        ...(store[key] || {}),
        [kind]: {
          md,
          at: new Date().toISOString(),
          model,
          reqHash: reqHash(d),
          prContextLoaded: d.prContext.loaded,
          edited: false,
        },
      };
      writeArtifacts(store);
      res.json({ ...store[key][kind], stale: false });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  app.put('/api/eng/ticket/:key/artifact', async (req, res) => {
    const { kind, md } = req.body || {};
    if (!['ac', 'tests'].includes(kind)) return res.status(400).json({ error: 'kind must be ac|tests' });
    const key = req.params.key.toUpperCase();
    const store = readArtifacts();
    const prev = store[key]?.[kind] || {};
    let hash = prev.reqHash;
    try {
      const cfg = cfgForTicket(key, req.query.project || req.body?.project);
      if (cfg) hash = reqHash(await ticketDetail(cfg, key));
    } catch {}
    store[key] = {
      ...(store[key] || {}),
      [kind]: { ...prev, md, at: new Date().toISOString(), reqHash: hash, edited: true },
    };
    writeArtifacts(store);
    res.json({ ...store[key][kind], stale: false });
  });

  // ---- write generated content back to the ticket (§writes) ----
  app.post('/api/eng/ticket/:key/comment', async (req, res) => {
    const cfg = cfgForTicket(req.params.key, req.query.project || req.body?.project);
    if (!cfg)
      return res
        .status(404)
        .json({ error: `no project configured for "${String(req.params.key).split('-')[0]}" — add it in Setup` });
    if (!cfg.writes)
      return res.status(403).json({
        error: 'writes disabled — set "writes": true on this project in projects.json (copy/download still work)',
      });
    const md = (req.body?.md || '').trim();
    if (!md) return res.status(400).json({ error: 'md required' });
    try {
      const a = await jiraAuth(cfg);
      const key = req.params.key.toUpperCase();
      const r = await fetch(`${a.base}/issue/${encodeURIComponent(key)}/comment`, {
        method: 'POST',
        headers: { ...a.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: markdownToAdf(md) }),
      });
      if (!r.ok) throw new Error(`jira ${r.status}: ${(await r.text()).slice(0, 180)}`);
      const j = await r.json();
      ticketCache.delete(key);
      res.json({ ok: true, id: j.id, url: `https://${cfg.jiraHost}/browse/${key}?focusedCommentId=${j.id}` });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}
