# Recon — L1 Grounding (read-only)

All paths relative to `/Users/ali.mohammad/learnspace/loushai/dashboard/`.

Key globals (`server.mjs`): `HOME=os.homedir()` (35), `CLAUDE=~/.claude` (36),
`readJson(p, fb)` (1057), `track(file, content, {scope, summary})` = git-tracked file writer,
`SETTINGS_FILES = { user, project, local }` (276-280),
`settingsFileFor(scope)` (1267), `propose(file, content, summary)` for global-scope writes.

---

## 1. Inject RAG hits into Chat completion

### SURPRISE — there is no "chat completion" model call
Chat is **not** an API/model completion. `POST /api/chat` (`server.mjs:853`) spawns the
`claude` CLI as a subprocess with `--input-format stream-json --output-format stream-json`
and streams its stream-json events back over SSE. `/api/chat/complete` (`server.mjs:909`) is
the **autocomplete** endpoint (slash-commands / @files), NOT a completion route — do not touch it.

The two real injection points:

**A. Per-turn user message — `POST /api/chat/:id/message` (`server.mjs:897`)**
```js
const content = (req.body.images || []).slice(0,20).map(...image...)
content.push({ type: 'text', text: req.body.text })   // line 902 — PREPEND RAG CONTEXT HERE
const msg = { type: 'user', message: { role: 'user', content } }
chatBroadcast(chat, msg)                               // echoes to viewers (line 904)
chat.child.stdin.write(JSON.stringify(msg) + '\n')     // line 905
```
Cleanest hook: before line 902, run retrieval on `req.body.text`, build a
`Retrieved context:\n…[cite]…` string, and either prepend a `{type:'text'}` block or splice it
into the text. NOTE: line 904 echoes `content` to all viewers — if you don't want the injected
context shown in the transcript, build a separate augmented content for `stdin.write` and echo the
original.

**B. System prompt at spawn — `POST /api/chat` (`server.mjs:860`)**
```js
const args = ['-p','--input-format','stream-json','--output-format','stream-json','--verbose',
  '--dangerously-skip-permissions','--append-system-prompt', PLAN_SCHEMA_RULE]
```
`PLAN_SCHEMA_RULE` defined at `server.mjs:812`. You can append a second
`--append-system-prompt <grounding rules>` here, but per-turn retrieval (A) is the right place for
query-dependent RAG hits; the system prompt is better for static grounding instructions.

### Callable search sources (all live in-process in the same Node server)

| Source | Function / route | Input | Output shape | In-process? |
|---|---|---|---|---|
| **Atoms** | `buildIndex(repo)` exported from `atoms/ingest.mjs:126`; also `GET /api/atoms/index` (`server-atoms.mjs:61`) | `repo` abs path (must contain `.wakeel/constitution`) | `{ repo, atomCount, sources:[{id,type,name,description,atoms:[…]}], coverage, … }`. Each atom = `{ id, claim, cite:[{path,lineRange}], source, sourceType, attestStatus }` (fields confirmed via `AtomsSection.jsx:126`). **Returns claim text + citation.** | Yes — `import { buildIndex } from './atoms/ingest.mjs'`. There is NO keyword-search fn; it returns the full index — you must filter/rank atoms by query yourself. `server-atoms.mjs` memoizes per-repo in `memo` (not exported). |
| **Atoms (grounded LLM)** | `askLLM(question, atoms)` in `server-atoms.mjs:26` (module-private) + `POST /api/atoms/explain` (`server-atoms.mjs:91`) | question + non-empty atoms[] | answer string (every sentence cites `[atom-id]`) | Costs an LLM call; overkill for RAG injection — prefer raw `buildIndex` atoms. |
| **Constitution** | `buildInsights(repo)` (`server-constitution.mjs:77`) + `GET /api/constitution/insights` | repo | graph of artifacts `{nodes:[{id,kind,atoms}], edges}`, workflows/skills/rules. Coarser than atoms; atoms are the better citation source. | Yes (module-private fn; `mountConstitution` is the only export → call via HTTP or refactor to export). |
| **Memory** | `searchMemories(terms, projFilter)` (`server-memory.mjs:40`) and `searchTranscripts(query, projFilter, limit)` (`server-memory.mjs:88`); route `GET /api/memory/search?q=&project=&sources=` (`server-memory.mjs:152`) | `terms` = lowercased word array; `projFilter` = mangled proj dir or null | array of `{ source:'memory', name, description, type, project, projDir, mtime, path, score, excerpt(≤600) }`; transcript hits `{ source:'transcript', role, sessionId, excerpt(≤400), path, score }`. **Returns text + path (citation).** Already ranked (memory-first, then score). | **Best fit for RAG.** BUT both fns are module-private — only `mountMemory` is default-exported. To call in-process, add named `export` to the two fns, or hit `GET /api/memory/search` over localhost. |

