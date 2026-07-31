// Documents — writing-first editor with AI edits, Markdown/HTML/CSV, syntax highlighting.
//
// ---------------------------------------------------------------------------------------------
// Derived in part from Odysseus (https://github.com/odysseus-dev/odysseus), Copyright (c) the
// Odysseus contributors, licensed under AGPL-3.0. This file is AGPL-3.0-only (NOTICE, clause 1).
// Consulted: `routes/document_routes.py` — the document read/write/AI-rewrite endpoint shape and
// the `ai-tidy` LLM-call pattern (a prompt built from document content, model output parsed back
// out, the model's answer not persisted by the endpoint that produced it).
// Modified 2026-07-31 by Ali Mohammad: rewritten for this codebase — Odysseus stores documents as
// database rows keyed by id and owns a PDF/render pipeline; this is file-backed, rooted at a single
// configured directory with a path-escape guard, and its AI edit returns proposed text only. The
// PDF/render/versioning/archive endpoints are not ported (AGPL §5(a) notice of modification).
// ---------------------------------------------------------------------------------------------
//
// THE SECURITY MODEL, because this is the one module here that writes to a path the user chose.
//
// Every request names a file with a RELATIVE path, and that path is resolved against one root. Two
// separate checks run, and both are needed:
//
//   1. LEXICAL, before the filesystem is touched: refuse absolute paths (including a Windows drive
//      letter and a leading separator), refuse any `..` segment, refuse control characters. This is
//      also what makes the errors meaningful — `../../etc/passwd` is rejected as traversal, not as
//      a missing file.
//   2. RESOLVED + REAL, after: `path.resolve`, then containment by SEGMENT via `path.relative`.
//      A prefix-string test (`abs.startsWith(root)`) admits `/docs-evil` for a root of `/docs`,
//      because "/docs-evil" does start with "/docs". `path.relative` returns `../docs-evil`, which
//      is unambiguous. Then `realpathSync` on the deepest existing ancestor, because a symlink
//      inside the root can point anywhere and no amount of string work will notice.
//
// `ai-edit` returns proposed text and NEVER writes. Accepting a diff is a separate PUT from the
// client. An AI edit that writes directly is a data-loss bug waiting for its first bad instruction,
// and the accept/reject flow only means anything if refusing leaves the disk untouched.

import fs from 'node:fs'
import path from 'node:path'
import { runAgent as defaultRunAgent } from '../lib/agent.mjs'
import { APP_ROOT } from '../lib/paths.mjs'

// Caps, in the shape lib/upload-guard.mjs established: every refusal carries a reason and every
// applied bound is reported, because a file that silently fails to open looks like a broken editor.
export const MAX_FILE_BYTES = 2 * 1024 * 1024   // per file, read and write
export const MAX_PATH_LENGTH = 1024
export const MAX_LISTED_FILES = 2000
export const MAX_INSTRUCTION_CHARS = 2000
export const MAX_SELECTION_CHARS = 20_000
export const AI_TIMEOUT_MS = 120_000

// The ai-edit agent gets an ALLOWLIST, not a denylist.
//
// A denylist of write tools was the first attempt and it is not closed: `mcp__<server>__<tool>` from
// whatever MCP servers the user has configured, and SlashCommand, are not in any fixed list of names
// and can both write. Naming what is permitted means a tool added tomorrow is refused by default
// instead of allowed by omission.
//
// This job needs no tools at all — the whole document is already in the prompt and the answer comes
// back as text — so the allowlist is empty.
export const AI_EDIT_TOOLS = []

// Text formats we are willing to open AND write back. A deliberately small allowlist, matching
// src/ui/viewers.jsx's `editableExts`: an editor offered on a format we cannot round-trip
// losslessly is a data-loss button.
export const DOC_EXTS = new Set(['md', 'markdown', 'txt', 'html', 'htm', 'csv', 'json', 'jsonl',
  'yml', 'yaml', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'css', 'sh', 'py', 'toml', 'ini'])

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.cache'])

/**
 * The single docs root. Configured by `DASH_DOCS_ROOT`; otherwise the repo's own `docs/`, which is
 * where this dashboard's prose already lives.
 */
export function docsRoot(env = process.env) {
  const raw = typeof env.DASH_DOCS_ROOT === 'string' && env.DASH_DOCS_ROOT.trim()
  return path.resolve(raw || path.join(APP_ROOT, 'docs'))
}

