import React from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { json as jsonLang } from '@codemirror/lang-json'
import { javascript } from '@codemirror/lang-javascript'
import { html as htmlLang } from '@codemirror/lang-html'

// Language by extension. src/ui/viewers.jsx keeps its own copy of this mapping private to its
// read-only CodeView and is not this brief's file to change, so the four lines are repeated here
// rather than reaching into it. The four installed grammars are the whole set — anything else falls
// back to markdown, which highlights prose and leaves code alone instead of mis-colouring it.
export function langFor(ext) {
  if (ext === 'json' || ext === 'jsonl') return [jsonLang()]
  if (['js', 'mjs', 'cjs', 'ts', 'jsx', 'tsx'].includes(ext)) return [javascript({ jsx: true, typescript: true })]
  if (ext === 'html' || ext === 'htm') return [htmlLang()]
  return [markdown()]
}

/**
 * The editable buffer.
 *
 * `value` is controlled by the section, because an AI proposal has to be able to replace the whole
 * buffer and a selection has to survive that. `onSelection` reports the selected TEXT rather than
 * offsets: the server matches the excerpt by content, so offsets that drift while a proposal is in
 * flight would point at the wrong region.
 */
export default function DocEditor({ value, ext, onChange, onSelection }) {
  return (
    <CodeMirror
      className="docs-editor"
      value={value}
      height="100%"
      theme="dark"
      extensions={langFor(ext)}
      onChange={onChange}
      onUpdate={v => {
        if (!v.selectionSet && !v.docChanged) return
        const s = v.state.selection.main
        onSelection(s.empty ? '' : v.state.sliceDoc(s.from, s.to))
      }}
    />
  )
}
