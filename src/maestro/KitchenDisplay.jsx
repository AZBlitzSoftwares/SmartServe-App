/* Smart Serve Maestro - Kitchen Display (/kitchen), for a kitchen barker on a tablet or a screen.

   Two states only, so a busy barker taps once per plate:
     In progress   a KOT is in progress the moment it reaches the kitchen (it prints by itself)
     Delivered     the barker hands the plate and its KOT to a steward: one tap, the KOT moves to
                   Delivered (and can be brought back from there).
   KOTs are listed by serial number, the oldest first, top left. The serial number is the biggest
   thing on the card. A KOT not delivered within the kitchen alert time (event set-up, 3 minutes
   by default) starts flashing gently until it is delivered. Search finds a KOT by its number,
   table, cover or dish. My dishes: this barker's KOTs; Entire kitchen: both barkers'. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { unlockChime, playChatChime, chimeReady } from '../lib/chime'
import { serviceDates, sessionStillCurrent } from '../components/guest/deviceEntry'
import { setSignOutReason, takeSignOutReason, setUnsavedCheck } from '../lib/appUpdate'
import logo from '../assets/janus_logo.jpg'
import LaptopServerSwitch from '../components/LaptopServerSwitch'
import './maestro.css'
import { lateMinutes, useLive, useNow, rpc, rpcRetry, isMissingFn, errText, mmss, clockText, loadMenu, coursesOf, shortCourses, splitNote, kotMatches, tc } from './msData'

const SESSION = 'ms_barker_session'

function readSession() {
  try { return JSON.parse(localStorage.getItem(SESSION) || 'null') } catch { return null }
}

export default function KitchenDisplay() {
  const [session, setSession] = useState(() => {
    const s = readSession()
    // receptions run past midnight: yesterday's session holds until 6 am
    return s && sessionStillCurrent(s.event?.date) ? s : null
  })
  useEffect(() => { document.title = 'Kitchen Display · Smart Serve Maestro' }, [])
  if (!session) return <BarkerLogin onLogin={s => { localStorage.setItem(SESSION, JSON.stringify(s)); setSession(s) }} />
  return <KitchenScreen session={session} onSignOut={() => { localStorage.removeItem(SESSION); setSession(null) }} />
}

// ------------------------------------------------------------------ sign-in
function BarkerLogin({ onLogin }) {
  const [notice] = useState(() => takeSignOutReason())
  const [events, setEvents] = useState(null)
  const [evId, setEvId] = useState('')
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from('events').select('*').in('date', serviceDates()).eq('maestro', true).order('name')
      if (error) { setErr(errText(error)); setEvents([]); return }
      setEvents(data || [])
      if (data?.length === 1) setEvId(data[0].id)
    })()
  }, [])

  async function submit(e) {
    e.preventDefault()
    setErr('')
    const ev = events?.find(x => x.id === evId)
    if (!ev) { setErr('Choose the event.'); return }
    if (!name.trim() || !pin.trim()) { setErr('Enter your name and PIN.'); return }
    setBusy(true)
    try {
      const b = await rpc('ms_barker_login', { p_event_id: ev.id, p_name: name.trim(), p_pin: pin.trim() })
      if (!b) { setErr('Name or PIN not recognised. Ask the control desk.'); setBusy(false); return }
      if (!b.kitchen_id) { setErr('You are not linked to a kitchen yet. Ask the control desk.'); setBusy(false); return }
      unlockChime()
      onLogin({ barker: { ...b, pin: pin.trim() }, event: { id: ev.id, name: ev.name, date: ev.date, late_minutes: ev.late_minutes } })
    } catch (e2) { setErr(errText(e2)) }
    setBusy(false)
  }

  return (
    <div className="ms kd kdl">
      <form onSubmit={submit} className="kdlogin">
        <div className="kdl-h">
          <div className="kdl-logo"><img src={logo} alt="" /></div>
          <div><div className="kdl-k">SMART SERVE MAESTRO</div><div className="kdl-t">Kitchen Display</div></div>
        </div>
        {events === null ? <div className="kdl-m">Loading today's events…</div>
          : !events.length ? <div className="kdl-w">No Smart Serve Maestro event is running today.</div>
          : (
            <>
              {events.length > 1 && (
                <select value={evId} onChange={e => setEvId(e.target.value)} className="kdl-in">
                  <option value="">Choose the event…</option>
                  {events.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              )}
              {events.length === 1 && <div className="kdl-m">{events[0].name}</div>}
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" autoComplete="off" className="kdl-in" />
              <input value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="PIN" inputMode="numeric" type="password" className="kdl-in" />
              {notice && !err && <div className="kdl-w">{notice}</div>}
              {err && <div className="kdl-e">{err}</div>}
              <button className="kdl-b" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
            </>
          )}
      </form>
    </div>
  )
}

// ------------------------------------------------------------------ screen
function KitchenScreen({ session, onSignOut }) {
  const { barker, event } = session
  const kitchenId = barker.kitchen_id
  const [view, setView] = useState('mine')           // mine | whole | done
  const [filter, setFilter] = useState('all')        // all | over
  const [search, setSearch] = useState('')
  const [doneScope, setDoneScope] = useState('mine')  // Delivered follows My dishes / Entire kitchen, whichever was last open
  // Card size for this screen, remembered on it: small for a tablet up close, large for a TV
  const [size, setSize] = useState(() => { try { return localStorage.getItem('ms_kd_size') || 'M' } catch { return 'M' } })
  const pickSize = v => { setSize(v); try { localStorage.setItem('ms_kd_size', v) } catch { /* private mode */ } }
  const [busy, setBusy] = useState(null)              // KOT id being changed
  const [toast, setToast] = useState(null)
  const [sheet, setSheet] = useState(null)
  const now = useNow(1000)
  const seenKots = useRef(null)
  const starting = useRef(new Set())

  // Never reload by itself while a barker is signed in (sound needs a tap after a reload)
  useEffect(() => { setUnsavedCheck(() => true); return () => setUnsavedCheck(null) }, [])
  // Browsers keep sound off until the screen is tapped once
  const [soundOn, setSoundOn] = useState(() => chimeReady())
  useEffect(() => {
    if (soundOn) return
    unlockChime()
    const t = setInterval(() => { if (chimeReady()) setSoundOn(true) }, 1000)
    return () => clearInterval(t)
  }, [soundOn])

  /* A sign-in the desk has ended - barker removed, new PIN, moved to another
     kitchen or side - must not carry on from this screen's memory. */
  useEffect(() => {
    let stop = false
    async function check() {
      try {
        const { data, error } = await supabase.from('barkers').select('id, is_active, pin, kitchen_id, side').eq('id', barker.id).maybeSingle()
        if (stop || error) return
        const reason = !data || data.is_active === false ? 'You were signed out: you were removed at the control desk.'
          : barker.pin && data.pin != null && String(data.pin) !== String(barker.pin) ? 'Your PIN was changed at the control desk. Sign in with the new PIN.'
          : data.kitchen_id !== barker.kitchen_id || (data.side && barker.side && data.side !== barker.side) ? 'You were moved to another kitchen or side. Sign in again.'
          : null
        if (reason) { setSignOutReason(reason); onSignOut() }
      } catch { /* offline: carry on */ }
    }
    check()
    const t = setInterval(check, 60000)
    const vis = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', vis)
    return () => { stop = true; clearInterval(t); document.removeEventListener('visibilitychange', vis) }
  }, [barker.id])

  // Check in every 30 seconds, so the Control Desk can show this screen as on.
  useEffect(() => {
    const ping = () => rpc('ms_barker_ping', { p_barker_id: barker.id }).catch(() => {})
    ping()
    const t = setInterval(ping, 30000)
    return () => clearInterval(t)
  }, [barker.id])

  // The Delivered list is fetched in full only while it is open; otherwise just the ids
  // for the counts, so a busy kitchen on a weak connection does not pull hundreds of
  // finished KOTs every few seconds.
  const viewRef = useRef(view)
  viewRef.current = view
  const colsOk = useRef(true)
  const q = useLive(async () => {
    const since = new Date(Date.now() - 12 * 3600e3).toISOString()
    const full = viewRef.current === 'done'
    // a database not yet updated for v2 lacks some columns: then the whole row
    const cols = colsOk.current ? KOT_COLS : '*'
    const [kitchen, kots, fin, ev] = await Promise.all([
      supabase.from('kitchens').select('*').eq('id', kitchenId).maybeSingle(),
      supabase.from('kots').select(cols).eq('kitchen_id', kitchenId).eq('kind', 'order').eq('status', 'open')
        .neq('stage', 'dispatched').is('served_at', null).gte('created_at', since).order('fired_at'),
      // Delivered this service, newest first
      supabase.from('kots').select(full ? cols : 'id,barker').eq('kitchen_id', kitchenId).eq('kind', 'order').eq('status', 'delivered')
        .gte('created_at', since).order('dispatched_at', { ascending: false, nullsFirst: false }).limit(full ? 300 : 3000),
      supabase.from('events').select('id,late_minutes,name,courses').eq('id', event.id).maybeSingle(),
    ])
    if (colsOk.current && kots.error && /column|42703/i.test(`${kots.error.code} ${kots.error.message}`)) { colsOk.current = false; throw kots.error }
    for (const r of [kitchen, kots, fin]) if (r.error) throw r.error
    return { kitchen: kitchen.data, kots: kots.data || [], ev: ev.data || event, done: fin.data || [] }
  }, { eventId: event.id, tables: ['kots'], intervalMs: 2500, filter: `kitchen_id=eq.${kitchenId}` })
  const d = q.data
  // KOTs delivered on this screen whose change has not come back from the server yet
  const [gone, setGone] = useState(() => new Set())
  useEffect(() => {
    if (!d || !gone.size) return
    const still = new Set((d.kots || []).map(k => k.id))
    if ([...gone].some(id => !still.has(id))) setGone(g => new Set([...g].filter(id => still.has(id))))
  }, [d]) // eslint-disable-line react-hooks/exhaustive-deps
  // opening Delivered loads the full list at once
  const reloadQ = q.reload
  useEffect(() => { if (view === 'done') reloadQ() }, [view, reloadQ])
  const kitchen = d?.kitchen
  const late = lateMinutes(kitchen, d?.ev || event)
  const crsLabel = shortCourses([...coursesOf(d?.ev), ...(d?.kots || []).map(k => k.course)])
  const mine = k => (k.barker || 'A') === barker.side
  const age = k => now - new Date(k.fired_at || k.created_at).getTime()
  const isOver = k => age(k) >= late * 60000

  // Serial order: the oldest KOT first (top left), then the next one
  const serialSort = (a, b) => new Date(a.fired_at || a.created_at) - new Date(b.fired_at || b.created_at) || String(a.kot_no).localeCompare(String(b.kot_no))
  const open = useMemo(() => (d?.kots || []).filter(k => !gone.has(k.id) && (view === 'whole' || mine(k))).sort(serialSort),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [d, view, barker.side, gone])
  const overCount = open.filter(isOver).length
  const shown = open.filter(k => (filter !== 'over' || isOver(k)) && kotMatches(k, search))

  // Chime when a KOT arrives that this screen shows
  useEffect(() => {
    if (!d) return
    const all = (d.kots || []).map(k => k.id)
    if (seenKots.current) {
      const fresh = (d.kots || []).filter(k => !seenKots.current.has(k.id) && (view === 'whole' || mine(k)))
      if (fresh.length) { try { playChatChime() } catch { /* no audio */ } }
    }
    seenKots.current = new Set([...(seenKots.current || []), ...all])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d])

  /* A KOT is in progress the moment it reaches the kitchen screen: no step for the barker.
     Only a KOT not yet in progress moves, each one once. If no kitchen screen is open, it
     stays "not on the kitchen screen" on the Control Desk. */
  useEffect(() => {
    const fresh = (d?.kots || []).filter(k => ['new', 'received'].includes(k.stage) && !starting.current.has(k.id)).map(k => k.id)
    if (!fresh.length) return
    fresh.forEach(id => starting.current.add(id))
    ;(async () => {
      try {
        const at = new Date().toISOString()
        const { error } = await supabase.from('kots').update({ stage: 'in_prep', received_at: at, in_prep_at: at, stage_by: barker.name })
          .in('id', fresh).in('stage', ['new', 'received'])
        if (error) throw error
        q.reload()
      } catch { fresh.forEach(id => starting.current.delete(id)) /* tried again on the next refresh */ }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d])

  // Delivered: the plate left with a steward. The KOT is complete.
  // Delivered: the card goes at once (no waiting for the network), other cards stay
  // tappable, and a weak connection gets a few more tries before the card comes back
  async function deliver(k) {
    if (gone.has(k.id)) return
    setGone(g => new Set(g).add(k.id))
    try {
      let r
      try { r = await rpcRetry('ms_deliver', { p_kot_ids: [k.id], p_by: barker.name }) }
      catch (e) {
        if (!isMissingFn(e)) throw e
        // an older database without ms_deliver
        await rpcRetry('ms_serve', { p_kot_ids: [k.id], p_undo: false })
        await supabase.from('kots').update({ stage_by: barker.name }).eq('id', k.id)
        r = { delivered: 1, already: [] }
      }
      if (r?.already?.length) setToast({ text: `${k.kot_no} was already delivered` })
      else setToast({ text: `${k.kot_no} · ${tc(k.table_number, k.cover_no)} delivered` })
      q.reload()
    } catch (e) {
      setToast({ text: `${k.kot_no} not saved as delivered: ${errText(e)}`, err: true })
      setGone(g => { const n = new Set(g); n.delete(k.id); return n })
    }
  }
  // Back to In progress: delivered by mistake
  async function reopen(k) {
    setGone(g => { if (!g.has(k.id)) return g; const n = new Set(g); n.delete(k.id); return n })
    try {
      await rpc('ms_kot_stage', { p_kot_id: k.id, p_stage: 'in_prep', p_by: barker.name })
      await rpc('ms_serve', { p_kot_ids: [k.id], p_undo: true })
      setToast({ text: `${k.kot_no} is back in progress` }); q.reload()
    } catch (e) { setToast({ text: errText(e), err: true }) }
  }
  // The KOT slip again, from the kitchen printer, marked REPRINT
  async function reprint(k) {
    if (busy) return
    setBusy(k.id)
    try {
      await rpc('ms_reprint', { p_kot_id: k.id, p_printer_ip: null })
      setToast({ text: `${k.kot_no} sent to the printer again · marked REPRINT` })
      await q.reload()
    } catch (e) { setToast({ text: errText(e), err: true }) }
    setBusy(null)
  }

  // A plain render function, not a component: a component declared in here would be a new type
  // on every one-second tick and remount every card.
  const card = k => {
    const over = isOver(k)
    const items = k.items || []
    return (
      <div key={k.id} className={'kc' + (over ? ' fl' : '') + (k.vip_name ? ' vipk' : '')} data-kot={k.kot_no}>
        {k.vip_name && <div className="vip vtop">★ VIP · {k.vip_name}</div>}
        <div className="kh">
          <span className={'sn' + (view === 'whole' ? ((k.barker || 'A') === 'A' ? ' sa' : ' sb') : '')}>{k.kot_no}</span>
          <span className="tm">{mmss(age(k))}</span>
        </div>
        <div className="km">
          <span className="tcv">{tc(k.table_number, k.cover_no)}</span>
          {k.course && <span className="crs" title={k.course}>{crsLabel(k.course)}</span>}
          {k.is_remake && <span className="bdg">REMAKE</span>}
          {k.print_status === 'failed' && <span className="bdg" title="The printer did not answer (off, out of paper or not reachable). It prints by itself when the printer is back, or tap Reprint.">SLIP NOT PRINTED</span>}
        </div>
        {k.guest_allergy && <div className="alg">Allergy · all dishes: {k.guest_allergy}</div>}
        {k.guest_note && <div className="gn">Guest note: {k.guest_note}</div>}
        <div className="its">
          {items.map((it, i) => (
            <div key={i} className="it1">
              <div className="nm">{it.qty > 1 ? `${it.qty} × ` : ''}{it.name}</div>
              {splitNote(it.note).length > 0 && <div className="nt">{splitNote(it.note).join(' · ')}</div>}
              {it.allergy && <div className="ia">Allergy: {it.allergy}</div>}
            </div>
          ))}
        </div>
        <div className="ka">
          <button className="dlv" onClick={() => deliver(k)}>Delivered</button>
          <button className="rp" disabled={busy === k.id} title="Print this KOT again on the kitchen printer" onClick={() => reprint(k)}>{busy === k.id ? '…' : 'Reprint'}</button>
        </div>
      </div>
    )
  }

  // Delivered view
  const doneAll = d?.done || []
  const doneMine = doneAll.filter(mine)
  const doneList = (doneScope === 'whole' ? doneAll : doneMine).filter(k => kotMatches(k, search))
  const tOut = k => { const t = k.dispatched_at || k.served_at; return k.fired_at && t ? new Date(t) - new Date(k.fired_at) : null }
  const wasLate = k => (tOut(k) ?? 0) > late * 60000
  const hhmm = iso => (iso ? clockText(new Date(iso)) : '–')

  const kname = String(kitchen?.name || barker.kitchen_name || '')
  const title = /kitchen$/i.test(kname.trim()) ? kname : `${kname} Kitchen`

  return (
    <div className={'ms kd sz-' + size} onClick={() => { unlockChime(); if (chimeReady()) setSoundOn(true) }}>
      {!soundOn && <div className="snd">Tap anywhere to turn on the sound for new KOTs</div>}
      <div className="top">
        <div className="ttl">
          <div className="lg"><img src={logo} alt="" /></div>
          <h1>{title} <span>{view === 'whole' ? 'Both barkers' : view === 'done' ? `Delivered · ${doneScope === 'whole' ? 'Entire kitchen' : 'My dishes'}` : `Barker ${barker.side} · ${barker.name}`}</span></h1>
        </div>
        <div className="srch">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search KOT no., T7, C3 or dish" aria-label="Search KOTs" inputMode="search" />
          {search && <button onClick={() => setSearch('')} title="Clear">✕</button>}
        </div>
        <div className="seg">
          <button className={view === 'mine' ? 'a' : ''} onClick={() => { setView('mine'); setDoneScope('mine') }}>My dishes ({barker.side})</button>
          <button className={view === 'whole' ? 'a' : ''} onClick={() => { setView('whole'); setDoneScope('whole') }}>Entire kitchen</button>
          <button className={view === 'done' ? 'a' : ''} onClick={() => setView('done')}>Delivered · {(doneScope === 'whole' ? doneAll : doneMine).length}</button>
        </div>
        <div className="rt">
          {!q.online && <span className="off">Offline</span>}
          <div className="clock">{clockText(new Date(now))}</div>
          <button className="menu-btn" onClick={() => setSheet('menu')}>☰</button>
        </div>
      </div>

      {view !== 'done' && (
        <div className="fl-row">
          <button className={'chip' + (filter === 'all' ? ' a' : '')} onClick={() => setFilter('all')}>In progress <b>{open.length}</b></button>
          <button className={'chip ov' + (filter === 'over' ? ' a' : '')} onClick={() => setFilter('over')}>Over {late} min <b>{overCount}</b></button>
          <span className="hint">Oldest first · tap <b>Delivered</b> when the plate goes to a steward</span>
        </div>
      )}

      {!d || (view === 'done' && doneAll.some(k => !('kot_no' in k))) ? <div className="empty">Loading…</div> : view === 'done' ? (
        <div className="donev">
          <div className="dtw">
            {doneList.length ? (
              <table className="dtab">
                <thead><tr><th>KOT</th><th>Table</th><th>Course</th><th>Dishes</th><th>Picked up</th><th>Delivered</th><th>Total</th><th /></tr></thead>
                <tbody>
                  {doneList.map(k => (
                    <tr key={k.id} className={wasLate(k) ? 'l' : ''}>
                      <td><b className="dsn">{k.kot_no}</b>{k.is_remake && <span className="bdg">REMAKE</span>}</td>
                      <td>{tc(k.table_number, k.cover_no)}</td>
                      <td>{k.course || ''}</td>
                      <td className="dl">{(k.items || []).map(it => `${it.qty > 1 ? it.qty + ' × ' : ''}${it.name}`).join(', ')}</td>
                      <td>{hhmm(k.fired_at)}</td>
                      <td>{hhmm(k.dispatched_at || k.served_at)}{k.stage_by ? <small> · {k.stage_by}</small> : null}</td>
                      <td><b>{mmss(tOut(k))}</b></td>
                      <td className="ac"><div>
                        <button className="rp" disabled={!!busy} onClick={() => reprint(k)}>Reprint</button>
                        <BackToOpen busy={!!busy} onBack={() => reopen(k)} />
                      </div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div className="empty">{search ? 'No delivered KOT matches the search.' : 'Nothing delivered yet this service.'}</div>}
          </div>
        </div>
      ) : (
        <div className="grid-k">
          {shown.length ? shown.map(card) : (
            <div className="empty">{search ? `No open KOT matches “${search.trim()}”.` : filter === 'over' ? `Nothing over ${late} minutes.` : 'No KOTs in progress. New KOTs appear here and print by themselves.'}</div>
          )}
        </div>
      )}

      <div className="foot">
        <span>Each KOT is one dish for one table and cover · the timer runs from pick-up · it flashes after {late} minutes until delivered</span>
        <span>Delivered this service: {doneAll.length}</span>
      </div>

      {sheet === 'menu' && (
        <div className="sheet-bg" onClick={() => setSheet(null)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <h3>{barker.name} · Barker {barker.side}</h3>
            <p>{kitchen?.name} kitchen · {event.name}</p>
            <div className="row" style={{ alignItems: 'center', marginBottom: 10 }}>
              <b style={{ fontSize: 13 }}>Card size</b>
              {[['S', 'Small'], ['M', 'Medium'], ['L', 'Large'], ['XL', 'Extra large']].map(([v, label]) => (
                <button key={v} className={'btn ' + (size === v ? 'btn-navy' : 'btn-ghost')} onClick={() => pickSize(v)}>{label}</button>
              ))}
            </div>
            <div style={{ borderTop: '1px solid var(--line)', padding: '10px 0 12px', marginBottom: 6 }}>
              <b style={{ fontSize: 13, display: 'block', marginBottom: 6 }}>Laptop server (internet down)</b>
              <LaptopServerSwitch />
            </div>
            <div className="row">
              <button className="btn btn-ghost" onClick={() => setSheet('soldout')}>Sold out dishes</button>
              <button className="btn btn-ghost" onClick={() => { setSheet(null); q.reload() }}>Refresh</button>
              <button className="btn btn-ghost" style={{ color: 'var(--red)' }} onClick={onSignOut}>Sign out</button>
            </div>
          </div>
        </div>
      )}
      {sheet === 'soldout' && <SoldOut eventId={event.id} kitchenId={kitchenId} barker={barker} onClose={() => setSheet(null)} setToast={setToast} />}
      {toast && <KdToast toast={toast} onClose={() => setToast(null)} />}
    </div>
  )
}

// Back to In progress from Delivered: a second tap, so a stray tap does not reopen a KOT
function BackToOpen({ busy, onBack }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 4000); return () => clearTimeout(t) }, [armed])
  return armed
    ? <button className="rp sure" disabled={busy} onClick={() => { setArmed(false); onBack() }}>Reopen?</button>
    : <button className="rp" disabled={busy} onClick={() => setArmed(true)} title="Delivered by mistake: back to In progress">Back to open</button>
}

// What a kitchen card shows (not the whole KOT row: less to download on a weak connection)
const KOT_COLS = 'id,kot_no,kitchen_id,table_number,cover_no,course,fired_at,created_at,barker,barker_name,items,guest_note,guest_allergy,vip_name,is_remake,is_reprint,print_status,stage,status,stage_by,served_at,dispatched_at,received_at'

// A short message that goes by itself (2.5 s; a problem 4 s). No Undo: a busy barker must not
// undo a delivery by mistake (Delivered › Back to open, two taps, if it really was a mistake).
function KdToast({ toast, onClose }) {
  const closeRef = useRef(onClose); closeRef.current = onClose
  useEffect(() => { const t = setTimeout(() => closeRef.current(), toast.err ? 4000 : 2500); return () => clearTimeout(t) }, [toast])
  return <div className={'toast' + (toast.err ? ' err' : '')} onClick={onClose}>{toast.text}</div>
}

function SoldOut({ eventId, kitchenId, barker, onClose, setToast }) {
  const [menu, setMenu] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = async () => setMenu(await loadMenu(eventId))
  useEffect(() => { load() }, [])
  const mine = (menu?.dishes || []).filter(d => d.kitchenId === kitchenId)
  async function toggle(dish) {
    setBusy(true)
    try {
      const off = dish.is_available !== false
      await rpc('ms_sold_out', { p_menu_item_id: dish.id, p_sold_out: off, p_by: `${barker.name} (Barker ${barker.side})` })
      setToast({ text: off ? `${dish.name} marked sold out on every captain tablet` : `${dish.name} is available again` })
      await load()
    } catch (e) { setToast({ text: errText(e), err: true }) }
    setBusy(false)
  }
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()} style={{ width: 'min(560px,100%)' }}>
        <h3>Sold out</h3>
        <p>A dish marked sold out shows as sold out on every captain tablet at once, so it cannot be ordered. Tap again when it is back.</p>
        {!menu ? <p>Loading…</p> : mine.map(dsh => (
          <div key={dsh.id} className="soldrow" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px dashed var(--line)' }}>
            <b style={{ fontSize: 14 }}>{dsh.name}</b>
            <span className="muted" style={{ fontSize: 12 }}>{dsh.course} · Barker {dsh.barkerSide}</span>
            <button className={'btn ' + (dsh.is_available === false ? 'btn-green' : 'btn-ghost')} style={{ marginLeft: 'auto' }} disabled={busy} onClick={() => toggle(dsh)}>
              {dsh.is_available === false ? 'Back in stock' : 'Mark sold out'}
            </button>
          </div>
        ))}
        <div className="row" style={{ marginTop: 12 }}><button className="btn btn-navy" onClick={onClose}>Done</button></div>
      </div>
    </div>
  )
}
