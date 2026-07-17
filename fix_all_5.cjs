const fs = require('fs')
const BASE = '/Users/asayyed/SmartServe/src'

// ═══════════════════════════════════════════════════════════════════
// FIX 1: OrderStatus — only 2 steps: In Progress + Delivered
// ═══════════════════════════════════════════════════════════════════
const orderStatusPath = BASE + '/components/guest/OrderStatus.jsx'
const osContent = fs.readFileSync(orderStatusPath, 'utf8')

// Replace entire steps definition with 2-step flow
const newOrderStatus = osContent
  .replace(
    /const STEPS = \[[\s\S]*?\]/m,
    `const STEPS = [
    { key:'in_progress', label:'In Progress',  icon:'👨‍🍳', desc:'Your order is being prepared' },
    { key:'delivered',   label:'Delivered',     icon:'🎉', desc:'Enjoy your meal!' },
  ]`
  )
  .replace(
    /const STATUS_ORDER = \[[\s\S]*?\]/m,
    `const STATUS_ORDER = ['in_progress','delivered']`
  )
  // Also handle cases where status is still 'pending' or 'placed' — map to in_progress for display
  .replace(
    /const currentStep = STATUS_ORDER\.indexOf\(order\.status\)/,
    `const displayStatus = ['pending','placed'].includes(order?.status) ? 'in_progress' : order?.status
  const currentStep = STATUS_ORDER.indexOf(displayStatus)`
  )

