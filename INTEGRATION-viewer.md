# INTEGRATION-viewer.md

Wiring instructions for features **076** (EditorHost lifecycle contract), **073** (Source / Preview /
Diff toggle) and **077** (editor-to-chat selection chips).

Everything below is **new code only** — nothing in the repo was edited. This file describes the exact
edits a maintainer needs to make in `src/ui/viewers.jsx`, `src/sections/ChatSection.jsx` and
`src/sections/ArtifactsSection.jsx` to turn these modules on.

## Files added

| File | What it is |
| --- | --- |
| `src/lib/editorHost.js` | 076 — lifecycle state machine, echo detection, `createEditorHost()` factory |
| `src/lib/lineDiff.js` | Line diff used by the Diff mode and by `host.diff()` |
| `src/lib/viewerModes.js` | 073 — pure mode-availability / mode-resolution decision |
| `src/lib/selectionChips.js` | 077 — chip normalisation, safe serialisation, 32 KiB packing |
| `src/ui/ViewerModes.jsx` | 073 — `<ViewerModeToggle>` segmented control + `<DiffPane>` |
| `src/ui/SelectionChips.jsx` | 077 — `<SelectionChips>` tray + `useSelectionChips()` + `pushSelection()` |
| `src/ui/Markdown.jsx` | The single sanitised markdown sink (DOMPurify) |
| `test/lib/*.test.mjs` | 90 `node --test` tests over the four `src/lib` modules |

## Prerequisite: one `package.json` change

`dompurify@3.4.12` is already present in `node_modules` and resolves in a `vite build`, but it is **not
declared** in `package.json`. Add it, or a clean `npm ci` will break the build:

```json
"dependencies": {
  "dompurify": "^3.4.12",
  ...
}
```

---

## 0. `src/ui/Markdown.jsx` — the XSS fix this all depends on

`marked.parse()` output is attacker-controlled HTML: an artifact file on disk or a transcript body can
contain `<img src=x onerror=…>` and it executes in the dashboard's origin. There are currently **two
live instances** of the bare sink:

- `src/ui/viewers.jsx:128` — `<div className="md pad" dangerouslySetInnerHTML={{ __html: marked.parse(content) }} />`
- `src/sections/ChatSection.jsx:71` — `<div className="chat-msg assistant" dangerouslySetInnerHTML={{ __html: marked.parse(b.text) }} />`

Replace both:

```jsx
// viewers.jsx — delete the `marked` import
import Markdown from './Markdown.jsx'
…
if (ext === 'md') return <Markdown text={content} className="md pad" />
```

```jsx
// ChatSection.jsx — delete the `marked` import
import Markdown from '../ui/Markdown.jsx'
…
if (b.kind === 'text') return <Markdown text={b.text} className="chat-msg assistant" />
```

After this, `rg 'dangerouslySetInnerHTML' src/` should return exactly one hit: the line inside
`Markdown.jsx`, immediately downstream of `DOMPurify.sanitize`. Grep for the sink and you can answer
"is this sanitised?" without reading anything else. (Other files may still need the same treatment —
`rg 'marked.parse' src/` to find them.)

---

## 1. Feature 073 — Source / Preview / Diff in `src/ui/viewers.jsx`

### 1a. `Viewer` takes a `mode`, not a `raw` boolean

`Viewer({ item, raw })` currently has a two-state boolean. Widen it to three, keeping `raw` accepted for
one release so nothing breaks mid-refactor:

```jsx
import { modeAvailability, resolveMode } from '../lib/viewerModes.js'
import { DiffPane } from './ViewerModes.jsx'

export function Viewer({ item, mode = 'preview', raw, baseline = null, current = null }) {
  const requested = raw === true ? 'source' : mode        // back-compat shim, delete once callers move
  const av = modeAvailability({ ext: item.ext, name: item.name, size: item.size, hasBaseline: baseline !== null })
  const { mode: eff } = resolveMode(requested, av)

  // …existing load effect unchanged…

  if (eff === 'diff') return <DiffPane before={baseline} after={current ?? content} />
  if (eff === 'source') return <CodeView content={content} ext={ext === 'svg' || ext === 'html' ? 'html' : ext} />
  // …existing per-extension preview branches unchanged…
}
```

`resolveMode` is only a safety net for a file whose type changed under a selected mode (rename, reload).
The toggle already disables unavailable modes, so in normal use `resolveMode` returns `changed: false`.
When it *does* fire, `resolved.reason` is rendered by the toggle — the fallback is stated, never silent.

