/* Smart Serve Maestro - Kitchens screen: a big screen anyone may look at (view only).

   Every kitchen side by side: how many KOTs are in progress, how many are late, how many
   were delivered, whether its printer answers, and each open KOT as the barker sees it
   (oldest first; over the kitchen alert time it flashes in gold). Tap a kitchen to see only
   that kitchen, larger; it goes back to all kitchens by itself after two minutes.
   Nothing on this screen changes anything: there is no Delivered, Reprint or setting here. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import logo from '../assets/janus_logo.jpg'
import './maestro.css'
import { lateMinutes, useLive, useNow, mmss, clockText, coursesOf, shortCourses, splitNote, tc } from './msData'

const KOT_COLS = 'id,kot_no,kitchen_id,table_number,cover_no,course,fired_at,created_at,barker,barker_name,items,guest_note,guest_allergy,vip_name,is_remake,print_status,stage,status,served_at'
const BACK_MS = 2 * 60000

const printerPill = kt => {
  const s = kt.printer_status
  if (s === 'online') return <span className="pr pon">Printer OK</span>
  if (s === 'paper_low') return <span className="pr pon">Paper low</span>
  if (['offline', 'paper_out', 'error'].includes(s)) return <span className="pr poff">{s === 'paper_out' ? 'Paper out' : 'Printer not responding'}</span>
  return <span className="pr punk">Printer ?</span>
}

export default function KitchensScreen({ eventData }) {
  const ev = eventData
  const now = useNow(1000)
  const [focus, setFocus] = useState(null)   // kitchen id shown alone, larger
  useEffect(() => {
    if (!focus) return
    const t = setTimeout(() => setFocus(null), BACK_MS)
    return () => clearTimeout(t)
  }, [focus])

  const colsOk = useRef(true)
  const q = useLive(async () => {
    const since = new Date(Date.now() - 18 * 3600e3).toISOString()
    // a database not yet updated for v2 lacks some columns: then the whole row
    const cols = colsOk.current ? KOT_COLS : '*'
    const [evr, kitchens, open, done] = await Promise.all([
      supabase.from('events').select('*').eq('id', ev.id).maybeSingle(),
      supabase.from('kitchens').select('*').eq('event_id', ev.id).eq('is_active', true).order('sort_order'),
      supabase.from('kots').select(cols).eq('event_id', ev.id).eq('kind', 'order').eq('status', 'open')
        .neq('stage', 'dispatched').is('served_at', null).gte('created_at', since).order('fired_at'),
      supabase.from('kots').select('id,kitchen_id').eq('event_id', ev.id).eq('kind', 'order').eq('status', 'delivered').gte('created_at', since).limit(5000),
    ])
    if (colsOk.current && open.error && /column|42703/i.test(`${open.error.code} ${open.error.message}`)) { colsOk.current = false; throw open.error }
    for (const r of [kitchens, open]) if (r.error) throw r.error
    return { ev: evr.data || ev, kitchens: kitchens.data || [], open: open.data || [], done: done.error ? [] : (done.data || []) }
  }, { eventId: ev.id, tables: ['kots', 'kitchens'], intervalMs: 3000, minGapMs: 1500 })

  const d = q.data
  const E = d?.ev || ev
  const crsLabel = shortCourses([...coursesOf(E), ...(d?.open || []).map(k => k.course)])
  const age = k => now - new Date(k.fired_at || k.created_at).getTime()
  const lateOf = kt => lateMinutes(kt, E)
  const byKitchen = useMemo(() => {
    const m = {}
    for (const k of d?.open || []) (m[k.kitchen_id] ||= []).push(k)
    for (const id in m) m[id].sort((a, b) => new Date(a.fired_at || a.created_at) - new Date(b.fired_at || b.created_at) || String(a.kot_no).localeCompare(String(b.kot_no)))
    return m
  }, [d])
  const doneOf = id => (d?.done || []).filter(k => k.kitchen_id === id).length
  const kitchens = d?.kitchens || []
  const shownKitchen = focus && kitchens.find(k => k.id === focus)

  // A column shows the cards that fit; the rest are counted at the bottom ("+ 3 more")
  const bodies = useRef({})
  const [hidden, setHidden] = useState({})
  useLayoutEffect(() => {
    const next = {}
    for (const [id, el] of Object.entries(bodies.current)) {
      if (!el) continue
      const limit = el.clientHeight
      next[id] = [...el.querySelectorAll(':scope > .kc')].filter(c => c.offsetTop + c.offsetHeight > limit + 1).length
    }
    if (JSON.stringify(next) !== JSON.stringify(hidden)) setHidden(next)
  })

  const card = (k, kt) => {
    const over = age(k) >= lateOf(kt) * 60000
    return (
      <div key={k.id} className={'kc' + (over ? ' fl' : '') + (k.vip_name ? ' vipk' : '')} data-kot={k.kot_no}>
        {k.vip_name && <div className="vip vtop">★ VIP · {k.vip_name}</div>}
        <div className="kh">
          <span className={'sn' + ((k.barker || 'A') === 'A' ? '' : ' sb')}>{k.kot_no}</span>
          <span className="tm">{mmss(age(k))}</span>
        </div>
        <div className="km">
          <span className="tcv">{tc(k.table_number, k.cover_no)}</span>
          {k.course && <span className="crs" title={k.course}>{crsLabel(k.course)}</span>}
          {k.is_remake && <span className="bdg">REMAKE</span>}
          {k.print_status === 'failed' && <span className="bdg">SLIP NOT PRINTED</span>}
        </div>
        {k.guest_allergy && <div className="alg">Allergy · all dishes: {k.guest_allergy}</div>}
        {k.guest_note && <div className="gn">Guest note: {k.guest_note}</div>}
        <div className="its">
          {(k.items || []).map((it, i) => (
            <div key={i} className="it1">
              <div className="nm">{it.qty > 1 ? `${it.qty} × ` : ''}{it.name}</div>
              {splitNote(it.note).length > 0 && <div className="nt">{splitNote(it.note).join(' · ')}</div>}
              {it.allergy && <div className="ia">Allergy: {it.allergy}</div>}
            </div>
          ))}
        </div>
      </div>
    )
  }

  const counts = kt => {
    const list = byKitchen[kt.id] || []
    const late = list.filter(k => age(k) >= lateOf(kt) * 60000).length
    return (
      <div className="n3k">
        <div><b>{list.length}</b>In progress</div>
        <div className={late ? 'l' : ''}><b>{late}</b>Late</div>
        <div><b>{doneOf(kt.id)}</b>Delivered</div>
      </div>
    )
  }
  const totalOpen = (d?.open || []).length
  const totalLate = kitchens.reduce((n, kt) => n + (byKitchen[kt.id] || []).filter(k => age(k) >= lateOf(kt) * 60000).length, 0)

  return (
    <div className="ms kd ks">
      <div className="top">
        <div className="ttl">
          <div className="lg"><img src={logo} alt="Janu's Smart Serve" /></div>
          <h1>{shownKitchen ? shownKitchen.name : 'Kitchens'}<span>{E.name}</span></h1>
        </div>
        {shownKitchen
          ? <button className="menu-btn" onClick={() => setFocus(null)}>◂ All kitchens</button>
          : <span className="vo">{totalOpen} in progress · {totalLate} late</span>}
        <div className="rt">
          {!q.online && <span className="off">Not connected · retrying</span>}
          <span className="vo">View only</span>
          <span className="clock">{clockText(new Date(now))}</span>
        </div>
      </div>

      {!d ? <div className="empty">Loading the kitchens…</div> : !kitchens.length ? <div className="empty">No kitchens are set up for this event yet.</div> : shownKitchen ? (
        <>
          <div className="fl-row fk">
            <b className="fkn">{printerPill(shownKitchen)}</b>
            {counts(shownKitchen)}
            <span className="hint">Oldest first · flashes after {lateOf(shownKitchen)} minutes until delivered</span>
          </div>
          <div className="grid-k" style={{ '--kz': 1.05 }}>
            {(byKitchen[shownKitchen.id] || []).map(k => card(k, shownKitchen))}
            {!(byKitchen[shownKitchen.id] || []).length && <div className="empty">Nothing in progress in {shownKitchen.name}.</div>}
          </div>
        </>
      ) : (
        <div className="cols" style={{ '--n': Math.min(kitchens.length, 6) }}>
          {kitchens.map(kt => {
            const list = byKitchen[kt.id] || []
            return (
              <div className="col" key={kt.id} onClick={() => setFocus(kt.id)} title={`Show only ${kt.name}`} data-kitchen={kt.name}>
                <div className="chd">
                  <h2>{kt.name}{printerPill(kt)}</h2>
                  {counts(kt)}
                </div>
                <div className="cl" ref={el => { bodies.current[kt.id] = el }}>
                  {list.map(k => card(k, kt))}
                  {!list.length && <div className="empty">Nothing in progress</div>}
                </div>
                {hidden[kt.id] > 0 && <div className="more">+ {hidden[kt.id]} more · tap to see all</div>}
              </div>
            )
          })}
        </div>
      )}
      <div className="foot">
        <span>Each KOT is one dish for one table and cover · the timer runs from pick-up · tap a kitchen to see it alone</span>
        <span>Delivered this service: {(d?.done || []).length}</span>
      </div>
    </div>
  )
}
