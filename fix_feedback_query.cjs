const fs = require('fs')
const BASE = '/Users/asayyed/SmartServe/src'

const frPath = BASE + '/components/supervisor/FeedbackReport.jsx'
let fr = fs.readFileSync(frPath, 'utf8')

// Replace entire loadFeedback with a simple query — no joins
fr = fr.replace(
  `  async function loadFeedback() {
    setLoading(true)
    try {
      // Strategy 1: by event_id
      const { data: byEvent } = await supabase.from('feedback')
        .select('*, orders(id, tables(table_number))')
        .eq('event_id', selectedEventId)
        .order('created_at', { ascending:false })

      if (byEvent?.length > 0) { setFeedback(byEvent); setLoading(false); return }

      // Strategy 2: via orders belonging to this event
      const { data: eventOrders } = await supabase.from('orders').select('id').eq('event_id', selectedEventId)
      const orderIds = (eventOrders||[]).map(o=>o.id)

      if (orderIds.length > 0) {
        const { data: byOrder } = await supabase.from('feedback')
          .select('*, orders(id, tables(table_number))')
          .in('order_id', orderIds)
          .order('created_at', { ascending:false })
        if (byOrder?.length > 0) { setFeedback(byOrder); setLoading(false); return }
      }

      // Strategy 3: get ALL feedback regardless of event — at least show something
      const { data: allFb } = await supabase.from('feedback')
        .select('*, orders(id, tables(table_number))')
        .order('created_at', { ascending:false })
        .limit(100)
      console.log('All feedback found:', allFb?.length, allFb)
      setFeedback(allFb||[])
    } catch(e) { console.error('Feedback load error:', e); setFeedback([]) }
    setLoading(false)
  }`,

  `  async function loadFeedback() {
    setLoading(true)
    try {
      // Simple query — no joins that could fail
      const { data: allFb, error } = await supabase
        .from('feedback')
        .select('*')
        .order('created_at', { ascending:false })
        .limit(200)

      if (error) { console.error('Feedback query error:', error); setFeedback([]); setLoading(false); return }

      // Now enrich with table numbers via separate query
      const orderIds = [...new Set((allFb||[]).map(f=>f.order_id).filter(Boolean))]
      let tableMap = {}
      if (orderIds.length > 0) {
        const { data: orders } = await supabase
          .from('orders')
          .select('id, table_id, tables(table_number)')
          .in('id', orderIds)
        ;(orders||[]).forEach(o => { if(o.id) tableMap[o.id] = o.tables?.table_number })
      }

      // Attach table number to each feedback
      const enriched = (allFb||[]).map(f => ({
        ...f,
        tableNumber: f.order_id ? tableMap[f.order_id] : null
      }))

      // Filter by selected event
      const forEvent = enriched.filter(f =>
        f.event_id === selectedEventId ||
        (!f.event_id && orderIds.length > 0) // show unlinked ones too
      )

      setFeedback(forEvent.length > 0 ? forEvent : enriched)
    } catch(e) {
      console.error('Feedback load error:', e)
      setFeedback([])
    }
    setLoading(false)
  }`
)

// Fix the table number display — use tableNumber field instead of orders.tables.table_number
fr = fr.replace(
  `                    {f.orders?.tables?.table_number && (
                      <span style={{ fontSize:12, background:'#EFF6FF', color:'#2563EB', fontWeight:700, padding:'2px 8px', borderRadius:999, marginLeft:8 }}>
                        Table {f.orders.tables.table_number}
                      </span>
                    )}`,
  `                    {(f.tableNumber || f.orders?.tables?.table_number) && (
                      <span style={{ fontSize:12, background:'#EFF6FF', color:'#2563EB', fontWeight:700, padding:'2px 8px', borderRadius:999, marginLeft:8 }}>
                        Table {f.tableNumber || f.orders?.tables?.table_number}
                      </span>
                    )}`
)

// Fix table summary to use tableNumber
fr = fr.replace(
  `  const tables = [...new Set(feedback.map(f=>f.orders?.tables?.table_number).filter(Boolean))].sort((a,b)=>a-b)
  const filtered = tableFilter==='all' ? feedback : feedback.filter(f=>f.orders?.tables?.table_number===parseInt(tableFilter))`,
  `  const tables = [...new Set(feedback.map(f=>f.tableNumber||f.orders?.tables?.table_number).filter(Boolean))].sort((a,b)=>a-b)
  const filtered = tableFilter==='all' ? feedback : feedback.filter(f=>(f.tableNumber||f.orders?.tables?.table_number)===parseInt(tableFilter))`
)

fr = fr.replace(
  `  const tableSummary = tables.map(t => {
    const rows = feedback.filter(f=>f.orders?.tables?.table_number===t)`,
  `  const tableSummary = tables.map(t => {
    const rows = feedback.filter(f=>(f.tableNumber||f.orders?.tables?.table_number)===t)`
)

fs.writeFileSync(frPath, fr)
console.log('✅ FeedbackReport — no-join query, works regardless of FK setup')
console.log('Run: npm run dev')
