import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

/* Track and cancel, captain side.

   Shows every order at the event, not only the ones this captain took.
   A guest at table 12 asks whichever captain is standing there to cancel,
   and that is very often not the person who wrote the order down - making
   this own-orders-only would mean finding the right captain across a hall
   mid-service. The captain's name is on each row instead, so the record
   still says who took it.

   Grouped by table because that is how the question always arrives:
   "table 12 wants to cancel", never "order #4F2A1C wants to cancel".

   Cancelling is only offered before a waiter is assigned. After that the
   food is already moving and the supervisor has to make the call - the
   same rule the guest app has always used. */

const STATUS = {
  placed:     { label:'Order Received',    color:'#D97706', bg:'#FEF3C7', icon:'\u{1F4CB}' },
  on_the_way: { label:'Waiter On The Way', color:'#2563EB', bg:'#EFF6FF', icon:'\u{1F3C3}' },
  delivered:  { label:'Delivered',         color:'#16A34A', bg:'#DCFCE7', icon:'\u2713' },
  cancelled:  { label:'Cancelled',         color:'#DC2626', bg:'#FEF2F2', icon:'\u2715' },
}

function mapStatus(raw) {
  if (['pending','placed'].includes(raw)) return 'placed'
  if (['in_progress','in_preparation','ready'].includes(raw)) return 'on_the_way'
  if (raw === 'delivered') return 'delivered'
  if (raw === 'cancelled') return 'cancelled'
  return 'placed'
}

