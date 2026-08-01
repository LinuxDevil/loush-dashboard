import test from 'node:test'
import assert from 'node:assert/strict'
import {
  summarizeToolCall,
  firstEnclosingContext,
  countHunks,
  groupEvents,
  parseShellHeadline,
  shortPath,
} from '../../lib/event-grouping.mjs'

const use = (id, name, input = {}) => ({ type: 'tool_use', id, name, input })
const assistant = (blocks, over = {}) => ({
  type: 'assistant',
  uuid: `a-${Math.random().toString(36).slice(2)}`,
  timestamp: '2026-07-29T10:00:00.000Z',
  message: { role: 'assistant', content: blocks },
  ...over,
})
const result = (id, over = {}) => ({
  type: 'user',
  uuid: `r-${id}`,
  timestamp: '2026-07-29T10:00:01.000Z',
  message: {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: id, is_error: over.isError === true, content: over.content ?? 'ok' }],
  },
  ...(over.toolUseResult ? { toolUseResult: over.toolUseResult } : {}),
})

// ---------------------------------------------------------------------------------------------

test('a Read call names the file rather than saying only "Read"', () => {
  const s = summarizeToolCall(use('t1', 'Read', { file_path: '/home/user/proj/src/App.jsx' }))
  assert.equal(s.title, 'Read src/App.jsx')
  assert.equal(s.kind, 'read')
  assert.match(s.summary, /src\/App\.jsx/)
})

test('an Edit reports the size of the change without reproducing the edited text', () => {
  const s = summarizeToolCall(use('t2', 'Edit', {
    file_path: '/home/user/proj/src/App.jsx',
    old_string: 'const KEY = "sk-live-secret-value"',
    new_string: 'const KEY = process.env.KEY',
  }))
  assert.equal(s.title, 'Edit src/App.jsx')
  assert.equal(s.detail.oldLength, 34)
  assert.equal(s.detail.delta, s.detail.newLength - s.detail.oldLength)
  const rendered = `${s.title} ${s.summary} ${JSON.stringify(s.detail)}`
  assert.equal(rendered.includes('sk-live-secret-value'), false, 'edit content must never reach the output')
})

test('a Bash call titles the binary and subcommand but withholds the arguments', () => {
  const s = summarizeToolCall(use('t3', 'Bash', {
    command: 'AWS_SECRET_ACCESS_KEY=zzz npm test -- --grep "Bearer sk-live-abc" | tee out.log',
  }))
  assert.equal(s.title, 'Bash npm test')
  assert.equal(s.kind, 'shell')
  assert.equal(s.detail.argumentsWithheld, true)
  assert.equal(s.detail.stagesOmitted, 1)
  const rendered = `${s.title} ${s.summary} ${JSON.stringify(s.detail)}`
  assert.equal(rendered.includes('sk-live-abc'), false)
  assert.equal(rendered.includes('AWS_SECRET_ACCESS_KEY'), false, 'leading env assignments are dropped, not echoed')
})

test('a single-word command keeps just the binary', () => {
  assert.equal(summarizeToolCall(use('t', 'Bash', { command: 'ls -la /etc' })).title, 'Bash ls')
  assert.equal(parseShellHeadline('/usr/bin/git   -C /repo   commit -m x').headline, 'git commit')
})

test('a Grep row shows the needle and where it was searched', () => {
  const s = summarizeToolCall(use('t4', 'Grep', { pattern: 'useState', path: 'src/' }))
  assert.equal(s.title, 'Grep "useState" in src/')
  assert.equal(s.kind, 'search')
})

