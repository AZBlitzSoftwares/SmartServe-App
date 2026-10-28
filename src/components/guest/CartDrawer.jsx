import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { queueOrder, flushOrderQueue } from '../../lib/offlineQueue'
import { newOrderId, sendOrderWithRetry } from '../../lib/placeOrder'

function quickSignal(ms) {
  try { if (AbortSignal.timeout) return AbortSignal.timeout(ms) } catch { /* older browser */ }
  const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal
}
import { NoteChips } from './mkShared'

export default function CartDrawer({ cart, tableData, eventData, isOnline, onOrderPlaced, onRemove, onAdd, cartOpen, onCartOpenChange, captain, captainTable, onShowStatus, onOpenMenu, showTrack, onOpenChairs, onNote }) {
  const [open, setOpen] = useState(cartOpen || false)

  // Sync with parent
  useEffect(() => {
    if (typeof cartOpen === 'boolean') setOpen(cartOpen)
  }, [cartOpen])
  const [placing, setPlacing] = useState(false)
  const [showWait, setShowWait] = useState(false)
  // Place Order runs once at a time. Set synchronously on the first tap (a
  // state update is not seen by a second tap in the same moment), so tapping
  // again while the network is slow can never send a second copy.
  const busyRef = useRef(false)
  // The order's id, made once per cart and sent with every retry of it
  const orderIdRef = useRef(null)
  // a different cart, or the same cart for another table, is a different order
  const cartKey = (tableData?.id || 'cap-' + captainTable) + '|' + cart.map(i => i.id + 'x' + i.quantity + (i.note ? ':' + i.note : '')).join(',')
  useEffect(() => { if (!busyRef.current) orderIdRef.current = null }, [cartKey])
  const [slow, setSlow] = useState(false)

  // A captain now arrives here with a table already chosen - it is picked
  // before the menu opens, not after the cart is built. The old "which
  // table?" prompt is gone with it.
  const captainMode = !!captain

  // ss-multi-kitchen. A captain at a multi-kitchen event sends through the
  // chair picker, and a table there takes many orders (one per chair group),
  // so max_orders_per_table means nothing and is ignored entirely. Every
  // other tablet - guest or ordinary captain - never sees this flag.
  const multi = captainMode && !!eventData?.multi_kitchen

  // Order limit waiting screen - visible for 15 seconds, then the guest is
  // back on the menu. The cart is deliberately left untouched so they do not
  // have to pick their dishes again.
  useEffect(() => {
    if (!showWait) return
    const t = setTimeout(() => setShowWait(false), 15000)
    return () => clearTimeout(t)
  }, [showWait])
  const [error, setError] = useState('')
  const [activeOrderCount, setActiveOrderCount] = useState(0)
  const total = cart.reduce((s, i) => s + i.quantity, 0)

  // 0 = "No limit" (Control › Order limit); empty = the old default of 1
  const maxOrders = eventData?.max_orders_per_table ?? 1
  const orderLimitHit = !multi && maxOrders > 0 && activeOrderCount >= maxOrders
  // A captain's tablet keeps the grey "Table busy" (staff know what it means)
  const greyLimit = orderLimitHit && captainMode

  // Multi-kitchen: Place Order opens the chair picker instead of sending.
  function openChairs() {
    setError('')
    setOpen(false)
    onCartOpenChange?.(false)
    onOpenChairs?.()
  }

  /* Both paths watch the same thing - how many orders this table already has
     outstanding - they just identify the table differently. A guest tablet
     has a table row; a captain has only the number they picked on the grid.

     This is what lets a captain sit on a blocked table with a full cart and
     see it unlock the moment the supervisor marks the earlier order
     delivered, rather than having to guess and retry. */
  useEffect(() => {
    if (multi) return   // no "table busy" at a multi-kitchen event
    if (!eventData?.id) return
    if (!tableData?.id && !(captainMode && captainTable != null)) return
    checkActiveOrders()
    const key = tableData?.id || ('cap-' + captainTable)
    const sub = supabase.channel('cart-order-watch-' + key)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, () => checkActiveOrders())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, () => checkActiveOrders())
      .subscribe()
    const poll = setInterval(checkActiveOrders, 5000)
    return () => { supabase.removeChannel(sub); clearInterval(poll) }
  }, [tableData?.id, eventData?.id, captainTable, captainMode, multi])

  // Returns the count it saw, so a caller never acts on a stale screen value.
  // quickMs: give up after that long and use the screen's count (the database
  // checks the limit again when the order is saved).
  async function checkActiveOrders(quickMs) {
    if (!eventData?.id) return activeOrderCount
    const lim = q => quickMs ? q.abortSignal(quickSignal(quickMs)) : q
    if (tableData?.id) {
      const { data, error } = await lim(supabase.from('orders')
        .select('id').eq('table_id', tableData.id)
        .in('status', ['pending', 'placed', 'in_progress']))
      if (error) return activeOrderCount
      setActiveOrderCount(data?.length || 0)
      return data?.length || 0
    }
    if (captainMode && captainTable != null) {
      const { data, error } = await lim(supabase.from('orders')
        .select('id, tables!inner(table_number)')
        .eq('event_id', eventData.id)
        .eq('tables.table_number', captainTable)
        .in('status', ['pending', 'placed', 'in_progress']))
      if (error) return activeOrderCount
      setActiveOrderCount(data?.length || 0)
      return data?.length || 0
    }
    return activeOrderCount
  }

  const orderOf = (tableId) => {
    if (!orderIdRef.current) orderIdRef.current = newOrderId()
    return {
      id: orderIdRef.current, event_id: eventData.id, table_id: tableId,
      items: cart.map(i => ({ id: i.id, quantity: i.quantity, ...(i.note ? { note: i.note } : {}) })),
      captain_id: captainMode ? captain?.id : null,
    }
  }

  /* Captain path.

     Finds or creates the table row, then sends the order. The order limit is
     checked by the database in the same step that saves the order, so two
     captains at one table at the same moment cannot both pass it. */
  async function placeCaptainOrder() {
    const tableNum = captainTable
    if (tableNum == null) { setError('No table selected. Go back and pick one.'); return }
    if (!eventData?.id) { setError('No event loaded. Sign in again.'); return }

    try {
      const { data: existing, error: findErr } = await supabase.from('tables')
        .select('*').eq('event_id', eventData.id).eq('table_number', tableNum).order('created_at').limit(1)
      // never create the table again just because the look-up did not answer
      if (findErr) throw new Error('The network is slow - table ' + tableNum + ' could not be checked. Tap Place Order again.')
      let tableRecord = existing?.[0]
      if (!tableRecord) {
        const { data: made, error: mkErr } = await supabase.from('tables')
          .insert({ event_id: eventData.id, table_number: tableNum, is_active: true })
          .select().single()
        if (mkErr || !made) throw new Error('Could not open table ' + tableNum + '. Please try again.')
        tableRecord = made
      }

      // Deliberately NOT claimed_by_device. A captain's tablet is not sitting
      // on that table, and claiming it would put a phantom device on the
      // supervisor's Tables screen.

      let r
      try {
        r = await sendOrderWithRetry(orderOf(tableRecord.id), { onSlow: () => setSlow(true) })
      } catch {
        throw new Error('The network is slow and the order did not go through yet. Tap Place Order again - it will not be sent twice.')
      }
      if (!r?.ok && r?.reason === 'LIMIT') {
        setActiveOrderCount(r.live ?? r.limit ?? activeOrderCount)
        throw new Error('Table ' + tableNum + ' has reached its limit of ' + r.limit +
          ' order' + (r.limit === 1 ? '' : 's') + '. Your items are safe - send them once the current order is delivered.')
      }
      if (!r?.ok) throw new Error('Order failed (' + (r?.reason || 'error') + '). Please try again.')

      const id = r.order_id || orderIdRef.current
      orderIdRef.current = null
      setOpen(false)
      onCartOpenChange?.(false)
      onOrderPlaced(id, tableNum)
    } catch (e) {
      setError(e?.message || 'Order failed. Please try again.')
    }
  }

  async function placeOrder() {
    if (multi) { openChairs(); return }
    // first thing, before any wait: a second tap now does nothing
    if (busyRef.current) return
    busyRef.current = true
    setPlacing(true); setSlow(false); setError('')
    try {
      if (captainMode) { await placeCaptainOrder(); return }

      if (!tableData || !eventData) {
        setError('Table setup in progress... please try again in a moment'); return
      }
      const order = orderOf(tableData.id)
      if (isOnline === false) {
        await queueOrder(order)
        orderIdRef.current = null
        onOrderPlaced('offline-' + order.id); setOpen(false); return
      }
      // the screen's count can be a few seconds old: ask again, briefly (the database checks too)
      const live = await checkActiveOrders(3000)
      if (!multi && maxOrders > 0 && live >= maxOrders) { setShowWait(true); return }

      let r
      try {
        r = await sendOrderWithRetry(order, { onSlow: () => setSlow(true) })
      } catch {
        // No answer at all: kept on this tablet and sent by itself, with the
        // same id, as soon as the server answers - never twice.
        try {
          await queueOrder(order)
          orderIdRef.current = null
          flushOrderQueue()
          onOrderPlaced('offline-' + order.id); setOpen(false)
        } catch { setError('Order failed. Please call a waiter.') }
        return
      }
      if (!r?.ok && r?.reason === 'LIMIT') { setActiveOrderCount(r.live ?? maxOrders); setShowWait(true); return }
      if (!r?.ok) { setError('Order failed. Please try again or call a waiter.'); return }
      orderIdRef.current = null
      checkActiveOrders()
      onOrderPlaced(r.order_id || order.id); setOpen(false)
    } finally {
      busyRef.current = false
      setPlacing(false); setSlow(false)
    }
  }

  return (
    <>
      <style>{`
        @keyframes ssOrderNowFlash {
          0%, 100% { background: #E8890C; box-shadow: 0 3px 12px rgba(232,137,12,0.40); transform: scale(1); }
          50%      { background: #FFB03A; box-shadow: 0 5px 26px rgba(232,137,12,0.90); transform: scale(1.045); }
        }
        .ss-order-now { animation: ssOrderNowFlash 1s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .ss-order-now { animation: none; } }
      `}</style>

      {/* ONE bar, four buttons.

          Track and MENU used to sit in their own strip above this one, so the
          moment a dish was added the screen lost two rows to buttons - on a
          ten inch tablet that is most of a dish card. MenuScreen hides its
          strip whenever the cart has something in it and the two halves meet
          here instead.

          Order across the bar: View Cart on the left, Track and MENU in the
          middle, Place Order on the right. The two that finish something sit
          at the ends where the thumbs are; the two that go somewhere else sit
          between them. Inset from both edges, because buttons in the corners
          of a tablet are genuinely hard to find. */}
      <div style={{ position:'fixed', bottom:0, left:0, right:0, zIndex:55,
        background:'#fff', borderTop:'1px solid #ECECEC',
        boxShadow:'0 -6px 22px rgba(0,0,0,0.10)',
        padding:'11px 28px calc(11px + env(safe-area-inset-bottom))',
        display:'flex', alignItems:'center', gap:10, boxSizing:'border-box' }}>

        {/* A captain who is sure sends it straight from Place Order; one who
            wants to re-read the order opens the cart first. That choice is
            theirs, not ours. */}
        <button onClick={() => { setOpen(true); onCartOpenChange?.(true) }}
          style={{ flexShrink:0, background:'#FFF8EE', border:'2px solid #E8890C',
            borderRadius:13, padding:'12px 16px', display:'flex', alignItems:'center',
            gap:8, cursor:'pointer' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C06A00"
            strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
          </svg>
          <span style={{ color:'#C06A00', fontWeight:800, fontSize:15, whiteSpace:'nowrap' }}>Cart</span>
          <span style={{ background:'#E8890C', color:'#fff', borderRadius:999, minWidth:22,
            height:22, padding:'0 6px', display:'flex', alignItems:'center',
            justifyContent:'center', fontWeight:800, fontSize:13 }}>{total}</span>
        </button>

        <span style={{ flex:1 }} />

        {/* Adopted from MenuScreen's strip while the cart is open. Compact,
            because the two order buttons are what this bar is really for. */}
        {showTrack && onShowStatus && (
          <button onClick={onShowStatus} style={{ flexShrink:0,
            background:'#16A34A', color:'#fff', border:'none', borderRadius:999,
            padding:'11px 16px', fontSize:14, fontWeight:800, cursor:'pointer',
            display:'flex', alignItems:'center', gap:6 }}>
            📦 Track
          </button>
        )}

        {onOpenMenu && (
          <button onClick={onOpenMenu} style={{ flexShrink:0,
            background:'#1A0A0A', color:'#fff', border:'none', borderRadius:999,
            padding:'11px 16px', fontSize:14, fontWeight:800, cursor:'pointer',
            display:'flex', alignItems:'center', gap:7, letterSpacing:'0.5px' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
            MENU
          </button>
        )}

        <span style={{ flex:1 }} />

        {/* At the order limit it still reads Place Order (with a lock) and can be
            pressed: guests did not press a grey button, so never saw why. The
            press shows the "Please wait" box. */}
        <button data-testid="place-order-bar" className={placing || greyLimit ? '' : 'ss-order-now'}
          onClick={() => { if (orderLimitHit) { setShowWait(true) } else { placeOrder() } }}
          disabled={placing}
          style={{ flexShrink:0,
            background: placing ? '#B0741C' : greyLimit ? '#E5E7EB' : '#E8890C',
            color: greyLimit ? '#9CA3AF' : '#fff',
            border:'none', borderRadius:13, padding:'13px 22px',
            fontWeight:900, fontSize:16, whiteSpace:'nowrap',
            cursor: placing ? 'wait' : 'pointer' }}>
          {placing ? (slow ? 'Still sending…' : 'Sending…') : orderLimitHit ? (captainMode ? '🔒 Table busy' : '🔒 Place Order') : 'Place Order \u2192'}
        </button>
      </div>

      {showWait && (
        <div data-testid="limit-wait" style={{ position:'fixed', inset:0, zIndex:120, background:'rgba(26,10,10,0.72)',
          display:'flex', alignItems:'center', justifyContent:'center', padding:22 }}>
          <div style={{ background:'#FFF1F2', border:'3px solid #FDA4AF', borderRadius:24,
            padding:'32px 26px 28px', maxWidth:400, width:'100%', textAlign:'center',
            boxShadow:'0 20px 60px rgba(0,0,0,0.45)' }}>
            <div style={{ fontSize:52, marginBottom:12, lineHeight:1 }}>⏳</div>
            <div style={{ fontWeight:900, fontSize:30, color:'#BE123C', marginBottom:12,
              letterSpacing:'1px' }}>PLEASE WAIT</div>
            <div style={{ fontSize:17, color:'#9F1239', lineHeight:1.6, fontWeight:600,
              marginBottom:24 }}>
              {captainMode
                ? 'Table ' + (captainTable ?? '') + ' already has an order being prepared. Your items are safe here.'
                : 'Your current order is being prepared'}
            </div>
            <button onClick={() => setShowWait(false)}
              style={{ background:'#1A0A0A', color:'#E8890C', border:'none', borderRadius:14,
                padding:'14px 30px', fontSize:15, fontWeight:900, cursor:'pointer',
                display:'inline-flex', alignItems:'center', gap:8 }}>
              🍽️ Back to Menu
            </button>
          </div>
        </div>
      )}

      {open && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:60 }} onClick={() => { setOpen(false); onCartOpenChange?.(false) }}>
          <div onClick={e => e.stopPropagation()} style={{ position:'absolute', bottom:0, left:0, right:0, background:'#fff', borderRadius:'24px 24px 0 0', padding:'24px 20px 36px', maxHeight:'80vh', overflowY:'auto' }}>
            <div style={{ width:40, height:4, background:'#E5E7EB', borderRadius:999, margin:'0 auto 20px' }} />
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
              <h3 style={{ fontSize:20, fontWeight:800 }}>
                Your Order{captainMode && captainTable != null ? ' \u00B7 Table ' + captainTable : ''}
              </h3>
              <button onClick={() => { setOpen(false); onCartOpenChange?.(false) }} style={{ background:'#1A0A0A', border:'none', borderRadius:999, width:40, height:40, fontSize:19, fontWeight:800, color:'#fff', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, boxShadow:'0 2px 8px rgba(0,0,0,0.25)' }}>✕</button>
            </div>

            {/* ss-multi-kitchen: same row, plus one-tap notes for the kitchen
                (Jain, no onion-garlic...). The note rides on the cart line, so it
                is saved with the table's held cart and printed on the KOT. */}
            {multi && cart.map(item => (
              <div key={item.id} style={{ padding:'12px 0', borderBottom:'1px solid #F0F0F0' }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                  <div style={{ fontWeight:700, fontSize:15, flex:1 }}>{item.name}</div>
                  <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                    <button onClick={() => onRemove(item.id)} style={{ width:36, height:36, borderRadius:'50%', background:'#F5F5F5', border:'1.5px solid #E5E7EB', fontSize:18, display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, cursor:'pointer' }}>−</button>
                    <span style={{ fontWeight:800, fontSize:16, minWidth:20, textAlign:'center' }}>{item.quantity}</span>
                    <button onClick={() => onAdd(item)} style={{ width:36, height:36, borderRadius:'50%', background:'#1A0A0A', border:'none', color:'#fff', fontSize:18, display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, cursor:'pointer' }}>+</button>
                  </div>
                </div>
                {onNote && (
                  <div style={{ marginTop:8 }}>
                    <NoteChips note={item.note} onChange={v => onNote(item.id, v)} />
                  </div>
                )}
              </div>
            ))}

            {!multi && cart.map(item => (
              <div key={item.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 0', borderBottom:'1px solid #F0F0F0' }}>
                <div style={{ fontWeight:700, fontSize:15, flex:1 }}>{item.name}</div>
                <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                  <button onClick={() => onRemove(item.id)} style={{ width:28, height:28, borderRadius:'50%', background:'#F5F5F5', border:'1.5px solid #E5E7EB', fontSize:16, display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, cursor:'pointer' }}>−</button>
                  <span style={{ fontWeight:800, fontSize:16, minWidth:20, textAlign:'center' }}>{item.quantity}</span>
                  <button onClick={() => onAdd(item)} style={{ width:28, height:28, borderRadius:'50%', background:'#1A0A0A', border:'none', color:'#fff', fontSize:16, display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, cursor:'pointer' }}>+</button>
                </div>
              </div>
            ))}

            <div style={{ marginTop:20, display:'flex', justifyContent:'space-between', fontSize:16, fontWeight:700, marginBottom:16 }}>
              <span>{multi ? 'Total plates' : 'Total items'}</span><span>{total}</span>
            </div>

            {isOnline === false && !captainMode && (
              <div style={{ background:'#FEF3C7', border:'1px solid #FCD34D', borderRadius:10, padding:'10px 14px', fontSize:13, color:'#92400E', marginBottom:12, fontWeight:600 }}>
                📶 Offline — order will sync when connected
              </div>
            )}

            {isOnline === false && captainMode && (
              <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:10, padding:'10px 14px', fontSize:13, color:'#B91C1C', marginBottom:12, fontWeight:600 }}>
                📶 No connection — this order cannot be sent yet. The cart is safe; try again once you have signal.
              </div>
            )}

            {orderLimitHit && (
              <div style={{ background:'#FFF1F2', border:'2px solid #FDA4AF', borderRadius:16, padding:'22px 18px', marginBottom:12, textAlign:'center' }}>
                <div style={{ fontSize:36, marginBottom:10 }}>⏳</div>
                <div style={{ fontWeight:900, fontSize:26, color:'#BE123C', marginBottom:8, letterSpacing:'0.5px' }}>PLEASE WAIT</div>
                <div style={{ fontSize:16, color:'#9F1239', lineHeight:1.6, marginBottom:16, fontWeight:500 }}>
                  {captainMode
                    ? 'Table ' + (captainTable ?? '') + ' already has an order being prepared. These items stay here until it is delivered.'
                    : 'Your current order is being prepared'}
                </div>
                <button onClick={() => setOpen(false)}
                  style={{ background:'#1A0A0A', color:'#E8890C', border:'none', borderRadius:12, padding:'11px 20px', fontSize:14, fontWeight:800, cursor:'pointer', display:'inline-flex', alignItems:'center', gap:6 }}>
                  🍽️ Browse Menu
                </button>
              </div>
            )}

            {error && (
              <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:10, padding:'10px 14px', fontSize:13, color:'#DC2626', marginBottom:12, fontWeight:600, lineHeight:1.5 }}>
                ⚠️ {error}
              </div>
            )}

            <button data-testid="place-order-sheet" onClick={() => { if (orderLimitHit) { setOpen(false); onCartOpenChange?.(false); setShowWait(true) } else { placeOrder() } }}
              disabled={placing}
              className={!placing && !greyLimit ? 'ss-order-now' : ''}
              style={{ width:'100%', background: placing ? '#999' : greyLimit ? '#E5E7EB' : '#E8890C', color: greyLimit ? '#9CA3AF' : '#fff', border:'none', borderRadius:14, padding:'18px', fontSize:17, fontWeight:900, cursor: placing ? 'not-allowed' : 'pointer', transition:'all 0.2s', display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
              {placing
                ? (slow ? '⏳ Still sending… please wait' : '⏳ Sending order…')
                : orderLimitHit
                  ? (captainMode ? '🔒 Please Wait' : '🔒 Place Order')
                  : captainMode
                    ? '✓ Place Order · Table ' + (captainTable ?? '')
                    : '✓ Place Order'}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
