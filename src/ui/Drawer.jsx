import React, { useEffect, useState } from 'react'

// Field specs per resource kind — mirrors the real frontmatter formats found on disk.
export const SPECS = {
  skills: {
    title: 'Skill',
    fields: [
      { k: 'name', label: 'Name', type: 'text', required: true, lockOnEdit: true, ph: 'my-skill (kebab-case)' },
      { k: 'description', label: 'Description — when should Claude trigger it?', type: 'textarea', ph: 'Use when the user asks to…' },
      { k: 'argument-hint', label: 'Argument hint', type: 'text', ph: '<path> [--flag]' },
      { k: 'allowed-tools', label: 'Allowed tools (comma-separated)', type: 'text', list: true, ph: 'Read, Bash, Grep' },
    ],
    defaultBody: n => `# /${n}\n\nInstructions for this skill.\n`,
  },
  commands: {
    title: 'Command',
    fields: [
      { k: 'name', label: 'Name', type: 'text', required: true, lockOnEdit: true, ph: 'my-command' },
      { k: 'description', label: 'Description', type: 'textarea' },
      { k: 'argument-hint', label: 'Argument hint', type: 'text', ph: '<your input>' },
      { k: 'allowed-tools', label: 'Allowed tools (comma-separated)', type: 'text', list: true },
    ],
    defaultBody: () => `Prompt body.\n\n$ARGUMENTS\n`,
  },
  agents: {
    title: 'Agent',
    fields: [
      { k: 'name', label: 'Name', type: 'text', required: true, lockOnEdit: true },
      { k: 'description', label: 'Description — when should this agent be spawned?', type: 'textarea' },
      { k: 'tools', label: 'Tools (comma-separated, supports mcp__x__*)', type: 'text', ph: 'Read, Grep, Glob' },
      { k: 'model', label: 'Model', type: 'select', options: ['', 'haiku', 'sonnet', 'opus', 'inherit'] },
      { k: 'color', label: 'Color', type: 'color' },
    ],
    defaultBody: () => `System prompt for this agent.\n`,
  },
  mcp: {
    title: 'MCP Server',
    fields: [
      { k: 'name', label: 'Name', type: 'text', required: true, lockOnEdit: true },
      { k: 'type', label: 'Transport', type: 'select', options: ['stdio', 'http'] },
      { k: 'command', label: 'Command (stdio)', type: 'text', ph: 'npx', showIf: v => v.type !== 'http' },
      { k: 'args', label: 'Arguments (one per line)', type: 'textarea', ph: '-y\nsome-mcp-server', showIf: v => v.type !== 'http' },
      { k: 'env', label: 'Env vars (KEY=value per line)', type: 'textarea', ph: 'API_KEY=…', showIf: v => v.type !== 'http' },
      { k: 'url', label: 'URL (http)', type: 'text', ph: 'https://mcp.example.com/mcp', showIf: v => v.type === 'http' },
    ],
  },
}

// Serialize frontmatter matching the on-disk conventions (quoted strings, YAML list for allowed-tools, inline string for agent tools).
export function serializeFM(values, spec) {
  const lines = []
  for (const f of spec.fields) {
    if (f.k === 'type' || f.k === 'command' || f.k === 'args' || f.k === 'env' || f.k === 'url') continue // mcp handled separately
    let v = values[f.k]
    if (v === undefined || v === null || v === '') continue
    if (f.list) {
      const arr = String(v).split(',').map(s => s.trim()).filter(Boolean)
      if (!arr.length) continue
      lines.push(`${f.k}:`)
      arr.forEach(x => lines.push(`  - ${x}`))
    } else if (f.k === 'color') lines.push(`${f.k}: "${v}"`)
    else if (/[:#"'\n{}\[\]]|^\s|\s$/.test(String(v))) lines.push(`${f.k}: "${String(v).replace(/"/g, '\\"')}"`)
    else lines.push(`${f.k}: ${v}`)
  }
  return `---\n${lines.join('\n')}\n---\n`
}

export function mcpConfigFrom(values) {
  if (values.type === 'http') return { type: 'http', url: values.url || '' }
  const env = {}
  for (const line of (values.env || '').split('\n')) {
    const i = line.indexOf('=')
    if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return { type: 'stdio', command: values.command || '', args: (values.args || '').split('\n').map(s => s.trim()).filter(Boolean), env }
}

export function mcpValuesFrom(name, config) {
  return {
    name, type: config.url ? 'http' : 'stdio', url: config.url || '',
    command: config.command || '', args: (config.args || []).join('\n'),
    env: Object.entries(config.env || {}).map(([k, v]) => `${k}=${v}`).join('\n'),
  }
}

export default function Drawer({ open, mode, kind, initial, onSave, onClose, extraNote }) {
  const spec = SPECS[kind]
  const [values, setValues] = useState({})
  const [err, setErr] = useState('')
  useEffect(() => { setValues(initial || (kind === 'mcp' ? { type: 'stdio' } : {})); setErr('') }, [open, initial])
  if (!open) return null

  const set = (k, v) => setValues(x => ({ ...x, [k]: v }))
  const submit = () => {
    for (const f of spec.fields) if (f.required && !String(values[f.k] || '').trim()) return setErr(`${f.label} is required`)
    if (values.name && !/^[\w.-]+$/.test(values.name)) return setErr('name must be kebab-case (letters, digits, - _ .)')
    Promise.resolve(onSave(values)).catch(e => setErr(e.message))
  }

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer" role="dialog" aria-label={`${mode} ${spec.title}`}>
        <div className="drawer-head">
          <h3>{mode === 'create' ? `New ${spec.title}` : `Edit ${spec.title}`}</h3>
          <button className="ghost" onClick={onClose} aria-label="close">✕</button>
        </div>
        <div className="drawer-body">
          {spec.fields.map(f => {
            if (f.showIf && !f.showIf(values)) return null
            const disabled = mode === 'edit' && f.lockOnEdit
            return (
              <label className="field" key={f.k}>
                <span>{f.label}{f.required && ' *'}</span>
                {f.type === 'textarea' ? (
                  <textarea rows={3} value={values[f.k] || ''} placeholder={f.ph} disabled={disabled} onChange={e => set(f.k, e.target.value)} />
                ) : f.type === 'select' ? (
                  <select value={values[f.k] || ''} disabled={disabled} onChange={e => set(f.k, e.target.value)}>
                    {f.options.map(o => <option key={o} value={o}>{o || '(none)'}</option>)}
                  </select>
                ) : f.type === 'color' ? (
                  <div className="color-field">
                    <input type="color" value={values[f.k] || '#2a78d6'} onChange={e => set(f.k, e.target.value)} />
                    <input type="text" value={values[f.k] || ''} placeholder="#F59E0B (optional)" onChange={e => set(f.k, e.target.value)} />
                  </div>
                ) : (
                  <input type="text" value={values[f.k] || ''} placeholder={f.ph} disabled={disabled} onChange={e => set(f.k, e.target.value)} />
                )}
              </label>
            )
          })}
          {mode === 'edit' && kind !== 'mcp' && <p className="muted small">Only frontmatter fields are edited here — the markdown body keeps its inline editor.</p>}
          {extraNote && <p className="muted small">{extraNote}</p>}
          {err && <div className="drawer-err">{err}</div>}
        </div>
        <div className="drawer-foot">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={submit}>{mode === 'create' ? 'Create' : 'Save fields'}</button>
        </div>
      </div>
    </>
  )
}