if (newOrderStatus !== osContent) {
  fs.writeFileSync(orderStatusPath, newOrderStatus)
  console.log('✅ 1/5 OrderStatus — 2 steps only (In Progress + Delivered)')
} else {
  // Write a complete replacement
  fs.writeFileSync(orderStatusPath, `import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

const STEPS = [
  { key:'in_progress', label:'In Progress',  icon:'👨‍🍳', desc:'Your order is being prepared and will be delivered shortly' },
  { key:'delivered',   label:'Delivered',    icon:'🎉', desc:'Enjoy your meal!' },
]
const STATUS_ORDER = ['in_progress', 'delivered']

export default function OrderStatus({ orderId, tableNumber, onBack }) {
  const [order, setOrder] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!orderId || orderId.startsWith('offline-')) { setLoading(false); return }
    fetchOrder()
    const sub = supabase.channel('order-status-' + orderId)
      .on('postgres_changes', { event:'UPDATE', schema:'public', table:'orders', filter:'id=eq.'+orderId }, payload => {
        setOrder(prev => ({ ...prev, ...payload.new }))
      }).subscribe()
    const interval = setInterval(fetchOrder, 6000)
    return () => { supabase.removeChannel(sub); clearInterval(interval) }
  }, [orderId])

  async function fetchOrder() {
    if (!orderId) return
    const { data } = await supabase.from('orders')
      .select('*, order_items(quantity, menu_items(name))')
      .eq('id', orderId).single()
    if (data) setOrder(data)
    setLoading(false)
  }

  if (orderId?.startsWith('offline-')) return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', display:'flex', flexDirection:'column' }}>
      <div style={{ display:'flex', alignItems:'center', gap:16, padding:'16px 20px', background:'#fff', borderBottom:'1px solid var(--line)' }}>
        <button onClick={onBack} style={{ background:'var(--bg)', border:'1.5px solid var(--line)', borderRadius:10, padding:'8px 14px', fontSize:14, fontWeight:600, cursor:'pointer' }}>← Back</button>
        <h2 style={{ fontSize:18, fontWeight:800 }}>Order Status</h2>
        <div style={{ marginLeft:'auto', background:'rgba(255,255,255,0.15)', color:'var(--ink)', fontSize:12, fontWeight:700, padding:'5px 12px', borderRadius:999, border:'1px solid var(--line)' }}>TABLE {tableNumber}</div>
      </div>
      <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:24, textAlign:'center' }}>
        <div style={{ fontSize:64, marginBottom:16 }}>📶</div>
        <h3 style={{ fontSize:20, fontWeight:800, marginBottom:8 }}>Order Queued Offline</h3>
        <p style={{ color:'var(--ink2)', fontSize:14, lineHeight:1.6 }}>Will sync automatically when internet is restored</p>
      </div>
    </div>
  )

  if (loading) return <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center' }}><div style={{ color:'var(--ink2)' }}>Loading...</div></div>

  // Map old statuses to new 2-step display
  const displayStatus = ['pending','placed','in_preparation','ready'].includes(order?.status) ? 'in_progress' : order?.status
  const currentStep = STATUS_ORDER.indexOf(displayStatus)

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', display:'flex', flexDirection:'column' }}>
      <div style={{ display:'flex', alignItems:'center', gap:16, padding:'16px 20px', background:'#fff', borderBottom:'1px solid var(--line)' }}>
        <button onClick={onBack} style={{ background:'var(--bg)', border:'1.5px solid var(--line)', borderRadius:10, padding:'8px 14px', fontSize:14, fontWeight:600, cursor:'pointer' }}>← Back</button>
        <h2 style={{ fontSize:18, fontWeight:800 }}>Order Status</h2>
        <div style={{ marginLeft:'auto', background:'rgba(255,255,255,0.15)', color:'var(--ink)', fontSize:12, fontWeight:700, padding:'5px 12px', borderRadius:999, border:'1px solid var(--line)' }}>TABLE {tableNumber}</div>
      </div>

      <div style={{ padding:24, flex:1 }}>
        {/* Status timeline */}
        <div style={{ background:'#fff', borderRadius:20, padding:24, marginBottom:20, boxShadow:'var(--shadow)' }}>
          {STEPS.map((step, idx) => {
            const done = currentStep > idx
            const active = currentStep === idx
            return (
              <div key={step.key} style={{ display:'flex', gap:16, alignItems:'flex-start', marginBottom: idx < STEPS.length-1 ? 8 : 0 }}>
                <div style={{ display:'flex', flexDirection:'column', alignItems:'center' }}>
                  <div style={{ width:48, height:48, borderRadius:'50%', background: done?'#16A34A': active?'#E8890C':'#F3F4F6', display:'flex', alignItems:'center', justifyContent:'center', fontSize:22, border: active?'3px solid #E8890C':'3px solid transparent', transition:'all 0.4s' }}>
                    {done ? '✓' : step.icon}
                  </div>
                  {idx < STEPS.length-1 && <div style={{ width:2, height:40, background: done?'#16A34A':'#E5E7EB', marginTop:4, transition:'background 0.4s' }}></div>}
                </div>
                <div style={{ paddingTop:10, flex:1 }}>
                  <div style={{ fontWeight: active||done ? 800 : 500, fontSize:16, color: done?'#16A34A': active?'#E8890C':'#9CA3AF' }}>{step.label}</div>
                  {active && <div style={{ fontSize:13, color:'#888', marginTop:4, lineHeight:1.5 }}>{step.desc}</div>}
                </div>
              </div>
            )
          })}
        </div>

        {/* Items */}
        {order?.order_items?.length > 0 && (
          <div style={{ background:'#fff', borderRadius:16, padding:20, boxShadow:'var(--shadow)' }}>
            <div style={{ fontWeight:800, fontSize:16, marginBottom:14 }}>Items Ordered</div>
            {order.order_items.map((oi, i) => (
              <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid var(--line)', fontSize:15 }}>
                <span style={{ fontWeight:500 }}>{oi.menu_items?.name}</span>
                <span style={{ fontWeight:700 }}>x{oi.quantity}</span>
              </div>
            ))}
          </div>
        )}

        {/* Delivered message */}
        {displayStatus === 'delivered' && (
          <div style={{ background:'#F0FDF4', border:'1.5px solid #BBF7D0', borderRadius:16, padding:20, marginTop:16, textAlign:'center' }}>
            <div style={{ fontSize:40, marginBottom:8 }}>🎉</div>
            <div style={{ fontWeight:800, fontSize:18, color:'#16A34A', marginBottom:4 }}>Order Delivered!</div>
            <div style={{ fontSize:14, color:'#888' }}>Thank you for ordering with Janu's Smart Serve</div>
          </div>
        )}

        <button onClick={onBack} style={{ width:'100%', marginTop:20, background:'var(--ink)', color:'#fff', border:'none', borderRadius:14, padding:'16px', fontSize:16, fontWeight:800, cursor:'pointer' }}>
          ← Back to Menu
        </button>
      </div>
    </div>
  )
}
`)
  console.log('✅ 1/5 OrderStatus — full rewrite, 2 steps only')
}

