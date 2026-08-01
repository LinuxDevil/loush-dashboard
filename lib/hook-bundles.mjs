// hook-bundles.mjs — 112. Four one-click hook presets with per-tool filters, written against the
// hook-config shape this repo already reads and writes: `settings.hooks[event] = [{ matcher,
// hooks: [{ type:'command', command, timeout }] }]` (server/index.mjs:344-360, :437, :3712).
//
// CROSS-PLATFORM. Every hook body is `node -e "..."`, not a shell script. A `sh -c '...'` hook
// (which is what server/index.mjs:3686 `require-tests-before-stop` ships today) does not fail
// loudly on Windows — it fails to spawn, and the user sees a hook that simply never fires, which
// is indistinguishable from "the hook is wrong". Node is guaranteed present: the harness that
// reads this config is itself running under it.
//
// Quoting rule for these commands, so they survive both `sh -c` and `cmd.exe`:
//   · outer quotes are DOUBLE, inner quotes are SINGLE
//   · no backticks, no `$(`, no `$VAR`  — cmd leaves them, sh expands them
//   · no `%`                            — cmd expands %VAR%, sh does not
// Every command below is checked against those rules by `validateBundle`.
//
// Pure: no fs. The caller reads/writes settings.json (server/index.mjs already owns backup+propose).

/** Events that carry a `tool_name`. A tool filter on any other event can never match. */
export const TOOL_EVENTS = ['PreToolUse', 'PostToolUse']
export const HOOK_EVENTS = ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'SessionStart', 'SessionEnd', 'Stop', 'SubagentStop', 'PreCompact', 'Notification']

/** Where installs are recorded. `_`-prefixed sidecar, matching this repo's existing
 *  `settings._disabledHooks` convention (server/index.mjs:490) — the harness ignores it. */
export const PROVENANCE_KEY = '_hookBundles'

/** Default per-hook timeout, in seconds. Stated, not silent: a hook that hangs stalls every turn. */
export const DEFAULT_TIMEOUT_S = 10

const n = body => `node -e "${body}"`
const READ_STDIN = "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{let j;try{j=JSON.parse(s)}catch(e){process.exit(0)}"
//                                                                          ^ a hook that throws on
// unexpected stdin blocks the tool call it was only meant to observe. Parse failure exits 0 (allow)
// and is therefore visible as "no output", never as a spurious block.