### Minimal change plan (item 1)
1. Export `searchMemories`/`searchTranscripts` from `server-memory.mjs` (named exports) and import into `server.mjs`. Reuse `buildIndex` from `atoms/ingest.mjs` (already exported).
2. In `POST /api/chat/:id/message` (897), before building `content`: derive query from `req.body.text`, gather top-N hits from memory (+ optionally atoms filtered by query terms, scoped to `chat.cwd` as the repo).
3. Format a compact grounding block with citations (`path` / `path:lineRange` / `[atom-id]`) and prepend as a text block. Echo the original text to viewers (line 904); write the augmented content to `chat.child.stdin` (905). Guard with a size cap and a feature flag.

---

## 2. Chat review-trail store

### Where messages render — `src/ChatSection.jsx`
- `buildBlocks(events)` (`ChatSection.jsx:16`) folds stream-json into renderable blocks; assistant prose = `{ kind:'text', text }` (built at 32-52), rendered by `Block` at **line 57** (`<div className="chat-msg assistant" …/>`).
- Main map — **`ChatSection.jsx:400`** (exact hook point):
  ```js
  {blocks.map((b, i) => (b.kind === 'user' || b.kind === 'text')
    ? <Cap key={i} text={b.text}><Block b={b} /></Cap>
    : <Block key={i} b={b} />)}
  ```
  Assistant text blocks are already wrapped in `<Cap>` (`ChatSection.jsx:102`, an existing per-message action affordance with a ⤴ capture button). **Add the accept/reject/diff control here** — either as another button inside `Cap`, or a sibling control rendered only for `b.kind === 'text'`. Needs a stable per-message key; `i` is used today but for a persisted trail use `realSessionId` (`ChatSection.jsx:296`) + block index, or the message's own id if available.
- `send()` posts turns at `ChatSection.jsx:275-279` (`POST /api/chat/:id/message`); SSE ingest at `attach()` `ChatSection.jsx:260-266`.

### Store pattern to copy — bugs / board (`server.mjs`)
Canonical lightweight JSON store (copy verbatim):
```js
const BUGS_FILE = path.join(CLAUDE, 'bugs.json')                                   // 3357
const readBugs  = () => readJson(BUGS_FILE, [])                                    // 3358
const writeBugs = b => track(BUGS_FILE, JSON.stringify(b, null, 2), { summary: 'update bugs' }) // 3359
app.get('/api/bugs',      (req,res)=> res.json(readBugs()...))                      // 3370
app.post('/api/bugs',     (req,res)=> { const bugs=readBugs(); bugs.push({id:'bug'+Date.now().toString(36), ...}); writeBugs(bugs); res.json(bug) }) // 3371
app.patch('/api/bugs/:id',(req,res)=> { ...mutate...; writeBugs(bugs) })            // 3397
app.delete('/api/bugs/:id',(req,res)=> writeBugs(readBugs().filter(...)))           // 3406
```
Board mirrors it: `BOARD_FILE`, `readBoard`/`writeBoard` (`server.mjs:3884-3885`) using the same
`readJson` + `track(...)` idiom. `track()` git-commits the write, so the review trail gets history for free.

