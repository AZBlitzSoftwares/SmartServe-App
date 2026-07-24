import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

export default function ReportsDashboard({ eventData: defaultEvent, onEventChange }) {
  const [allEvents, setAllEvents] = useState([])
  const [selectedEventId, setSelectedEventId] = useState(defaultEvent?.id||null)
  const [eventData, setEventData] = useState(defaultEvent)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    supabase.from('events').select('*').order('created_at',{ascending:false}).then(({data}) => {
      setAllEvents(data||[])
      if (!selectedEventId && data?.length) {
        const active = data.find(e=>!e.is_closed) || data[0]
        setSelectedEventId(active.id)
        setEventData(active)
      }
    })
  }, [])

  useEffect(() => {
    if (selectedEventId) loadReport(selectedEventId)
  }, [selectedEventId])

  async function loadReport(evId) {
    setLoading(true); setData(null)
    const ev = allEvents.find(e=>e.id===evId) || eventData
    setEventData(ev)
    const [ordersRes, sosRes, fbRes, waitersRes] = await Promise.all([
      supabase.from('orders').select('*, tables(table_number), order_items(quantity, menu_items(name))').eq('event_id', evId),
      supabase.from('sos_requests').select('*, tables(table_number)').eq('event_id', evId),
      supabase.from('feedback').select('*, tables(table_number)').eq('event_id', evId),
      supabase.from('waiters').select('*').eq('event_id', evId)
    ])
    const orders = ordersRes.data||[]; const sos = sosRes.data||[]; const fb = fbRes.data||[]; const ws = waitersRes.data||[]
    const tableMap = {}
    orders.forEach(o => {
      const t = o.tables?.table_number||'?'
      if (!tableMap[t]) tableMap[t] = { table:t, orders:0, items:0, delivered:0, cancelled:0, waiter:null }
      tableMap[t].orders++
      if (o.status==='delivered') tableMap[t].delivered++
      if (o.status==='cancelled') tableMap[t].cancelled++
      o.order_items?.forEach(oi => { tableMap[t].items += oi.quantity })
    })
    // Link waiters to tables
    ws.forEach(w => {
      if (!w.table_numbers) return
      w.table_numbers.split(',').forEach(tStr => {
        const t = tStr.trim().replace(/[^0-9]/g,'')
        if (t && tableMap[t]) tableMap[t].waiter = w.name + (w.mobile ? ' ('+w.mobile+')' : '')
      })
    })
    const itemMap = {}
    orders.forEach(o => o.order_items?.forEach(oi => {
      const n = oi.menu_items?.name||'?'
      if (!itemMap[n]) itemMap[n] = { name:n, qty:0 }
      itemMap[n].qty += oi.quantity
    }))
    const delivered = orders.filter(o=>o.status==='delivered').length
    const cancelled = orders.filter(o=>o.status==='cancelled').length
    const active = orders.filter(o=>!['delivered','cancelled'].includes(o.status)).length
    const avgRating = fb.length ? (fb.reduce((s,f)=>s+(f.rating||0),0)/fb.length).toFixed(1) : null
    setData({ orders, sos, fb, ws, stats:{ total:orders.length, delivered, cancelled, active }, tableStats:Object.values(tableMap).sort((a,b)=>a.table-b.table), itemStats:Object.values(itemMap).sort((a,b)=>b.qty-a.qty), avgRating })
    setLoading(false)
  }

  function printReport() {
    if (!data||!eventData) return
    const dateStr = new Date(eventData.date||Date.now()).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})
    const now = new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true})
    const w = window.open('','_blank')
    w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Event Report — ${eventData.name}</title>
