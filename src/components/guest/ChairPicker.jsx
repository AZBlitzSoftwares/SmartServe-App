import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { NoteChips, NoteBadge, chairsLabel, kitchenResolver, friendlySendError } from './mkShared'

/* Captain + Multi-Kitchen: the last step before an order goes.

   Opened by Place Order, only at a multi-kitchen event. The captain taps
   the chairs the order is for - the waiter carrying each kitchen's dishes
   walks to those chairs, not just to the table - and sees, before sending,
   which kitchen every dish is going to. One KOT prints per kitchen.

   Sending is ONE database call (mk_place_order). The order, its dishes
   and every kitchen's KOT are written together or not at all, so there is
   no half-sent order to explain to anyone. Nothing in the cart is cleared
   until that call has come back with an order id.                        */

const DARK = '#1A0A0A'
const MARI = '#E8890C'
const GREEN = '#16A34A'

function ChairRing({ count, table, selected, ordered, onToggle, disabled }) {
  const B = 58                                   // chair button, px
  const R = Math.max(112, Math.ceil(count * (B + 10) / (2 * Math.PI)))
  const box = 2 * R + B
  const inner = Math.max(96, 2 * (R - B / 2 - 16))
  const c = box / 2
  return (
    <div style={{ position:'relative', width:box, height:box, flexShrink:0 }}>
      <div style={{ position:'absolute', left:c - inner / 2, top:c - inner / 2, width:inner, height:inner,
        borderRadius:'50%', background:DARK, display:'flex', flexDirection:'column',
        alignItems:'center', justifyContent:'center', boxShadow:'0 8px 24px rgba(26,10,10,0.25)' }}>
        <span style={{ color:'rgba(255,255,255,0.55)', fontSize:12, fontWeight:800, letterSpacing:'1.2px' }}>TABLE</span>
        <span style={{ color:'#fff', fontSize:36, fontWeight:900, lineHeight:1.05 }}>{table}</span>
      </div>
      {Array.from({ length: count }, (_, i) => {
        const n = i + 1
        const a = (i * 2 * Math.PI) / count
        const x = c + R * Math.sin(a) - B / 2
        const y = c - R * Math.cos(a) - B / 2
        const sel = selected.includes(n)
        const done = ordered.includes(n)
        return (
          <button key={n} type="button" disabled={disabled} onClick={() => onToggle(n)}
            aria-pressed={sel} aria-label={'Chair ' + n + (done ? ', already has an order' : '')}
            style={{ position:'absolute', left:x, top:y, width:B, height:B, borderRadius:'50%',
              border:(sel ? 3 : 2) + 'px solid ' + (sel ? MARI : done ? '#86EFAC' : '#D6CFE0'),
              background: sel ? MARI : '#fff', color: sel ? '#fff' : 'var(--ink)',
              fontSize:20, fontWeight:900, fontFamily:'Manrope', cursor: disabled ? 'default' : 'pointer',
              boxShadow: sel ? '0 4px 14px rgba(232,137,12,0.45)' : '0 2px 6px rgba(42,27,46,0.08)',
              transform: sel ? 'scale(1.06)' : 'none', transition:'transform 0.12s, background 0.12s',
              display:'flex', alignItems:'center', justifyContent:'center', padding:0 }}>
            {n}
            {done && (
              <span style={{ position:'absolute', top:-5, right:-5, width:22, height:22, borderRadius:'50%',
                background:GREEN, border:'2px solid #fff', color:'#fff', fontSize:12, fontWeight:900,
                display:'flex', alignItems:'center', justifyContent:'center', lineHeight:1 }}>{'✓'}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export default function ChairPicker({ eventData, captain, tableNumber, cart, isOnline, onClose, onSent, onNote }) {
  const count = Math.min(30, Math.max(1, parseInt(eventData?.chairs_per_table, 10) || 10))
  const [selected, setSelected] = useState([])
  const [ordered, setOrdered] = useState([])
  const [kitchens, setKitchens] = useState(null)       // null = not loaded yet
  const [cats, setCats] = useState([])
  const [fresh, setFresh] = useState({})               // menu item id -> { kitchen_id, category_id }
  const [noteFor, setNoteFor] = useState(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [kFail, setKFail] = useState(false)
  // A double tap must never send the order twice. State updates are not
  // synchronous, so the guard is a ref.
  const sendingRef = useRef(false)
  // One id per Send for the life of this sheet. If the reply is lost on a
  // slow network and the captain taps Send again, the server returns the
  // first order instead of making a second one (no double KOTs in kitchens).
  const clientRef = useRef('cp-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10))

  // Kitchens and routing, read fresh: the admin may have moved a category
  // to another kitchen since these dishes went into the cart.
  useEffect(() => {
    if (!eventData?.id) return
    let stop = false
    ;(async () => {
      try {
        const ids = cart.map(i => i.id)
        const [k, c, mi] = await Promise.all([
          supabase.from('kitchens').select('id, name, prefix, sort_order, is_default, is_active, created_at')
            .eq('event_id', eventData.id),
          supabase.from('menu_categories').select('id, kitchen_id').eq('event_id', eventData.id),
          ids.length
            ? supabase.from('menu_items').select('id, kitchen_id, category_id').in('id', ids)
            : Promise.resolve({ data: [] }),
        ])
        if (stop) return
        if (k.error) { setKitchens([]); setKFail(true) } else setKitchens(k.data || [])
        if (!c.error) setCats(c.data || [])
        if (!mi.error) {
          const m = {}
          ;(mi.data || []).forEach(r => { m[r.id] = r })
          setFresh(m)
        }
      } catch (e) { /* the summary falls back to what the cart already knows */ }
    })()
    return () => { stop = true }
  }, [eventData?.id])

  // Chairs that already have an order at this table. Kept moving, because
  // two captains can share a table and the other one may send while this
  // sheet is open.
  useEffect(() => {
    if (!eventData?.id || tableNumber == null) return
    let stop = false
    async function loadOrdered() {
      try {
        const { data } = await supabase.from('orders')
          .select('id, chairs, status, tables!inner(table_number)')
          .eq('event_id', eventData.id)
          .eq('tables.table_number', tableNumber)
          .neq('status', 'cancelled')
        if (stop) return
        const s = new Set()
        ;(data || []).forEach(o => (o.chairs || []).forEach(n => s.add(Number(n))))
        setOrdered([...s])
      } catch (e) { /* the next poll covers it */ }
    }
    loadOrdered()
    const t = setInterval(loadOrdered, 5000)
    return () => { stop = true; clearInterval(t) }
  }, [eventData?.id, tableNumber])

  function toggle(n) {
    setError('')
    setSelected(prev => prev.includes(n) ? prev.filter(x => x !== n) : [...prev, n])
  }
  const allOn = selected.length === count
  function toggleAll() {
    setError('')
    setSelected(allOn ? [] : Array.from({ length: count }, (_, i) => i + 1))
  }

  const plates = cart.reduce((s, i) => s + (i.quantity || 0), 0)
  const sortedChairs = [...selected].sort((a, b) => a - b)

  // Group the cart by kitchen exactly as the database will
  const resolve = kitchenResolver(kitchens || [], cats)
  const groupMap = new Map()
  cart.forEach(item => {
    const routed = { ...item, ...(fresh[item.id] ? { kitchen_id: fresh[item.id].kitchen_id, category_id: fresh[item.id].category_id } : {}) }
    const k = resolve(routed)
    const key = k ? k.id : 'none'
    if (!groupMap.has(key)) groupMap.set(key, { kitchen: k, rows: [] })
    groupMap.get(key).rows.push(item)
  })
  const groups = [...groupMap.values()].sort((a, b) =>
    (a.kitchen?.sort_order ?? 999) - (b.kitchen?.sort_order ?? 999) ||
    String(a.kitchen?.name || '').localeCompare(String(b.kitchen?.name || '')))
  const noKitchens = !kFail && Array.isArray(kitchens) && kitchens.filter(k => k.is_active !== false).length === 0
  const realGroups = groups.filter(g => g.kitchen)

  async function send() {
    if (sending || sendingRef.current) return
    if (!selected.length) { setError('Pick at least one chair, then send.'); return }
    if (!cart.length) { setError('The cart is empty. Add a dish first.'); return }
    sendingRef.current = true
    setSending(true); setError('')
    const t0 = Date.now()
    try {
      const { data, error: rpcErr } = await supabase.rpc('mk_place_order', {
        p_event_id: eventData.id,
        p_table_number: Number(tableNumber),
        p_captain_id: captain.id,
        p_chairs: sortedChairs,
        p_items: cart.map(i => ({
          menu_item_id: i.id,
          quantity: Math.max(1, parseInt(i.quantity, 10) || 1),
          note: String(i.note || '').trim() || null,
        })),
        p_client_ref: clientRef.current,
      })
      if (rpcErr) throw rpcErr
      const res = typeof data === 'string' ? JSON.parse(data) : data
      if (!res?.order_id) throw new Error('The server did not confirm the order.')
      onSent({ orderId: res.order_id, kots: Array.isArray(res.kots) ? res.kots : [],
        chairs: sortedChairs, sentAt: Math.round((t0 + Date.now()) / 2) })
    } catch (e) {
      setError(friendlySendError(e))
      sendingRef.current = false
      setSending(false)
    }
  }

  const ready = selected.length > 0 && cart.length > 0

  return (
    <div onClick={() => { if (!sending) onClose() }}
      style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:170 }}>
      <style>{`
        .mk-cp-sheet { position:absolute; left:0; right:0; bottom:0; background:#fff;
          border-radius:24px 24px 0 0; max-height:calc(100vh - 14px); max-height:calc(100dvh - 14px);
          display:flex; flex-direction:column; font-family:Manrope, sans-serif;
          box-shadow:0 -10px 40px rgba(0,0,0,0.28); }
        .mk-cp-body { flex:1; min-height:0; overflow-y:auto; display:flex; flex-direction:column;
          gap:18px; padding:6px 24px 14px; }
        .mk-cp-ring { display:flex; flex-direction:column; align-items:center; flex-shrink:0; }
        .mk-cp-sum { flex:1; min-width:0; }
        @media (min-aspect-ratio: 1/1) {
          .mk-cp-body { flex-direction:row; align-items:stretch; gap:30px; overflow:hidden; }
          .mk-cp-ring, .mk-cp-sum { overflow-y:auto; }
          .mk-cp-ring { justify-content:flex-start; padding-top:2px; }
        }
      `}</style>
      <div className="mk-cp-sheet" onClick={e => e.stopPropagation()}>
        <div style={{ width:40, height:4, background:'#E5E7EB', borderRadius:999, margin:'12px auto 10px', flexShrink:0 }} />

        <div style={{ display:'flex', alignItems:'flex-start', gap:14, padding:'0 24px 10px', flexShrink:0 }}>
          <div style={{ flex:1, minWidth:0 }}>
            <h3 style={{ fontSize:21, fontWeight:900, color:DARK, margin:0, lineHeight:1.25 }}>
              Which chairs is this order for? <span style={{ color:MARI }}>{'·'} Table {tableNumber}</span>
            </h3>
            <div style={{ fontSize:13.5, color:'#6B6B6B', fontWeight:600, marginTop:3 }}>
              Tap one or more chairs. The kitchen waiters bring the dishes to these chairs.
            </div>
          </div>
          <button type="button" onClick={() => { if (!sending) onClose() }} aria-label="Close"
            style={{ background:DARK, border:'none', borderRadius:999, width:40, height:40, fontSize:19,
              fontWeight:800, color:'#fff', cursor:'pointer', display:'flex', alignItems:'center',
              justifyContent:'center', flexShrink:0, boxShadow:'0 2px 8px rgba(0,0,0,0.25)' }}>{'✕'}</button>
        </div>

        <div className="mk-cp-body">
          <div className="mk-cp-ring">
            <ChairRing count={count} table={tableNumber} selected={selected} ordered={ordered}
              onToggle={toggle} disabled={sending} />
            <div style={{ display:'flex', gap:10, marginTop:12 }}>
              <button type="button" onClick={toggleAll} disabled={sending}
                style={{ background: allOn ? MARI : DARK, color:'#fff', border:'none', borderRadius:999,
                  padding:'12px 22px', fontSize:15, fontWeight:800, cursor:'pointer', minHeight:46,
                  fontFamily:'Manrope' }}>
                {allOn ? '✓ All chairs' : 'All chairs'}
              </button>
              <button type="button" onClick={() => { setSelected([]); setError('') }}
                disabled={sending || !selected.length}
                style={{ background:'#fff', color: selected.length ? '#333' : '#BBB',
                  border:'1.5px solid ' + (selected.length ? '#D1D5DB' : '#EEE'), borderRadius:999,
                  padding:'12px 22px', fontSize:15, fontWeight:700, minHeight:46, fontFamily:'Manrope',
                  cursor: selected.length ? 'pointer' : 'default' }}>
                Clear
              </button>
            </div>
            <div style={{ display:'flex', gap:16, marginTop:10, fontSize:12, color:'#6B6B6B', fontWeight:700 }}>
              <span style={{ display:'flex', alignItems:'center', gap:5 }}>
                <span style={{ width:12, height:12, borderRadius:999, background:MARI }} />Selected
              </span>
              <span style={{ display:'flex', alignItems:'center', gap:5 }}>
                <span style={{ width:15, height:15, borderRadius:999, background:GREEN, color:'#fff',
                  fontSize:9, fontWeight:900, display:'flex', alignItems:'center', justifyContent:'center' }}>{'✓'}</span>
                Already has an order
              </span>
            </div>
          </div>

          <div className="mk-cp-sum">
            <div style={{ fontSize:12, fontWeight:800, color:'#888', letterSpacing:'0.6px',
              textTransform:'uppercase', margin:'6px 0 10px' }}>
              Order summary {'·'} by kitchen
            </div>

            {kFail && (
              <div style={{ background:'#F3F4F6', border:'1px solid #E5E7EB', borderRadius:10, padding:'9px 13px',
                fontSize:13, color:'#4B5563', fontWeight:700, marginBottom:10, lineHeight:1.5 }}>
                Could not load the kitchen list. The order still goes to the right kitchens when you send it.
              </div>
            )}

            {noKitchens && (
              <div style={{ background:'#FFFBEB', border:'1px solid #FCD34D', borderRadius:10, padding:'9px 13px',
                fontSize:13, color:'#92400E', fontWeight:700, marginBottom:10, lineHeight:1.5 }}>
                No kitchens are set up for this event yet. Ask the operator before sending.
              </div>
            )}

            {groups.map(g => (
              <div key={g.kitchen?.id || 'none'} style={{ marginBottom:12, borderRadius:12, overflow:'hidden',
                border:'1px solid #ECECEC' }}>
                <div style={{ background:DARK, padding:'8px 14px', display:'flex', alignItems:'center',
                  justifyContent:'space-between', gap:10 }}>
                  <span style={{ fontWeight:900, fontSize:13, color:MARI, letterSpacing:'0.5px',
                    textTransform:'uppercase' }}>
                    {g.kitchen ? g.kitchen.name + ' kitchen' : (kitchens === null ? 'Loading kitchens…' : 'Kitchen')}
                  </span>
                  {g.kitchen && (
                    <span style={{ fontSize:11, color:'rgba(255,255,255,0.55)', fontWeight:700 }}>KOT prints here</span>
                  )}
                </div>
                {g.rows.map(item => {
                  const open = noteFor === item.id
                  return (
                    <div key={item.id} style={{ background:'#fff', borderTop:'1px solid #F3F3F3' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 14px', minHeight:44 }}>
                        <span style={{ fontWeight:700, fontSize:15, color:'#1A1A1A', flex:1, minWidth:0 }}>{item.name}</span>
                        <NoteBadge note={item.note} />
                        <span style={{ fontWeight:900, fontSize:16, color:DARK, flexShrink:0 }}>{'×'} {item.quantity}</span>
                        {onNote && (
                          <button type="button" onClick={() => setNoteFor(open ? null : item.id)} disabled={sending}
                            style={{ flexShrink:0, background: open ? DARK : '#fff', color: open ? '#fff' : '#555',
                              border:'1.5px solid ' + (open ? DARK : '#E5E7EB'), borderRadius:999,
                              padding:'6px 12px', fontSize:12, fontWeight:800, cursor:'pointer',
                              fontFamily:'Manrope', minHeight:34 }}>
                            {open ? 'Done' : (item.note ? 'Edit note' : '+ Note')}
                          </button>
                        )}
                      </div>
                      {open && (
                        <div style={{ padding:'0 14px 11px' }}>
                          <NoteChips note={item.note} disabled={sending} onChange={v => onNote(item.id, v)} />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>

        <div style={{ borderTop:'1px solid #F0F0F0', padding:'12px 24px calc(14px + env(safe-area-inset-bottom))',
          flexShrink:0, background:'#fff' }}>
          {isOnline === false && !error && (
            <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:10, padding:'8px 13px',
              fontSize:13, color:'#B91C1C', fontWeight:700, marginBottom:10 }}>
              {'\u{1F4F6}'} No connection - this order cannot go yet. The cart is safe.
            </div>
          )}
          {error && (
            <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:10, padding:'9px 13px',
              fontSize:13.5, color:'#DC2626', fontWeight:700, marginBottom:10, lineHeight:1.5 }}>
              {'⚠️'} {error}
            </div>
          )}
          <div style={{ display:'flex', alignItems:'center', gap:16 }}>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontWeight:900, fontSize:19, color: selected.length ? DARK : '#9CA3AF',
                whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                {selected.length ? chairsLabel(sortedChairs, count) : 'Tap a chair'}
                <span style={{ color:DARK }}> {'·'} {plates} {plates === 1 ? 'plate' : 'plates'}</span>
              </div>
              <div style={{ fontSize:13, color:'#6B6B6B', fontWeight:600, marginTop:1 }}>
                {realGroups.length === 1
                  ? 'One KOT prints in the ' + realGroups[0].kitchen.name + ' kitchen'
                  : realGroups.length > 1
                    ? 'One KOT prints in each of ' + realGroups.length + ' kitchens'
                    : ' '}
              </div>
            </div>
            <button type="button" onClick={send} disabled={!ready || sending}
              className={ready ? 'ss-cta' : ''}
              style={ready
                ? { borderRadius:14, padding:'16px 32px', fontSize:17, flexShrink:0, minHeight:56, fontFamily:'Manrope' }
                : { borderRadius:14, padding:'16px 32px', fontSize:17, fontWeight:900, flexShrink:0, minHeight:56,
                    background:'#E5E7EB', color:'#9CA3AF', border:'none', cursor:'not-allowed', fontFamily:'Manrope' }}>
              {sending ? 'Sending…' : 'Send to Kitchens →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