### Minimal change plan (item 2)
1. New store in `server.mjs`: `const REVIEW_FILE = path.join(CLAUDE,'chat-reviews.json')`, `readReviews`/`writeReviews` mirroring bugs (3357-3359).
2. Record shape suggestion: `{ id, sessionId, cwd, blockIndex, verdict:'accept'|'reject', note, diff?, at }` keyed by `sessionId`.
3. Routes: `GET /api/chat/reviews?sessionId=`, `POST /api/chat/reviews` (upsert verdict), mirroring the bugs GET/POST.
4. Frontend: at `ChatSection.jsx:400`, render accept/reject/diff buttons for `kind:'text'` blocks; POST verdict; load existing verdicts on `attach` keyed by `realSessionId`.

---

## 3. Default safety hook on first run

### How hooks are defined / installed (`server.mjs`)
- **Hook definitions live in `HOOK_LIBRARY`** (`server.mjs:3502-3515`). **Both requested hooks ALREADY EXIST** — no need to author them:
  - `block-prod-file-edit` — `event:'PreToolUse'`, `matcher:'Edit|Write'`, blocks `.env`/`secrets/`/prod paths (`server.mjs:3503-3504`).
  - `secret-scan-pre-write` — `event:'PreToolUse'`, `matcher:'Edit|Write'`, blocks AWS keys / private keys / `password=` (`server.mjs:3505-3506`).
  - Others: `require-tests-before-stop`, `log-tool-usage`, `truncate-tool-result` (parameterised).
- A library entry shape: `{ name, event, matcher, description, command, params? }` where `command` is a shell/node one-liner that `process.exit(2)` to block.
- **Install route** `POST /api/hooks/install` (`server.mjs:3526`): body `{ name, params?, scope? }` (scope default `'global'`). It `resolvePattern(name, params)` (3518), reads `settingsFileFor(scope)`, ensures `s.hooks[event]`, dedups by command, then pushes:
  ```js
  s.hooks[pat.event].push({ matcher: pat.matcher, hooks: [{ type:'command', command: pat.command, timeout: 10 }] })
  ```
  Global scope goes through `propose(file, content, …)` (returns a proposal for approval); non-global uses `track(file, …)` directly (`server.mjs:3537-3538`).
- **On-disk target**: `settings.json` under `SETTINGS_FILES` (`server.mjs:276-280`) — user = `~/.claude/settings.json`, project = `<PROJECT>/.claude/settings.json`, local = `.claude/settings.local.json`. Raw read/write also via `GET/PUT /api/hooks` (`server.mjs:281-297`) and `PUT /api/settings` (299).
- **Frontend**: `src/HooksSection.jsx` (+ `src/hooks.js`); it consumes `GET /api/hooks/library` (`server.mjs:3516`) and calls install.

### NO first-run / seed / bootstrap path exists for hooks
Grep for `first-run|bootstrap|seed` finds only analytics/design manifest bootstrap
(`server.mjs:3755`, `3834`) — nothing for hooks. Hooks are installed only on explicit user action.
So "default safety hook on first run" = a **new** bootstrap that auto-installs the two library
patterns once.

### Minimal change plan (item 3)
1. Add a first-run guard file, e.g. `const SAFETY_SEED = path.join(CLAUDE,'.safety-seeded')`.
2. At server startup (or first `GET /api/hooks`), if the seed file is absent: for each of
   `['block-prod-file-edit','secret-scan-pre-write']` run the same logic as `/api/hooks/install`
   (call `resolvePattern` + the dedup-and-push block) against `settingsFileFor('user')`, then write the seed marker.
   Reuse the existing install code path to stay consistent (dedup already guards double-install).
3. Because these are global-scope writes, decide between `propose()` (user approves) vs `track()`
   (auto-commit) — `/api/hooks/install` uses `propose` for global; a silent first-run seed may prefer
   `track`/direct-write to `~/.claude/settings.json` so it applies without a prompt.