<style>body{font-family:Arial,sans-serif;font-size:13px;padding:24px;color:#111;max-width:800px;margin:0 auto}h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:20px 0 8px;border-bottom:1px solid #ddd;padding-bottom:4px}.meta{color:#666;font-size:12px;margin-bottom:20px;line-height:1.8}.stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px}.stat{background:#f5f5f5;border-radius:8px;padding:12px;text-align:center}.stat-num{font-size:24px;font-weight:bold;color:#E8890C}.stat-label{font-size:11px;color:#666;margin-top:4px}table{width:100%;border-collapse:collapse;margin-bottom:20px}th{background:#f0f0f0;text-align:left;padding:8px 10px;font-size:12px}td{padding:8px 10px;border-bottom:1px solid #eee;font-size:12px}.badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:bold}.g{background:#dcfce7;color:#16a34a}.r{background:#fee2e2;color:#dc2626}.y{background:#fef9c3;color:#ca8a04}@media print{body{padding:8px}}</style>
</head><body>
<h1>Janu's Smart Serve — Event Report</h1>
<div class="meta">
  <strong>${eventData.name}</strong><br>
  📍 Venue: ${eventData.venue||'—'}<br>
  📅 Date: ${dateStr}<br>
  🍽️ Catering: ${eventData.catering_company||'—'}<br>
  🪑 Tables: ${eventData.number_of_tables||'—'}<br>
  🕐 Report generated: ${now}
</div>
<div class="stat-grid">
  <div class="stat"><div class="stat-num">${data.stats.total}</div><div class="stat-label">Total Orders</div></div>
  <div class="stat"><div class="stat-num" style="color:#16a34a">${data.stats.delivered}</div><div class="stat-label">Delivered</div></div>
  <div class="stat"><div class="stat-num" style="color:#d97706">${data.stats.active}</div><div class="stat-label">Active</div></div>
  <div class="stat"><div class="stat-num" style="color:#dc2626">${data.stats.cancelled}</div><div class="stat-label">Cancelled</div></div>
</div>
${data.avgRating?'<p>⭐ Avg Guest Rating: <strong>'+data.avgRating+'/5</strong> from '+data.fb.length+' responses</p>':''}
<h2>Table-wise Summary</h2>
<table><tr><th>Table</th><th>Waiter</th><th>Orders</th><th>Items</th><th>Delivered</th><th>Cancelled</th></tr>
${data.tableStats.map(t=>'<tr><td><strong>Table '+t.table+'</strong></td><td>'+(t.waiter||'—')+'</td><td>'+t.orders+'</td><td>'+t.items+'</td><td><span class="badge g">'+t.delivered+'</span></td><td><span class="badge r">'+t.cancelled+'</span></td></tr>').join('')}
</table>
<h2>Most Ordered Dishes</h2>
<table><tr><th>#</th><th>Dish</th><th>Qty</th></tr>
${data.itemStats.slice(0,15).map((item,i)=>'<tr><td>'+( i+1)+'</td><td>'+item.name+'</td><td><strong>'+item.qty+'</strong></td></tr>').join('')}
</table>
<h2>SOS / Service Requests (${data.sos.length})</h2>
${data.sos.length===0?'<p style="color:#888">None.</p>':'<table><tr><th>Type</th><th>Table</th><th>Time</th><th>Status</th></tr>'+data.sos.map(s=>'<tr><td>'+s.request_type?.replace(/_/g,' ')+'</td><td>Table '+(s.tables?.table_number||'?')+'</td><td>'+new Date(s.created_at).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true})+'</td><td><span class="badge '+(s.status==='resolved'?'g':s.status==='acknowledged'?'y':'r')+'">'+s.status+'</span></td></tr>').join('')+'</table>'}
${data.fb.length>0?'<h2>Guest Feedback</h2><table><tr><th>Name</th><th>Rating</th><th>Comment</th></tr>'+data.fb.map(f=>'<tr><td>'+(f.guest_name||'Anonymous')+'</td><td>'+'⭐'.repeat(f.rating||0)+'</td><td>'+(f.comment||'—')+'</td></tr>').join('')+'</table>':''}
<div style="margin-top:32px;text-align:center;font-size:11px;color:#aaa">Generated by Janu's Smart Serve · ${new Date().toLocaleString('en-IN')}</div>
</body></html>`)
    w.document.close(); w.focus(); setTimeout(()=>{ w.print(); w.close() },400)
  }

  async function exportCSV() {
    if (!data) return
    // Fetch full order details for rich export
    const { data: orders } = await supabase
      .from('orders')
      .select('id,status,created_at,delivered_at,assigned_at,tables(table_number),waiters(name),order_items(quantity,menu_items(name,is_veg,is_live_counter))')
      .eq('event_id', selectedEventId)
      .order('created_at', { ascending: true })

    const rows = [['Order ID','Table No','Waiter','Status','Item Name','Veg/Non-Veg','Live Counter','Qty','Order Time','Delivered Time','Duration (mins)']]
    ;(orders||[]).forEach(o => {
      const tableNum = o.tables?.table_number || ''
      const waiter = o.waiters?.name || ''
      const orderTime = o.created_at ? new Date(o.created_at).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:true}) : ''
      const deliveredTime = o.delivered_at ? new Date(o.delivered_at).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:true}) : ''
      const duration = (o.delivered_at && o.assigned_at) ? Math.round((new Date(o.delivered_at)-new Date(o.assigned_at))/60000) : ''
      const orderId = '#'+o.id.slice(-6).toUpperCase()
      if (o.order_items?.length) {
        o.order_items.forEach(oi => {
          rows.push([
            orderId, tableNum, waiter, o.status,
            oi.menu_items?.name||'',
            oi.menu_items?.is_veg ? 'Veg' : 'Non-Veg',
            oi.menu_items?.is_live_counter ? 'Yes' : 'No',
            oi.quantity,
            orderTime, deliveredTime, duration
          ])
        })
      } else {
        rows.push([orderId, tableNum, waiter, o.status, '', '', '', '', orderTime, deliveredTime, duration])
      }
    })

    const csv = rows.map(r => r.map(v => '"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\n')
    const blob = new Blob([csv],{type:'text/csv'})
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href=url
    a.download=(eventData?.name||'report')+'_detailed_'+new Date().toISOString().slice(0,10)+'.csv'
    a.click(); URL.revokeObjectURL(url)
  }

  const CARDS = data ? [
    { label:'Total Orders', value:data.stats.total, color:'#2563EB', bg:'#EFF6FF' },
    { label:'Delivered',    value:data.stats.delivered, color:'#16A34A', bg:'#F0FDF4' },
    { label:'Active',       value:data.stats.active, color:'#D97706', bg:'#FEF3C7' },
    { label:'Cancelled',    value:data.stats.cancelled, color:'#DC2626', bg:'#FEF2F2' },
    { label:'SOS Requests', value:data.sos.length, color:'#0891B2', bg:'#ECFEFF' },
    { label:'Avg Rating',   value:data.avgRating?data.avgRating+'★':'N/A', color:'#7C3AED', bg:'#F5F3FF' },
  ] : []

  return (
    <div>
      {/* Event selector */}
      <div style={{ background:'#fff',borderRadius:16,padding:'14px 16px',marginBottom:16,boxShadow:'var(--shadow)' }}>
        <div style={{ fontSize:13,fontWeight:700,color:'var(--ink2)',marginBottom:8 }}>Select Event for Report</div>
        <select value={selectedEventId||''} onChange={e => setSelectedEventId(e.target.value)}
          style={{ width:'100%',border:'1.5px solid var(--line)',borderRadius:10,padding:'10px 14px',fontSize:14,fontFamily:'Manrope',outline:'none',background:'#fff' }}>
          <option value="">Choose an event...</option>
          {allEvents.map(ev => <option key={ev.id} value={ev.id}>{ev.name} — {new Date(ev.date).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})} {ev.is_closed?'(Closed)':'(Active)'}</option>)}
        </select>
      </div>

      {loading && <div style={{ textAlign:'center',padding:60,color:'var(--ink2)' }}>Loading report...</div>}

      {data && eventData && (
        <>
          {/* Event info */}
          <div style={{ background:'#fff',borderRadius:16,padding:'14px 18px',marginBottom:16,boxShadow:'var(--shadow)' }}>
            <div style={{ display:'flex',justifyContent:'space-between',alignItems:'flex-start' }}>
              <div>
                <div style={{ fontWeight:800,fontSize:18,marginBottom:4 }}>{eventData.name}</div>
                {eventData.venue && <div style={{ fontSize:13,color:'var(--ink2)' }}>📍 {eventData.venue}</div>}
                {eventData.date && <div style={{ fontSize:13,color:'var(--ink2)' }}>📅 {new Date(eventData.date).toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'})}</div>}
                {eventData.catering_company && <div style={{ fontSize:13,color:'var(--ink2)' }}>🍽️ {eventData.catering_company}</div>}
                {eventData.number_of_tables && <div style={{ fontSize:13,color:'var(--ink2)' }}>🪑 {eventData.number_of_tables} tables</div>}
              </div>
              <div style={{ display:'flex',flexDirection:'column',gap:8 }}>
                <button onClick={printReport} style={{ background:'var(--ink)',color:'#fff',border:'none',borderRadius:10,padding:'8px 14px',fontSize:13,fontWeight:700 }}>🖨 Print PDF</button>
                <button onClick={exportCSV} style={{ background:'#F0FDF4',border:'1px solid #BBF7D0',color:'#16A34A',borderRadius:10,padding:'8px 14px',fontSize:13,fontWeight:700 }}>📊 CSV</button>
                <button onClick={() => loadReport(selectedEventId)} style={{ background:'var(--bg)',border:'1px solid var(--line)',borderRadius:10,padding:'8px 14px',fontSize:13,fontWeight:600 }}>↻ Refresh</button>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div style={{ display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,marginBottom:16 }}>
            {CARDS.map(c => <div key={c.label} style={{ background:c.bg,borderRadius:14,padding:'14px 16px' }}><div style={{ fontSize:26,fontWeight:800,color:c.color }}>{c.value}</div><div style={{ fontSize:11,color:'var(--ink2)',fontWeight:600,marginTop:2 }}>{c.label}</div></div>)}
          </div>

          {/* Table stats */}
          <div style={{ background:'#fff',borderRadius:16,padding:16,marginBottom:16,boxShadow:'var(--shadow)' }}>
            <div style={{ fontWeight:800,fontSize:16,marginBottom:12 }}>Table-wise Summary</div>
            {data.tableStats.length===0 ? <div style={{ color:'var(--ink2)',fontSize:13 }}>No orders yet</div>
            : data.tableStats.map(t => (
              <div key={t.table} style={{ padding:'10px 0',borderBottom:'1px solid var(--line)' }}>
                <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center' }}>
                  <div style={{ fontWeight:700,fontSize:15 }}>Table {t.table}</div>
                  <div style={{ display:'flex',gap:10,fontSize:13 }}>
                    <span><strong style={{ color:'var(--ink)' }}>{t.orders}</strong> orders</span>
                    <span style={{ color:'#16A34A',fontWeight:700 }}>✓{t.delivered}</span>
                    {t.cancelled>0 && <span style={{ color:'#DC2626',fontWeight:700 }}>✗{t.cancelled}</span>}
                  </div>
                </div>
                {t.waiter && <div style={{ fontSize:12,color:'#2563EB',marginTop:3 }}>👤 Waiter: {t.waiter}</div>}
              </div>
            ))}
          </div>

          {/* Top dishes */}
          <div style={{ background:'#fff',borderRadius:16,padding:16,marginBottom:16,boxShadow:'var(--shadow)' }}>
            <div style={{ fontWeight:800,fontSize:16,marginBottom:12 }}>Most Ordered Dishes</div>
            {data.itemStats.length===0 ? <div style={{ color:'var(--ink2)',fontSize:13 }}>No data</div>
            : data.itemStats.map((item,i) => (
              <div key={item.name} style={{ display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 0',borderBottom:'1px solid var(--line)' }}>
                <div style={{ display:'flex',alignItems:'center',gap:10 }}>
                  <div style={{ width:24,height:24,borderRadius:'50%',background:i<3?'#E8890C':'var(--bg)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:800,color:i<3?'#fff':'var(--ink2)' }}>{i+1}</div>
                  <span style={{ fontWeight:600,fontSize:14 }}>{item.name}</span>
                </div>
                <div style={{ fontWeight:800,fontSize:16,color:'#E8890C' }}>{item.qty}x</div>
              </div>
            ))}
          </div>

          {/* SOS */}
          <div style={{ background:'#fff',borderRadius:16,padding:16,marginBottom:16,boxShadow:'var(--shadow)' }}>
            <div style={{ fontWeight:800,fontSize:16,marginBottom:12 }}>Service Requests ({data.sos.length})</div>
            {data.sos.length===0 ? <div style={{ color:'var(--ink2)',fontSize:13 }}>No SOS requests</div>
            : data.sos.map((s,i) => (
              <div key={i} style={{ display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:'1px solid var(--line)',fontSize:13 }}>
                <span style={{ fontWeight:600,textTransform:'capitalize' }}>{s.request_type?.replace(/_/g,' ')}</span>
                <span style={{ color:'var(--ink2)' }}>Table {s.tables?.table_number} · {new Date(s.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span>
                <span style={{ fontWeight:700,color:s.status==='resolved'?'#16A34A':s.status==='acknowledged'?'#D97706':'#DC2626' }}>{s.status}</span>
              </div>
            ))}
          </div>

          {/* Feedback moved to dedicated Feedback tab */}
        </>
      )}
    </div>
  )
}
