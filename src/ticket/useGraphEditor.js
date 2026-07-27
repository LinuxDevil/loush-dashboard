import { useCallback, useEffect, useRef, useState } from 'react'
import { api, toast } from '../lib/api.js'

// Undo/redo + structural editing for the design graph.
//
// WHY A STACK AND NOT A FLAG
// Shneiderman's third principle of direct manipulation is "rapid, incremental, REVERSIBLE
// operations". Reversibility is constitutive of a canvas, not a feature on top of one: people will
// not drag, delete or rename in something they cannot back out of. Retrofitting undo onto mutable
// state is a rewrite, so the graph is only ever replaced wholesale here and every replacement
// pushes the previous value.
//
// The stack is deliberately CLIENT-side and in-memory. The server owns `rev` and rejects a stale
// write with 409; undo is about the last few seconds of intent, not durable history.

const LIMIT = 100

export function useGraphEditor({ tKey, project, graph, rev, onGraph }) {
  const [past, setPast] = useState([])
  const [future, setFuture] = useState([])
  const [saving, setSaving] = useState(null)     // null | 'saving' | 'error'
  const revRef = useRef(rev)
  useEffect(() => { revRef.current = rev }, [rev])

  // A new ticket, or a re-derive landing, invalidates the history — those snapshots describe a
  // different graph and undoing into them would silently resurrect deleted work.
  useEffect(() => { setPast([]); setFuture([]) }, [tKey])

  const persist = useCallback(async next => {
    setSaving('saving')
    try {
      const out = await api.put(`/api/ticket/${tKey}/design/graph?project=${project}`, { graph: next, rev: revRef.current })
      revRef.current = out.rev
      onGraph(out)
      setSaving(null)
      return true
    } catch (e) {
      setSaving('error')
      // 409 means someone else moved first. Reloading would throw away what the user just did, so
      // say so and leave their version on screen to copy out of.
      toast(/changed elsewhere/i.test(e.message) ? 'this design changed elsewhere — your edit was not saved' : `could not save: ${e.message}`, 'error')
      return false
    }
  }, [tKey, project, onGraph])

  /** Replace the graph, remembering the previous value. */
  const commit = useCallback(next => {
    setPast(p => [...p.slice(-(LIMIT - 1)), graph])
    setFuture([])
    persist(next)
  }, [graph, persist])

  const undo = useCallback(() => {
    setPast(p => {
      if (!p.length) return p
      const prev = p[p.length - 1]
      setFuture(f => [graph, ...f].slice(0, LIMIT))
      persist(prev)
      return p.slice(0, -1)
    })
  }, [graph, persist])

  const redo = useCallback(() => {
    setFuture(f => {
      if (!f.length) return f
      setPast(p => [...p.slice(-(LIMIT - 1)), graph])
      persist(f[0])
      return f.slice(1)
    })
  }, [graph, persist])

  // ---- structural ops, each a whole-graph replacement so undo is uniform ----
  const slug = s => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48)

  const addNode = useCallback((label, type = 'process') => {
    const base = slug(label) || 'node'
    let id = base, i = 2
    while (graph.nodes.some(n => n.id === id)) id = `${base}-${i++}`
    commit({ ...graph, nodes: [...graph.nodes, { id, type, position: null, data: { label: label || 'New component', note: '', files: [], origin: 'user' } }] })
    return id
  }, [graph, commit])

  const removeNode = useCallback(id => {
    const lost = graph.edges.filter(e => e.source === id || e.target === id).length
    commit({ nodes: graph.nodes.filter(n => n.id !== id), edges: graph.edges.filter(e => e.source !== id && e.target !== id) })
    // Naming the collateral edge deletions is the part people forget, and it is the reason a
    // delete feels like data loss when it is actually undoable.
    toast(lost ? `deleted 1 component and ${lost} connection${lost > 1 ? 's' : ''} — ⌘Z to undo` : 'deleted 1 component — ⌘Z to undo')
  }, [graph, commit])

  /** Delete a multi-selection in ONE undo step — N separate steps would be N undos to get back. */
  const removeNodes = useCallback(ids => {
    const set = new Set(ids)
    const lost = graph.edges.filter(e => set.has(e.source) || set.has(e.target)).length
    commit({ nodes: graph.nodes.filter(n => !set.has(n.id)), edges: graph.edges.filter(e => !set.has(e.source) && !set.has(e.target)) })
    toast(`deleted ${set.size} component${set.size > 1 ? 's' : ''}${lost ? ` and ${lost} connection${lost > 1 ? 's' : ''}` : ''} — ⌘Z to undo`)
  }, [graph, commit])

  const setEdgeLabel = useCallback((id, label) => {
    commit({ ...graph, edges: graph.edges.map(e => (e.id === id ? { ...e, label, data: { ...e.data, origin: 'user' } } : e)) })
  }, [graph, commit])

  const patchNode = useCallback((id, patch) => {
    commit({
      ...graph,
      nodes: graph.nodes.map(n => (n.id === id
        ? { ...n, ...(patch.type ? { type: patch.type } : {}), data: { ...n.data, ...patch.data, origin: 'user' } }
        : n)),
    })
  }, [graph, commit])

  const addEdge = useCallback((source, target, label = '') => {
    const id = `e:${source}>${target}`
    if (source === target || graph.edges.some(e => e.id === id)) return
    commit({ ...graph, edges: [...graph.edges, { id, source, target, label, data: { kind: 'depends', origin: 'user', isStatic: false, evidence: '' } }] })
  }, [graph, commit])

  const removeEdge = useCallback(id => commit({ ...graph, edges: graph.edges.filter(e => e.id !== id) }), [graph, commit])

  return {
    undo, redo, commit, addNode, removeNode, removeNodes, patchNode, addEdge, removeEdge, setEdgeLabel,
    canUndo: past.length > 0, canRedo: future.length > 0, undoDepth: past.length, saving,
  }
}