test('Glob, Task, WebFetch, WebSearch, TodoWrite and NotebookEdit each get a specific title', () => {
  assert.equal(summarizeToolCall(use('a', 'Glob', { pattern: '**/*.mjs' })).title, 'Glob **/*.mjs')
  assert.equal(summarizeToolCall(use('b', 'Task', { subagent_type: 'code-reviewer', prompt: 'secret plan' })).title, 'Task code-reviewer')
  assert.equal(summarizeToolCall(use('c', 'WebFetch', { url: 'https://docs.example.com/x?token=abc' })).title, 'WebFetch docs.example.com')
  assert.equal(summarizeToolCall(use('d', 'WebSearch', { query: 'node test runner' })).title, 'WebSearch "node test runner"')
  assert.equal(summarizeToolCall(use('e', 'TodoWrite', { todos: [{ status: 'completed' }, { status: 'pending' }] })).title, 'TodoWrite 2 todos')
  assert.equal(summarizeToolCall(use('f', 'NotebookEdit', { notebook_path: '/n/analysis.ipynb', cell_type: 'code' })).title, 'NotebookEdit n/analysis.ipynb')
  assert.equal(summarizeToolCall(use('g', 'Write', { file_path: '/p/lib/x.mjs', content: 'a\nb\n' })).title, 'Write lib/x.mjs')
})

test('a WebFetch never carries the URL path or query into the output', () => {
  const s = summarizeToolCall(use('t5', 'WebFetch', {
    url: 'https://user:pw@files.example.com/private?X-Amz-Signature=deadbeef',
    prompt: 'summarise',
  }))
  assert.equal(s.title, 'WebFetch files.example.com')
  const rendered = `${s.title} ${s.summary} ${JSON.stringify(s.detail)}`
  for (const secret of ['deadbeef', 'X-Amz-Signature', 'user:pw', 'private']) {
    assert.equal(rendered.includes(secret), false, `${secret} must not appear`)
  }
})

test('a TodoWrite reports counts and withholds the item text', () => {
  const s = summarizeToolCall(use('t6', 'TodoWrite', {
    todos: [
      { status: 'completed', content: 'rotate the leaked key sk-live-xyz' },
      { status: 'in_progress', content: 'deploy' },
      { status: 'weird', content: 'x' },
    ],
  }))
  assert.equal(s.detail.total, 3)
  assert.equal(s.detail.other, 1, 'an unrecognised status is counted as unrecognised, not as pending')
  assert.equal(JSON.stringify(s).includes('sk-live-xyz'), false)
})

test('an unrecognised tool is named truthfully instead of getting an invented description', () => {
  const s = summarizeToolCall(use('t7', 'mcp__linear__create_issue', { title: 'x', apiKey: 'lin_api_secret' }))
  assert.equal(s.title, 'mcp__linear__create_issue')
  assert.equal(s.kind, 'unknown')
  assert.match(s.summary, /mcp__linear__create_issue/)
  assert.match(s.summary, /No per-tool summary renderer exists/)
  assert.equal(s.detail.rendered, false)
  assert.deepEqual(s.detail.inputKeys, ['title', 'apiKey'], 'key names are schema and are safe to show')
  assert.equal(s.detail.inputValuesWithheld, true)
  assert.equal(JSON.stringify(s).includes('lin_api_secret'), false, 'unknown tools have unknown secret fields — values are withheld')
})

test('malformed records return an honest unknown instead of throwing', () => {
  for (const bad of [null, undefined, 42, 'nope', {}, { message: { content: 'text only' } }, { type: 'tool_use' }]) {
    const s = summarizeToolCall(bad)
    assert.equal(typeof s.title, 'string')
    assert.equal(s.kind, 'unknown')
  }
  assert.equal(summarizeToolCall({ type: 'tool_use', name: 'Read' }).title, 'Read', 'a missing input object is not a crash')
})

test('a tool call nested in a full transcript record is found', () => {
  const rec = assistant([{ type: 'text', text: 'ok' }, use('t8', 'Read', { file_path: '/a/b/c.py' })])
  assert.equal(summarizeToolCall(rec).title, 'Read b/c.py')
})

test('a long search pattern is truncated and says so', () => {
  const s = summarizeToolCall(use('t9', 'Grep', { pattern: 'x'.repeat(200) }))
  assert.equal(s.detail.patternTruncated, true)
  assert.ok(s.detail.pattern.length < 200)
})

test('shortPath keeps two trailing segments so sibling files stay distinguishable', () => {
  assert.equal(shortPath('/home/u/p/src/App.jsx'), 'src/App.jsx')
  assert.equal(shortPath('App.jsx'), 'App.jsx')
  assert.equal(shortPath(null), null)
})

// ---------------------------------------------------------------------------------------------

