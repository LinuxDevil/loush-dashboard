import React from 'react'

// generic section-loading skeleton: a row of stat tiles + list rows, shimmering
export default function Skeleton({ tiles = 3, rows = 5 }) {
  return (
    <div className="skel-wrap">
      {tiles > 0 && (
        <div className="skel-tiles">
          {Array.from({ length: tiles }, (_, i) => <div key={i} className="skel skel-tile" />)}
        </div>
      )}
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skel skel-row" style={{ width: `${100 - (i % 3) * 9}%` }} />)}
    </div>
  )
}
