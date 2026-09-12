import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

/* Track and cancel, captain side.

   Opens on this captain's own orders. A forty table event with six
   captains puts sixty rows on the screen, and a list that long stops being
   read at all - the captain scrolls past their own table looking for it.

   The room is reachable on demand instead, through the table lookup at the
   top. A guest stops a captain who did not take their order and asks where
   it is; tapping that table number answers it in one step, with the same
   detail - items, status, which waiter is carrying it - so the captain can
   say "waiter 07 is on the way" rather than "let me find out".

   Cancelling stays with the captain who took the order. Anyone can SEE any
   table, but only the person who wrote an order down can cancel it,
   because only they know what the guest actually asked for. Another
   captain's row names its owner instead, so the answer is "Amir took that
   one, I will tell him" rather than a cancellation made on a guess.

   Rows are compact with the detail behind a tap - the same shape the
   supervisor's KOT board uses. What stays on the collapsed row is what
   gets scanned: table, time, item count, status, waiter number, owner.  */

const STATUS = {
  placed:     { label:'Received',  color:'#D97706', bg:'#FEF3C7' },
  on_the_way: { label:'On the way',color:'#2563EB', bg:'#EFF6FF' },
  delivered:  { label:'Delivered', color:'#16A34A', bg:'#DCFCE7' },
  cancelled:  { label:'Cancelled', color:'#DC2626', bg:'#FEF2F2' },
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
  // null = my own orders. A number = every order at that table, whoever
  // took it. This is the whole of the "scope" concept; there is no third
  // state, because "everyone's orders" as a browsable list is the thing
  // that made this screen unreadable.
  const [tableView, setTableView] = useState(null)
  const [typed, setTyped] = useState('')
  const [openRow, setOpenRow] = useState(null)
  const [confirmId, setConfirmId] = useState(null)
  const [busy, setBusy] = useState(false)
  // { icon, title, text } - the modal had one hardcoded heading, which
  // was wrong the moment there was a second reason to show it.
  const [notice, setNotice] = useState(null)

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
        .select('waiter_id, status, captain_id, captains(name)').eq('id', orderId).single()
      // The button is already hidden on another captain's order; this is the
      // same rule enforced where it actually matters, in case a row goes
      // stale between the poll and the tap.
      if (data && data.captain_id !== captain?.id) {
        setConfirmId(null)
        setNotice({ icon:'\u{1F9D1}', title:'Not your order',
          text:'This order was taken by captain ' + (data.captains?.name || 'someone else') +
            '. Please ask them or the supervisor to cancel it.' })
        setBusy(false)
        return
      }
      if (data?.waiter_id || !['pending','placed'].includes(data?.status)) {
        setConfirmId(null)
        setNotice({ icon:'\u{1F3C3}', title:'Already on the way',
          text:'A waiter has already been assigned to this order, so it can no longer be cancelled here. Please tell the supervisor.' })
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
      setNotice({ icon:'\u26A0\uFE0F', title:'Could not cancel',
        text:'Something went wrong. Please tell the supervisor.' })
    }
    setBusy(false)
  }

  const mine = o => o.captain_id === captain?.id

  const shown = orders.filter(o => {
    const s = mapStatus(o.status)
    if (filter === 'active'    && !(s === 'placed' || s === 'on_the_way')) return false
    if (filter === 'delivered' && s !== 'delivered') return false
    // Scope last, so the Active/Delivered/All tabs mean the same thing in
    // either view rather than quietly changing meaning when a table is open.
    if (tableView != null) return Number(o.tables?.table_number) === Number(tableView)
    return mine(o)
  })

  const myActive = orders.filter(o =>
    mine(o) && ['placed','on_the_way'].includes(mapStatus(o.status))).length

  // Table ascending, then newest first inside each table
  const sorted = [...shown].sort((a, b) => {
    const ta = Number(a.tables?.table_number ?? 9999)
    const tb = Number(b.tables?.table_number ?? 9999)
    if (ta !== tb) return ta - tb
    return new Date(b.created_at) - new Date(a.created_at)
  })

  // The header counts what is outstanding at this table when a table is
  // open, and this captain's own work otherwise.
  const activeCount = tableView != null
    ? orders.filter(o => Number(o.tables?.table_number) === Number(tableView)
        && ['placed','on_the_way'].includes(mapStatus(o.status))).length
    : myActive

  return (
    <div style={{ position:'fixed', inset:0, background:'#F5F5F5', zIndex:120,
      display:'flex', flexDirection:'column' }}>

      <style>{`
        /* Two columns on a wide screen, so a landscape tablet or the
           supervisor's laptop shows roughly twice as many rows before any
           scrolling. Portrait stays single column. */
        .ss-cap-cols { display:grid; grid-template-columns:1fr; gap:0; align-items:start; }
        @media (min-width: 1000px) { .ss-cap-cols { grid-template-columns:1fr 1fr; gap:10px; } }
      `}</style>

      <div style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 14px',
        background:'#1A0A0A', flexShrink:0 }}>
        <button onClick={onClose} style={{ background:'#E8890C', border:'none',
          borderRadius:10, padding:'10px 18px', fontSize:15, fontWeight:800, cursor:'pointer',
          color:'#fff', flexShrink:0 }}>← Back</button>
        <h2 style={{ fontSize:17, fontWeight:800, color:'#fff', flex:1 }}>
          {tableView != null ? 'Table ' + tableView : 'My Orders'}
        </h2>
        <div style={{ color:'#E8890C', fontSize:12, fontWeight:800, padding:'5px 12px',
          borderRadius:999, border:'1.5px solid #E8890C', flexShrink:0 }}>
          {activeCount} live
        </div>
      </div>

      {/* Table lookup. A guest stops whichever captain is nearby and asks
          about their table - this turns that into one tap instead of
          "let me find who took it".

          Type the number and press Go. There are deliberately no table
          chips: at fifty or sixty tables any list of them is either several
          rows deep or a sideways scroll nobody trusts, and either way it
          takes space from the orders. A number box is the same size at six
          tables and at sixty, and a captain being asked about table 37
          already knows the number - it is the thing the guest just said. */}
      <div style={{ background:'#fff', borderBottom:'1px solid #eee', flexShrink:0,
        padding:'9px 12px 7px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:7 }}>

          <button onClick={() => { setTableView(null); setTyped(''); setOpenRow(null) }}
            style={{ flexShrink:0, borderRadius:9, padding:'8px 14px', fontSize:13,
              fontWeight:800, cursor:'pointer', border:'1.5px solid',
              background: tableView == null ? '#1A0A0A' : '#fff',
              color: tableView == null ? '#fff' : '#1A0A0A',
              borderColor: tableView == null ? '#1A0A0A' : '#E5E7EB' }}>
            My Orders{myActive ? ' \u00B7 ' + myActive : ''}
          </button>

          <span style={{ width:1, height:26, background:'#E5E7EB', flexShrink:0 }} />

          {/* Any table, including one with nothing outstanding - a guest can
              ask about an order that was delivered ten minutes ago. Enter
              works as well as the button. */}
          <input value={typed} inputMode="numeric" placeholder="Table no."
            onChange={e => setTyped(e.target.value.replace(/\D/g, '').slice(0, 3))}
            onKeyDown={e => {
              if (e.key === 'Enter' && typed) { setTableView(Number(typed)); setOpenRow(null) }
            }}
            style={{ flexShrink:0, width:96, border:'1.5px solid #E5E7EB', borderRadius:8,
              padding:'8px 8px', fontSize:14, fontWeight:900, textAlign:'center',
              fontFamily:'Manrope', outline:'none', boxSizing:'border-box' }} />

          <button onClick={() => { if (typed) { setTableView(Number(typed)); setOpenRow(null) } }}
            disabled={!typed}
            style={{ flexShrink:0, borderRadius:8, padding:'8px 16px', fontSize:14,
              fontWeight:900, border:'none',
              background: typed ? '#E8890C' : '#E5E7EB',
              color: typed ? '#fff' : '#9CA3AF',
              cursor: typed ? 'pointer' : 'not-allowed' }}>
            Go
          </button>
        </div>
      </div>

      <div style={{ display:'flex', gap:6, padding:'9px 12px', background:'#fff',
        borderBottom:'1px solid #eee', flexShrink:0 }}>
        {[['active','Active'],['delivered','Delivered'],['all','All']].map(([v,label]) => (
          <button key={v} onClick={() => { setFilter(v); setOpenRow(null) }}
            style={{ flex:1, padding:'8px 4px', borderRadius:9, fontSize:14, fontWeight:800,
              cursor:'pointer', border:'1.5px solid',
              background: filter===v ? '#1A0A0A' : '#fff',
              color: filter===v ? '#fff' : '#1A0A0A',
              borderColor: filter===v ? '#1A0A0A' : '#E5E7EB' }}>{label}</button>
        ))}
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'8px 10px 30px' }}>
        {loading ? (
          <div style={{ textAlign:'center', padding:50, color:'#888' }}>Loading…</div>
        ) : sorted.length === 0 ? (
          <div style={{ textAlign:'center', padding:'50px 20px' }}>
            <div style={{ fontSize:48, marginBottom:12 }}>🍽️</div>
            <div style={{ fontSize:17, fontWeight:800, marginBottom:6 }}>
              {tableView != null ? 'Nothing at table ' + tableView : 'Nothing here'}
            </div>
            <div style={{ fontSize:14, color:'#888', lineHeight:1.6 }}>
              {tableView != null
                ? (filter === 'active'
                    ? 'No order is waiting at this table right now.'
                    : 'No orders to show for this table.')
                : (filter === 'active'
                    ? 'None of your orders are waiting right now. Tap a table number above to check another table.'
                    : 'No orders to show.')}
            </div>
          </div>
        ) : (
          <div className="ss-cap-cols">
          {[sorted.slice(0, Math.ceil(sorted.length/2)), sorted.slice(Math.ceil(sorted.length/2))]
            .map((col, ci) => (
            <div key={ci} style={{ background:'#fff', borderRadius:12, overflow:'hidden',
              boxShadow:'0 2px 8px rgba(0,0,0,0.06)', marginBottom:10,
              display: col.length ? 'block' : 'none' }}>
            {col.map((o, i) => {
              const s = mapStatus(o.status)
              const cfg = STATUS[s]
              const open = openRow === o.id
              const isMine = mine(o)
              // Only the captain who took it. Anyone can see any table, but a
              // cancellation made without knowing what the guest actually said
              // is worse than a short walk to find the person who does.
              const canCancel = isMine && !o.waiter_id && ['pending','placed'].includes(o.status)
              const items = o.order_items || []
              const count = items.reduce((n, li) => n + (li.quantity || 1), 0)
              const tNum = o.tables?.table_number ?? '?'
              // waiters.name is stored as "Raju (07)" or just "07". The number
              // is what gets called across a hall, so that is what shows.
              const wRaw = o.waiters?.name || ''
              const wNum = wRaw.match(/\(([^)]+)\)\s*$/)
              const waiterLabel = wNum ? wNum[1] : wRaw
              // A rule where the table changes, so the eye still reads the
              // list table by table without a heading for every one.
              const prev = col[i - 1]
              const newTable = !prev || (prev.tables?.table_number ?? '?') !== tNum

              return (
                <div key={o.id} style={{ borderLeft:'4px solid ' + cfg.color,
                  borderTop: newTable && i > 0 ? '2px solid #E5E7EB' : 'none',
                  borderBottom:'1px solid #F2F2F2' }}>

                  <div onClick={() => setOpenRow(open ? null : o.id)}
                    style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 11px',
                      cursor:'pointer', minHeight:40, boxSizing:'border-box' }}>

                    <span style={{ background:'#1A0A0A', color:'#E8890C', borderRadius:7,
                      padding:'3px 9px', fontSize:13, fontWeight:900, flexShrink:0,
                      minWidth:34, textAlign:'center' }}>T{tNum}</span>

                    <span style={{ fontSize:12, color:'#888', fontWeight:600, flexShrink:0,
                      minWidth:40 }}>
                      {new Date(o.created_at).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}
                    </span>

                    <span style={{ fontSize:12, color:'#555', fontWeight:700, flexShrink:0 }}>
                      {count} {count === 1 ? 'item' : 'items'}
                    </span>

                    <span style={{ flex:1, minWidth:0 }} />

                    {/* The waiter number rides inside the status pill rather than
                        beside it. A captain who can see "On the way 07" can stop
                        waiter 07 walking past and send them to that table first,
                        which is the whole point of showing status at all - but the
                        row is already carrying five things, so it goes in the pill
                        instead of becoming a sixth. */}
                    <span style={{ background:cfg.bg, color:cfg.color, borderRadius:999,
                      padding:'3px 10px', fontSize:11, fontWeight:800, flexShrink:0,
                      whiteSpace:'nowrap', display:'flex', alignItems:'center', gap:5 }}>
                      {cfg.label}
                      {waiterLabel && (
                        <span style={{ background:cfg.color, color:'#fff', borderRadius:999,
                          padding:'1px 7px', fontSize:11, fontWeight:900 }}>
                          {waiterLabel}
                        </span>
                      )}
                    </span>

                    {/* Muted when it belongs to another captain, so a table view
                        reads as "mine, and these are someone else's" at a glance
                        rather than an undifferentiated list. */}
                    {o.captains?.name && (
                      <span style={{ fontSize:11, fontWeight:800, flexShrink:0,
                        maxWidth:74, overflow:'hidden', textOverflow:'ellipsis',
                        whiteSpace:'nowrap',
                        color: isMine ? '#2563EB' : '#9CA3AF' }}>
                        {o.captains.name}
                      </span>
                    )}

                    <span style={{ fontSize:11, color:'#AAA', flexShrink:0,
                      transform:'rotate(' + (open ? 180 : 0) + 'deg)',
                      transition:'transform 0.15s' }}>▼</span>
                  </div>

                  {open && (
                    <div style={{ padding:'0 12px 12px', background:'#FAFAFA' }}>
                      {items.map((oi, j) => (
                        <div key={j} style={{ display:'flex', justifyContent:'space-between',
                          fontSize:13, padding:'4px 0', borderBottom:'1px solid #F0F0F0' }}>
                          <span style={{ fontWeight:600 }}>{oi.menu_items?.name || 'Item'}</span>
                          <span style={{ color:'#888', fontWeight:700 }}>x{oi.quantity}</span>
                        </div>
                      ))}

                      {o.waiters?.name && (
                        <div style={{ fontSize:12, color:'#2563EB', fontWeight:700, marginTop:8 }}>
                          Waiter {o.waiters.name} is delivering
                        </div>
                      )}

                      {o.status === 'cancelled' && o.cancel_reason && (
                        <div style={{ fontSize:12, color:'#B91C1C', fontWeight:600, marginTop:8 }}>
                          {o.cancel_reason}
                        </div>
                      )}

                      {canCancel && (
                        <button onClick={e => { e.stopPropagation(); setConfirmId(o.id) }}
                          style={{ width:'100%', marginTop:10, background:'transparent',
                            border:'1.5px solid #FECACA', borderRadius:10, padding:'10px',
                            fontSize:13, fontWeight:800, color:'#DC2626', cursor:'pointer' }}>
                          ✕ Cancel this order
                        </button>
                      )}

                      {/* Not a refusal so much as a redirection: it names the
                          person to go and speak to, which is what the captain
                          needs to know next. */}
                      {!isMine && !o.waiter_id && ['pending','placed'].includes(o.status) && (
                        <div style={{ marginTop:10, background:'#FFF7ED',
                          border:'1px solid #FED7AA', borderRadius:10, padding:'9px 12px',
                          fontSize:12, color:'#9A3412', fontWeight:700, lineHeight:1.5 }}>
                          Taken by captain {o.captains?.name || 'another captain'}. Ask them
                          or the supervisor to cancel it.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
            </div>
          ))}
          </div>
        )}
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
            <div style={{ fontSize:44, marginBottom:12 }}>{notice.icon}</div>
            <div style={{ fontSize:19, fontWeight:800, marginBottom:10 }}>{notice.title}</div>
            <div style={{ fontSize:14, color:'#888', lineHeight:1.6, marginBottom:22 }}>{notice.text}</div>
            <button onClick={() => { setNotice(null); load() }}
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