/** Segment-wise containment. `''` (the root itself) is not a file in it, so it is not "inside". */
export function isInside(root, target) {
  const rel = path.relative(root, target)
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel)
}

/**
 * Refuse a path any of whose components inside the root is a symlink — checked by `lstat`, which
 * does not follow, so it sees links whose targets do not exist.
 *
 * This is what `realOrNearest` cannot do. `fs.realpathSync` throws ENOENT on a DANGLING symlink, so
 * the ancestor walk below skipped past it and handed back the lexical path; `isInside` then saw a
 * path textually under the root and passed it. `fs.writeFileSync` opens with O_CREAT and FOLLOWS the
 * link, creating the file wherever it points. A live symlink out of the root was always caught — a
 * dangling one was not, which is why the test that only builds live links passed.
 *
 * Creation alone is enough to matter: a `note.md → ~/.zshenv` link, where no `.zshenv` exists, is
 * arbitrary code execution on the next shell.
 *
 * Every component is checked, not just the leaf: a dangling DIRECTORY symlink (`root/d → /outside/d`)
 * escapes the same way. Non-existent tails are fine — that is a normal create.
 */
function hasSymlinkComponent(root, abs) {
  const rel = path.relative(root, abs)
  if (!rel || rel.startsWith('..')) return false
  let cur = root
  for (const seg of rel.split(path.sep)) {
    cur = path.join(cur, seg)
    let st
    try { st = fs.lstatSync(cur) } catch { return false }  // does not exist yet: nothing to follow
    if (st.isSymbolicLink()) return true
  }
  return false
}

/** realpath of `p`, or of its deepest existing ancestor when `p` does not exist yet (PUT-create). */
function realOrNearest(p) {
  let cur = p
  for (let i = 0; i < 64; i++) {
    try { return path.join(fs.realpathSync(cur), path.relative(cur, p)) } catch {}
    const up = path.dirname(cur)
    if (up === cur) return p
    cur = up
  }
  return p
}

/**
 * Resolve a client-supplied relative path against the root, or say why it cannot be.
 * @returns {{ok: true, abs: string, rel: string, ext: string} | {ok: false, reason: string}}
 */
export function resolveDocPath(root, raw) {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, reason: 'path-required' }
  if (raw.length > MAX_PATH_LENGTH) return { ok: false, reason: 'path-too-long' }
  // A NUL truncates the path at the syscall boundary, so `a.md\0.png` can become `a.md`.
  if (/[\u0000-\u001f\u007f]/.test(raw)) return { ok: false, reason: 'bad-characters' }
  // Absolute in any dialect: POSIX root, Windows drive, UNC share. `path.isAbsolute` on POSIX does
  // not consider `C:\x` absolute, so the shapes are checked explicitly rather than deferring to the
  // host platform's opinion of what an absolute path looks like.
  if (path.isAbsolute(raw) || /^[\\/]/.test(raw) || /^[A-Za-z]:/.test(raw)) return { ok: false, reason: 'absolute-path' }

  const segs = []
  for (const seg of raw.split(/[\\/]+/)) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') return { ok: false, reason: 'parent-traversal' }
    segs.push(seg)
  }
  if (!segs.length) return { ok: false, reason: 'path-required' }

  const rootReal = realOrNearest(path.resolve(root))
  const abs = path.resolve(rootReal, ...segs)
  if (!isInside(rootReal, abs)) return { ok: false, reason: 'escapes-root' }
  // The lexical path is contained; the real one may not be, if a component is a symlink pointing out.
  if (!isInside(rootReal, realOrNearest(abs))) return { ok: false, reason: 'symlink-escapes-root' }
  // Catches the dangling case realpath cannot see. listDocs already skips symlinks entirely, so no
  // path this app would ever offer the user is refused by this.
  if (hasSymlinkComponent(rootReal, abs)) return { ok: false, reason: 'symlink-escapes-root' }

  const ext = path.extname(abs).slice(1).toLowerCase()
  if (!DOC_EXTS.has(ext)) return { ok: false, reason: 'unsupported-type' }
  return { ok: true, abs, rel: segs.join('/'), ext }
}

