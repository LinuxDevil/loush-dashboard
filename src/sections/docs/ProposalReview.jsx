import React from 'react'
import { DiffPane } from '../../ui/ViewerModes.jsx'

// The accept/reject gate for an AI proposal, following the rules lib/diff-review.mjs sets out for
// its server-side store, in the one shape they can take on a buffer that has not been written:
//
//   · ONE pending proposal per file. A second run replaces this one rather than stacking, because
//     approving change 3 against a base that no longer exists is meaningless.
//   · The diff is original → proposed as a single unit; there is no per-hunk accept here.
//   · Reject cannot lose data, because nothing was written: `POST /api/docs/ai-edit` returns text
//     and never touches the disk, so rejecting is discarding a string. Accept puts the proposal in
//     the buffer and leaves the save to the user, so even accepting is still reversible.
//
// `original` is the buffer the proposal was computed against, not the file on disk. That is the
// honest baseline: it is what the user was looking at when they asked.
export default function ProposalReview({ original, proposed, instruction, onAccept, onReject }) {
  return (
    <div className="docs-proposal">
      <div className="docs-proposal-head">
        <span className="badge">proposed edit</span>
        <span className="docs-proposal-instruction" title={instruction}>{instruction}</span>
        <span className="muted docs-proposal-note">nothing has been written — accept puts this in the editor, save writes it</span>
        <button className="mini" onClick={onAccept}>accept</button>
        <button className="mini" onClick={onReject}>reject</button>
      </div>
      <div className="docs-proposal-diff"><DiffPane before={original} after={proposed} /></div>
    </div>
  )
}
