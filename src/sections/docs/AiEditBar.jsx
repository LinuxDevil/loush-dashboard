import React from 'react'

// The AI edit control. Consulted Odysseus `static/js/document.js` for the shape of this interaction
// (an instruction typed against the current selection, the model's answer returned for review) —
// see the header of src/sections/DocsSection.jsx for the attribution this file is covered by.
//
// The scope is stated on the button, never inferred silently: with a selection it says how much text
// it will send, and with none it says the whole document. "AI edit" on its own would leave the user
// guessing which one they just authorised.
export default function AiEditBar({ instruction, onInstruction, selection, busy, disabled, onRun }) {
  const scope = selection ? `selection (${selection.length} chars)` : 'whole document'
  return (
    <div className="docs-ai-bar">
      <input
        placeholder="ask for an edit — e.g. tighten this paragraph, convert to a table…"
        value={instruction}
        disabled={disabled || busy}
        onChange={e => onInstruction(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && instruction.trim() && !busy) onRun() }}
      />
      <span className="docs-ai-scope">{scope}</span>
      <button className="mini" disabled={disabled || busy || !instruction.trim()} onClick={onRun}>
        {busy ? 'thinking…' : 'AI edit'}
      </button>
    </div>
  )
}