/** Files under the root, relative paths, newest first. Symlinks are skipped, not followed. */
export function listDocs(root) {
  const out = []
  const walk = (dir, prefix, depth) => {
    if (depth > 12 || out.length >= MAX_LISTED_FILES) return
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (out.length >= MAX_LISTED_FILES) return
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue
      if (e.isSymbolicLink()) continue          // a symlink is where containment stops being textual
      const abs = path.join(dir, e.name)
      const rel = prefix ? prefix + '/' + e.name : e.name
      if (e.isDirectory()) { walk(abs, rel, depth + 1); continue }
      if (!e.isFile() || !DOC_EXTS.has(path.extname(e.name).slice(1).toLowerCase())) continue
      try {
        const st = fs.statSync(abs)
        out.push({ path: rel, bytes: st.size, mtime: st.mtimeMs })
      } catch {}                                 // vanished between readdir and stat — not an error
    }
  }
  walk(path.resolve(root), '', 0)
  out.sort((a, b) => b.mtime - a.mtime)
  return out
}

/**
 * The model is asked for replacement text and nothing else, but it is a model, so it may still wrap
 * the answer in a fence. Strip one fence; leave everything else alone, because guessing at prose
 * removal would silently delete real content from the proposal.
 */
export function unfence(text) {
  const s = String(text ?? '')
  const m = /^\s*```[^\n]*\n([\s\S]*?)\n?```\s*$/.exec(s)
  return m ? m[1] : s.replace(/^\s*\n/, '')
}

export function aiEditPrompt({ rel, ext, instruction, selection, whole }) {
  const target = selection
    ? `Here is the SELECTED excerpt to rewrite:\n<<<SELECTION\n${selection}\nSELECTION>>>`
    : `Here is the WHOLE document to rewrite:\n<<<DOCUMENT\n${whole}\nDOCUMENT>>>`
  return [
    `You are editing "${rel}" (a ${ext} file). Apply this instruction:`,
    instruction, '', target, '',
    `Reply with ONLY the rewritten text for that ${selection ? 'excerpt' : 'document'}.`,
    'No preamble, no explanation, no code fence. Preserve the surrounding style and formatting.',
    'Do not read or write any files — your reply is the entire deliverable.',
  ].join('\n')
}

const bad = (res, code, reason, extra) => res.status(code).json({ error: reason, ...extra })

/**
 * @param {object} app express app
 * @param {{root?: string, runAgent?: Function}} [deps] injected by tests; production passes none,
 *        because `server/index.mjs` calls `mountDocs(app)` and must not need to know about this.
 */
