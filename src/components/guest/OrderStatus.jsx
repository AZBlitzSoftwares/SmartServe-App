import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

function mapStatus(raw) {
  if (!raw) return 'placed'
  if (['pending','placed'].includes(raw)) return 'placed'
  if (['in_progress','in_preparation','ready'].includes(raw)) return 'on_the_way'
  if (raw === 'delivered') return 'delivered'
  if (raw === 'cancelled') return 'cancelled'
  return 'placed'
}

// Labels mirror the SOS "Request Received" screen: large icon above a
// black, bold, 20px title. No badge pill.
const STATUS_CONFIG = {
  placed:     { label:'Order Received',    icon:'📋', color:'#D97706', bg:'#FEF3C7' },
  on_the_way: { label:'Waiter On The Way', icon:'🏃', color:'#2563EB', bg:'#EFF6FF' },
  delivered:  { label:'Delivered',         icon:'✓',  color:'#16A34A', bg:'#DCFCE7' },
  cancelled:  { label:'Cancelled',         icon:'✕',  color:'#DC2626', bg:'#FEF2F2' },
}

// "8:15 PM" - the time on the guest's own tablet clock
const clock = ts => ts ? new Date(ts).toLocaleTimeString('en-IN', { hour:'numeric', minute:'2-digit', hour12:true }).toUpperCase() : ''
const mmss = sec => Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0')
const secsSince = (from, to) => Math.max(0, Math.floor(((to || Date.now()) - new Date(from).getTime()) / 1000))

// One shared 1 s tick for every running clock on the screen
function useNow(on) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [on])
  return now
}

/* The order's times on one small line: when it was ordered, a clock that runs
   while the guest waits, and once delivered the delivered time with the clock
   stopped at what they waited. */
function TimeLine({ order, now }) {
  const st = mapStatus(order?.status)
  const from = order?.created_at
  if (!from) return null
  const doneAt = st === 'delivered' ? order.delivered_at : null
  const base = { fontSize:12, fontWeight:700, color:'#555', fontVariantNumeric:'tabular-nums', whiteSpace:'nowrap' }
  if (st === 'cancelled') return <span data-testid="order-time" style={base}>Ordered {clock(from)}</span>
  if (st === 'delivered') return (
    <span data-testid="order-time" style={base}>
      Ordered {clock(from)} · <b style={{ color:'#15803D' }}>Delivered {clock(doneAt) || '✓'}</b>
      {doneAt && <> · ⏱ {mmss(secsSince(from, new Date(doneAt).getTime()))}</>}
    </span>
  )
  return (
    <span data-testid="order-time" style={base}>
      Ordered {clock(from)} · <b style={{ color:'#1A0A0A' }}>⏱ {mmss(secsSince(from, now))}</b>
    </span>
  )
}

function Modal({ children }) {
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.72)', zIndex:200,
      display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div style={{ width:'100%', maxWidth:370, background:'#fff', borderRadius:22,
        padding:'28px 24px 24px', boxShadow:'0 24px 60px rgba(0,0,0,0.35)', textAlign:'center' }}>
        {children}
      </div>
    </div>
  )
}

