import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const WIN = process.platform === 'win32';

/**
 * `allowedTools` exists for callers whose contract is "give me text, touch nothing" — the Documents
 * AI edit is the first. Skipping permissions is right for a build agent and wrong for a pure
 * transform: without it, an endpoint's write-free return path guarantees nothing, because the model
 * can pick up Write and edit the file itself. Refusing the tools is the only place that promise can
 * be enforced rather than merely requested in the prompt.
 *
 * An ALLOWLIST, deliberately, and it replaces a denylist that was not closed: `mcp__*` tools from
 * the user's configured servers and SlashCommand can all write, and none of them appears in any
 * fixed list of write-tool names. Pass `[]` to permit nothing.
 *
 * `null`/absent means "no restriction", which is the historical behaviour every other caller
 * depends on — so an empty array and an absent value must stay distinguishable here.
 */
/**
 * `onSpawn` hands the caller the child process. Without it a buffered run is unstoppable: the
 * promise is the only handle, and a promise cannot be cancelled — so a run that had gone wrong had
 * to be waited out to its 30-minute timeout while it kept spending.
 */
/**
 * `transcriptDir` turns a run into something that can be read after the fact.
 *
 * Without it the only trace a finished agent leaves is a 1500-character summary on the ticket: what
 * it was asked, what it answered, what it decided and what it cost all live in this process and die
 * with the promise. On AIR-10733 a server restart mid-run left a dev agent that went on to land a
 * complete commit whose cost, reasoning and final message are simply unrecoverable — the only way
 * to learn what it had done was to read `git log`. The prompt and the raw result are written next
 * to each other so the pair can be reviewed, diffed against the next run, or replayed.
 */
export function runAgent({ cwd, prompt, model, timeoutMs = 1800_000, resume, allowedTools, onSpawn, transcriptDir }) {
  const stamp = (name, body) => {
    if (!transcriptDir) return null;
    try {
      fs.mkdirSync(transcriptDir, { recursive: true });
      const p = path.join(transcriptDir, name);
      fs.writeFileSync(p, body ?? '');
      return p;
    } catch { return null; }
  };
  const promptPath = stamp('prompt.md', prompt);
  return new Promise((resolve) => {
    const args = ['-p', prompt, '--output-format', 'json', '--dangerously-skip-permissions'];
    if (Array.isArray(allowedTools)) args.push('--allowedTools', allowedTools.join(','));
    if (model) args.push('--model', model);
    if (resume) args.push('--resume', resume);
    const child = spawn('claude', args, { cwd, env: process.env, shell: WIN });
    try { onSpawn?.(child) } catch {}
    let out = '',
      err = '';
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {}
      resolve({ error: 'timeout after ' + timeoutMs / 60000 + 'min', promptPath, rawPath: stamp('raw.json', out || err) });
    }, timeoutMs);
    // Streamed to disk as it arrives, not buffered and written at exit. The parent holds the only
    // copy until it resolves, so a parent that dies first — a restart, a crash — takes the agent's
    // entire output with it while the child carries on working. Observed twice on AIR-10733: both
    // orphaned runs left a prompt on disk and nothing else, and the only way to learn what they had
    // done was to read `git log`. An append stream survives the parent.
    let sink = null;
    if (transcriptDir) {
      try {
        fs.mkdirSync(transcriptDir, { recursive: true });
        sink = fs.createWriteStream(path.join(transcriptDir, 'stdout.log'), { flags: 'a' });
        sink.on('error', () => { sink = null; });
      } catch { sink = null; }
    }
    child.stdout.on('data', (d) => { out += d; try { sink?.write(d) } catch {} });
    child.stderr.on('data', (d) => { err += d; try { sink?.write(d) } catch {} });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ error: e.message });
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      try { sink?.end() } catch {}
      // A killed run reported as an error only by accident: the child dies with no output, so
      // JSON.parse throws and the catch below calls it "no output from claude". If it had managed
      // to flush parseable JSON first, a killed agent would have read as a COMPLETED one — and the
      // board would have advanced the ticket to review on work that was cut off mid-way.
      // Written before any parse so a run that produced unparseable output is still readable —
      // that is exactly the case where you most need to see what came back.
      const rawPath = stamp('raw.json', out || err);
      if (signal) return resolve({ error: `stopped (${signal})`, signal, promptPath, rawPath });
      try {
        const j = JSON.parse(out);
        const blocked = /^BLOCKED:\s*(.+)/m.exec(j.result || '');
        stamp('result.md', j.result || '');
        resolve({
          promptPath,
          rawPath,
          transcriptDir: transcriptDir || null,
          result: j.result || '',
          blocked: blocked?.[1] || null,
          cost: j.total_cost_usd || 0,
          turns: j.num_turns || 0,
          sessionId: j.session_id || null,
          ms: j.duration_ms || 0,
        });
      } catch {
        resolve({ error: (err || out).slice(0, 1200) || 'no output from claude', promptPath, rawPath });
      }
    });
  });
}