test('the enclosing function comes from the diff hunk header when git supplied one', () => {
  const hunk = ['@@ -10,7 +10,9 @@ export function useSessionList(opts) {', ' const a = 1', '+const b = 2'].join('\n')
  assert.equal(firstEnclosingContext(hunk), 'useSessionList')
})

test('with no usable header the hunk lines are scanned backwards for a declaration', () => {
  const hunk = {
    oldStart: 40,
    lines: ['   return x', ' }', ' ', ' function computeTotals(rows) {', '-  let t = 0', '+  let t = 1'],
  }
  assert.equal(firstEnclosingContext(hunk), 'computeTotals')
})

test('declarations are recognised across JS, Python, Go, Rust and Java', () => {
  const one = line => firstEnclosingContext({ lines: [line] })
  assert.equal(one(' const useThing = (a) => {'), 'useThing')
  assert.equal(one(' export async function loadAll() {'), 'loadAll')
  assert.equal(one(' class SessionStore extends Base {'), 'SessionStore')
  assert.equal(one(' def compute_totals(rows):'), 'compute_totals')
  assert.equal(one(' async def fetch_all(self):'), 'fetch_all')
  assert.equal(one(' func ParseConfig(p string) error {'), 'ParseConfig')
  assert.equal(one(' func (s *Server) Handle(w http.ResponseWriter) {'), 'Server.Handle')
  assert.equal(one(' type Config struct {'), 'Config')
  assert.equal(one(' pub fn parse_config(path: &str) -> Result<Config> {'), 'parse_config')
  assert.equal(one(' impl Display for Config {'), 'Display')
  assert.equal(one(' public static void main(String[] args) {'), 'main')
  assert.equal(one(' private List<String> namesOf(Session s) {'), 'namesOf')
  assert.equal(one('   renderRow(item) {'), 'renderRow')
})

test('firstEnclosingContext returns null when nothing is identifiable', () => {
  const nothing = [
    '@@ -1,3 +1,4 @@',
    '   total += row.value',
    '-  total = 0',
    '+  total = 1',
    '   console.log(total)',
  ].join('\n')
  assert.equal(firstEnclosingContext(nothing), null)

  assert.equal(firstEnclosingContext({ lines: ['   if (ready) {'] }), null, 'a control-flow brace is not a declaration')
  assert.equal(firstEnclosingContext({ lines: ['   for (const r of rows) {'] }), null)
  assert.equal(firstEnclosingContext({ lines: ['   } catch (err) {'] }), null)
  assert.equal(firstEnclosingContext({ lines: ['   return computeTotals(rows);'] }), null, 'a call site is not a definition')
  assert.equal(firstEnclosingContext({ lines: ['   store.reload(force);'] }), null)
  assert.equal(firstEnclosingContext('@@ -1,1 +1,1 @@ }'), null, 'a junk header falls through to the scan, which finds nothing')

  for (const bad of [null, undefined, 42, {}, [], '', { lines: 'not-an-array' }, { lines: [null, 7] }]) {
    assert.equal(firstEnclosingContext(bad), null)
  }
})

test('countHunks separates malformed hunks from counted ones instead of dropping them', () => {
  const c = countHunks([
    { lines: ['+a', '-b', ' c'] },
    { oldStart: 5 },
    { lines: ['+x', '+y'] },
  ])
  assert.deepEqual(c, { hunks: 3, counted: 2, added: 3, removed: 1 })
  assert.deepEqual(countHunks(null), { hunks: 0, counted: 0, added: 0, removed: 0 })
})

// ---------------------------------------------------------------------------------------------

test('consecutive same-tool calls on the same file collapse into one counted group', () => {
  const records = [
    assistant([use('e1', 'Edit', { file_path: '/p/src/App.jsx', old_string: 'a', new_string: 'b' })]),
    result('e1'),
    assistant([use('e2', 'Edit', { file_path: '/p/src/App.jsx', old_string: 'c', new_string: 'd' })]),
    result('e2'),
    assistant([use('e3', 'Edit', { file_path: '/p/src/App.jsx', old_string: 'e', new_string: 'f' })]),
    result('e3'),
    assistant([use('e4', 'Edit', { file_path: '/p/src/Other.jsx', old_string: 'g', new_string: 'h' })]),
    result('e4'),
  ]
  const { groups } = groupEvents(records)
  assert.equal(groups.length, 2, 'same-file edits merge, a different file starts a new group')
  assert.equal(groups[0].count, 3)
  assert.equal(groups[0].toolUseIds.length, 3)
  assert.match(groups[0].summary, /3 consecutive Edit calls/)
  assert.equal(groups[1].count, 1)
})

