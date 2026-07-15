import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { deriveSessionsFromTranscripts } from '../career-insights.mjs'

// write a tiny fake transcript and assert every derived field
test('deriveSessionsFromTranscripts extracts structural fields from raw .jsonl', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-tx-'))
  const proj = path.join(dir, '-Users-me-app')
  fs.mkdirSync(proj)
  const lines = [
    { timestamp: '2026-06-30T19:00:00Z', cwd: '/Users/me/app', message: { role: 'user', content: 'go' } },
    { timestamp: '2026-06-30T19:00:05Z', message: { role: 'assistant', content: [
      { type: 'tool_use', name: 'Edit', input: {} },
      { type: 'tool_use', name: 'Bash', input: { command: 'git commit -m x && git push' } } ] } },
    { timestamp: '2026-06-30T19:00:20Z', toolUseResult: { filePath: 'a.ts', structuredPatch: [{ lines: ['+x'] }] } },
    { timestamp: '2026-06-30T19:00:30Z', message: { role: 'user', content: 'next' } },            // 25s response gap
    { timestamp: '2026-06-30T19:00:35Z', message: { role: 'user', content: '[Request interrupted by user]' } },
  ]
  fs.writeFileSync(path.join(proj, 's1.jsonl'), lines.map(l => JSON.stringify(l)).join('\n'))
  // subagent transcripts must be ignored
  fs.mkdirSync(path.join(proj, 'subagents'))
  fs.writeFileSync(path.join(proj, 'subagents', 'a.jsonl'), JSON.stringify(lines[1]))

  const { sessions, parsed } = deriveSessionsFromTranscripts(dir)
  assert.equal(sessions.length, 1, 'one real session, subagent skipped')
  const s = sessions[0]
  assert.equal(s.session_id, 's1')
  assert.equal(s.project_path, '/Users/me/app')
  assert.equal(s.git_commits, 1)
  assert.equal(s.git_pushes, 1)
  assert.equal(s.user_interruptions, 1)
  assert.deepEqual(s.tool_counts, { Edit: 1, Bash: 1 })
  assert.deepEqual(s.languages, { TypeScript: 1 })
  assert.deepEqual(s.user_response_times, [25])
  assert.equal(s.start_time, '2026-06-30T19:00:00.000Z')
  assert.ok(parsed >= 1)
  fs.rmSync(dir, { recursive: true, force: true })
})
