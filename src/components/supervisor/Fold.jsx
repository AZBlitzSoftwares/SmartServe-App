/* One collapsible section of the set-up page: an arrow at the top-right corner closes it to a
   one-line bar (step number and title) and opens it again. Closed sections stay mounted (only
   hidden), so nothing typed in them is lost. See src/lib/fold.js. */
import { useEffect, useState } from 'react'
import { readFolds, writeFold } from '../../lib/fold'

export default function Fold({ id, step, title, children }) {
  const [closed, setClosed] = useState(() => !!readFolds()[id])
  useEffect(() => {
    const on = e => {
      const t = e.detail || {}
      if (t.id === id || t.id === '*') { setClosed(!t.open); writeFold(id, !t.open) }
    }
    window.addEventListener('ss-fold', on)
    return () => window.removeEventListener('ss-fold', on)
  }, [id])
  const toggle = () => { setClosed(!closed); writeFold(id, !closed) }
  return (
    <div className={'ssfold' + (closed ? ' shut' : '')} data-fold={id}>
      <button type="button" className="ssfold-btn" onClick={toggle} aria-expanded={!closed}
        title={closed ? 'Open ' + title : 'Collapse ' + title}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {closed && (
        <div className="ssfold-bar" role="button" tabIndex={0} onClick={toggle} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() } }}>
          {step != null && <i>{step}</i>}<b>{title}</b><span>Collapsed</span>
        </div>
      )}
      <div className="ssfold-body" style={closed ? { display: 'none' } : undefined}>{children}</div>
    </div>
  )
}