### 1b. `ArtifactsSection.jsx` — replace the two buttons with the segmented control

Currently lines 81–82:

```jsx
<button className={!raw ? 'active' : ''} onClick={() => setRaw(false)}>Rendered</button>
<button className={raw ? 'active' : ''} onClick={() => setRaw(true)}>Source</button>
```

Replace with:

```jsx
import { ViewerModeToggle } from '../ui/ViewerModes.jsx'
import { modeAvailability } from '../lib/viewerModes.js'
…
const [mode, setMode] = useState('preview')
// reset on selection change — where the file currently does `setRaw(false)` in the card onClick:
onClick={() => { setSel(i); setMode(modeAvailability({ ext: i.ext, name: i.name, size: i.size }).defaultMode) }}
…
const av = modeAvailability({ ext: sel.ext, name: sel.name, size: sel.size, hasBaseline: false })
<ViewerModeToggle file={sel} availability={av} mode={mode} onMode={setMode} />
…
<div className="viewer-body"><Viewer item={sel} mode={mode} /></div>
```

**Diff is a mode of the file you are already viewing** — same `detail-pane`, same header, same `sel`.
Do not route it to another screen; flipping to Diff and back must not lose the user's place.

`hasBaseline` is `false` for a read-only artifact list, so the Diff tab renders **disabled with the
reason** "no baseline to compare against…". Once `ArtifactsSection` mounts an editable host (§2), pass
`hasBaseline: host.getState().hasBaseline` and Diff lights up.

### 1c. What the control guarantees

- A `.mjs` gets `Preview` **disabled** with `title="…a JavaScript module — there is no rendered form of
  it, so Preview would show the same text as Source"`, plus an `aria-label` carrying the same reason
  (the hover reason is not mouse-only). It is not hidden and it does not silently become Source.
- An extension with no registered renderer says so explicitly rather than guessing at a format.
- The preview size cap (`PREVIEW_MAX_BYTES`, 2 MB) and the source cap (8 MB) surface as a `⚠` on the
  tab and a line under the control. Nothing is clamped invisibly.
- `DiffPane` prints the line cap (`DIFF_MAX_LINES`, 4000) and the cell-budget degradation banner when
  either fires. A missing baseline renders its reason — **not** an empty diff, because "no changes" and
  "nothing to compare against" are different facts.

---

## 2. Feature 076 — `EditorHost` in `src/ui/viewers.jsx`

### 2a. Server endpoints needed

`load` reads via the existing `GET /api/artifacts/content?path=`. `save` needs a companion write route
that **returns the post-write `stat`**:

```
PUT /api/artifacts/content   { path, content }  →  { ok: true, stat: { mtimeMs, size } }
```

The `stat` is not cosmetic — it is the certain half of echo detection (§2c). If the route cannot return
it, the host still works and records a notice saying echo suppression fell back to timing alone.

### 2b. Mounting the host

The host is created **once per file** in a ref, never rebuilt on render:

```jsx
import { createEditorHost } from '../lib/editorHost.js'

function EditableViewer({ item }) {
  const cmRef = useRef(null)            // CodeMirror EditorView, via onCreateEditor
  const hostRef = useRef(null)
  const [ui, setUi] = useState(null)    // status/dirty/notices ONLY — never the text

  useEffect(() => {
    const host = createEditorHost({
      path: item.path,
      adapter: {
        applyContent: text => cmRef.current?.dispatch({
          changes: { from: 0, to: cmRef.current.state.doc.length, insert: text },
        }),
        getCurrentContent: () => cmRef.current?.state.doc.toString(),
        setTheme: name => { /* CodeMirror theme compartment reconfigure */ },
        destroy: () => {},
      },
      io: {
        read: async p => {
          try { return { content: (await api.get('/api/artifacts/content?path=' + encodeURIComponent(p))).content } }
          catch (e) { return { ok: false, reason: e.message } }
        },
        write: async (p, content) => {
          try { return { ok: true, stat: (await api.put('/api/artifacts/content', { path: p, content })).stat }
          } catch (e) { return { ok: false, reason: e.message } }
        },
      },
      onChange: setUi,
    })
    hostRef.current = host
    host.load()
    return () => host.dispose()
  }, [item.path])
  …
}
```

Then render `<CodeMirror onCreateEditor={v => { cmRef.current = v }} onChange={() => hostRef.current?.markDirty()} />`
— note **no `value` prop**. The `value` prop is exactly the React-state coupling this design forbids.

