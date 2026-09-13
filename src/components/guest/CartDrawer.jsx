import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { queueOrder } from '../../lib/offlineQueue'

export default function CartDrawer({ cart, tableData, eventData, isOnline, onOrderPlaced, onRemove, onAdd, cartOpen, onCartOpenChange, captain, captainTable, onShowStatus, onOpenMenu, showTrack }) {
  const [open, setOpen] = useState(cartOpen || false)

  // Sync with parent
  useEffect(() => {
    if (typeof cartOpen === 'boolean') setOpen(cartOpen)
  }, [cartOpen])
  const [placing, setPlacing] = useState(false)
  const [showWait, setShowWait] = useState(false)

  // A captain now arrives here with a table already chosen - it is picked
  // before the menu opens, not after the cart is built. The old "which
  // table?" prompt is gone with it.
  const captainMode = !!captain

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

  const maxOrders = eventData?.max_orders_per_table || 1
  const orderLimitHit = activeOrderCount >= maxOrders

  /* Both paths watch the same thing - how many orders this table already has
     outstanding - they just identify the table differently. A guest tablet
     has a table row; a captain has only the number they picked on the grid.

     This is what lets a captain sit on a blocked table with a full cart and
     see it unlock the moment the supervisor marks the earlier order
     delivered, rather than having to guess and retry. */
  useEffect(() => {
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
  }, [tableData?.id, eventData?.id, captainTable, captainMode])

  async function checkActiveOrders() {
    if (!eventData?.id) return
    if (tableData?.id) {
      const { data } = await supabase.from('orders')
        .select('id').eq('table_id', tableData.id)
        .in('status', ['pending', 'placed', 'in_progress'])
      setActiveOrderCount(data?.length || 0)
      return
    }
    if (captainMode && captainTable != null) {
      const { data } = await supabase.from('orders')
        .select('id, tables!inner(table_number)')
        .eq('event_id', eventData.id)
        .eq('tables.table_number', captainTable)
        .in('status', ['pending', 'placed', 'in_progress'])
      setActiveOrderCount(data?.length || 0)
    }
  }

  /* Captain path.

     Finds or creates the table row, re-checks the limit against the
     database, then writes the order. The re-check matters: the grid said
     green when this captain walked over, and with five captains on the
     floor another one may have filled it since. */
  async function placeCaptainOrder() {
    const tableNum = captainTable
    if (tableNum == null) { setError('No table selected. Go back and pick one.'); return }
    if (!eventData?.id) { setError('No event loaded. Sign in again.'); return }

    setPlacing(true); setError('')
    try {
      const { data: existing } = await supabase.from('tables')
        .select('*').eq('event_id', eventData.id).eq('table_number', tableNum).limit(1)
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

      const limit = eventData?.max_orders_per_table || 0
      if (limit > 0) {
        const { data: live } = await supabase.from('orders')
          .select('id').eq('table_id', tableRecord.id)
          .in('status', ['pending', 'placed', 'in_progress'])
        if ((live?.length || 0) >= limit) {
          setActiveOrderCount(live?.length || 0)
          throw new Error('Table ' + tableNum + ' has reached its limit of ' + limit +
            ' order' + (limit === 1 ? '' : 's') + '. Your items are safe - send them once the current order is delivered.')
        }
      }

      const { data: order, error: orderError } = await supabase.from('orders').insert({
        event_id: eventData.id,
        table_id: tableRecord.id,
        status: 'pending',
        captain_id: captain.id
      }).select().single()
      if (orderError || !order) throw new Error('Order failed. Please try again.')

      const { error: itemsError } = await supabase.from('order_items')
        .insert(cart.map(i => ({ order_id: order.id, menu_item_id: i.id, quantity: i.quantity })))
      if (itemsError) throw new Error('The order was created but its items did not save. Tell the supervisor before re-sending.')

      setOpen(false)
      onCartOpenChange?.(false)
      onOrderPlaced(order.id, tableNum)
    } catch (e) {
      setError(e?.message || 'Order failed. Please try again.')
    } finally {
      setPlacing(false)
    }
  }

  async function placeOrder() {
    setError('')
    if (placing) return

    await checkActiveOrders()
    if (orderLimitHit) { setShowWait(true); return }

    if (captainMode) { placeCaptainOrder(); return }

    if (isOnline === false) {
      if (eventData && tableData) await queueOrder({ event_id: eventData.id, table_id: tableData.id, items: cart })
      onOrderPlaced('offline-' + Date.now()); setOpen(false); return
    }

    if (!tableData || !eventData) {
      setError('Table setup in progress... please try again in a moment'); return
    }

    setPlacing(true)
    try {
      const { data: order, error: orderError } = await supabase
        .from('orders').insert({ event_id: eventData.id, table_id: tableData.id, status: 'pending' }).select().single()
      if (orderError) throw orderError
      const { error: itemsError } = await supabase.from('order_items')
        .insert(cart.map(i => ({ order_id: order.id, menu_item_id: i.id, quantity: i.quantity })))
      if (itemsError) throw itemsError
      await checkActiveOrders()
      onOrderPlaced(order.id); setOpen(false)
    } catch(e) {
      try {
        await queueOrder({ event_id: eventData.id, table_id: tableData.id, items: cart })
        onOrderPlaced('offline-' + Date.now()); setOpen(false)
      } catch(e2) { setError('Order failed. Please call a waiter.') }
    } finally { setPlacing(false) }
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

        <button className={placing || orderLimitHit ? '' : 'ss-order-now'}
          onClick={() => { if (orderLimitHit) { setShowWait(true) } else { placeOrder() } }}
          disabled={placing}
          style={{ flexShrink:0,
            background: placing ? '#B0741C' : orderLimitHit ? '#E5E7EB' : '#E8890C',
            color: orderLimitHit ? '#9CA3AF' : '#fff',
            border:'none', borderRadius:13, padding:'13px 22px',
            fontWeight:900, fontSize:16, whiteSpace:'nowrap',
            cursor: placing ? 'wait' : 'pointer' }}>
          {placing ? 'Placing...' : orderLimitHit ? '🔒 Table busy' : 'Place Order \u2192'}
        </button>
      </div>

      {showWait && (
        <div style={{ position:'fixed', inset:0, zIndex:120, background:'rgba(26,10,10,0.72)',
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

            {cart.map(item => (
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
              <span>Total items</span><span>{total}</span>
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

            <button onClick={placeOrder} disabled={placing || orderLimitHit}
              className={!placing && !orderLimitHit ? 'ss-order-now' : ''}
              style={{ width:'100%', background: placing ? '#999' : orderLimitHit ? '#E5E7EB' : '#E8890C', color: orderLimitHit ? '#9CA3AF' : '#fff', border:'none', borderRadius:14, padding:'18px', fontSize:17, fontWeight:900, cursor: placing || orderLimitHit ? 'not-allowed' : 'pointer', transition:'all 0.2s', display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
              {placing
                ? '⏳ Placing Order...'
                : orderLimitHit
                  ? '🔒 Please Wait'
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
