// What to call a session on screen.
//
// Every surface in this app identified sessions by UUID — a session row, a card on the Now board,
// an entry in the resume picker all read `8cf64285`. That is the one thing about a session a human
// never remembers and cannot act on.
//
// Claude Code already writes the answer into the transcript, in three forms, and they have a strict
// order of authority:
//   1. `{type:'custom-title', customTitle}`  — a title the human chose (/rename, `claude -n`, the
//      picker's Ctrl+R). It always wins; the user overrode whatever we would have guessed.
//   2. `{type:'ai-title', aiTitle}`          — auto-generated from the conversation.
//   3. the first real user prompt            — for sessions that never got either, including every
//      imported one. Truncated, with harness noise stripped (see below).
// Falling off the end of that list is not an error: `null` means "the transcript did not say", and
// the caller shows the short id. It must never return an empty string, which would render as a
// blank row and read as data loss.
//
// The last title line wins, not the first: a rename appends a new record rather than editing the
// old one, so the newest is the current one.

export const MAX_NAME_LEN = 80

// Below this many characters a prompt is a keystroke, not a name. Measured on this machine: the
// first user turn is literally `x` in four sessions and `clear` in another — people type those to
// interrupt or reset, not to describe work. Naming a row after one is worse than showing its id,
// because it looks like a name, says nothing, and several unrelated sessions end up sharing it.
// A prompt that fails this bar is skipped and the NEXT one is considered, so a session that opens
// with `x` and then asks for something real gets named after the real thing.
export const MIN_PROMPT_LEN = 8

// Wrappers Claude Code puts around a user turn that are not what the user typed. A prompt whose
// entire body is one of these is noise, and naming a session after it would give a dozen unrelated
// sessions the same name.
const NOISE_BLOCKS = [
  /<local-command-caveat>[\s\S]*?<\/local-command-caveat>/gi,
  /<system-reminder>[\s\S]*?<\/system-reminder>/gi,
  /<command-message>[\s\S]*?<\/command-message>/gi,
  /<command-args>[\s\S]*?<\/command-args>/gi,
  /<command-contents>[\s\S]*?<\/command-contents>/gi,
]
// A slash command is a legitimate name — `/graphify` says more about the session than the caveat
// text wrapped around it — so it is extracted rather than stripped.
const COMMAND_NAME = /<command-name>\s*([^<]+?)\s*<\/command-name>/i

// Text out of a message.content that may be a string or an array of blocks. Only `text` blocks
// count: a turn that is nothing but a tool_result or an image is not a prompt anyone wrote.
export function messageText(message) {
  const c = message?.content
  if (typeof c === 'string') return c
  if (!Array.isArray(c)) return ''
  return c.filter(b => b?.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n')
}

// Turn one raw user turn into something worth showing, or '' if there is nothing there.
export function cleanPrompt(raw) {
  if (typeof raw !== 'string') return ''
  const cmd = raw.match(COMMAND_NAME)
  let s = raw
  for (const re of NOISE_BLOCKS) s = s.replace(re, ' ')
  s = s
    .replace(/<\/?[a-z][^>]*>/gi, ' ')          // any other harness tag
    .replace(/^\s*[#>*\-\s]+/, '')              // leading markdown heading / quote / bullet
    .replace(/`{1,3}/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  // A slash command whose body was all wrapper text still deserves its command name.
  if (!s && cmd) return cmd[1].trim()
  if (cmd && s.length < 12) return (cmd[1] + ' ' + s).trim()
  return s
}

const truncate = s => (s.length <= MAX_NAME_LEN ? s : s.slice(0, MAX_NAME_LEN - 1).trimEnd() + '…')

// Fold one parsed JSONL line into an accumulator. Called from the walker that already visits every
// line, so naming costs one extra branch per line and no extra file read.
//
// `acc` is a plain object so a caller can create it with `{}` and hand it straight back.
export function foldNameLine(acc, j) {
  if (!j || typeof j !== 'object') return acc
  if (j.type === 'custom-title' && typeof j.customTitle === 'string' && j.customTitle.trim()) {
    acc.custom = j.customTitle.trim()
    return acc
  }
  if (j.type === 'ai-title' && typeof j.aiTitle === 'string' && j.aiTitle.trim()) {
    acc.ai = j.aiTitle.trim()
    return acc
  }
  // Only the FIRST usable prompt, and never a subagent's: `isSidechain` marks a turn that belongs
  // to a nested agent, whose instructions describe the subtask rather than the session.
  if (acc.prompt || j.type !== 'user' || j.isSidechain) return acc
  const cleaned = cleanPrompt(messageText(j.message))
  // Too short to be a name: leave acc.prompt unset so the next user turn gets its chance.
  if (cleaned.length >= MIN_PROMPT_LEN) acc.prompt = cleaned
  return acc
}

// The name, or null when the transcript genuinely does not say. Callers fall back to the short id;
// this function does not, because it does not know the id and inventing one here would hide the
// difference between "named" and "unnamed" from every consumer.
export function sessionName(acc) {
  const pick = acc?.custom || acc?.ai || acc?.prompt
  return pick ? truncate(pick) : null
}

// Which of the three sources the name came from. Surfaced alongside the name so a UI can style an
// inferred name differently from one the human chose — the same reason `source` is on the pricing
// payload.
export function nameSource(acc) {
  if (acc?.custom) return 'custom'
  if (acc?.ai) return 'ai'
  if (acc?.prompt) return 'prompt'
  return null
}