### 2c. Why content must not live in React state

The comment block at the top of `src/lib/editorHost.js` is the canonical statement; short version, all
three are real bugs you will hit if you use `useState` for the buffer:

1. **Lost keystrokes.** React state is async and batched. A watcher event that lands mid-render sets
   state from disk; the keystroke typed 4ms earlier is still queued in the other `setState` and gets
   clobbered by the re-render. The user watches a character disappear.
2. **Save races.** If the buffer is state, `save()` persists the last *committed render*, not what is on
   screen. Under fast typing you write a version the user never saw.
3. **Cursor destruction.** Re-rendering CodeMirror with a new `value` resets selection and scroll on
   every external event.

So: the editor instance owns the text; React state here holds only the small lifecycle enum, `dirty`,
and the notices array.

### 2d. Echo detection — and the case it cannot catch

Feed watcher events straight in: `host.watch({ at: Date.now(), stat, content })`. The host returns
`{ verdict, certain, reason, reloaded }`.

The naive implementation — "is the file's content equal to what I just wrote?" — is **wrong**, and this
is the reason the module is shaped the way it is. A format-on-save hook (prettier, `eslint --fix`, a
gofmt, an editorconfig trailing-newline rule) rewrites the file microseconds after our write. The bytes
on disk then differ from the bytes we sent, so content comparison calls the formatter's echo an
*external* change and reloads over the user's next keystrokes. Capturing `mtime + size` at write time
fails identically: the formatter's rewrite has a different mtime and usually a different size.

What identity we actually have, and how it is layered (see `classifyWatchEvent`):

| Signal | Verdict | Certain? |
| --- | --- | --- |
| Event stat == the stat the FS reported for our write | `echo` | yes |
| Event content == the bytes we wrote | `echo` | yes |
| Neither, but within `ECHO_SETTLE_MS` (1500ms) of our write | `echo` | **no** — attributed to a save-time rewrite |
| Neither, past the window | `external` | yes |

**RESIDUAL CASE WE CANNOT CATCH:** a genuine third-party write — a teammate's `git checkout`, a codegen
step, a second editor — that lands inside the settle window of one of our own saves is byte-for-byte
indistinguishable from a formatter rewriting that save. We will call it an echo and not reload; the file
on screen is then stale until the next event. The window is deliberately short to shrink the hole, and
the verdict is returned with `certain: false` plus a notice in `host.getState().notices`, so the user
has a thread to pull when the file "looks stale". **There is no local-filesystem signal that closes this
gap** — resolving it requires the *writer's identity*, which neither inotify nor FSEvents carries. If
the server ever gains a per-writer watcher (e.g. it knows the write came from its own PUT handler),
pass that through as an explicit `event.writer` and the heuristic tier can be deleted.

Surface `ui.notices` under the editor header — every suppressed reload, every degraded capability and
every uncertain echo lands there, so nothing this host decides is invisible.

### 2e. Contract members

`load` · `save` · `applyContent` · `getCurrentContent` · `watch` · `diff` · `theme`, plus
`markDirty` / `retry` / `getState` / `getBaseline` / `subscribe` / `dispose` for the React shell.
Every viewer implements the same two-method adapter (`applyContent`, `getCurrentContent`); optional
`setTheme` / `destroy` degrade with a reported reason rather than silently. Nothing throws — every
failure path returns `{ ok: false, reason }`.

`host.diff()` feeds `<DiffPane before={host.getBaseline()} after={host.getCurrentContent().content} />`,
which is what makes the Diff tab in §1 available (`hasBaseline: host.getState().hasBaseline`).

---

## 3. Feature 077 — selection chips in `src/sections/ChatSection.jsx`

### 3a. Editor side (one line)

Anywhere a viewer knows what the user selected:

```jsx
import { pushSelection, announceOpenTabs } from '../ui/SelectionChips.jsx'

pushSelection({
  id: `${item.path}:${from}-${to}`,   // required — chat dedupes and removes by id
  label: `${item.name}:${line}`,
  description: 'selected rows',
  icon: typeIcon(item.ext),
  data: selectedRows,                 // optional structured payload
  includeData: false,                 // OPT-IN. Anything other than exactly `true` means "label only".
  tabId: item.path,                   // owns the chip's lifetime
  source: item.path,
})
```

When editor tabs open or close, call `announceOpenTabs(openTabIds)`. Chat drops any chip whose `tabId`
is gone and shows a line naming what went — chips do not just vanish.

