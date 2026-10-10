/* Smart Serve Maestro - Kitchen Display (/kitchen).

   The kitchen barker's screen: a large screen, a mouse, at the pass.
     My dishes      the barker's own KOTs in three columns, oldest first:
                    Received -> In Preparation -> Ready, then Handed over when
                    the plate leaves with a steward: that completes the KOT.
                    A KOT is marked received as soon as it reaches the screen.
     Entire kitchen every open KOT of both barkers, with the same buttons, so
                    one barker can carry on for the other when needed.
     Done           KOTs handed over this service, with their times, and the
                    barker's counts (handed over, average time, late).
   Timers run from firing and turn red after the kitchen's late threshold.
   Coming-up counts show dishes held at the tables and not yet fired.
   Reprint sends a KOT to the kitchen printer again, marked REPRINT. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { unlockChime, playChatChime, chimeReady } from '../lib/chime'
import { todayISO, sessionStillCurrent } from '../components/guest/deviceEntry'
import { setSignOutReason, takeSignOutReason, setUnsavedCheck } from '../lib/appUpdate'
import logo from '../assets/janus_logo.jpg'
import './maestro.css'
import { NEXT_ACTION, lateMinutes, useLive, useNow, rpc, errText, mmss, clockText, loadMenu, shortName, coursesOf, shortCourses } from './msData'

const SESSION = 'ms_barker_session'

function readSession() {
  try { return JSON.parse(localStorage.getItem(SESSION) || 'null') } catch { return null }
}

export default function KitchenDisplay() {
  const [session, setSession] = useState(() => {
    const s = readSession()
    // receptions run past midnight: yesterday's session holds until 5 am
    return s && sessionStillCurrent(s.event?.date) ? s : null
  })
  useEffect(() => { document.title = "Kitchen Display · Smart Serve Maestro" }, [])
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
      const { data, error } = await supabase.from('events').select('*').eq('date', todayISO()).eq('maestro', true).order('name')
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
    <div className="ms kd" style={{ alignItems: 'center', justifyContent: 'center' }}>
      <form onSubmit={submit} style={{ background: '#1C2741', borderRadius: 18, padding: 28, width: 'min(420px,94vw)', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <div className="brandmk"><div className="lt" style={{ background: '#fff', width: 44, height: 44, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><img src={logo} alt="" style={{ width: 40, height: 40, objectFit: 'contain' }} /></div></div>
          <div><div style={{ fontSize: 10, letterSpacing: '.2em', fontWeight: 800, color: '#D9B26B' }}>SMART SERVE MAESTRO</div>
            <div style={{ fontFamily: 'Georgia,serif', fontSize: 24, fontWeight: 700, color: '#fff' }}>Kitchen Display</div></div>
        </div>
        {events === null ? <div style={{ color: '#AEB8D0' }}>Loading today's events…</div>
          : !events.length ? <div style={{ color: '#FFD27A', fontWeight: 700 }}>No Smart Serve Maestro event is running today.</div>
          : (
            <>
              {events.length > 1 && (
                <select value={evId} onChange={e => setEvId(e.target.value)} style={inp}>
                  <option value="">Choose the event…</option>
                  {events.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              )}
              {events.length === 1 && <div style={{ color: '#AEB8D0', fontWeight: 700 }}>{events[0].name}</div>}
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" autoComplete="off" style={inp} />
              <input value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="PIN" inputMode="numeric" type="password" style={inp} />
              {notice && !err && <div style={{ color: '#FFD27A', fontWeight: 700, fontSize: 14 }}>{notice}</div>}
              {err && <div style={{ color: '#FF8A8A', fontWeight: 700, fontSize: 14 }}>{err}</div>}
              <button className="kbtn b2" disabled={busy} style={{ padding: 12, fontSize: 16 }}>{busy ? 'Signing in…' : 'Sign in'}</button>
            </>
          )}
      </form>
    </div>
  )
}
const inp = { background: '#111A2E', border: '1.5px solid #2E3B5C', color: '#fff', borderRadius: 10, padding: '12px 14px', fontSize: 16, fontWeight: 700 }

// ------------------------------------------------------------------ screen
function KitchenScreen({ session, onSignOut }) {
  const { barker, event } = session
  const kitchenId = barker.kitchen_id
  const [view, setView] = useState('mine')           // mine | whole | done
  const [doneScope, setDoneScope] = useState('mine')  // Done view: my KOTs or the entire kitchen
  // Card size for this screen: small cards fit more KOTs on a monitor up close, large ones read
  // from across the kitchen on a TV. Remembered on this screen.
  const [size, setSize] = useState(() => { try { return localStorage.getItem('ms_kd_size') || 'M' } catch { return 'M' } })
  const pickSize = v => { setSize(v); try { localStorage.setItem('ms_kd_size', v) } catch { /* private mode */ } }
  const [picked, setPicked] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(null)
  const [sheet, setSheet] = useState(null)
  const now = useNow(1000)
  const seenKots = useRef(null)
  const receiving = useRef(new Set())

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

  const q = useLive(async () => {
    const since = new Date(Date.now() - 12 * 3600e3).toISOString()
    const [kitchen, kots, held, fin, ev] = await Promise.all([
      supabase.from('kitchens').select('*').eq('id', kitchenId).maybeSingle(),
      supabase.from('kots').select('*').eq('kitchen_id', kitchenId).eq('kind', 'order').eq('status', 'open')
        .neq('stage', 'dispatched').is('served_at', null).gte('created_at', since).order('created_at'),
      supabase.from('ms_items').select('name,qty,barker').eq('kitchen_id', kitchenId).eq('state', 'held'),
      // Done: handed over (or closed at the desk) this service, newest first
      supabase.from('kots').select('*').eq('kitchen_id', kitchenId).eq('kind', 'order').eq('status', 'delivered')
        .gte('created_at', since).order('dispatched_at', { ascending: false, nullsFirst: false }).limit(300),
      supabase.from('events').select('id,late_minutes,name,courses').eq('id', event.id).maybeSingle(),
    ])
    for (const r of [kitchen, kots, held, fin]) if (r.error) throw r.error
    const done = fin.data || []
    const fr = [...done, ...(kots.data || [])].filter(k => k.fired_at && k.ready_at).map(k => new Date(k.ready_at) - new Date(k.fired_at)).filter(x => x >= 0)
    return {
      kitchen: kitchen.data, kots: kots.data || [], held: held.data || [], ev: ev.data || event, done,
      dispatched: done.length,
      avgReady: fr.length ? fr.reduce((a, b) => a + b, 0) / fr.length : null,
    }
  }, { eventId: event.id, tables: ['kots', 'ms_items'], intervalMs: 2500 })
  const d = q.data
  const kitchen = d?.kitchen
  const late = lateMinutes(kitchen, d?.ev || event)
  const crsLabel = shortCourses([...coursesOf(d?.ev), ...(d?.kots || []).map(k => k.course)])
  const mine = k => (k.barker || 'A') === barker.side

  const kots = useMemo(() => {
    const list = (d?.kots || []).filter(k => view === 'whole' || mine(k))
    // remakes first, then oldest first
    return [...list].sort((a, b) => (b.priority ? 1 : 0) - (a.priority ? 1 : 0) || new Date(a.fired_at || a.created_at) - new Date(b.fired_at || b.created_at))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, view, barker.side])

  // Chime when a KOT arrives that this screen shows (the barker's own, or the
  // entire kitchen's while that view is open)
  useEffect(() => {
    if (!d) return
    // Every KOT of the kitchen counts as seen once loaded, so opening Entire kitchen later
    // does not chime for KOTs that were already there
    const all = (d.kots || []).map(k => k.id)
    if (seenKots.current) {
      const fresh = (d.kots || []).filter(k => !seenKots.current.has(k.id) && (view === 'whole' || mine(k)))
      if (fresh.length) { try { playChatChime() } catch { /* no audio */ } }
    }
    seenKots.current = new Set([...(seenKots.current || []), ...all])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d])

  /* A KOT is received the moment it reaches the kitchen screen: no New step
     for the barker. Only a KOT still at New moves (never one a barker has
     already started), and each one is sent once. If no kitchen screen is
     open, the KOT stays "not yet received" on the Control Desk. */
  useEffect(() => {
    const fresh = (d?.kots || []).filter(k => k.stage === 'new' && !receiving.current.has(k.id)).map(k => k.id)
    if (!fresh.length) return
    fresh.forEach(id => receiving.current.add(id))
    ;(async () => {
      try {
        const { error } = await supabase.from('kots').update({ stage: 'received', received_at: new Date().toISOString(), stage_by: barker.name })
          .in('id', fresh).eq('stage', 'new')
        if (error) throw error
        q.reload()
      } catch { fresh.forEach(id => receiving.current.delete(id)) /* tried again on the next refresh */ }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d])

  const age = k => now - new Date(k.fired_at || k.created_at).getTime()
  const cls = k => {
    if (k.stage === 'ready') return ''
    const a = age(k)
    if (a >= late * 60000) return 'l'
    if (a >= (late - 1) * 60000) return 'w'
    return ''
  }
  const by = st => kots.filter(k => k.stage === st)
  // New only lasts until the screen has marked it received: shown as received
  const received = kots.filter(k => k.stage === 'new' || k.stage === 'received')
  const lateCount = kots.filter(k => cls(k) === 'l').length

  const heldCounts = useMemo(() => {
    const m = new Map()
    for (const h of d?.held || []) {
      if (view !== 'whole' && !mine(h)) continue
      m.set(h.name, (m.get(h.name) || 0) + (h.qty || 1))
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, view])

  async function move(k, to, quiet) {
    const from = k.stage
    try {
      // Both barkers can act on a KOT: if the other screen has just moved it, leave it be
      const { data: cur } = await supabase.from('kots').select('stage,status').eq('id', k.id).maybeSingle()
      if (cur && (cur.status !== 'open' || (cur.stage !== from && !(from === 'new' && cur.stage === 'received')))) {
        if (!quiet) setToast({ text: `${k.kot_no} was just moved by the other screen` })
        return
      }
      if (to === 'dispatched') {
        // Handed over: the KOT is complete (served), nothing else to mark
        await rpc('ms_serve', { p_kot_ids: [k.id], p_undo: false })
        await supabase.from('kots').update({ stage_by: barker.name }).eq('id', k.id)
      } else {
        await rpc('ms_kot_stage', { p_kot_id: k.id, p_stage: to, p_by: barker.name })
      }
      if (!quiet) setToast({ text: `${k.kot_no} · ${to === 'in_prep' ? 'in preparation' : to === 'dispatched' ? 'handed over · done' : to}`, undo: () => moveBack(k, from === 'new' ? 'received' : from) })
    } catch (e) { setToast({ text: errText(e), err: true }) }
  }
  // Undo a move; a KOT handed over by mistake goes back to Ready (open again)
  async function moveBack(k, stage) {
    try {
      const { data: cur } = await supabase.from('kots').select('status').eq('id', k.id).maybeSingle()
      // Stage first: if the reopen then fails, the KOT is still in Done and can be tried again
      await rpc('ms_kot_stage', { p_kot_id: k.id, p_stage: stage, p_by: barker.name })
      if (cur?.status === 'delivered') await rpc('ms_serve', { p_kot_ids: [k.id], p_undo: true })
      setToast({ text: `${k.kot_no} moved back` }); q.reload()
    } catch (e) { setToast({ text: errText(e), err: true }) }
  }
  async function act(k) {
    const n = NEXT_ACTION[k.stage]
    if (!n || busy) return
    setBusy(true)
    await move(k, n.to)
    await q.reload()
    setBusy(false)
  }
  async function bulkMove() {
    const list = kots.filter(k => picked.has(k.id))
    if (!list.length) return
    setBusy(true)
    for (const k of list) { const n = NEXT_ACTION[k.stage]; if (n) await move(k, n.to, true) }
    setToast({ text: `${list.length} KOTs moved on` })
    setPicked(new Set())
    await q.reload()
    setBusy(false)
  }
  const pick = k => setPicked(s => { const n = new Set(s); n.has(k.id) ? n.delete(k.id) : n.add(k.id); return n })

  // The KOT slip again, from the kitchen printer, marked REPRINT on the slip
  async function reprint(k) {
    if (busy) return
    setBusy(true)
    try {
      await rpc('ms_reprint', { p_kot_id: k.id, p_printer_ip: null })
      setToast({ text: `${k.kot_no} sent to the printer again · marked REPRINT` })
      await q.reload()
    } catch (e) { setToast({ text: errText(e), err: true }) }
    setBusy(false)
  }

  // A plain render function, not a component: a component declared in here
  // would be a new type on every one-second tick and remount every card.
  // Entire kitchen has the same buttons: a barker can act on the other barker's KOTs.
  const card = (k, whole) => {
    const n = NEXT_ACTION[k.stage]
    return (
      <div key={k.id} className={'tl ' + cls(k) + (picked.has(k.id) ? ' pk' : '')}
        onClick={e => { if (e.target.tagName !== 'BUTTON') pick(k) }} style={{ cursor: 'pointer' }}>
        <div className="tr">
          {/* Entire kitchen: the KOT number in the barker's colour (blue A, gold B) */}
          <b className={whole ? ((k.barker || 'A') === 'A' ? 'ka' : 'kb') : undefined}>{k.kot_no}</b>
          <span className="cvb">T{k.table_number}·C{k.cover_no}</span>
          {k.course && <span className="crs" title={k.course}>{crsLabel(k.course)}</span>}
          <span className="tm">{mmss(age(k))}</span>
        </div>
        {(k.is_remake || k.print_status === 'failed') && (
          <div>{k.is_remake && <span className="rmk">REMAKE</span>}{k.print_status === 'failed' && <span className="rmk">NOT PRINTED</span>}</div>
        )}
        <div className="dd">
          {(k.items || []).map((it, i) => (
            <div key={i}>{it.qty} × {it.name}{it.note && String(it.note).split(',').map(x => x.trim()).filter(Boolean).map(x => <span key={x} className="jn">{x}</span>)}</div>
          ))}
        </div>
        <div className="kact">
          {n && <button className={'kbtn ' + n.cls} disabled={busy} onClick={() => act(k)}>{n.label}</button>}
          <button className="kbtn rp" disabled={busy} title="Print this KOT again on the kitchen printer"
            onClick={() => reprint(k)}>Reprint</button>
        </div>
      </div>
    )
  }
  // Done: KOTs handed over this service, with their times
  const doneAll = d?.done || []
  const doneMine = doneAll.filter(mine)
  const doneList = doneScope === 'whole' ? doneAll : doneMine
  const tReady = k => (k.fired_at && k.ready_at ? new Date(k.ready_at) - new Date(k.fired_at) : null)
  const tOut = k => { const t = k.dispatched_at || k.served_at; return k.fired_at && t ? new Date(t) - new Date(k.fired_at) : null }
  const avgOf = xs => { const v = xs.filter(x => x != null && x >= 0); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }
  const wasLate = k => (tReady(k) ?? tOut(k) ?? 0) > late * 60000
  const hhmm = iso => (iso ? clockText(new Date(iso)) : '–')

  const kname = String(kitchen?.name || barker.kitchen_name || '')
  const title = /kitchen$/i.test(kname.trim()) ? kname : `${kname} Kitchen`

  return (
    <div className={'ms kd sz-' + size} onClick={() => { unlockChime(); if (chimeReady()) setSoundOn(true) }}>
      {!soundOn && <div style={{ background: '#7A4B00', color: '#FFE3A3', fontWeight: 800, fontSize: 14, padding: '8px 14px', textAlign: 'center', cursor: 'pointer' }}>Tap anywhere to turn on the sound for new KOTs</div>}
      <div className="top">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div className="brandmk"><div className="lt"><img src={logo} alt="" /></div></div>
          <div className="brandsep" style={{ margin: '0 12px' }} />
          <h1>{title} <span>· {view === 'whole' ? 'Both barkers' : view === 'done' ? 'Done this service' : `Barker ${barker.side} · ${barker.name}`}</span></h1>
        </div>
        <div className="seg">
          <button className={view === 'mine' ? 'a' : ''} onClick={() => { setView('mine'); setPicked(new Set()) }}>My dishes ({barker.side})</button>
          <button className={view === 'whole' ? 'a' : ''} onClick={() => setView('whole')}>Entire kitchen</button>
          <button className={view === 'done' ? 'a' : ''} onClick={() => { setView('done'); setPicked(new Set()) }}>Done · {doneMine.length}</button>
        </div>
        <div className="cnt">
          <div className="c"><b>{received.length}</b>Received</div>
          <div className="c"><b>{by('in_prep').length}</b>In prep</div>
          <div className="c"><b>{by('ready').length}</b>Ready</div>
          <div className="c r"><b>{lateCount}</b>Late</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {!q.online && <span className="c r" style={{ padding: '6px 10px' }}>Offline</span>}
          <div className="clock">{clockText(new Date(now))}</div>
          <button className="menu-btn" onClick={() => setSheet('menu')}>☰</button>
        </div>
      </div>

      {heldCounts.length > 0 && (
        <div className="held"><b>Coming up · held at tables, not yet fired</b>
          {heldCounts.slice(0, 12).map(([n, c]) => <span key={n}>{shortName(n, 20)} {c}</span>)}
        </div>
      )}
      {picked.size > 0 && (
        <div className="bulk">{picked.size} KOT{picked.size === 1 ? '' : 's'} selected
          <button disabled={busy} onClick={bulkMove}>Move to the next stage</button>
          <button className="g" onClick={() => setPicked(new Set())}>Clear</button>
        </div>
      )}

      {view === 'whole' && <div className="whint">Both barkers' KOTs. Use the buttons when the other barker is away: every change shows on both screens at once.</div>}
      {!d ? <div style={{ color: '#AEB8D0', padding: 20 }}>Loading…</div> : view === 'done' ? (
        <div className="donev">
          <div className="dsum">
            <div className="c"><b>{doneMine.length}</b>My dishes ({barker.side}) handed over</div>
            <div className="c"><b>{doneAll.length}</b>Entire kitchen</div>
            <div className="c"><b>{mmss(avgOf(doneList.map(tReady)))}</b>Avg firing → ready</div>
            <div className="c"><b>{mmss(avgOf(doneList.map(tOut)))}</b>Avg firing → handed over</div>
            <div className={'c' + (doneList.some(wasLate) ? ' r' : '')}><b>{doneList.filter(wasLate).length}</b>Late (over {late} min)</div>
            <div className="seg sm" style={{ marginLeft: 'auto' }}>
              <button className={doneScope === 'mine' ? 'a' : ''} onClick={() => setDoneScope('mine')}>Mine</button>
              <button className={doneScope === 'whole' ? 'a' : ''} onClick={() => setDoneScope('whole')}>Entire kitchen</button>
            </div>
          </div>
          <div className="dtw">
            {doneList.length ? (
              <table className="dtab">
                <thead><tr><th>KOT</th><th>Table</th><th>Course</th><th>Dishes</th><th>Fired</th><th>Ready</th><th>Handed over</th><th>Total</th><th /></tr></thead>
                <tbody>
                  {doneList.map(k => (
                    <tr key={k.id} className={wasLate(k) ? 'l' : ''}>
                      <td><b>{k.kot_no}</b>{doneScope === 'whole' && <span className={'tag ' + ((k.barker || 'A') === 'A' ? 'ta' : 'tb')}>{k.barker || 'A'}</span>}{k.is_remake && <span className="rmk">REMAKE</span>}</td>
                      <td>T{k.table_number} · C{k.cover_no}</td>
                      <td>{k.course || ''}</td>
                      <td className="dl">{(k.items || []).map(it => `${it.qty} × ${it.name}`).join(', ')}</td>
                      <td>{hhmm(k.fired_at)}</td>
                      <td>{hhmm(k.ready_at)}{tReady(k) != null && <small> · {mmss(tReady(k))}</small>}</td>
                      <td>{hhmm(k.dispatched_at || k.served_at)}{k.stage_by ? <small> · {k.stage_by}</small> : null}</td>
                      <td><b>{mmss(tOut(k))}</b></td>
                      <td className="ac"><div>
                        <button className="kbtn rp" disabled={busy} onClick={() => reprint(k)}>Reprint</button>
                        <BackToReady busy={busy} onBack={() => moveBack(k, 'ready')} />
                      </div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div className="empty" style={{ color: '#AEB8D0', padding: 30, textAlign: 'center' }}>Nothing handed over yet this service.</div>}
          </div>
        </div>
      ) : view === 'mine' ? (
        <div className="cols">
          {[[received, 'Received'], [by('in_prep'), 'In preparation'], [by('ready'), 'Ready · hand to a steward']].map(([list, label]) => (
            <div className="col" key={label}>
              <div className="colh"><span>{label}</span><span>{list.length}</span></div>
              <div className="colb">{list.map(k => card(k, false))}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="cols whole">
          <div className="col"><div className="colh"><span>Received</span><span>oldest first</span></div>
            <div className="colb">{[...received].sort((a, b) => age(b) - age(a)).map(k => card(k, true))}</div></div>
          <div className="col"><div className="colh"><span>In preparation</span><span>red = over {late} min</span></div>
            <div className="colb">{by('in_prep').map(k => card(k, true))}</div></div>
          <div className="col"><div className="colh"><span>Ready · to dispatch</span></div>
            <div className="colb">{by('ready').map(k => card(k, true))}</div></div>
        </div>
      )}

      <div className="foot">
        <span>{view === 'whole'
          ? 'Blue = Barker A · gold = Barker B · tap cards to move several at once · handed over KOTs move to Done'
          : `Each KOT is for one table and one cover · the timer runs from firing · red after ${late} minutes`}</span>
        <span>{d?.avgReady != null ? `Avg. firing to ready ${mmss(d.avgReady)} · ` : ''}Handed over this service: {d?.dispatched ?? 0}</span>
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

// Back to Ready from Done: a second tap, so a stray click does not reopen a KOT
function BackToReady({ busy, onBack }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 4000); return () => clearTimeout(t) }, [armed])
  return armed
    ? <button className="kbtn b2" disabled={busy} onClick={() => { setArmed(false); onBack() }}>Reopen?</button>
    : <button className="kbtn rp" disabled={busy} onClick={() => setArmed(true)} title="Handed over by mistake: back to Ready">Back to Ready</button>
}

function KdToast({ toast, onClose }) {
  const closeRef = useRef(onClose); closeRef.current = onClose
  useEffect(() => { const t = setTimeout(() => closeRef.current(), toast.undo ? 8000 : toast.err ? 6000 : 3000); return () => clearTimeout(t) }, [toast])
  return (
    <div className={'toast' + (toast.err ? ' err' : '')}>
      {toast.text}
      {toast.undo && <button onClick={() => { toast.undo(); onClose() }}>Undo</button>}
    </div>
  )
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