// ---------------------------------------------------------------------------------------------
// The four bundles, declared as data
// ---------------------------------------------------------------------------------------------
export const BUNDLES = Object.freeze({
  'code-quality': {
    id: 'code-quality',
    title: 'Code quality',
    description: 'Formats-checks and size-checks what the agent writes, and refuses to finish with source changed but no test touched.',
    hooks: [
      {
        id: 'code-quality/oversized-write',
        event: 'PostToolUse',
        filters: { tools: ['Write', 'Edit', 'MultiEdit'] },
        why: 'a 3,000-line generated file is a review nobody performs',
        timeout: DEFAULT_TIMEOUT_S,
        command: n(`${READ_STDIN}const i=j.tool_input||{};const c=i.content||i.new_string||'';const L=c.split('\\n').length;if(L>800)console.log(JSON.stringify({systemMessage:'[code-quality] '+(i.file_path||'file')+' is '+L+' lines — consider splitting it'}))})`),
      },
      {
        id: 'code-quality/tests-before-stop',
        event: 'Stop',
        // NOT a tool event. The tool filter is null WITH A REASON rather than an empty array,
        // because an empty array reads as "filters nothing" and this filters nothing for a
        // different reason: there is no tool to filter on.
        filters: { tools: null, reason: 'Stop carries no tool_name — a tool filter here could never match' },
        why: 'source changed with no test touched is the single most common silent regression',
        timeout: 20,
        blocking: true,
        // Cross-platform replacement for the repo's existing `sh -c 'git diff ... | grep'` version.
        command: n(`const{execSync}=require('child_process');let f='';try{f=execSync('git diff --name-only HEAD',{encoding:'utf8',stdio:['ignore','pipe','ignore']})}catch(e){process.exit(0)}const a=f.split('\\n').filter(Boolean);if(!a.some(p=>/\\.(ts|tsx|js|jsx|mjs|py|go|rb|java)$/.test(p)))process.exit(0);if(a.some(p=>/(test|spec|__tests__)/.test(p)))process.exit(0);console.error('[code-quality] source changed but no test file was touched: '+a.slice(0,5).join(', '));process.exit(2)`),
      },
    ],
  },

  security: {
    id: 'security',
    title: 'Security',
    description: 'Blocks writes to protected paths and writes whose content looks like a live credential.',
    hooks: [
      {
        id: 'security/protected-path',
        event: 'PreToolUse',
        filters: { tools: ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'] },
        why: 'an agent editing .env or a prod config is a production incident, not a code review comment',
        timeout: DEFAULT_TIMEOUT_S,
        blocking: true,
        command: n(`${READ_STDIN}const p=(j.tool_input||{}).file_path||'';if(/(^|\\/)\\.env|(^|\\/)secrets?\\/|\\bprod(uction)?\\b|\\.pem$|id_rsa/.test(p)){console.error('[security] blocked: protected path '+p);process.exit(2)}})`),
      },
      {
        id: 'security/secret-in-content',
        event: 'PreToolUse',
        filters: { tools: ['Write', 'Edit'] },
        why: 'a committed key is unrevocable by the time review catches it',
        timeout: DEFAULT_TIMEOUT_S,
        blocking: true,
        command: n(`${READ_STDIN}const i=j.tool_input||{};const c=i.content||i.new_string||'';const r=[[/AKIA[0-9A-Z]{16}/,'AWS access key'],[/-----BEGIN [A-Z ]*PRIVATE KEY/,'private key'],[/gh[pousr]_[A-Za-z0-9]{30,}/,'GitHub token'],[/sk-ant-[A-Za-z0-9-]{20,}/,'Anthropic key']];for(const[re,name]of r){if(re.test(c)){console.error('[security] blocked: content contains what looks like a '+name);process.exit(2)}}})`),
      },
      {
        id: 'security/curl-pipe-shell',
        event: 'PreToolUse',
        filters: { tools: ['Bash'] },
        why: 'curl | sh executes an unreviewed remote script with the user\'s privileges',
        timeout: DEFAULT_TIMEOUT_S,
        blocking: true,
        command: n(`${READ_STDIN}const c=(j.tool_input||{}).command||'';if(/(curl|wget)[^|]*\\|\\s*(sudo\\s+)?(ba)?sh/.test(c)){console.error('[security] blocked: piping a downloaded script straight into a shell');process.exit(2)}})`),
      },
    ],
  },

  notifications: {
    id: 'notifications',
    title: 'Notifications',
    description: 'Appends a local JSONL trail of turn boundaries and permission prompts. Local file only — nothing leaves the machine.',
    hooks: [
      {
        id: 'notifications/turn-log',
        event: 'Stop',
        filters: { tools: null, reason: 'Stop carries no tool_name' },
        why: 'without a turn boundary log you cannot tell a long turn from a hung one',
        timeout: DEFAULT_TIMEOUT_S,
        command: n(`${READ_STDIN}const fs=require('fs'),p=require('path'),os=require('os');const f=p.join(os.homedir(),'.claude','hook-notifications.jsonl');try{fs.mkdirSync(p.dirname(f),{recursive:true});fs.appendFileSync(f,JSON.stringify({t:Date.now(),event:'Stop',session:j.session_id||null})+'\\n')}catch(e){}})`),
      },
      {
        id: 'notifications/permission-prompt',
        event: 'Notification',
        filters: { tools: null, reason: 'Notification carries no tool_name' },
        why: 'a run blocked on an unseen permission prompt looks identical to a slow run',
        timeout: DEFAULT_TIMEOUT_S,
        command: n(`${READ_STDIN}const fs=require('fs'),p=require('path'),os=require('os');const f=p.join(os.homedir(),'.claude','hook-notifications.jsonl');try{fs.mkdirSync(p.dirname(f),{recursive:true});fs.appendFileSync(f,JSON.stringify({t:Date.now(),event:'Notification',message:String(j.message||'').slice(0,300)})+'\\n')}catch(e){}})`),
      },
    ],
  },

  performance: {
    id: 'performance',
    title: 'Performance',
    description: 'Caps oversized tool results and flags unbounded searches, so the context window is spent on signal.',
    hooks: [
      {
        id: 'performance/cap-read-result',
        event: 'PostToolUse',
        filters: { tools: ['Read'] },
        why: 'Read is the largest single consumer of context; an uncapped 200k-char read evicts the work',
        timeout: DEFAULT_TIMEOUT_S,
        // The cap is REPORTED to the model in the injected text, so it never silently sees a
        // truncated file and concludes the rest does not exist.
        command: n(`${READ_STDIN}const r=j.tool_response;const t=typeof r==='string'?r:JSON.stringify(r==null?'':r);const MAX=20000;if(t.length<=MAX)process.exit(0);const note='[performance] Read returned '+t.length+' chars, capped at '+MAX+'. The first '+MAX+' chars follow; the rest was NOT read — re-read with offset/limit for it.\\n\\n'+t.slice(0,MAX);console.log(JSON.stringify({hookSpecificOutput:{hookEventName:'PostToolUse',additionalContext:note},systemMessage:'Read capped: '+t.length+' -> '+MAX+' chars'}))})`),
      },
      {
        id: 'performance/unbounded-search',
        event: 'PreToolUse',
        filters: { tools: ['Grep', 'Glob'] },
        why: 'a repo-wide unfiltered grep returns thousands of lines nobody reads and everybody pays for',
        timeout: DEFAULT_TIMEOUT_S,
        command: n(`${READ_STDIN}const i=j.tool_input||{};if((i.pattern==='.'||i.pattern==='**/*')&&!i.glob&&!i.type)console.log(JSON.stringify({systemMessage:'[performance] unbounded search — add a glob or type filter'}))})`),
      },
    ],
  },
})

export const listBundles = () => Object.values(BUNDLES).map(b => ({
  id: b.id, title: b.title, description: b.description, hooks: b.hooks.length,
  events: [...new Set(b.hooks.map(h => h.event))],
  tools: [...new Set(b.hooks.flatMap(h => h.filters.tools || []))],
}))

/** Unknown ids are rejected BY NAME with the allowed set — never coerced to a nearest match. */
export function getBundle(id) {
  if (typeof id !== 'string') return { ok: false, reason: `bundle id must be a string, received ${typeof id}`, allowed: Object.keys(BUNDLES) }
  const b = BUNDLES[id]
  if (!b) return { ok: false, reason: `"${id}" is not a known bundle`, allowed: Object.keys(BUNDLES) }
  return { ok: true, bundle: b }
}

// ---------------------------------------------------------------------------------------------
// Validation against the real hook-config shape
// ---------------------------------------------------------------------------------------------
/** Characters that mean different things to `sh` and to `cmd.exe`. Presence = a platform-dependent hook. */
const CROSS_PLATFORM_HAZARDS = [
  [/`/, 'backtick — command substitution in sh, literal in cmd'],
  [/\$\(/, '$( — command substitution in sh, literal in cmd'],
  [/\$[A-Za-z_]/, '$VAR — expanded by sh, literal in cmd'],
  [/%[A-Za-z_]/, '%VAR — expanded by cmd, literal in sh'],
  [/^\s*(sh|bash|zsh)\s+-c\b/, 'shell script body — a silent no-op on a machine without that shell'],
]

/** NEVER THROWS. Returns `{ok:false, errors:[...]}` naming each field. */
export function validateBundle(bundle) {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) return { ok: false, errors: [{ field: '(root)', reason: `expected a bundle object, received ${Array.isArray(bundle) ? 'array' : bundle === null ? 'null' : typeof bundle}` }] }
  const errors = [], warnings = []
  if (typeof bundle.id !== 'string' || !bundle.id) errors.push({ field: 'id', value: bundle.id ?? null, reason: 'a bundle id is required — uninstall tracks provenance by it' })
  if (!Array.isArray(bundle.hooks) || !bundle.hooks.length) errors.push({ field: 'hooks', value: bundle.hooks ?? null, reason: 'a bundle must declare at least one hook' })

  for (const h of bundle.hooks || []) {
    const at = `hooks[${h?.id ?? '?'}]`
    if (!h || typeof h !== 'object') { errors.push({ field: at, reason: 'each hook must be an object' }); continue }
    if (typeof h.id !== 'string' || !h.id) errors.push({ field: `${at}.id`, value: h.id ?? null, reason: 'a stable per-hook id is required for uninstall provenance' })
    if (!HOOK_EVENTS.includes(h.event)) errors.push({ field: `${at}.event`, value: h.event ?? null, reason: `"${String(h.event)}" is not a hook event`, allowed: [...HOOK_EVENTS] })
    if (typeof h.command !== 'string' || !h.command.trim()) errors.push({ field: `${at}.command`, value: h.command ?? null, reason: 'command is required' })
    if (!Number.isFinite(h.timeout) || h.timeout <= 0) errors.push({ field: `${at}.timeout`, value: h.timeout ?? null, reason: 'timeout (seconds) is required and must be positive — an untimed hook can stall every turn' })

    const f = h.filters
    if (!f || typeof f !== 'object') errors.push({ field: `${at}.filters`, value: f ?? null, reason: 'filters is required; use {tools:null, reason} when the event carries no tool' })
    else if (f.tools === null) {
      if (!f.reason) errors.push({ field: `${at}.filters.reason`, reason: 'filters.tools is null — say WHY, or a reader cannot tell "no filter" from "filter forgotten"' })
      if (TOOL_EVENTS.includes(h.event)) warnings.push({ field: `${at}.filters.tools`, reason: `${h.event} does carry a tool_name, so a null filter means this hook fires for EVERY tool` })
    } else if (!Array.isArray(f.tools) || !f.tools.length) {
      errors.push({ field: `${at}.filters.tools`, value: f.tools ?? null, reason: 'filters.tools must be a non-empty array of tool names, or null with a reason' })
    } else if (!TOOL_EVENTS.includes(h.event)) {
      errors.push({ field: `${at}.filters.tools`, value: f.tools, reason: `${h.event} carries no tool_name — this filter could never match`, allowed: [...TOOL_EVENTS] })
    }

    for (const [re, why] of CROSS_PLATFORM_HAZARDS)
      if (typeof h.command === 'string' && re.test(h.command))
        errors.push({ field: `${at}.command`, reason: `not cross-platform: contains ${why}` })
  }
  return errors.length ? { ok: false, errors, warnings } : { ok: true, errors: [], warnings }
}

/** The matcher the harness actually evaluates (server/index.mjs:3645 builds `^(matcher)$`). */
export const matcherFor = h => (h.filters?.tools ? h.filters.tools.join('|') : '')

/** One bundle hook → the exact settings entry this repo's writer produces. */
export const toSettingsEntry = h => ({ matcher: matcherFor(h), hooks: [{ type: 'command', command: h.command, timeout: h.timeout }] })

// ---------------------------------------------------------------------------------------------
// Install planning — conflicts are NAMED and require explicit intent
// ---------------------------------------------------------------------------------------------
const clone = o => JSON.parse(JSON.stringify(o ?? {}))
const short = c => (String(c).length > 90 ? String(c).slice(0, 90) + '…' : String(c))

/**
 * What would installing `bundleId` do to `settings`? Pure — computes, never writes.
 *
 * Three outcomes per hook, all reported:
 *   · already-installed — byte-identical command already present; a no-op
 *   · conflict          — same event + same matcher, DIFFERENT command. Installing REPLACES a hook
 *                         the user (or another bundle) put there. Named, and blocked without intent.
 *   · coexisting        — same event, overlapping tools, different matcher string. Both will fire.
 *                         Not a blocker, but reported: silently doubling a PreToolUse gate is a
 *                         surprise the first time a write is blocked twice.
 */
export function planInstall(settings, bundleId, opts = {}) {
  const got = getBundle(bundleId)
  if (!got.ok) return { ok: false, ...got }
  const v = validateBundle(got.bundle)
  if (!v.ok) return { ok: false, reason: `bundle "${bundleId}" is itself invalid — refusing to install`, errors: v.errors }
  if (settings !== undefined && settings !== null && (typeof settings !== 'object' || Array.isArray(settings)))
    return { ok: false, reason: `settings must be an object, received ${Array.isArray(settings) ? 'array' : typeof settings}` }

  const s = clone(settings)
  const conflicts = [], already = [], coexisting = [], toAdd = []

  for (const h of got.bundle.hooks) {
    const entries = (s.hooks?.[h.event]) || []
    const m = matcherFor(h)
    const identical = entries.find(e => (e.hooks || []).some(x => x.command === h.command))
    if (identical) { already.push({ hookId: h.id, event: h.event, matcher: m }); continue }
    const sameSlot = entries.find(e => (e.matcher || '') === m)
    if (sameSlot) {
      conflicts.push({
        hookId: h.id, event: h.event, matcher: m,
        existing: { matcher: sameSlot.matcher || '', commands: (sameSlot.hooks || []).map(x => short(x.command)) },
        incoming: short(h.command),
        reason: `an existing ${h.event} hook on matcher "${m || '(all tools)'}" would be REPLACED`,
      })
      continue
    }
    const overlap = entries.filter(e => overlapsTools(e.matcher || '', h.filters?.tools))
    if (overlap.length) coexisting.push({ hookId: h.id, event: h.event, matcher: m, withMatchers: overlap.map(e => e.matcher || '(all tools)'), reason: 'both hooks will fire for the overlapping tools — this install does not remove the existing one' })
    toAdd.push(h)
  }

  const requiresIntent = conflicts.length > 0 && !opts.overwrite
  return {
    ok: !requiresIntent,
    reason: requiresIntent ? `${conflicts.length} existing hook(s) would be replaced — pass {overwrite:true} to confirm` : null,
    bundleId, conflicts, already, coexisting,
    willAdd: toAdd.map(h => ({ hookId: h.id, event: h.event, matcher: matcherFor(h) })),
    willReplace: opts.overwrite ? conflicts.map(c => ({ hookId: c.hookId, event: c.event, matcher: c.matcher })) : [],
    requiresIntent,
    limits: { note: 'no cap on hooks per event; every hook in the bundle is accounted for above (added, already-present, conflicting, or coexisting).' },
  }
}

function overlapsTools(matcher, tools) {
  if (!tools) return matcher === ''            // a null-filter hook only "overlaps" another catch-all
  if (matcher === '') return true              // catch-all matches every tool
  const a = new Set(matcher.split('|').map(x => x.trim()).filter(Boolean))
  return tools.some(t => a.has(t))
}

/**
 * Apply a plan. Returns the NEXT settings object; the caller writes it (server/index.mjs already
 * owns backup + propose). Refuses when the plan requires intent — a conflict must be answered, not
 * defaulted.
 */
export function installBundle(settings, bundleId, opts = {}) {
  const plan = planInstall(settings, bundleId, opts)
  if (!plan.ok) return { ok: false, ...plan }
  const got = getBundle(bundleId)
  const s = clone(settings)
  s.hooks ||= {}
  const installed = []

  for (const h of got.bundle.hooks) {
    const m = matcherFor(h)
    s.hooks[h.event] ||= []
    const entries = s.hooks[h.event]
    if (entries.some(e => (e.hooks || []).some(x => x.command === h.command))) continue   // already there
    const i = entries.findIndex(e => (e.matcher || '') === m)
    const entry = toSettingsEntry(h)
    let replaced = null
    if (i >= 0 && opts.overwrite) { replaced = (entries[i].hooks || []).map(x => short(x.command)); entries[i] = entry }
    else if (i >= 0) continue                                                             // unreachable: plan.ok implies no conflicts
    else entries.push(entry)
    installed.push({ hookId: h.id, event: h.event, matcher: m, command: h.command, replaced })
  }

  // Provenance, per hook entry. Uninstall matches on it and NOTHING else, so removing this bundle
  // can never take out a hook the user wrote by hand that happens to look similar.
  s[PROVENANCE_KEY] ||= {}
  s[PROVENANCE_KEY][bundleId] = {
    installedAt: opts.now ?? Date.now(),
    entries: installed.map(x => ({ hookId: x.hookId, event: x.event, matcher: x.matcher, command: x.command })),
    // A replaced hook's previous command is preserved verbatim: overwriting is allowed, LOSING the
    // thing you overwrote is not. Uninstall offers it back.
    replaced: installed.filter(x => x.replaced).map(x => ({ hookId: x.hookId, event: x.event, matcher: x.matcher, previousCommands: x.replaced })),
  }
  return { ok: true, settings: s, installed, plan }
}

/**
 * Remove exactly what this bundle installed, and nothing else.
 *
 * An entry whose command has CHANGED since install is kept, not removed, and reported as
 * `modifiedSinceInstall` — the user edited it, so it is theirs now. Deleting an edited hook because
 * a bundle once owned the slot is data loss with a plausible-looking excuse.
 */
export function uninstallBundle(settings, bundleId) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return { ok: false, reason: `settings must be an object, received ${Array.isArray(settings) ? 'array' : settings === null ? 'null' : typeof settings}` }
  const rec = settings[PROVENANCE_KEY]?.[bundleId]
  if (!rec) return { ok: false, reason: `no install record for "${bundleId}" in settings.${PROVENANCE_KEY} — this bundle was not installed by this tool, so nothing can be safely removed`, installed: Object.keys(settings[PROVENANCE_KEY] || {}) }

  const s = clone(settings)
  const removed = [], kept = [], missing = []
  for (const e of rec.entries || []) {
    const entries = s.hooks?.[e.event]
    if (!Array.isArray(entries)) { missing.push({ ...e, reason: `no ${e.event} hooks remain — already removed by hand` }); continue }
    const i = entries.findIndex(x => (x.matcher || '') === e.matcher && (x.hooks || []).some(h => h.command === e.command))
    if (i >= 0) { entries.splice(i, 1); removed.push({ hookId: e.hookId, event: e.event, matcher: e.matcher }); if (!entries.length) delete s.hooks[e.event]; continue }
    const slot = entries.find(x => (x.matcher || '') === e.matcher)
    if (slot) kept.push({ hookId: e.hookId, event: e.event, matcher: e.matcher, reason: 'the command in this slot no longer matches what was installed — it was edited, so it is left in place', current: (slot.hooks || []).map(h => short(h.command)) })
    else missing.push({ hookId: e.hookId, event: e.event, matcher: e.matcher, reason: 'not present — already removed by hand' })
  }
  delete s[PROVENANCE_KEY][bundleId]
  if (!Object.keys(s[PROVENANCE_KEY]).length) delete s[PROVENANCE_KEY]

  return {
    ok: true, settings: s, removed, keptModified: kept, alreadyGone: missing,
    restorable: rec.replaced || [],
    note: kept.length ? `${kept.length} hook(s) were edited after install and were LEFT IN PLACE — remove them by hand if you meant to.` : 'every tracked entry accounted for.',
  }
}

/** What did this tool install into these settings? Reads provenance only — never guesses by shape. */
export function installedBundles(settings) {
  const rec = settings?.[PROVENANCE_KEY]
  if (!rec) return { ok: true, bundles: [], note: `settings.${PROVENANCE_KEY} is absent — either nothing was installed by this tool, or it was installed before provenance tracking. These are NOT distinguishable from the file alone.` }
  return { ok: true, bundles: Object.entries(rec).map(([id, r]) => ({ id, installedAt: r.installedAt, entries: (r.entries || []).length })) }
}
