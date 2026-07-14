const fs = require('fs')
const BASE = '/Users/asayyed/SmartServe/src'

// Read current SupervisorApp and add order alert alongside SOS alert
const content = fs.readFileSync(BASE + '/pages/SupervisorApp.jsx', 'utf8')

// Add order alert hook after the SOS hook line
const newContent = content
  // 1. Add useEffect for order alerts after existing hooks
  .replace(
    `  // SOS alert hook — runs regardless of which tab is active
  const { openRequests, newAlert, clearAlert } = useSOSAlert(eventData)

  useEffect(() => {
    setSosCount(openRequests.length)
  }, [openRequests])`,
    `  // SOS alert hook — runs regardless of which tab is active
  const { openRequests, newAlert, clearAlert } = useSOSAlert(eventData)
  const [newOrderAlert, setNewOrderAlert] = useState(null)
  const prevOrderCount = { current: -1 }

  useEffect(() => {
    setSosCount(openRequests.length)
  }, [openRequests])

  // Order alert — poll for new pending orders
  useEffect(() => {
    if (!eventData) return
    async function checkOrders() {
      const { data } = await supabase.from('orders')
        .select('id, created_at, status, tables(table_number)')
        .eq('event_id', eventData.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
      const count = data?.length || 0
      if (prevOrderCount.current >= 0 && count > prevOrderCount.current && data?.[0]) {
        setNewOrderAlert(data[0])
        setTimeout(() => setNewOrderAlert(null), 6000)
      }
      prevOrderCount.current = count
    }
    checkOrders()
    const interval = setInterval(checkOrders, 4000)
    return () => clearInterval(interval)
  }, [eventData])`
  )
  // 2. Add order alert banner after the SOS alert banner
  .replace(
    `      {/* ── FLOATING SOS ALERT — shows on top of everything ── */}`,
    `      {/* ── FLOATING ORDER ALERT ── */}
      {newOrderAlert && (
        <>
          <style>{\`@keyframes orderFlash{0%,100%{opacity:1}50%{opacity:0.85}}.order-alert{animation:orderFlash 0.7s ease-in-out 4}\`}</style>
          <div className="order-alert" style={{
            position:'fixed', top:0, left:0, right:0, zIndex:9998,
            background:'#16A34A', padding:'14px 20px',
            display:'flex', alignItems:'center', gap:14, boxShadow:'0 4px 24px rgba(22,163,74,0.6)'
          }}>
            <span style={{ fontSize:32 }}>🎫</span>
            <div style={{ flex:1 }}>
              <div style={{ color:'#fff', fontWeight:800, fontSize:16 }}>
                🆕 New Order — Table {newOrderAlert.tables?.table_number}
              </div>
              <div style={{ color:'rgba(255,255,255,0.85)', fontSize:13, marginTop:2 }}>
                {new Date(newOrderAlert.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} · Tap to view
              </div>
            </div>
            <button onClick={() => { setNewOrderAlert(null); setActiveTab('kot') }} style={{ background:'#fff', color:'#16A34A', border:'none', borderRadius:10, padding:'10px 18px', fontSize:13, fontWeight:800, cursor:'pointer' }}>
              View →
            </button>
            <button onClick={() => setNewOrderAlert(null)} style={{ background:'rgba(255,255,255,0.2)', border:'none', borderRadius:8, padding:'8px 12px', color:'#fff', fontSize:18, cursor:'pointer', lineHeight:1 }}>✕</button>
          </div>
          <div style={{ height:72 }} />
        </>
      )}

      {/* ── FLOATING SOS ALERT — shows on top of everything ── */}`
  )

fs.writeFileSync(BASE + '/pages/SupervisorApp.jsx', newContent)
console.log('✅ Order alert added — green banner flashes when any table places an order')