test('collapse can be turned off without changing anything else', () => {
  const records = [
    assistant([use('e1', 'Read', { file_path: '/p/a.mjs' })]), result('e1'),
    assistant([use('e2', 'Read', { file_path: '/p/a.mjs' })]), result('e2'),
  ]
  assert.equal(groupEvents(records).groups.length, 1)
  assert.equal(groupEvents(records, { collapse: false }).groups.length, 2)
})

test('a tool_use is paired with its tool_result by tool_use_id, and errors are marked', () => {
  const records = [
    assistant([use('x1', 'Bash', { command: 'npm test' }), use('x2', 'Read', { file_path: '/p/a.mjs' })]),
    result('x2'),
    result('x1', { isError: true }),
  ]
  const { groups, unpaired } = groupEvents(records)
  assert.deepEqual(unpaired, [])
  const bash = groups.find(g => g.tool === 'Bash')
  const read = groups.find(g => g.tool === 'Read')
  assert.equal(bash.status, 'error')
  assert.equal(read.status, 'ok')
})

test('an unpaired tool_use is reported as still running rather than silently dropped', () => {
  const records = [
    assistant([use('ok1', 'Read', { file_path: '/p/a.mjs' })]),
    result('ok1'),
    assistant([use('pending1', 'Bash', { command: 'npm run build' })]),
  ]
  const { groups, unpaired } = groupEvents(records)
  assert.equal(groups.length, 2, 'the unpaired call still gets a row')
  assert.equal(groups[1].status, 'running')
  assert.equal(unpaired.length, 1)
  assert.deepEqual(
    { id: unpaired[0].toolUseId, reason: unpaired[0].reason, tool: unpaired[0].tool },
    { id: 'pending1', reason: 'no-tool-result', tool: 'Bash' },
  )
})

test('a tool_use with no id is reported as unpairable, distinct from still running', () => {
  const { unpaired } = groupEvents([assistant([{ type: 'tool_use', name: 'Read', input: { file_path: '/p/a.mjs' } }])])
  assert.equal(unpaired.length, 1)
  assert.equal(unpaired[0].reason, 'missing-tool-use-id')
  assert.equal(unpaired[0].toolUseId, null)
})

test('subagent events nest under the Task that spawned them', () => {
  const records = [
    assistant([use('task1', 'Task', { subagent_type: 'explorer', prompt: 'go look' })]),
    assistant([use('sub1', 'Grep', { pattern: 'useState', path: 'src/' })], {
      isSidechain: true, parentToolUseId: 'task1',
    }),
    result('sub1'),
    result('task1'),
    assistant([use('main1', 'Write', { file_path: '/p/out.mjs', content: 'x' })]),
    result('main1'),
  ]
  const { groups } = groupEvents(records)
  assert.deepEqual(groups.map(g => g.tool), ['Task', 'Write'], 'subagent work does not appear at top level')
  assert.equal(groups[0].children.length, 1)
  assert.equal(groups[0].children[0].tool, 'Grep')
  assert.equal(groups[0].children[0].isSidechain, true)
})

test('a subagent event whose parent is missing stays visible and is flagged as an orphan', () => {
  const records = [assistant([use('sub9', 'Grep', { pattern: 'x' })], { isSidechain: true, parentToolUseId: 'gone' })]
  const { groups, orphans } = groupEvents(records)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].orphanParentToolUseId, 'gone')
  assert.equal(orphans.length, 1)
  assert.equal(orphans[0].parentToolUseId, 'gone')
})

test('an Edit group folds in hunk counts and the enclosing function from its result patch', () => {
  const records = [
    assistant([use('p1', 'Edit', { file_path: '/p/src/store.mjs', old_string: 'a', new_string: 'b' })]),
    result('p1', {
      toolUseResult: {
        structuredPatch: [{ oldStart: 10, lines: [' export function loadSessions(dir) {', '-  const a = 1', '+  const a = 2'] }],
      },
    }),
  ]
  const { groups } = groupEvents(records)
  assert.deepEqual(groups[0].detail.patch, { hunks: 1, counted: 1, added: 1, removed: 1 })
  assert.equal(groups[0].detail.enclosingContext, 'loadSessions')
})

