/* Smart Serve Maestro - Control Desk: one table, as its captains see it.

   Opened by clicking a table on the Control Desk.
     Left   every cover x every course (the captain's course board, read only):
            held, in the kitchen, ready, served, late.
     Right  the cover picked on the left: each dish with its kitchen, KOT,
            barker and times (fired, ready, served), and Reprint for its KOT.
   Covers carry the captain who looks after them (cover split).
   The desk can cancel a fired dish at any stage before it is served (a captain
   only until the kitchen starts it); the kitchen gets a CANCEL slip. */
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { coursesOf, lateMinutes, dishStatus, useLive, useNow, rpc, errText, mmss, clockText, coverRange, rangeText } from './msData'

export default function TableView({ ev, table, caps = [], kitchens = [], onClose }) {
  const now = useNow(1000)
  const courses = coursesOf(ev)
  const coverCount = Math.max(1, Number(ev.chairs_per_table) || 10)
  const [pick, setPick] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  const q = useLive(async () => {
    const [items, kots, covers] = await Promise.all([
      supabase.from('ms_items').select('*').eq('event_id', ev.id).eq('table_number', table).order('held_at'),
      supabase.from('kots').select('id,kot_no,kitchen_id,kitchen_name,cover_no,barker,barker_name,stage,stage_by,fired_at,received_at,in_prep_at,ready_at,dispatched_at,served_at,status,kind,is_remake,print_status,is_reprint')
        .eq('event_id', ev.id).eq('table_number', table).eq('kind', 'order'),
      supabase.from('ms_covers').select('*').eq('event_id', ev.id).eq('table_number', table),
    ])
    for (const r of [items, kots, covers]) if (r.error) throw r.error
    return { items: items.data || [], kots: kots.data || [], covers: covers.data || [] }
  }, { eventId: ev.id, tables: ['ms_items', 'kots', 'ms_covers'], intervalMs: 3000, deps: [table] })
  const d = q.data || { items: [], kots: [], covers: [] }

  const kotById = useMemo(() => Object.fromEntries(d.kots.map(k => [k.id, k])), [d.kots])
  const kitchenById = useMemo(() => Object.fromEntries(kitchens.map(k => [k.id, k])), [kitchens])
  const statusOf = i => dishStatus(i, kotById[i.kot_id], now, lateMinutes(kitchenById[i.kitchen_id], ev))
  const live = d.items.filter(i => i.state !== 'cancelled')
  const itemsOf = c => live.filter(i => i.cover_no === c)
  const seatedAt = c => d.covers.find(x => x.cover_no === c)?.seated_at

  // The table's captains, in cover order, and who looks after each cover
  const tcaps = caps.filter(c => Number(c.table_number) === Number(table))
    .sort((a, b) => (Number(a.cover_from) || 99) - (Number(b.cover_from) || 99) || String(a.name).localeCompare(String(b.name)))
  const ownerOf = c => {
    const split = tcaps.filter(x => coverRange(x, coverCount))
    const who = split.filter(x => { const r = coverRange(x, coverCount); return c >= r.from && c <= r.to })
    return (who.length ? who : tcaps.filter(x => !coverRange(x, coverCount))).map(x => x.name).join(', ')
  }
  const covers = Array.from({ length: coverCount }, (_, i) => i + 1)
  const cover = pick ?? (covers.find(c => itemsOf(c).length) || 1)
  const extra = [...new Set(live.map(i => i.course).filter(c => !courses.includes(c)))]
  const cols = [...courses, ...extra]
  const served = live.filter(i => statusOf(i).cls === 'sv').length
  const seatedN = covers.filter(seatedAt).length

  async function reprint(k) {
    setBusy(true)
    try { await rpc('ms_reprint', { p_kot_id: k.id, p_printer_ip: null }); setMsg({ text: `${k.kot_no} sent to the printer again (marked REPRINT)` }); q.reload() }
    catch (e) { setMsg({ text: errText(e), err: true }) }
    setBusy(false)
  }

  async function cancelDish(i, k) {
    setBusy(true)
    try {
      await rpc('ms_cancel', { p_item_ids: [i.id], p_by: 'Control Desk' })
      setMsg({ text: `${i.name} cancelled for C${i.cover_no}${['printing', 'printed'].includes(k?.print_status) ? ' · a CANCEL slip prints in the kitchen' : ' · taken off the kitchen screen'}` })
      q.reload()
    }
    catch (e) { setMsg({ text: errText(e), err: true }) }
    setBusy(false)
  }

  const t = iso => (iso ? clockText(new Date(iso)) : '')
  const cellOf = (c, course) => {
    const its = itemsOf(c).filter(i => i.course === course)
    if (!its.length) return <td key={course} className="c na" onClick={() => setPick(c)}><b>—</b></td>
    const sts = its.map(statusOf)
    const st = sts.find(s => s.late) || [...sts].sort((a, b) => a.rank - b.rank)[0]
    const name = its.length === 1 ? its[0].name : `${its.length} dishes`
    return (
      <td key={course} className={'c ' + st.cls + (c === cover ? ' cur' : '')} onClick={() => setPick(c)} title={its.map(i => i.name).join(', ')}>
        <b>{name}</b><span>{st.label}</span>
      </td>
    )
  }

  const mine = itemsOf(cover)
  const byCourse = cols.map(c => ({ course: c, its: mine.filter(i => i.course === c) })).filter(g => g.its.length)

  return (
    <div className="sheet-bg tv-bg" onClick={onClose}>
      <div className="tv" onClick={e => e.stopPropagation()}>
        <div className="tvh">
          <div>
            <h3>Table T{table}</h3>
            <p>
              {tcaps.length ? tcaps.map(c => `${c.name} · ${rangeText(coverRange(c, coverCount))}`).join('   |   ') : 'No table captain'}
              {'   ·   '}{seatedN}/{coverCount} covers seated · {served}/{live.length} plates served
            </p>
          </div>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
        {msg && <div className={'tvmsg' + (msg.err ? ' err' : '')} onClick={() => setMsg(null)}>{msg.text}</div>}
        <div className="tvb">
          <div className="tvl">
            <div className="tvcap">Every cover and course · click a cover to see its order</div>
            <div className="boardwrap">
              <table className="board">
                <thead><tr><th />{cols.map(c => <th key={c}>{c}</th>)}</tr></thead>
                <tbody>
                  {covers.map(c => (
                    <tr key={c} className={c === cover ? 'cur' : ''}>
                      <td className="cvc" style={{ cursor: 'pointer' }} onClick={() => setPick(c)}>C{c}<small>{ownerOf(c) || (seatedAt(c) ? 'seated' : '')}</small></td>
                      {cols.map(course => cellOf(c, course))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="tvr">
            <h4>T{table} · C{cover}{ownerOf(cover) ? <span> · {ownerOf(cover)}</span> : null}</h4>
            <p className="muted" style={{ fontSize: 12, margin: '0 0 8px' }}>
              {seatedAt(cover) ? `Seated ${t(seatedAt(cover))}` : 'Not seated yet'} · {mine.length} {mine.length === 1 ? 'dish' : 'dishes'}
            </p>
            {!byCourse.length && <div className="empty">Nothing ordered for C{cover} yet.</div>}
            {byCourse.map(g => (
              <div className="tvc" key={g.course}>
                <div className="h">{g.course}</div>
                {g.its.map(i => {
                  const s = statusOf(i)
                  const k = kotById[i.kot_id]
                  const done = k?.dispatched_at || k?.served_at || i.served_at
                  return (
                    <div className="tvi" key={i.id}>
                      <div className="r1">
                        <b>{i.qty > 1 ? `${i.qty} × ` : ''}{i.name}</b>
                        {i.note && <span className="note">{i.note}</span>}
                        <span className={'chip ' + s.cls}>{s.label}</span>
                      </div>
                      <div className="r2">
                        {kitchenById[i.kitchen_id]?.name || ''}
                        {k ? ` · ${k.kot_no} · Barker ${k.barker || 'A'}${k.barker_name ? ' ' + k.barker_name : ''}` : ' · not fired yet'}
                        {k?.is_remake ? ' · REMAKE' : ''}
                      </div>
                      {k && (
                        <div className="r3">
                          <span>Fired {t(k.fired_at)}</span>
                          {k.ready_at && <span>Ready {t(k.ready_at)} ({mmss(new Date(k.ready_at) - new Date(k.fired_at))})</span>}
                          {done && <span>Served {t(done)}{k.stage_by ? ` by ${k.stage_by}` : ''}</span>}
                          {!done && !k.ready_at && <span>{k.stage === 'in_prep' ? 'In preparation' : 'Received'} · {mmss(now - new Date(k.fired_at))}</span>}
                          <button className="btn btn-ghost" disabled={busy} onClick={() => reprint(k)}>Reprint KOT</button>
                          {i.state === 'fired' && !done && k.status === 'open' && <DeskCancel disabled={busy} onCancel={() => cancelDish(i, k)} />}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// Cancel needs a second tap: it takes the dish off the kitchen screen and prints a CANCEL slip
function DeskCancel({ disabled, onCancel }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 4000); return () => clearTimeout(t) }, [armed])
  return armed
    ? <button className="btn btn-red" disabled={disabled} onClick={() => { setArmed(false); onCancel() }}>Cancel dish?</button>
    : <button className="btn btn-ghost" style={{ color: 'var(--red)' }} disabled={disabled} onClick={() => setArmed(true)}>Cancel</button>
}