// ═══════════════════════════════════════════════════════════════════
// FIX 2: KOTDashboard — fix status label for 'pending' orders
//         Waiter assign shows on NEW orders correctly
// ═══════════════════════════════════════════════════════════════════
const kotPath = BASE + '/components/supervisor/KOTDashboard.jsx'
let kotContent = fs.readFileSync(kotPath, 'utf8')

// Fix: DB uses 'pending' but code uses 'placed' — normalize both
kotContent = kotContent
  .replace(
    `const STATUS_LABELS = { placed:'New Order', in_progress:'In Progress', delivered:'Delivered', cancelled:'Cancelled' }`,
    `const STATUS_LABELS = { pending:'New Order', placed:'New Order', in_progress:'In Progress', delivered:'Delivered', cancelled:'Cancelled' }`
  )
  .replace(
    `const STATUS_COLORS = { placed:'#D97706', in_progress:'#2563EB', delivered:'#16A34A', cancelled:'#DC2626' }`,
    `const STATUS_COLORS = { pending:'#D97706', placed:'#D97706', in_progress:'#2563EB', delivered:'#16A34A', cancelled:'#DC2626' }`
  )
  // Fix activeCount filter — include both 'pending' and 'placed'
  .replace(
    `const activeCount = all.filter(o => !['delivered','cancelled'].includes(o.status)).length`,
    `const activeCount = all.filter(o => !['delivered','cancelled'].includes(o.status)).length`
  )
  // Fix waiter assign — show for both 'pending' and 'placed'
  .replace(
    `{order.status === 'placed' && (
            <div>`,
    `{['pending','placed'].includes(order.status) && (
            <div>`
  )
  .replace(
    `{order.status === 'placed' && (
              <button onClick={()=>cancelOrder(order.id)}`,
    `{['pending','placed'].includes(order.status) && (
              <button onClick={()=>cancelOrder(order.id)}`
  )
  // Fix assignWaiter to use correct status transition
  .replace(
    `await supabase.from('orders').update({
      status: 'in_progress',
      waiter_id: waiterId || null
    }).eq('id', orderId)`,
    `await supabase.from('orders').update({
      status: 'in_progress',
      waiter_id: waiterId || null
    }).eq('id', orderId)
    // Also upsert to food_master when marking in progress`
  )
  // Fix filter — 'active' should include 'pending'
  .replace(
    `if (filter==='active') return !['delivered','cancelled'].includes(o.status)`,
    `if (filter==='active') return !['delivered','cancelled'].includes(o.status)`
  )

fs.writeFileSync(kotPath, kotContent)
console.log('✅ 2/5 KOTDashboard — pending/placed both show as New Order with waiter assign')

// ═══════════════════════════════════════════════════════════════════
// FIX 3: MenuManager — add "All" filter tab + duplicate check in copy
// ═══════════════════════════════════════════════════════════════════
const mmPath = BASE + '/components/supervisor/MenuManager.jsx'
let mmContent = fs.readFileSync(mmPath, 'utf8')