test('text, thinking and system records become their own groups without leaking full bodies', () => {
  const long = 'y'.repeat(500)
  const { groups } = groupEvents([
    assistant([{ type: 'text', text: long }]),
    assistant([{ type: 'thinking', thinking: 'secret reasoning' }]),
    { type: 'system', subtype: 'compact_boundary', uuid: 's1' },
  ])
  assert.deepEqual(groups.map(g => g.kind), ['text', 'thinking', 'system'])
  assert.equal(groups[0].detail.truncated, true)
  assert.equal(groups[0].detail.length, 500)
  assert.ok(groups[0].summary.length < 200)
  assert.equal(JSON.stringify(groups[1]).includes('secret reasoning'), false, 'thinking is measured, not quoted')
  assert.equal(groups.length, 3, 'two adjacent prose blocks never merge into one group')
})

test('maxGroups reports what it left out instead of silently cutting the list', () => {
  const records = []
  for (const f of ['a', 'b', 'c', 'd']) {
    records.push(assistant([use(f, 'Read', { file_path: `/p/${f}.mjs` })]), result(f))
  }
  const full = groupEvents(records)
  assert.equal(full.truncated, null)
  const cut = groupEvents(records, { maxGroups: 2 })
  assert.equal(cut.groups.length, 2)
  assert.deepEqual(cut.truncated, { limit: 2, omitted: 2 })
  assert.equal(cut.counts.groups, 4, 'the real total is still reported')
})

test('groupEvents never throws on malformed input and counts what it could not read', () => {
  const out = groupEvents([null, 7, 'str', {}, { message: { content: null } }, { type: 'user', message: { content: [{ type: 'tool_result' }] } }])
  assert.ok(Array.isArray(out.groups))
  assert.ok(out.counts.malformed >= 1, 'unreadable records are counted, not ignored')
  for (const bad of [null, undefined, 'nope', 42, {}]) {
    const o = groupEvents(bad, null)
    assert.deepEqual(o.groups, [])
    assert.deepEqual(o.unpaired, [])
  }
})

test('subagent nesting also works off sourceToolUseID, the field real transcripts use', () => {
  const records = [
    assistant([use('task2', 'Task', { subagent_type: 'explorer' })]),
    assistant([use('sub2', 'Read', { file_path: '/p/a.mjs' })], { isSidechain: true, sourceToolUseID: 'task2' }),
    result('sub2'),
    result('task2'),
  ]
  const { groups, counts } = groupEvents(records)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].children[0].tool, 'Read')
  assert.equal(counts.sidechainUnlinked, 0)
})

test('sidechain events with no parent link at all are counted as unlinked, not quietly flattened', () => {
  const { counts } = groupEvents([
    assistant([use('s1', 'Grep', { pattern: 'x' })], { isSidechain: true, agentId: 'agent-a1', agentType: 'explorer' }),
  ])
  assert.equal(counts.sidechain, 1)
  assert.equal(counts.sidechainUnlinked, 1)
})

test('record types this build does not model are counted by type rather than vanishing', () => {
  const { groups, counts } = groupEvents([
    { type: 'attachment', uuid: 'x1' },
    { type: 'attachment', uuid: 'x2' },
    assistant([use('r1', 'Read', { file_path: '/p/a.mjs' })]),
  ])
  assert.equal(groups.length, 1)
  assert.deepEqual(counts.skippedRecordTypes, { attachment: 2 })
})

test('an unknown tool still groups and pairs like any other call', () => {
  const records = [
    assistant([use('m1', 'mcp__notion__notion-search', { query: 'x' })]),
    result('m1'),
  ]
  const { groups, unpaired } = groupEvents(records)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].tool, 'mcp__notion__notion-search')
  assert.equal(groups[0].kind, 'unknown')
  assert.equal(groups[0].status, 'ok')
  assert.deepEqual(unpaired, [])
})