A `window` CustomEvent is used (not a prop chain) because the selection can happen while Chat is
unmounted, exactly like the existing `chat-open` deep link at `ChatSection.jsx:295`.

### 3b. Chat side

In `InputBar` (`ChatSection.jsx:126`):

```jsx
import SelectionChips, { useSelectionChips } from '../ui/SelectionChips.jsx'

function InputBar({ cwd, ended, onSend, initial }) {
  const chips = useSelectionChips()
  …
  const send = async () => {
    …
    // chips.promptBlock is prepended, NOT concatenated into `input` — the user's typed text stays theirs
    const text = [chips.promptBlock, input.trim(), refs].filter(Boolean).join('\n')
    if (!text && !images.length) return
    setInput(''); setAtts([]); setSug(null); chips.clear()   // chips are consumed by the send
    onSend(text || 'see attached', images)
  }
  …
  return (
    <div className="chat-inputwrap">
      {sug && …}
      <SelectionChips
        packed={chips.packed} onRemove={chips.remove} onClear={chips.clear}
        onToggleData={chips.toggleData} tabNotice={chips.tabNotice} onDismissNotice={chips.dismissTabNotice} />
      {atts.length > 0 && …}
      <div className="chat-inputbar">…</div>
    </div>
  )
}
```

The tray sits directly above the existing `chat-atts` row and reuses the `.chat-att` styling, so no
`styles.css` change is required.

### 3c. Guardrails, and where each one is visible

| Guardrail | Enforced in | Shown to the user as |
| --- | --- | --- |
| `data` is opt-in via `includeData === true` | `normalizeChip` | a `⛁ off` / `⛁ 1.2 KiB` toggle on every chip that has data, plus the note "data not included" |
| 32 KiB **total** across all chips | `packChips` | `⚠ truncated 4.1 KiB/61 KiB` on the affected chip, an amber budget line, and a tray note |
| Cyclic values | `safeSerialize` | `[cycle → $.a.b]` in the payload, `⚠ 3 stripped` on the chip, paths listed in the tooltip |
| Non-JSON values (fn, Symbol, BigInt, NaN, DOM node, throwing getter) | `safeSerialize` | same `⚠ n stripped` badge, each with a per-path reason |
| Nesting past 12 levels | `safeSerialize` | `[too deep]` marker + a recorded reason |
| Max 24 chips | `packChips` | "chip limit is 24 — 3 more selections are not attached", with the overflow labels named |
| Chips cleared on tab close | `chipsForOpenTabs` | a dismissible line naming the removed chips |
| Serialisation never throws | `safeSerialize` | n/a — asserted by tests; a throw here would take out the chat input |

**Truncation is also stated inside the prompt**, not just in the UI (`chipsToPrompt`):

```
  NOTE: the data below is TRUNCATED at 32768 of 61440 bytes and is not valid JSON. Do not assume it is complete.
```

That line is the point of the feature. A silently truncated payload makes the model answer confidently
about rows 1–40 while the user believes it read all 900 — so both the user *and* the model are told.

---

## 4. Verification status

- `npm test` → **476 tests, 476 passing, 0 failing**. **90 of them are new** (`test/lib/`):
  40 `editorHost`, 25 `selectionChips`, 16 `viewerModes`, 9 `lineDiff`. No pre-existing test changed.
- `npx vite build` → clean. The new `.jsx` was additionally compiled through a temporary lib-mode entry
  (since nothing imports it yet) to confirm every new component and its imports build; that scratch
  entry has been removed.

**Not verified** (no DOM/browser in this environment, and no existing component-test harness in the repo):

- `DOMPurify.sanitize` at runtime. DOMPurify needs a `window`; it is only exercised in a browser. The
  sanitiser config and the `rel=noopener` hook are untested — worth a manual XSS smoke test with an
  artifact containing `<img src=x onerror=alert(1)>` once wired.
- The React components render only in a browser: `useSelectionChips` event plumbing, the CodeMirror
  adapter in §2b, and the `DiffPane`/`ViewerModeToggle` markup are compile-verified only.
- The `PUT /api/artifacts/content` route in §2a **does not exist yet** — it must be added server-side
  before `host.save()` can work against real files. `io.write` is fully exercised by fakes in the tests.
- Echo detection is tested against a simulated clock and simulated watcher events, not a real
  filesystem watcher. The formatter-rewrite scenario and the documented residual case are both asserted
  as unit tests, but no end-to-end run against inotify was performed.