export default function CaptainOrders({ eventData, captain, onClose }) {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('active')
  const [confirmId, setConfirmId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [eventData?.id])

  async function load() {
    if (!eventData?.id) { setLoading(false); return }
    try {
      const { data } = await supabase.from('orders')
        .select('*, tables(table_number), waiters(name), captains(name), order_items(quantity, menu_items(name))')
        .eq('event_id', eventData.id)
        .order('created_at', { ascending: false })
      setOrders(data || [])
    } catch (e) { /* the next poll will catch it */ }
    setLoading(false)
  }

  async function reallyCancel(orderId) {
    setBusy(true)
    try {
      // Re-read rather than trusting the list: the supervisor may have
      // assigned a waiter in the seconds since this screen last polled.
      const { data } = await supabase.from('orders')
        .select('waiter_id, status').eq('id', orderId).single()
      if (data?.waiter_id || !['pending','placed'].includes(data?.status)) {
        setConfirmId(null)
        setNotice('A waiter has already been assigned to this order, so it can no longer be cancelled here. Please tell the supervisor.')
        setBusy(false)
        return
      }
      await supabase.from('orders')
        .update({ status:'cancelled', cancel_reason:'Cancelled by captain ' + (captain?.name || '') })
        .eq('id', orderId)
      setConfirmId(null)
      load()
    } catch (e) {
      setConfirmId(null)
      setNotice('Could not cancel right now. Please tell the supervisor.')
    }
    setBusy(false)
  }

  const shown = orders.filter(o => {
    const s = mapStatus(o.status)
    if (filter === 'active')    return s === 'placed' || s === 'on_the_way'
    if (filter === 'delivered') return s === 'delivered'
    return true
  })

  // Grouped by table, tables in numeric order, newest order first inside each
  const byTable = {}
  shown.forEach(o => {
    const t = o.tables?.table_number ?? '?'
    if (!byTable[t]) byTable[t] = []
    byTable[t].push(o)
  })
  const tables = Object.keys(byTable).sort((a, b) => Number(a) - Number(b))

  const activeCount = orders.filter(o => ['placed','on_the_way'].includes(mapStatus(o.status))).length

  return (
    <div style={{ position:'fixed', inset:0, background:'#F5F5F5', zIndex:120,
      display:'flex', flexDirection:'column' }}>

      <div style={{ display:'flex', alignItems:'center', gap:12, padding:'14px 16px',
        background:'#1A0A0A', flexShrink:0, boxShadow:'0 2px 12px rgba(0,0,0,0.35)' }}>
        <button onClick={onClose} style={{ background:'#E8890C', border:'none',
          borderRadius:10, padding:'11px 20px', fontSize:15, fontWeight:800, cursor:'pointer',
          color:'#fff', flexShrink:0 }}>← Back</button>
        <h2 style={{ fontSize:17, fontWeight:800, color:'#fff', flex:1 }}>Track Orders</h2>
        <div style={{ color:'#E8890C', fontSize:12, fontWeight:800, padding:'5px 12px',
          borderRadius:999, border:'1.5px solid #E8890C', flexShrink:0 }}>
          {activeCount} live
        </div>
      </div>

      <div style={{ display:'flex', gap:8, padding:'12px 14px', background:'#fff',
        borderBottom:'1px solid #eee', flexShrink:0 }}>
        {[['active','Active'],['delivered','Delivered'],['all','All']].map(([v,label]) => (
          <button key={v} onClick={() => setFilter(v)}
            style={{ flex:1, padding:'9px 4px', borderRadius:10, fontSize:14, fontWeight:800,
              cursor:'pointer', border:'1.5px solid',
              background: filter===v ? '#1A0A0A' : '#fff',
              color: filter===v ? '#fff' : '#1A0A0A',
              borderColor: filter===v ? '#1A0A0A' : '#E5E7EB' }}>{label}</button>
        ))}
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'14px 14px 40px' }}>
        {loading ? (
          <div style={{ textAlign:'center', padding:50, color:'#888' }}>Loading…</div>
        ) : tables.length === 0 ? (
          <div style={{ textAlign:'center', padding:'50px 20px' }}>
            <div style={{ fontSize:48, marginBottom:12 }}>🍽️</div>
            <div style={{ fontSize:17, fontWeight:800, marginBottom:6 }}>Nothing here</div>
            <div style={{ fontSize:14, color:'#888' }}>
              {filter === 'active' ? 'No orders are waiting right now.' : 'No orders to show.'}
            </div>
          </div>
        ) : tables.map(t => (
          <div key={t} style={{ marginBottom:18 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8,
              paddingLeft:2 }}>
              <span style={{ background:'#1A0A0A', color:'#E8890C', borderRadius:8,
                padding:'4px 12px', fontSize:15, fontWeight:900 }}>TABLE {t}</span>
              <span style={{ fontSize:12, color:'#888', fontWeight:700 }}>
                {byTable[t].length} {byTable[t].length === 1 ? 'order' : 'orders'}
              </span>
            </div>

            {byTable[t].map(o => {
              const s = mapStatus(o.status)
              const cfg = STATUS[s]
              const canCancel = !o.waiter_id && ['pending','placed'].includes(o.status)
              const items = o.order_items || []
              return (
                <div key={o.id} style={{ background:'#fff', borderRadius:14, padding:'12px 14px',
                  marginBottom:8, borderLeft:'4px solid ' + cfg.color,
                  boxShadow:'0 2px 8px rgba(0,0,0,0.06)' }}>

                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8,
                    flexWrap:'wrap' }}>
                    <span style={{ background:cfg.bg, color:cfg.color, borderRadius:999,
                      padding:'3px 11px', fontSize:12, fontWeight:800 }}>
                      {cfg.icon} {cfg.label}
                    </span>
                    <span style={{ fontSize:12, color:'#888', fontWeight:600 }}>
                      {new Date(o.created_at).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}
                    </span>
                    <span style={{ flex:1 }} />
                    {o.captains?.name && (
                      <span style={{ fontSize:11, color:'#2563EB', fontWeight:800,
                        background:'#EFF6FF', borderRadius:999, padding:'2px 9px' }}>
                        🧑 {o.captains.name}
                      </span>
                    )}
                  </div>

                  {items.map((oi, i) => (
                    <div key={i} style={{ display:'flex', justifyContent:'space-between',
                      fontSize:13, padding:'3px 0' }}>
                      <span style={{ fontWeight:600 }}>{oi.menu_items?.name || 'Item'}</span>
                      <span style={{ color:'#888', fontWeight:700 }}>x{oi.quantity}</span>
                    </div>
                  ))}

                  {o.waiters?.name && (
                    <div style={{ fontSize:12, color:'#2563EB', fontWeight:700, marginTop:6 }}>
                      Waiter {o.waiters.name} is delivering
                    </div>
                  )}

                  {canCancel && (
                    <button onClick={() => setConfirmId(o.id)}
                      style={{ width:'100%', marginTop:10, background:'transparent',
                        border:'1.5px solid #FECACA', borderRadius:10, padding:'10px',
                        fontSize:13, fontWeight:800, color:'#DC2626', cursor:'pointer' }}>
                      ✕ Cancel this order
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {confirmId && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.72)', zIndex:200,
          display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div style={{ width:'100%', maxWidth:370, background:'#fff', borderRadius:22,
            padding:'28px 24px 24px', textAlign:'center' }}>
            <div style={{ fontSize:44, marginBottom:12 }}>🗑️</div>
            <div style={{ fontSize:20, fontWeight:800, marginBottom:22 }}>Cancel this order?</div>
            <div style={{ display:'flex', gap:12 }}>
              <button onClick={() => setConfirmId(null)} disabled={busy}
                style={{ flex:1, background:'#F3F4F6', color:'#374151', border:'none',
                  borderRadius:14, padding:'16px', fontSize:16, fontWeight:800, cursor:'pointer' }}>
                No
              </button>
              <button onClick={() => reallyCancel(confirmId)} disabled={busy}
                style={{ flex:1, background: busy ? '#999' : '#DC2626', color:'#fff', border:'none',
                  borderRadius:14, padding:'16px', fontSize:16, fontWeight:800,
                  cursor: busy ? 'wait' : 'pointer' }}>
                {busy ? 'Please wait…' : 'Yes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {notice && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.72)', zIndex:200,
          display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div style={{ width:'100%', maxWidth:370, background:'#fff', borderRadius:22,
            padding:'28px 24px 24px', textAlign:'center' }}>
            <div style={{ fontSize:44, marginBottom:12 }}>🏃</div>
            <div style={{ fontSize:19, fontWeight:800, marginBottom:10 }}>Already on the way</div>
            <div style={{ fontSize:14, color:'#888', lineHeight:1.6, marginBottom:22 }}>{notice}</div>
            <button onClick={() => { setNotice(''); load() }}
              style={{ width:'100%', background:'#1A0A0A', color:'#fff', border:'none',
                borderRadius:14, padding:'16px', fontSize:16, fontWeight:800, cursor:'pointer' }}>
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