function OrderCard({ order, onCancel, now }) {
  const status = mapStatus(order?.status)
  const cfg    = STATUS_CONFIG[status] || STATUS_CONFIG.placed
  const statuses = status === 'cancelled'
    ? ['placed','cancelled']
    : ['placed','on_the_way','delivered']
  const currentIdx = statuses.indexOf(status)
  const orderId = order?.id ? '#' + String(order.id).slice(-6).toUpperCase() : '#------'
  const items = Array.isArray(order?.order_items) ? order.order_items : []

  return (
    <div style={{ background:'#fff', borderRadius:20, padding:'20px 18px 20px', marginBottom:14,
      boxShadow:'0 4px 16px rgba(0,0,0,0.08)', border:'2px solid ' + cfg.color + '33' }}>

      {/* Order reference and its times, one row */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:10,
        flexWrap:'wrap', marginBottom:14 }}>
        <span style={{ fontSize:13, fontWeight:700, color:'#888' }}>{orderId}</span>
        <TimeLine order={order} now={now} />
      </div>

      {/* ── Status headline — matches the SOS Request Received styling ── */}
      <div style={{ textAlign:'center', marginBottom:18 }}>
        <div style={{ fontSize:44, marginBottom:8 }}>{cfg.icon}</div>
        <div style={{ fontSize:20, fontWeight:800, color:'#1A0A0A', marginBottom:10 }}>
          {cfg.label}
        </div>
      </div>

      {/* Progress dots — unchanged */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', marginBottom:14 }}>
        {statuses.map((s, idx) => {
          const sCfg = STATUS_CONFIG[s] || STATUS_CONFIG.placed
          const done = idx < currentIdx, active = idx === currentIdx
          return (
            <div key={s} style={{ display:'flex', alignItems:'center' }}>
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
                <div style={{ width:32, height:32, borderRadius:'50%',
                  background: done?'#16A34A' : active?sCfg.color : '#E5E7EB',
                  border:'2px solid '+(done?'#16A34A':active?sCfg.color:'#D1D5DB'),
                  display:'flex', alignItems:'center', justifyContent:'center',
                  fontSize:13, color:done||active?'#fff':'#9CA3AF', fontWeight:900 }}>
                  {done ? '✓' : sCfg.icon}
                </div>
                <span style={{ fontSize:9, fontWeight:active?800:600,
                  color:active?'#1A0A0A':done?'#16A34A':'#9CA3AF',
                  maxWidth:62, textAlign:'center', lineHeight:1.25 }}>{sCfg.label}</span>
              </div>
              {idx < statuses.length-1 && (
                <div style={{ width:26, height:2, background:done?'#16A34A':'#E5E7EB',
                  margin:'0 5px 18px', transition:'background 0.3s' }} />
              )}
            </div>
          )
        })}
      </div>

      {status === 'cancelled' && order?.cancel_reason && (
        <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:10,
          padding:'8px 14px', fontSize:13, color:'#DC2626', fontWeight:600, marginBottom:10 }}>
          Reason: {order.cancel_reason}
        </div>
      )}

      {items.length > 0 && (
        <div style={{ borderTop:'1px solid #F0F0F0', paddingTop:10,
          marginBottom: status === 'placed' || status === 'on_the_way' ? 10 : 0 }}>
          {items.map((oi, i) => (
            <div key={i} style={{ display:'flex', justifyContent:'space-between',
              padding:'5px 0', fontSize:13 }}>
              <span style={{ fontWeight:600 }}>{oi?.menu_items?.name || 'Item'}</span>
              <span style={{ fontWeight:800, color:'#888' }}>x{oi?.quantity ?? 1}</span>
            </div>
          ))}
        </div>
      )}

      {/* Until it is delivered. Once a waiter is on the way the guest is told
          it may still arrive (see the confirm box). */}
      {(status === 'placed' || status === 'on_the_way') && (
        <button data-testid="cancel-order"
          onClick={() => onCancel(order)}
          style={{ width:'100%', marginTop:8, background:'transparent',
            border:'1.5px solid #FECACA', borderRadius:10, padding:'10px',
            fontSize:13, fontWeight:700, color:'#DC2626', cursor:'pointer' }}>
          ✕ Cancel Order
        </button>
      )}
    </div>
  )
}

/* A delivered or cancelled order: kept on Track for an hour as one small card,
   so the guest can still see when it came. */
function DoneCard({ order }) {
  const status = mapStatus(order?.status)
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.delivered
  const orderId = order?.id ? '#' + String(order.id).slice(-6).toUpperCase() : ''
  const items = Array.isArray(order?.order_items) ? order.order_items : []
  const names = items.map(oi => (oi?.menu_items?.name || 'Item') + ' ×' + (oi?.quantity ?? 1)).join(', ')
  return (
    <div data-testid="done-order" style={{ background:'#fff', borderRadius:14, padding:'10px 14px', marginBottom:10,
      borderLeft:'4px solid ' + cfg.color, boxShadow:'0 2px 8px rgba(0,0,0,0.05)' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:10, flexWrap:'wrap' }}>
        <span style={{ fontSize:13, fontWeight:800, color:cfg.color }}>
          {status === 'cancelled' ? '✕ Cancelled' : '✓ Delivered'} <span style={{ color:'#999', fontWeight:700 }}>{orderId}</span>
        </span>
        <TimeLine order={order} now={0} />
      </div>
      {names && <div style={{ fontSize:12, color:'#777', marginTop:3, overflow:'hidden', textOverflow:'ellipsis',
        whiteSpace:'nowrap' }}>{names}</div>}
    </div>
  )
}

