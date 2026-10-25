import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { getDeviceId } from '../../lib/deviceId'
import { serviceDates } from '../guest/deviceEntry'
import { printKotWindow, kotAsOrder, helpAsOrder } from '../../lib/kotSlip'

/* Assign waiters automatically (event switch, Control › Waiters).

   One desk does it: the desk where the switch was turned on (events.auto_assign_device
   = that browser's device id). The runner below lives in the desk app as long as
   someone is signed in, on any tab, and looks every few seconds at every event of
   today that is bound to this desk - so a guest event and a captain event can both
   run from one laptop without switching screens.

   For each KOT (one per category, or the whole order when "One KOT per category" is
   off) and each help request that has no waiter yet, the database picks the least
   busy waiter (ss_auto_assign_*: only if it still has no waiter, so two desks or a
   person and the runner can never both assign it). This desk then prints the slip,
   exactly as if the operator had assigned it by hand. The desk can still change a
   waiter by hand at any time. */

const EVERY_MS = 4000
const PRINT_GAP_MS = 1500
// several desk tabs on one laptop share the device id: a visible tab does the work,
// a hidden one only steps in when no visible tab has run for this long
const VISIBLE_KEY = 'ss_auto_visible_at'
const HIDDEN_TAKEOVER_MS = 12000

const autoPrintOn = () => { try { return localStorage.getItem('ss_autoprint') !== 'off' } catch { return true } }
const isVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden'

