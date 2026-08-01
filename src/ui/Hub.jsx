import React, { useState } from 'react'
import { Tabs } from './tabs.jsx'

export default function Hub({ items }) {
  const [tab, setTab] = useState(items[0].label)
  const [seen, setSeen] = useState({ [items[0].label]: true })
  const go = t => { setSeen(s => (s[t] ? s : { ...s, [t]: true })); setTab(t) }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Tabs tabs={items.map(i => i.label)} tab={tab} setTab={go} />
      {items.filter(i => seen[i.label]).map(i => (
        <div key={i.label} style={i.label === tab ? undefined : { display: 'none' }}>{i.el}</div>
      ))}
    </div>
  )
}
