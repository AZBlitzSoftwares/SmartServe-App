/* Smart Serve Maestro - Kitchen Display (/kitchen).

   The kitchen barker's screen: a large screen, a mouse, at the pass.
     My dishes      the barker's own KOTs in four columns, oldest first:
                    New -> Received -> In Preparation -> Ready, then Dispatched
                    when the plate leaves with a steward. One click per stage.
     Whole kitchen  every open KOT of both barkers, large text for the chefs.
   Timers run from firing and turn red after the kitchen's late threshold.
   Coming-up counts show dishes held at the tables and not yet fired.
   Take over: one barker can work the other barker's queue as well. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { unlockChime, playChatChime } from '../lib/chime'
import { todayISO } from '../components/guest/deviceEntry'
import logo from '../assets/janus_logo.jpg'
import './maestro.css'
import { NEXT_ACTION, lateMinutes, useLive, useNow, rpc, errText, mmss, clockText, loadMenu, shortName } from './msData'

const SESSION = 'ms_barker_session'

function readSession() {
  try { return JSON.parse(localStorage.getItem(SESSION) || 'null') } catch { return null }
}

export default function KitchenDisplay() {
  const [session, setSession] = useState(() => {
    const s = readSession()
    return s && s.event?.date === todayISO() ? s : null
  })
  useEffect(() => { document.title = "Kitchen Display · Smart Serve Maestro" }, [])
  if (!session) return <BarkerLogin onLogin={s => { localStorage.setItem(SESSION, JSON.stringify(s)); setSession(s) }} />
  return <KitchenScreen session={session} onSignOut={() => { localStorage.removeItem(SESSION); setSession(null) }} />
}

// ------------------------------------------------------------------ sign-in
function BarkerLogin({ onLogin }) {
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
      onLogin({ barker: b, event: { id: ev.id, name: ev.name, date: ev.date, late_minutes: ev.late_minutes } })
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
  const [view, setView] = useState('mine')
  const [takeover, setTakeover] = useState(false)
  const [picked, setPicked] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(null)
  const [sheet, setSheet] = useState(null)
  const now = useNow(1000)
  const seenNew = useRef(null)

  // Check in every 30 seconds, so the Control Desk can show this screen as on.
  useEffect(() => {
    const ping = () => rpc('ms_barker_ping', { p_barker_id: barker.id }).catch(() => {})
    ping()
    const t = setInterval(ping, 30000)
    return () => clearInterval(t)
  }, [barker.id])

  const q = useLive(async () => {
    const since = new Date(Date.now() - 12 * 3600e3).toISOString()
    const [kitchen, kots, held, disp, ev] = await Promise.all([
      supabase.from('kitchens').select('*').eq('id', kitchenId).maybeSingle(),
      supabase.from('kots').select('*').eq('kitchen_id', kitchenId).eq('kind', 'order').neq('status', 'cancelled')
        .neq('stage', 'dispatched').is('served_at', null).gte('created_at', since).order('created_at'),
      supabase.from('ms_items').select('name,qty,barker').eq('kitchen_id', kitchenId).eq('state', 'held'),
      supabase.from('kots').select('stage,fired_at,ready_at,served_at').eq('kitchen_id', kitchenId).eq('kind', 'order').not('ready_at', 'is', null).gte('created_at', since),
      supabase.from('events').select('id,late_minutes,name').eq('id', event.id).maybeSingle(),
    ])
    for (const r of [kitchen, kots, held]) if (r.error) throw r.error
    const done = disp.data || []
    const fr = done.filter(k => k.fired_at).map(k => new Date(k.ready_at) - new Date(k.fired_at)).filter(x => x >= 0)
    return {
      kitchen: kitchen.data, kots: kots.data || [], held: held.data || [], ev: ev.data || event,
      dispatched: done.filter(k => k.stage === 'dispatched' || k.served_at).length,
      avgReady: fr.length ? fr.reduce((a, b) => a + b, 0) / fr.length : null,
    }
  }, { eventId: event.id, tables: ['kots', 'ms_items'], intervalMs: 2500 })
  const d = q.data
  const kitchen = d?.kitchen
  const late = lateMinutes(kitchen, d?.ev || event)
  const twoBarkers = (Number(kitchen?.barkers) || 2) >= 2
  const other = barker.side === 'A' ? 'B' : 'A'
  const mySides = new Set([barker.side, ...(takeover ? [other] : [])])

  const kots = useMemo(() => {
    const list = (d?.kots || []).filter(k => view === 'whole' || mySides.has(k.barker || 'A'))
    // remakes first, then oldest first
    return [...list].sort((a, b) => (b.priority ? 1 : 0) - (a.priority ? 1 : 0) || new Date(a.fired_at || a.created_at) - new Date(b.fired_at || b.created_at))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, view, takeover, barker.side])

  // chime when a new KOT arrives for this barker
  useEffect(() => {
    if (!d) return
    const ids = new Set((d.kots || []).filter(k => k.stage === 'new' && mySides.has(k.barker || 'A')).map(k => k.id))
    if (seenNew.current) {
      for (const id of ids) if (!seenNew.current.has(id)) { try { playChatChime() } catch { /* no audio */ } break }
    }
    seenNew.current = ids
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
  const lateCount = kots.filter(k => cls(k) === 'l').length

  const heldCounts = useMemo(() => {
    const m = new Map()
    for (const h of d?.held || []) {
      if (view !== 'whole' && !mySides.has(h.barker || 'A')) continue
      m.set(h.name, (m.get(h.name) || 0) + (h.qty || 1))
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, view, takeover])

  async function move(k, to, quiet) {
    const from = k.stage
    try {
      await rpc('ms_kot_stage', { p_kot_id: k.id, p_stage: to, p_by: barker.name })
      if (!quiet) setToast({ text: `${k.kot_no} · ${to === 'in_prep' ? 'sent to chef' : to}`, undo: () => moveBack(k, from) })
    } catch (e) { setToast({ text: errText(e), err: true }) }
  }
  async function moveBack(k, stage) {
    try { await rpc('ms_kot_stage', { p_kot_id: k.id, p_stage: stage, p_by: barker.name }); setToast({ text: `${k.kot_no} moved back` }); q.reload() }
    catch (e) { setToast({ text: errText(e), err: true }) }
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

  // A plain render function, not a component: a component declared in here
  // would be a new type on every one-second tick and remount every card.
  // The whole-kitchen view is an overview: no buttons, nothing to select.
  const card = (k, whole) => (
    <div key={k.id} className={'tl ' + cls(k) + (picked.has(k.id) ? ' pk' : '')}
      onClick={whole ? undefined : e => { if (e.target.tagName !== 'BUTTON') pick(k) }} style={{ cursor: whole ? 'default' : 'pointer' }}>
      <div className="tr">
        <b>{k.kot_no}{whole && <span className={'tag ' + ((k.barker || 'A') === 'A' ? 'ta' : 'tb')}>{k.barker || 'A'}</span>}</b>
        <span className="tm">{mmss(age(k))}</span>
      </div>
      <span className="cvb">T{k.table_number} · C{k.cover_no}</span>
      {k.course && <span className="crs">{k.course}</span>}
      {k.is_remake && <span className="rmk">REMAKE</span>}
      <div className="dd">
        {(k.items || []).map((it, i) => (
          <div key={i}>{it.qty} × {it.name}{it.note && String(it.note).split(',').map(n => n.trim()).filter(Boolean).map(n => <span key={n} className="jn">{n}</span>)}</div>
        ))}
      </div>
      {!whole && NEXT_ACTION[k.stage] && <button className={'kbtn ' + NEXT_ACTION[k.stage].cls} disabled={busy} onClick={() => act(k)}>{NEXT_ACTION[k.stage].label}</button>}
    </div>
  )
  const kname = String(kitchen?.name || barker.kitchen_name || '')
  const title = /kitchen$/i.test(kname.trim()) ? kname : `${kname} Kitchen`

  return (
    <div className="ms kd" onClick={() => unlockChime()}>
      <div className="top">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div className="brandmk"><div className="lt"><img src={logo} alt="" /></div></div>
          <div className="brandsep" style={{ margin: '0 12px' }} />
          <h1>{title} <span>· {view === 'whole' ? 'Whole kitchen' : `Barker ${barker.side} · ${barker.name}${takeover ? ` + Barker ${other}` : ''}`}</span></h1>
        </div>
        <div className="seg">
          <button className={view === 'mine' ? 'a' : ''} onClick={() => setView('mine')}>My dishes ({barker.side}{takeover ? '+' + other : ''})</button>
          <button className={view === 'whole' ? 'a' : ''} onClick={() => setView('whole')}>Whole kitchen</button>
        </div>
        <div className="cnt">
          {view === 'whole'
            ? <><div className="c"><b>{by('new').length + by('received').length}</b>New &amp; received</div><div className="c"><b>{by('in_prep').length}</b>In prep</div></>
            : <><div className="c"><b>{by('new').length}</b>New</div><div className="c"><b>{by('received').length}</b>Received</div><div className="c"><b>{by('in_prep').length}</b>In prep</div></>}
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

      {!d ? <div style={{ color: '#AEB8D0', padding: 20 }}>Loading…</div> : view === 'mine' ? (
        <div className="cols">
          {[['new', 'New'], ['received', 'Received'], ['in_prep', 'In preparation'], ['ready', 'Ready · hand to a steward']].map(([st, label]) => (
            <div className="col" key={st}>
              <div className="colh"><span>{label}</span><span>{by(st).length}</span></div>
              <div className="colb">{by(st).map(k => card(k, false))}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="cols whole">
          <div className="col"><div className="colh"><span>New &amp; received</span><span>oldest first</span></div>
            <div className="colb g2">{[...by('new'), ...by('received')].sort((a, b) => age(b) - age(a)).map(k => card(k, true))}</div></div>
          <div className="col"><div className="colh"><span>In preparation</span><span>red = over {late} min</span></div>
            <div className="colb g2">{by('in_prep').map(k => card(k, true))}</div></div>
          <div className="col"><div className="colh"><span>Ready · to dispatch</span></div>
            <div className="colb">{by('ready').map(k => card(k, true))}</div></div>
        </div>
      )}

      <div className="foot">
        <span>{view === 'whole'
          ? 'Blue = Barker A · gold = Barker B · dispatched KOTs clear from the screen automatically'
          : `Each KOT is for one table and one cover · the timer runs from firing · red after ${late} minutes`}</span>
        <span>{d?.avgReady != null ? `Avg. firing to ready ${mmss(d.avgReady)} · ` : ''}Dispatched this service: {d?.dispatched ?? 0}</span>
      </div>

      {sheet === 'menu' && (
        <div className="sheet-bg" onClick={() => setSheet(null)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <h3>{barker.name} · Barker {barker.side}</h3>
            <p>{kitchen?.name} kitchen · {event.name}</p>
            <div className="row">
              {twoBarkers && <button className="btn btn-navy" onClick={() => { setTakeover(t => !t); setSheet(null) }}>{takeover ? `Stop working Barker ${other}'s queue` : `Take over Barker ${other}'s queue`}</button>}
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