export function AutoAssignRunner() {
  const [events, setEvents] = useState([])
  const [blocked, setBlocked] = useState(false)
  const busy = useRef(false)
  const queue = useRef([])
  const printing = useRef(false)

  function queuePrint(fn) {
    if (!autoPrintOn()) return
    queue.current.push(fn)
    if (printing.current) return
    printing.current = true
    const next = () => {
      const job = queue.current.shift()
      if (!job) { printing.current = false; return }
      let ok
      try { ok = job() !== false } catch { ok = true }
      setBlocked(!ok)
      setTimeout(next, PRINT_GAP_MS)
    }
    next()
  }

  async function runEvent(ev) {
    if (ev.kot_per_category) {
      const { data: ks } = await supabase.from('kots').select('id')
        .eq('event_id', ev.id).eq('kind', 'order').eq('status', 'open').is('waiter_id', null)
        .order('created_at', { ascending: true }).limit(40)
      for (const k of ks || []) {
        const { data, error } = await supabase.rpc('ss_auto_assign_kot', { p_kot_id: k.id })
        if (error || !data) continue
        if (data.print !== 'desk') continue          // a category printer: the Print Hub prints it
        const { data: fresh } = await supabase.from('kots')
          .select('id,kot_no,table_number,captain_name,category_name,items,waiter_id,waiter_label,created_at')
          .eq('id', k.id).maybeSingle()
        if (fresh) queuePrint(() => printKotWindow(kotAsOrder(fresh, data.waiter), false, ev.name, { quiet: true }))
      }
    } else {
      const { data: os } = await supabase.from('orders').select('id')
        .eq('event_id', ev.id).in('status', ['pending', 'placed']).is('waiter_id', null)
        .order('created_at', { ascending: true }).limit(40)
      for (const o of os || []) {
        const { data, error } = await supabase.rpc('ss_auto_assign_order', { p_order_id: o.id })
        if (error || !data) continue
        const { data: fresh } = await supabase.from('orders')
          .select('*, tables(table_number), waiters(name), captains(name), order_items(quantity, menu_items(name, is_veg))')
          .eq('id', o.id).maybeSingle()
        if (fresh) queuePrint(() => printKotWindow(fresh, false, ev.name, { quiet: true }))
      }
    }
    const { data: ss } = await supabase.from('sos_requests').select('id')
      .eq('event_id', ev.id).in('status', ['open', 'acknowledged']).is('waiter_id', null)
      .order('created_at', { ascending: true }).limit(40)
    for (const s of ss || []) {
      const { data, error } = await supabase.rpc('ss_auto_assign_sos', { p_sos_id: s.id })
      if (error || !data) continue
      const { data: fresh } = await supabase.from('sos_requests')
        .select('*, tables(table_number), waiters(name), captains(name), sos_request_items(item_name, quantity)')
        .eq('id', s.id).maybeSingle()
      if (fresh) queuePrint(() => printKotWindow(helpAsOrder(fresh), true, ev.name, { quiet: true }))
    }
  }

  useEffect(() => {
    let stopped = false
    async function tick() {
      if (busy.current) return
      if (isVisible()) {
        try { localStorage.setItem(VISIBLE_KEY, String(Date.now())) } catch { /* private mode */ }
      } else {
        let seen = 0
        try { seen = parseInt(localStorage.getItem(VISIBLE_KEY) || '0', 10) } catch { /* private mode */ }
        if (Date.now() - seen < HIDDEN_TAKEOVER_MS) return
      }
      busy.current = true
      try {
        const { data, error } = await supabase.from('events')
          .select('id,name,date,kot_per_category,multi_kitchen,maestro')
          .eq('auto_assign_waiter', true).eq('auto_assign_device', getDeviceId())
          .in('date', serviceDates())
        if (!error) {
          const list = (data || []).filter(e => !e.multi_kitchen && !e.maestro)
          if (!stopped) setEvents(list)
          for (const ev of list) await runEvent(ev)
        }
      } catch { /* the next tick tries again */ }
      busy.current = false
    }
    tick()
    const t = setInterval(tick, EVERY_MS)
    return () => { stopped = true; clearInterval(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!events.length) return null
  return (
    <div data-testid="auto-assign-runner"
      style={{ position:'fixed', left:12, bottom:12, zIndex:90, maxWidth:'calc(100vw - 180px)',
        background: blocked ? '#FEE2E2' : '#ECFDF5', border:'1.5px solid ' + (blocked ? '#FCA5A5' : '#6EE7B7'),
        color: blocked ? '#991B1B' : '#065F46', borderRadius:12, padding:'7px 12px', fontSize:12, fontWeight:800,
        boxShadow:'0 4px 14px rgba(0,0,0,0.12)', lineHeight:1.35 }}>
      🤖 Auto-assign on this desk: {events.map(e => e.name).join(' · ')}
      {!autoPrintOn() && <div style={{ fontWeight:600 }}>Auto-print is OFF here: waiters are assigned, nothing prints.</div>}
      {blocked && <div style={{ fontWeight:600 }}>KOTs are not printing: the browser blocked the print window. Allow pop-ups for this site, or open the desk with “6 Open Desk”.</div>}
    </div>
  )
}

/* The event's auto-assign state, re-read every few seconds so a desk sees a change
   made on another desk. */
function useAutoState(eventData) {
  const [st, setSt] = useState({ on: !!eventData?.auto_assign_waiter, device: eventData?.auto_assign_device || null })
  useEffect(() => {
    if (!eventData?.id) return
    let stopped = false
    async function load() {
      const { data } = await supabase.from('events').select('auto_assign_waiter,auto_assign_device').eq('id', eventData.id).maybeSingle()
      if (data && !stopped) setSt({ on: !!data.auto_assign_waiter, device: data.auto_assign_device || null })
    }
    load()
    const t = setInterval(load, 5000)
    return () => { stopped = true; clearInterval(t) }
  }, [eventData?.id])
  return [st, setSt]
}

/* Live Orders header: whether this event's waiters are assigned automatically, and where. */
export function AutoAssignBadge({ eventData }) {
  const [st] = useAutoState(eventData)
  if (!st.on) return null
  const here = st.device === getDeviceId()
  return (
    <span data-testid="auto-assign-badge" title="Change it in Control › Waiters"
      style={{ background: here ? '#ECFDF5' : '#FFFBEB', border:'1px solid ' + (here ? '#6EE7B7' : '#FCD34D'),
        color: here ? '#065F46' : '#92400E', borderRadius:10, padding:'7px 12px', fontSize:12, fontWeight:700,
        whiteSpace:'nowrap' }}>
      🤖 Auto-assign {here ? 'ON' : 'ON · another desk prints'}
    </span>
  )
}

/* Control › Waiters: the switch. Turning it on binds it to this desk. Moving it to
   another desk, or turning it off from a desk that is not running it, needs the
   supervisor PIN, so a second laptop cannot take the printing away by accident. */
export function AutoAssignSetting({ eventData, onEventChange }) {
  const [st, setSt] = useAutoState(eventData)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [pinFor, setPinFor] = useState(null)   // 'here' | 'off' while asking for the PIN
  const [pin, setPin] = useState('')
  const me = getDeviceId()
  const here = st.on && st.device === me
  const elsewhere = st.on && st.device !== me

  async function save(on) {
    setBusy(true); setMsg('')
    const upd = on ? { auto_assign_waiter: true, auto_assign_device: me } : { auto_assign_waiter: false }
    const { error } = await supabase.from('events').update(upd).eq('id', eventData.id)
    setBusy(false)
    if (error) { setMsg('Could not save' + (/auto_assign/.test(error.message || '') ? ': the database update for this switch has not been run yet.' : '. Check the connection and try again.')); return }
    setSt(s => ({ on, device: on ? me : s.device }))
    const { data } = await supabase.from('events').select('*').eq('id', eventData.id).single()
    if (data && onEventChange) onEventChange(data)
  }

  async function checkPin() {
    const p = pin.trim()
    if (!p) { setMsg('Enter the supervisor PIN.'); return }
    const [{ data: sups }, { data: admins }] = await Promise.all([
      supabase.from('supervisors').select('id').eq('event_id', eventData.id).eq('pin', p).eq('is_active', true),
      supabase.from('admins').select('id').eq('pin', p).eq('is_active', true),
    ])
    if (!(sups || []).length && !(admins || []).length) { setMsg('Incorrect PIN.'); return }
    const what = pinFor
    setPinFor(null); setPin('')
    await save(what === 'here')
  }

  const box = { background:'#fff', borderRadius:14, padding:'14px 16px', marginBottom:12, boxShadow:'var(--shadow)' }
  const btn = (bg) => ({ border:'none', borderRadius:999, padding:'9px 18px', fontSize:13.5, fontWeight:800, cursor:'pointer', background:bg, color:'#fff' })

  return (
    <div style={box} data-testid="auto-assign-setting">
      <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
        <div style={{ flex:1, minWidth:220 }}>
          <div style={{ fontWeight:900, fontSize:15 }}>Assign waiters automatically</div>
          <div style={{ fontSize:12.5, color:'var(--ink2)', marginTop:3, lineHeight:1.5 }}>
            {here && 'On, on this desk. Every new KOT' + (eventData?.kot_per_category ? (eventData?.kot_per_course ? ' (one per course, so each course goes to its own runner)' : ' (one per category, so each category goes to its own runner)') : '') + ' and every help request goes to the least busy waiter and prints here at once. Keep this desk signed in (any tab). You can still change a waiter by hand.'}
            {elsewhere && 'On, running on another desk: that desk assigns the waiters and prints the KOTs.'}
            {!st.on && 'Off: the desk picks the waiter for each KOT (as before). On: every new KOT and help request gets the least busy waiter by itself and prints on this desk.'}
          </div>
        </div>
        {!st.on && <button data-testid="auto-assign-on" disabled={busy} onClick={() => save(true)} style={btn('var(--ink)')}>Turn on</button>}
        {here && <button data-testid="auto-assign-off" disabled={busy} onClick={() => save(false)} style={btn('#16A34A')}>ON · turn off</button>}
        {elsewhere && !pinFor && <>
          <button data-testid="auto-assign-here" disabled={busy} onClick={() => { setPinFor('here'); setMsg('') }} style={btn('var(--ink)')}>Run on this desk</button>
          <button disabled={busy} onClick={() => { setPinFor('off'); setMsg('') }} style={btn('#6B7280')}>Turn off</button>
        </>}
      </div>
      {pinFor && (
        <div style={{ display:'flex', gap:8, alignItems:'center', marginTop:10, flexWrap:'wrap' }}>
          <span style={{ fontSize:12.5, fontWeight:700 }}>{pinFor === 'here' ? 'Move it to this desk:' : 'Turn it off:'} supervisor PIN</span>
          <input type="password" inputMode="numeric" value={pin} autoFocus onChange={e => setPin(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') checkPin() }}
            style={{ border:'1.5px solid var(--line)', borderRadius:9, padding:'7px 10px', fontSize:14, width:110 }} />
          <button onClick={checkPin} style={btn('var(--ink)')}>OK</button>
          <button onClick={() => { setPinFor(null); setPin(''); setMsg('') }} style={btn('#6B7280')}>Cancel</button>
        </div>
      )}
      {st.on && (
        <div style={{ fontSize:12, color:'var(--ink2)', marginTop:8, lineHeight:1.5 }}>
          Guest and captain events can run on the same laptop: turn this on in each event from that laptop.
          The KOT prints in a pop-up window: in an ordinary Chrome window allow pop-ups for this site once
          (the Offline Kit's “6 Open Desk” window already does).
        </div>
      )}
      {msg && <div style={{ marginTop:8, fontSize:12.5, color:'#B91C1C', fontWeight:700 }}>{msg}</div>}
    </div>
  )
}
