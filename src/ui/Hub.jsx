import React, { useState } from 'react'
import { Tabs } from './tabs.jsx'
import { PaneVisible } from '../lib/hooks.js'

const PANE_PARAM = 'pane'

// The pane is part of the address, not just component state. Three things depended on that and all
// three were broken: a deep link could name a section but never a pane, a refresh (which remounts
// the section by key) threw you back to the first pane, and the inbox could only ever land you on
// pane one. Reading the param is guarded by "is this one of MY labels" because every Hub on the page
// reads the same key — a pane name belonging to another section is ignored rather than matched.
const paneFromUrl = items => {
  const want = new URLSearchParams(window.location.search).get(PANE_PARAM)
  return items.some(i => i.label === want) ? want : items[0].label
}

export function paneUrl(pane) {
  const q = new URLSearchParams(window.location.search)
  pane ? q.set(PANE_PARAM, pane) : q.delete(PANE_PARAM)
  return window.location.pathname + (q.toString() ? '?' + q : '')
}

// Props reaching a Hub (App clones `onNav` into the section element) are forwarded to every child:
// a section moved into a Hub otherwise loses them silently, and the CTA that navigates you out of a
// "not configured" pane just stops working. `onGo` lets a child hand off to a sibling pane instead
// of printing a toast telling you where to click next.
export default function Hub({ items, head, ...props }) {
  const [tab, setTab] = useState(() => paneFromUrl(items))
  const [seen, setSeen] = useState({ [tab]: true })
  const go = t => {
    setSeen(s => (s[t] ? s : { ...s, [t]: true }))
    setTab(t)
    window.history.replaceState(null, '', paneUrl(t))
    // One scroll container holds every pane, so without this you arrive at a short pane already
    // scrolled past its content — which is how the tab bar itself ends up hidden under the topbar.
    document.querySelector('main.content')?.scrollTo({ top: 0 })
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Tabs tabs={items.map(i => i.label)} tab={tab} setTab={go} />
      {}
      {head}
      {items.filter(i => seen[i.label]).map(i => (
        <div key={i.label} style={i.label === tab ? undefined : { display: 'none' }}>
          <PaneVisible.Provider value={i.label === tab}>
            {React.cloneElement(i.el, { ...props, onGo: go })}
          </PaneVisible.Provider>
        </div>
      ))}
    </div>
  )
}
