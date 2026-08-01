// workScope — the one answer to "which repo, and which ticket, am I working on".
//
// THE FAILURE THIS EXISTS TO PREVENT
// Four panes sit in one tab and every one of them used to ask for the project separately, in its
// own vocabulary: the ticket pane by workspace id, the board and the dispatcher by absolute path,
// the runs filter by BASENAME, and the harness-scoped panels by scope id (which is also the path).
// Nothing synchronised them, so the tab routinely showed the board for one repo above a ticket from
// another, each pane correct in isolation and the screen as a whole a lie. One store, one key.
//
// The key is the absolute path, because every other identifier is derivable from it and it is
// derivable from none of them: the basename loses the parent directory (two `ct-web-flights`
// checkouts are a real case here), and a workspace id only exists for folders you have opened a
// Claude Code session in.
//
// NOT dataScope. That one narrows aggregate QUERIES and guards against a stale response landing
// under a newer heading. This one says which repo the user is working in. Merging them would mean a
// "show me everything" filter also meant "work on nothing", which is not the same sentence.

const KEY = 'workScope'
const listeners = new Set()
let state = read()

function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}')
    return { path: typeof raw.path === 'string' ? raw.path : null, ticket: typeof raw.ticket === 'string' ? raw.ticket : null }
  } catch { return { path: null, ticket: null } }
}

/** basename without importing a path module — the runs list keys on this (server: path.basename). */
export const basename = p => (p ? String(p).replace(/\/+$/, '').split('/').pop() : null)

export const workScope = {
  get: () => state,
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
  /**
   * Patch the scope. Changing the repo CLEARS the ticket unless a new one is given in the same
   * call: a ticket key belongs to exactly one repo, and carrying TRN-310 into a different checkout
   * would point every pane at work that does not exist there.
   */
  set(patch) {
    const next = { ...state, ...patch }
    if (patch.path !== undefined && patch.path !== state.path && patch.ticket === undefined) next.ticket = null
    if (next.path === state.path && next.ticket === state.ticket) return state
    state = next
    try { localStorage.setItem(KEY, JSON.stringify(state)) } catch {}
    for (const fn of listeners) fn(state)
    return state
  },
}