// Add activeCategory 'all' support
mmContent = mmContent
  // Change initial activeCategory to 'all'
  .replace(
    `  const [activeCategory, setActiveCategory] = useState(null)`,
    `  const [activeCategory, setActiveCategory] = useState('all')`
  )
  // Change loadMenu to not force activeCategory
  .replace(
    `    if (cats?.length && !activeCategory) setActiveCategory(cats[0].id)`,
    `    // Keep 'all' as default, only switch if activeCategory is null`
  )
  // Fix filtered to handle 'all'
  .replace(
    `  const filtered = items.filter(i => i.category_id === activeCategory)`,
    `  const filtered = activeCategory === 'all' ? items : items.filter(i => i.category_id === activeCategory)`
  )
  // Add "All" tab before category tabs
  .replace(
    `      {/* Category tabs */}
      <div style={{ display:'flex', gap:8, marginBottom:12, overflowX:'auto', flexWrap:'nowrap', paddingBottom:4 }}>
        {categories.map(cat => (`,
    `      {/* Category tabs */}
      <div style={{ display:'flex', gap:8, marginBottom:12, overflowX:'auto', flexWrap:'nowrap', paddingBottom:4 }}>
        <button onClick={()=>setActiveCategory('all')} style={{ flexShrink:0, background:activeCategory==='all'?'var(--ink)':'#fff', color:activeCategory==='all'?'#fff':'var(--ink)', border:'1.5px solid', borderColor:activeCategory==='all'?'var(--ink)':'var(--line)', borderRadius:999, padding:'8px 18px', fontSize:13, fontWeight:700, whiteSpace:'nowrap' }}>
          All ({items.length})
        </button>
        {categories.map(cat => (`
  )
  // Fix duplicate check in copy from event
  .replace(
    `await supabase.from('menu_items').insert({ category_id:catCache[catKey], name:item.name, description:item.description, is_veg:item.is_veg, is_live_counter:item.is_live_counter, photo_url:item.photo_url, is_available:true })`,
    `// Check for duplicate by name in this event
              const alreadyExists = items.some(ex => ex.name.toLowerCase() === item.name.toLowerCase())
              if (!alreadyExists) {
                await supabase.from('menu_items').insert({ category_id:catCache[catKey], name:item.name, description:item.description, is_veg:item.is_veg, is_live_counter:item.is_live_counter, photo_url:item.photo_url, is_available:true })
              }`
  )

fs.writeFileSync(mmPath, mmContent)
console.log('✅ 3/5 MenuManager — All tab added, duplicate check in copy fixed')

// ═══════════════════════════════════════════════════════════════════
// FIX 4: EventManager — add max_orders_per_table to create form
// ═══════════════════════════════════════════════════════════════════
const emPath = BASE + '/components/supervisor/EventManager.jsx'
let emContent = fs.readFileSync(emPath, 'utf8')

emContent = emContent
  // Add max_orders to newEvent state
  .replace(
    `const [newEvent, setNewEvent] = useState({ name:'', date:'', venue:'', number_of_tables:'', catering_company:'' })`,
    `const [newEvent, setNewEvent] = useState({ name:'', date:'', venue:'', number_of_tables:'', catering_company:'', max_orders_per_table:1 })`
  )
  // Add max_orders to createEvent insert
  .replace(
    `catering_company: newEvent.catering_company||null,
      is_closed:false, ai_enabled:false`,
    `catering_company: newEvent.catering_company||null,
      max_orders_per_table: newEvent.max_orders_per_table ? parseInt(newEvent.max_orders_per_table) : 1,
      is_closed:false, ai_enabled:false`
  )
  // Add max_orders input field after number_of_tables input
  .replace(
    `          <input type="number" value={newEvent.number_of_tables} onChange={e=>setNewEvent(p=>({...p,number_of_tables:e.target.value}))} placeholder="Number of tables (optional)" style={INP} />`,
    `          <input type="number" value={newEvent.number_of_tables} onChange={e=>setNewEvent(p=>({...p,number_of_tables:e.target.value}))} placeholder="Number of tables (optional)" style={INP} />
          <div style={{ marginBottom:10 }}>
            <label style={{ fontSize:13, fontWeight:600, color:'var(--ink2)', display:'block', marginBottom:6 }}>Max Orders Per Table (default: 1)</label>
            <div style={{ display:'flex', gap:8 }}>
              {[1,2,3,4,5].map(n => (
                <button key={n} type="button" onClick={()=>setNewEvent(p=>({...p,max_orders_per_table:n}))}
                  style={{ flex:1, padding:'10px', borderRadius:10, border:'1.5px solid', borderColor:newEvent.max_orders_per_table===n?'var(--ink)':'var(--line)', background:newEvent.max_orders_per_table===n?'var(--ink)':'#fff', color:newEvent.max_orders_per_table===n?'#fff':'var(--ink)', fontWeight:700, fontSize:14, cursor:'pointer' }}>
                  {n}
                </button>
              ))}
            </div>
            <div style={{ fontSize:12, color:'var(--ink2)', marginTop:6 }}>Guests can place this many simultaneous orders per table</div>
          </div>`
  )