/**
 * Streamed run. Returns a handle immediately; `onEvent` fires per stream-json event.
 * The caller owns the handle so run state can live on the SERVER, keyed by ticket — a client-owned
 * run dies when React remounts the section, and src/App.jsx's refresh() remounts on every click.
 *
 * `kill` takes an OPTIONAL signal so a caller can escalate. SIGTERM is a request the child is free
 * to ignore, and a child that ignores it keeps running — and keeps spending — after the caller has
 * already marked the run terminal. Omitting the signal keeps the previous SIGTERM behaviour, which
 * every existing caller relies on.
 *
 * @returns {{kill(signal?: NodeJS.Signals): void, get alive(): boolean}}
 */
export function spawnAgent({ cwd, prompt, model, resume, timeoutMs = 1800_000, onEvent, onExit }) {
  const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'];
  if (model) args.push('--model', model);
  if (resume) args.push('--resume', resume);

  let child;
  try {
    child = spawn('claude', args, { cwd, env: process.env, shell: WIN, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    onEvent?.({ type: 'closed', error: e.message });
    onExit?.({ code: null, error: e.message });
    return {
      kill() {},
      get alive() {
        return false;
      },
    };
  }

  let alive = true;
  let buf = '';
  let ended = false;
  // A timeout used to kill the child and record nothing, so the subsequent 'exit' reported
  // `{error: null}` — indistinguishable from a clean finish. A caller then treated a run it had
  // just killed as successful. The reason is remembered here so the exit carries it.
  let timedOut = false;
  // The one-shot line is kept in this exact shape because test/server/ticket.test.mjs asserts on it
  // as source text. Reformatting it silently turns that test red for a reason unrelated to the
  // invariant it is guarding.
  const finish = (payload) => {
    if (ended) return;
    ended = true;
    alive = false;
    clearTimeout(timer);
    if (timedOut && !payload?.error) payload = { ...payload, error: `timeout after ${timeoutMs / 60000}min` };
    onExit?.(payload);
  };
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      child.kill();
    } catch {}
  }, timeoutMs);

  child.stdout.on('data', (d) => {
    buf += d;
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        onEvent?.(JSON.parse(line));
      } catch {}
    }
  });
  child.stderr.on('data', (d) => onEvent?.({ type: 'stderr', text: String(d).slice(0, 2000) }));
  child.on('error', (e) => {
    if (!ended) onEvent?.({ type: 'closed', error: e.message });
    finish({ code: null, error: e.message });
  });
  child.on('exit', (code, signal) => {
    if (!ended) onEvent?.({ type: 'closed', code, signal: signal || null });
    finish({ code, signal: signal || null, error: null });
  });

  return {
    kill(signal) {
      try {
        child.kill(signal);
      } catch {}
    },
    get alive() {
      return alive;
    },
  };
}