function Header({ tableNumber, onBack }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:12, padding:'14px 16px',
      background:'#1A0A0A', position:'sticky', top:0, zIndex:50,
      boxShadow:'0 2px 12px rgba(0,0,0,0.35)' }}>
      <button onClick={onBack} style={{ background:'#E8890C', border:'none',
        borderRadius:10, padding:'11px 20px', fontSize:15, fontWeight:800, cursor:'pointer',
        color:'#fff', boxShadow:'0 3px 12px rgba(232,137,12,0.5)', flexShrink:0 }}>← Back</button>
      <h2 style={{ fontSize:17, fontWeight:800, color:'#fff', flex:1 }}>Track Orders</h2>
      <div style={{ background:'transparent', color:'#E8890C', fontSize:12, fontWeight:800,
        padding:'5px 12px', borderRadius:999, border:'1.5px solid #E8890C', flexShrink:0 }}>TABLE {tableNumber}</div>
    </div>
  )
}

export default function OrderStatus({ activeOrders, doneOrders, activeHelp, tableNumber, onBack }) {
  const orders = Array.isArray(activeOrders) ? activeOrders.filter(Boolean) : []
  const done   = Array.isArray(doneOrders)   ? doneOrders.filter(Boolean)   : []
  const help   = Array.isArray(activeHelp)   ? activeHelp.filter(Boolean)   : []
  const [confirm, setConfirm] = useState(null)       // the order in the Yes/No cancel box
  const [notice, setNotice] = useState(null)         // { title, text } - styled replacement for alert()
  const [busy, setBusy] = useState(false)
  const now = useNow(orders.length > 0)

  // A waiter already has it: the guest may still cancel, and is told it may arrive anyway
  const onWay = o => !!o?.waiter_id || mapStatus(o?.status) === 'on_the_way'

  async function reallyCancel(order) {
    setBusy(true)
    try {
      // One KOT per category: once part of the order has reached the table the
      // rest is the waiter's / desk's call (Cancel this KOT), not the guest's.
      // Asked every time: the screen can be a few seconds behind the desk.
      const { data: ks, error: kErr } = await supabase.from('kots')
        .select('status').eq('order_id', order.id).eq('kind', 'order')
      if (!kErr && (ks || []).some(k => k.status === 'delivered')) {
        setConfirm(null)
        setNotice({ title:'Part already served', text:'Part of this order has already reached your table. Please ask your waiter.' })
        return
      }
      const { data, error } = await supabase.from('orders')
        .update({ status: 'cancelled', cancel_reason: onWay(order) ? 'Cancelled by guest (waiter was on the way)' : 'Cancelled by guest' })
        .eq('id', order.id).in('status', ['pending', 'placed', 'in_progress'])
        .select('id')
      if (error) throw error
      setConfirm(null)
      // nothing changed: it was delivered (or cancelled) in the meantime
      if (!data?.length) {
        const { data: now } = await supabase.from('orders').select('status').eq('id', order.id).maybeSingle()
        setNotice(now?.status === 'cancelled'
          ? { title:'Already cancelled', text:'This order has already been cancelled.' }
          : { title:'Already delivered', text:'This order has already reached your table.' })
        return
      }
      if (onBack) onBack()
    } catch (e) {
      setConfirm(null)
      setNotice({ title:'Could not cancel', text:'Please try again, or ask your waiter.' })
    } finally {
      setBusy(false)
    }
  }

  const doneList = done.length > 0 && (
    <div style={{ marginTop: orders.length ? 4 : 0 }}>
      {done.map(o => <DoneCard key={o.id} order={o} />)}
    </div>
  )

  const body = orders.length === 0 ? (
    done.length > 0 ? (
      <div style={{ flex:1, padding:'16px 14px 40px' }}>
        {doneList}
        <button onClick={onBack} style={{ width:'100%', marginTop:6, background:'#1A0A0A',
          color:'#fff', border:'none', borderRadius:14, padding:'16px', fontSize:16,
          fontWeight:800, cursor:'pointer' }}>
          ← Back to Menu
        </button>
      </div>
    ) : (
    <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center',
      justifyContent:'center', padding:24, textAlign:'center' }}>
      <div style={{ fontSize:48, marginBottom:12 }}>🍽️</div>
      <div style={{ fontSize:18, fontWeight:800, marginBottom:8, color:'#1A0A0A' }}>No active orders</div>
      <div style={{ fontSize:14, color:'#888', marginBottom:24, lineHeight:1.6, maxWidth:300 }}>
        Your order was cancelled or delivered.<br/>Go back to menu to place a new order.
      </div>
      <button onClick={onBack} style={{ background:'#1A0A0A', color:'#fff', border:'none',
        borderRadius:14, padding:'16px 32px', fontSize:16, fontWeight:800, cursor:'pointer' }}>
        ← Back to Menu
      </button>
    </div>
  )) : (
    <div style={{ flex:1, padding:'16px 14px 40px' }}>
      <div style={{ fontSize:13, fontWeight:700, color:'#888', marginBottom:12, paddingLeft:4 }}>
        {orders.length} active {orders.length === 1 ? 'order' : 'orders'}
      </div>
      {orders.map(o => (
        <OrderCard key={o.id} order={o} now={now} onCancel={o => setConfirm(o)} />
      ))}
      {doneList}
      <button onClick={onBack} style={{ width:'100%', marginTop:6, background:'#1A0A0A',
        color:'#fff', border:'none', borderRadius:14, padding:'16px', fontSize:16,
        fontWeight:800, cursor:'pointer' }}>
        ← Back to Menu
      </button>
    </div>
  )

  return (
    <div style={{ minHeight:'100vh', background:'#F5F5F5', display:'flex', flexDirection:'column' }}>
      <Header tableNumber={tableNumber} onBack={onBack} />
      {help.length > 0 && (
        <div style={{ padding:'0 16px', marginTop:14 }}>
          {help.map(h => {
            const onWay = h.status === 'in_progress' || h.waiter_id
            return (
              <div key={h.id} style={{ background:'#fff', borderRadius:18, padding:'16px 18px',
                marginBottom:12, borderLeft:'5px solid ' + (onWay ? '#2563EB' : '#D97706'),
                boxShadow:'0 2px 10px rgba(0,0,0,0.06)' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
                  marginBottom:10 }}>
                  <span style={{ fontWeight:800, fontSize:15, color:'#1A0A0A' }}>🔔 Help Request</span>
                  <span style={{ fontSize:12, fontWeight:800, padding:'4px 11px', borderRadius:999,
                    background: onWay ? '#EFF6FF' : '#FEF3C7',
                    color: onWay ? '#2563EB' : '#D97706' }}>
                    {onWay ? 'Waiter On The Way' : 'Request Received'}
                  </span>
                </div>
                {(h.sos_request_items || []).map((li, i) => (
                  <div key={i} style={{ display:'flex', justifyContent:'space-between',
                    fontSize:14, padding:'4px 0', borderBottom:'1px solid #F0F0F0' }}>
                    <span style={{ fontWeight:600 }}>{li.item_name}</span>
                    <span style={{ color:'#888' }}>x{li.quantity}</span>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}
      {body}

      {confirm && (
        <Modal>
          <div style={{ fontSize:44, marginBottom:12 }}>{onWay(confirm) ? '🏃' : '🗑️'}</div>
          <div style={{ fontSize:20, fontWeight:800, color:'#1A0A0A', marginBottom: onWay(confirm) ? 8 : 24 }}>
            Cancel this order?
          </div>
          {onWay(confirm) && (
            <div data-testid="on-way-note" style={{ fontSize:14, color:'#666', lineHeight:1.5, marginBottom:22 }}>
              Waiter is already on the way.<br />If it still reaches you, please ignore it.
            </div>
          )}
          <div style={{ display:'flex', gap:12 }}>
            <button onClick={() => setConfirm(null)} disabled={busy}
              style={{ flex:1, background:'#F3F4F6', color:'#374151', border:'none',
                borderRadius:14, padding:'16px', fontSize:16, fontWeight:800, cursor:'pointer' }}>
              No
            </button>
            <button data-testid="cancel-yes" onClick={() => reallyCancel(confirm)} disabled={busy}
              style={{ flex:1, background: busy ? '#999' : '#DC2626', color:'#fff', border:'none',
                borderRadius:14, padding:'16px', fontSize:16, fontWeight:800,
                cursor: busy ? 'wait' : 'pointer' }}>
              {busy ? 'Please wait...' : 'Yes'}
            </button>
          </div>
        </Modal>
      )}

      {notice && (
        <Modal>
          <div style={{ fontSize:19, fontWeight:800, color:'#1A0A0A', marginBottom:10 }}>
            {notice.title}
          </div>
          <div style={{ fontSize:14, color:'#888', lineHeight:1.6, marginBottom:22 }}>{notice.text}</div>
          <button onClick={() => setNotice(null)}
            style={{ width:'100%', background:'#1A0A0A', color:'#fff', border:'none',
              borderRadius:14, padding:'16px', fontSize:16, fontWeight:800, cursor:'pointer' }}>
            OK
          </button>
        </Modal>
      )}
    </div>
  )
}