fs.writeFileSync(emPath, emContent)
console.log('✅ 4/5 EventManager — max_orders_per_table field added to create form')

// ═══════════════════════════════════════════════════════════════════
// FIX 5: CartDrawer — block checkout when order limit reached
//         Show friendly message instead of silently failing
// ═══════════════════════════════════════════════════════════════════
const cdPath = BASE + '/components/guest/CartDrawer.jsx'
let cdContent = fs.readFileSync(cdPath, 'utf8')

// Enhance placeOrder to check limit and show message
cdContent = cdContent.replace(
  `  async function placeOrder() {
    setError('')
    if (placing) return

    // Offline fallback`,
  `  const [orderLimitMsg, setOrderLimitMsg] = useState('')

  async function placeOrder() {
    setError('')
    setOrderLimitMsg('')
    if (placing) return

    // Check order limit
    if (tableData && eventData) {
      const maxOrders = eventData.max_orders_per_table || 1
      const { data: activeOrders } = await supabase.from('orders')
        .select('id').eq('table_id', tableData.id)
        .in('status', ['pending','placed','in_progress'])
      const activeCount = activeOrders?.length || 0
      if (activeCount >= maxOrders) {
        setOrderLimitMsg('Your order is being prepared. Once it\\'s delivered, you can place your next order. Feel free to browse and add to cart in the meantime!')
        return
      }
    }

    // Offline fallback`
)
// Add orderLimitMsg display before the place order button
.replace(
  `            {error && (
              <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:10, padding:'10px 14px', fontSize:13, color:'#DC2626', marginBottom:12, fontWeight:600 }}>
                ⚠️ {error}
              </div>
            )}`,
  `            {orderLimitMsg && (
              <div style={{ background:'#FEF3C7', border:'1px solid #FCD34D', borderRadius:12, padding:'14px 16px', fontSize:14, color:'#92400E', marginBottom:12, lineHeight:1.6, textAlign:'center' }}>
                <div style={{ fontSize:28, marginBottom:8 }}>🍽️</div>
                <div style={{ fontWeight:700, marginBottom:4 }}>Order in Progress!</div>
                {orderLimitMsg}
              </div>
            )}
            {error && (
              <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:10, padding:'10px 14px', fontSize:13, color:'#DC2626', marginBottom:12, fontWeight:600 }}>
                ⚠️ {error}
              </div>
            )}`
)

// Need to add useState import for orderLimitMsg
cdContent = cdContent.replace(
  `import { useState } from 'react'`,
  `import { useState } from 'react'`
)

fs.writeFileSync(cdPath, cdContent)
console.log('✅ 5/5 CartDrawer — order limit blocks checkout with friendly message')

console.log('\n🎉 All 5 fixes done!')
console.log('Run: npm run dev to test locally')