export default function mount(app, deps = {}) {
  const rootOf = () => path.resolve(deps.root || docsRoot())
  const runAgent = deps.runAgent || defaultRunAgent

  // Resolve, or answer the request. Returns null when it has already sent the refusal.
  const target = (req, res, raw) => {
    const root = rootOf()
    const r = resolveDocPath(root, raw)
    if (!r.ok) { bad(res, 400, r.reason, { path: typeof raw === 'string' ? raw : null }); return null }
    return r
  }

  app.get('/api/docs', (req, res) => {
    const root = rootOf()
    if (!fs.existsSync(root)) return res.json({ root, files: [], error: 'docs-root-missing' })
    const files = listDocs(root)
    res.json({
      root, files,
      limits: { fileBytes: MAX_FILE_BYTES, listed: MAX_LISTED_FILES },
      ...(files.length >= MAX_LISTED_FILES ? { capped: `listing stopped at ${MAX_LISTED_FILES} files` } : {}),
    })
  })

  app.get('/api/docs/file', (req, res) => {
    const t = target(req, res, req.query?.path)
    if (!t) return
    let st
    try { st = fs.statSync(t.abs) } catch { return bad(res, 404, 'not-found', { path: t.rel }) }
    if (!st.isFile()) return bad(res, 400, 'not-a-file', { path: t.rel })
    if (st.size > MAX_FILE_BYTES) return bad(res, 413, 'file-too-large', { path: t.rel, bytes: st.size, limit: MAX_FILE_BYTES })
    try {
      res.json({ path: t.rel, text: fs.readFileSync(t.abs, 'utf8'), bytes: st.size, mtime: st.mtimeMs })
    } catch (e) { bad(res, 500, e.message, { path: t.rel }) }
  })

  app.put('/api/docs/file', (req, res) => {
    const t = target(req, res, req.query?.path)
    if (!t) return
    const text = req.body?.text
    if (typeof text !== 'string') return bad(res, 400, 'text-required', { path: t.rel })
    const bytes = Buffer.byteLength(text, 'utf8')
    if (bytes > MAX_FILE_BYTES) return bad(res, 413, 'file-too-large', { path: t.rel, bytes, limit: MAX_FILE_BYTES })
    try {
      // The parent is created only because the guard above already proved it contained; without
      // that proof this line would be the traversal.
      fs.mkdirSync(path.dirname(t.abs), { recursive: true })
      // O_NOFOLLOW so the KERNEL refuses to open a symlink, whatever the guard concluded a moment
      // ago. The guard is a check on a name; this is a property of the open. It closes the window
      // between the two — a link swapped in after the check cannot be followed — and makes the
      // symlink defence independent of the guard being exhaustive.
      let fd
      try {
        fd = fs.openSync(t.abs, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW, 0o644)
        fs.writeFileSync(fd, text, 'utf8')
      } finally { if (fd !== undefined) try { fs.closeSync(fd) } catch {} }
      const st = fs.statSync(t.abs)
      res.json({ ok: true, path: t.rel, bytes: st.size, mtime: st.mtimeMs })
    } catch (e) {
      // ELOOP is the kernel refusing a symlink — report it as the containment failure it is, not 500.
      if (e.code === 'ELOOP') return bad(res, 400, 'symlink-escapes-root', { path: t.rel })
      bad(res, 500, e.message, { path: t.rel })
    }
  })

  // Proposes. Does not write. The client diffs {text} against its buffer and PUTs on accept.
  app.post('/api/docs/ai-edit', async (req, res) => {
    const t = target(req, res, req.body?.path)
    if (!t) return
    const instruction = String(req.body?.instruction ?? '').trim()
    if (!instruction) return bad(res, 400, 'instruction-required')
    if (instruction.length > MAX_INSTRUCTION_CHARS) return bad(res, 400, 'instruction-too-long', { limit: MAX_INSTRUCTION_CHARS })
    const rawSel = req.body?.selection
    const selection = typeof rawSel === 'string' && rawSel.trim() ? rawSel : ''
    if (selection.length > MAX_SELECTION_CHARS) return bad(res, 400, 'selection-too-long', { limit: MAX_SELECTION_CHARS })

    let whole
    try {
      const st = fs.statSync(t.abs)
      if (st.size > MAX_FILE_BYTES) return bad(res, 413, 'file-too-large', { path: t.rel, bytes: st.size, limit: MAX_FILE_BYTES })
      whole = fs.readFileSync(t.abs, 'utf8')
    } catch { return bad(res, 404, 'not-found', { path: t.rel }) }
    // A selection the file on disk no longer contains would produce a proposal we cannot splice
    // back into the right region. Refuse rather than rewrite the wrong one.
    if (selection && !whole.includes(selection)) return bad(res, 409, 'selection-not-in-file', { path: t.rel })

    const out = await runAgent({
      cwd: rootOf(), timeoutMs: AI_TIMEOUT_MS, model: req.body?.model,
      prompt: aiEditPrompt({ rel: t.rel, ext: t.ext, instruction, selection, whole }),
      // "This endpoint never writes" was only true of the endpoint. lib/agent.mjs spawns the CLI
      // with --dangerously-skip-permissions, so the MODEL could pick up Write and edit the file
      // itself — the accept/reject diff would then be reviewing a change already on disk. The
      // whole document is in the prompt, so no tool is needed to do this job at all.
      allowedTools: AI_EDIT_TOOLS,
    })
    if (out?.error) return bad(res, 502, out.error, { path: t.rel })
    if (out?.blocked) return bad(res, 409, 'agent-blocked', { path: t.rel, detail: out.blocked })
    const proposed = unfence(out?.result)
    if (!proposed) return bad(res, 502, 'empty-proposal', { path: t.rel })

    res.json({
      path: t.rel,
      // Whole-file text for the client to diff against its buffer, so accept is one PUT whether
      // the instruction covered a selection or the document.
      text: selection ? whole.replace(selection, () => proposed) : proposed,
      selection: selection || null,
      wrote: false,       // stated, not implied: this endpoint never touches the disk
      cost: out?.cost ?? 0,
    })
  })
}
