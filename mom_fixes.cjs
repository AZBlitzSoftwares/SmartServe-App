const fs = require('fs')
const BASE = '/Users/asayyed/SmartServe/src'

// ═══════════════════════════════════════════════════════════════════
// FIX 1: MenuScreen — Swiggy-style chips + sticky category headers
// All items shown grouped, chips scroll to section
// ═══════════════════════════════════════════════════════════════════
fs.writeFileSync(BASE + '/components/guest/MenuScreen.jsx', `import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'

export default function MenuScreen({ tableNumber, eventData, cart, addToCart, removeFromCart, cartCount, isOnline, onShowSOS, onShowHistory, onShowStatus, currentOrderId, showFeedbackBubble, onFeedbackBubbleClick, onShowFeedback }) {
  const [categories, setCategories] = useState([])
  const [items, setItems] = useState([])
  const [search, setSearch] = useState('')
  const [vegMode, setVegMode] = useState('all')
  const [activeChip, setActiveChip] = useState('all')
  const [loading, setLoading] = useState(true)
  const sectionRefs = useRef({})
  const chipBarRef = useRef()
  const scrollRef = useRef()

  useEffect(() => { if (eventData) loadMenu() }, [eventData])

  async function loadMenu() {
    setLoading(true)
    const { data: cats } = await supabase.from('menu_categories').select('*').eq('event_id', eventData.id).eq('is_visible', true).order('sort_order')
    const { data: catIds } = { data: (cats||[]).map(c=>c.id) }
    const { data: menuItems } = catIds.length
      ? await supabase.from('menu_items').select('*').in('category_id', catIds).eq('is_available', true).order('name')
      : { data: [] }
    setCategories(cats||[])
    setItems(menuItems||[])
    setLoading(false)
  }

  // Scroll to category section
  function scrollToCategory(catId) {
    setActiveChip(catId)
    const el = sectionRefs.current[catId]
    if (el) el.scrollIntoView({ behavior:'smooth', block:'start' })
  }

  // Detect which category is in view while scrolling
  function handleScroll(e) {
    if (search.length > 0) return
    const scrollTop = e.target.scrollTop + 120
    let current = 'all'
    categories.forEach(cat => {
      const el = sectionRefs.current[cat.id]
      if (el && el.offsetTop <= scrollTop) current = cat.id
    })
    setActiveChip(current)
  }

  const filtered = items.filter(i => {
    const matchSearch = search.length === 0 || i.name.toLowerCase().includes(search.toLowerCase()) || (i.description||'').toLowerCase().includes(search.toLowerCase())
    const matchVeg = vegMode === 'all' || (vegMode==='veg' ? i.is_veg!==false : i.is_veg===false)
    return matchSearch && matchVeg
  })

  // Group items by category (for section view)
  const grouped = categories.map(cat => ({
    cat,
    items: filtered.filter(i => i.category_id === cat.id)
  })).filter(g => g.items.length > 0)

  // Flat list for search
  const flatFiltered = search.length > 0 ? filtered : null

  const getQty = id => cart.find(c=>c.id===id)?.quantity||0

  function ItemCard({ item }) {
    const qty = getQty(item.id)
    const isVeg = item.is_veg !== false
    return (
      <div style={{ background:'#fff', borderBottom:'1px solid #F0F0F0', padding:'14px 16px', display:'flex', gap:12, alignItems:'flex-start' }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:5 }}>
            <span style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:16, height:16, borderRadius:3, border:'2px solid '+(isVeg?'#16A34A':'#DC2626'), flexShrink:0 }}>
              <span style={{ width:7, height:7, borderRadius:'50%', background:isVeg?'#16A34A':'#DC2626', display:'block' }}></span>
            </span>
            {item.is_live_counter && <span style={{ fontSize:10, color:'#D97706', fontWeight:700, background:'#FEF3C7', padding:'1px 7px', borderRadius:999 }}>⏱ Live counter</span>}
          </div>
          <div style={{ fontWeight:700, fontSize:15, color:'#1A1A1A', marginBottom:4, lineHeight:1.3 }}>{item.name}</div>
          {item.description && <div style={{ fontSize:12, color:'#888', lineHeight:1.5, marginBottom:10, display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>{item.description}</div>}
          {qty===0
            ? <button onClick={()=>addToCart(item)} style={{ background:'#fff', color:'#E8890C', border:'1.5px solid #E8890C', borderRadius:8, padding:'7px 22px', fontSize:13, fontWeight:800, cursor:'pointer', letterSpacing:'0.3px' }}>ADD +</button>
            : <div style={{ display:'inline-flex', alignItems:'center', background:'#E8890C', borderRadius:8, overflow:'hidden' }}>
                <button onClick={()=>removeFromCart(item.id)} style={{ background:'none', border:'none', color:'#fff', fontSize:20, fontWeight:800, cursor:'pointer', padding:'5px 13px', lineHeight:1 }}>−</button>
                <span style={{ color:'#fff', fontWeight:800, fontSize:14, minWidth:22, textAlign:'center' }}>{qty}</span>
                <button onClick={()=>addToCart(item)} style={{ background:'none', border:'none', color:'#fff', fontSize:20, fontWeight:800, cursor:'pointer', padding:'5px 13px', lineHeight:1 }}>+</button>
              </div>
          }
        </div>
        <div style={{ flexShrink:0, width:110, height:90, borderRadius:12, overflow:'hidden' }}>
          {item.photo_url
            ? <img src={item.photo_url} alt={item.name} style={{ width:'100%', height:'100%', objectFit:'cover' }} onError={e=>e.target.style.display='none'} />
            : <div style={{ width:'100%', height:'100%', background:'linear-gradient(135deg,#F7F4FB,#E8E0F0)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:36 }}>🍽️</div>
          }
        </div>
      </div>
    )
  }

  return (
    <div style={{ height:'100vh', display:'flex', flexDirection:'column', background:'#F5F5F5', overflow:'hidden' }}>

      {/* HEADER */}
      <div style={{ background:'#1A0A0A', padding:'10px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, minWidth:0 }}>
          {eventData?.catering_logo_url && <img src={eventData.catering_logo_url} alt="" style={{ width:36, height:36, objectFit:'contain', borderRadius:8, background:'rgba(255,255,255,0.1)', padding:3, flexShrink:0 }} onError={e=>e.target.style.display='none'} />}
          <div style={{ minWidth:0 }}>
            {eventData?.catering_company
              ? <><div style={{ color:'#fff', fontWeight:800, fontSize:15, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{eventData.catering_company}</div>
                  <div style={{ color:'rgba(255,255,255,0.4)', fontSize:10 }}>by Janu's Smart Serve</div></>
              : <div style={{ color:'#fff', fontWeight:800, fontSize:17 }}>Janu's <span style={{ color:'#E8890C' }}>Smart Serve</span></div>
            }
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
          {isOnline===false && <span style={{ background:'#DC2626', color:'#fff', fontSize:10, fontWeight:700, padding:'2px 6px', borderRadius:999 }}>OFFLINE</span>}
          <div style={{ background:'rgba(255,255,255,0.15)', color:'#fff', fontSize:12, fontWeight:700, padding:'5px 12px', borderRadius:999 }}>TABLE {tableNumber}</div>
        </div>
      </div>

      {/* ACTION BAR */}
      <div style={{ display:'flex', gap:8, padding:'8px 14px', background:'#fff', borderBottom:'1px solid #eee', overflowX:'auto', flexShrink:0, scrollbarWidth:'none' }}>
        {currentOrderId && <button onClick={onShowStatus} style={{ flexShrink:0, background:'#16A34A', color:'#fff', border:'none', borderRadius:999, padding:'6px 14px', fontSize:12, fontWeight:700, cursor:'pointer' }}>📦 Track Order</button>}
        <button onClick={onShowHistory} style={{ flexShrink:0, background:'#fff', color:'#333', border:'1.5px solid #ddd', borderRadius:999, padding:'6px 14px', fontSize:12, fontWeight:600, cursor:'pointer' }}>📋 History</button>
        {eventData?.call_waiter_enabled!==false && <button onClick={onShowSOS} style={{ flexShrink:0, background:'#FEF3C7', color:'#92400E', border:'1.5px solid #FCD34D', borderRadius:999, padding:'6px 14px', fontSize:12, fontWeight:700, cursor:'pointer' }}>🛎️ Call Waiter</button>}
        <button onClick={onShowFeedback} style={{ flexShrink:0, background:'#FFF7ED', color:'#C2410C', border:'1.5px solid #FED7AA', borderRadius:999, padding:'6px 14px', fontSize:12, fontWeight:700, cursor:'pointer' }}>⭐ Feedback</button>
      </div>

      {/* SEARCH */}
      <div style={{ padding:'8px 14px', background:'#fff', borderBottom:'1px solid #eee', flexShrink:0 }}>
        <div style={{ background:'#F5F5F5', borderRadius:12, padding:'8px 14px', display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:16 }}>🔍</span>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search dishes..."
            style={{ border:'none', outline:'none', flex:1, fontSize:14, fontFamily:'Manrope', background:'transparent' }} />
          {search.length>0 && <button onClick={()=>setSearch('')} style={{ background:'none', border:'none', fontSize:16, color:'#999', cursor:'pointer' }}>✕</button>}
        </div>
      </div>

      {/* VEG FILTER */}
      <div style={{ display:'flex', gap:8, padding:'8px 14px', background:'#fff', borderBottom:'1px solid #eee', flexShrink:0, overflowX:'auto', scrollbarWidth:'none' }}>
        {[['all','🍽️ All'],['veg','🟢 Veg Only'],['nonveg','🔴 Non-Veg']].map(([val,label]) => (
          <button key={val} onClick={()=>setVegMode(val)} style={{ flexShrink:0, padding:'5px 14px', borderRadius:999, fontSize:12, fontWeight:700, border:'1.5px solid', cursor:'pointer', background:vegMode===val?(val==='veg'?'#16A34A':val==='nonveg'?'#DC2626':'#1A0A0A'):'#fff', color:vegMode===val?'#fff':'#555', borderColor:vegMode===val?'transparent':'#ddd' }}>{label}</button>
        ))}
      </div>

      {/* SWIGGY-STYLE CATEGORY CHIPS */}
      {search.length===0 && (
        <div ref={chipBarRef} style={{ display:'flex', gap:8, padding:'10px 14px', background:'#fff', borderBottom:'2px solid #F0F0F0', overflowX:'auto', flexShrink:0, scrollbarWidth:'none' }}>
          <button onClick={()=>{ setActiveChip('all'); scrollRef.current?.scrollTo({top:0,behavior:'smooth'}) }}
            style={{ flexShrink:0, padding:'7px 18px', borderRadius:999, fontSize:13, fontWeight:700, border:'none', cursor:'pointer', background:activeChip==='all'?'#1A0A0A':'#F5F5F5', color:activeChip==='all'?'#fff':'#444', transition:'all 0.15s' }}>
            All
          </button>
          {categories.map(cat => (
            <button key={cat.id} onClick={()=>scrollToCategory(cat.id)}
              style={{ flexShrink:0, padding:'7px 18px', borderRadius:999, fontSize:13, fontWeight:700, border:'none', cursor:'pointer', background:activeChip===cat.id?'#1A0A0A':'#F5F5F5', color:activeChip===cat.id?'#fff':'#444', transition:'all 0.15s', whiteSpace:'nowrap' }}>
              {cat.name}
              <span style={{ fontSize:11, marginLeft:5, opacity:0.6 }}>({items.filter(i=>i.category_id===cat.id).length})</span>
            </button>
          ))}
        </div>
      )}

      {/* SCROLLABLE MENU CONTENT */}
      <div ref={scrollRef} onScroll={handleScroll} style={{ flex:1, overflowY:'auto', paddingBottom: cartCount>0?100:24 }}>
        {loading ? (
          <div style={{ textAlign:'center', padding:60, color:'#888' }}>Loading menu...</div>
        ) : search.length>0 ? (
          // SEARCH RESULTS — flat list
          <>
            <div style={{ padding:'10px 16px 6px', fontSize:13, color:'#888', fontWeight:600 }}>{filtered.length} results for "{search}"</div>
            {filtered.length===0
              ? <div style={{ textAlign:'center', padding:60 }}><div style={{ fontSize:40, marginBottom:12 }}>🔍</div><div style={{ color:'#888', fontWeight:600 }}>No dishes found</div></div>
              : filtered.map(item => <ItemCard key={item.id} item={item} />)
            }
          </>
        ) : (
          // GROUPED BY CATEGORY with sticky section headers
          grouped.length===0
            ? <div style={{ textAlign:'center', padding:60 }}><div style={{ fontSize:40, marginBottom:12 }}>🍽️</div><div style={{ color:'#888', fontWeight:600 }}>No items available</div></div>
            : grouped.map(({ cat, items: catItems }) => (
              <div key={cat.id} ref={el=>sectionRefs.current[cat.id]=el}>
                {/* Sticky category header */}
                <div style={{ position:'sticky', top:0, zIndex:10, background:'#EEEEF0', padding:'8px 16px', borderBottom:'1px solid #E0E0E0', borderTop:'1px solid #E0E0E0' }}>
                  <span style={{ fontWeight:800, fontSize:14, color:'#1A1A1A' }}>{cat.name}</span>
                  <span style={{ fontSize:12, color:'#888', marginLeft:8 }}>{catItems.length} item{catItems.length!==1?'s':''}</span>
                </div>
                {catItems.map(item => <ItemCard key={item.id} item={item} />)}
              </div>
            ))
        )}
      </div>

      {/* FEEDBACK BUBBLE */}
      {showFeedbackBubble && (
        <>
          <style>{\`@keyframes fbP{0%,100%{transform:translateY(0)}40%{transform:translateY(-12px)}70%{transform:translateY(-5px)}}.fbb{animation:fbP 1.8s ease-in-out infinite}\`}</style>
          <button className="fbb" onClick={onFeedbackBubbleClick} style={{ position:'fixed', bottom:cartCount>0?90:28, right:16, zIndex:80, background:'#E8890C', border:'3px solid #fff', borderRadius:50, padding:'13px 16px', display:'flex', flexDirection:'column', alignItems:'center', gap:3, cursor:'pointer', boxShadow:'0 8px 28px rgba(232,137,12,0.6)', color:'#fff', minWidth:76 }}>
            <span style={{ fontSize:28 }}>⭐</span>
            <span style={{ fontSize:10, fontWeight:800, whiteSpace:'nowrap' }}>Rate Us!</span>
          </button>
        </>
      )}
    </div>
  )
}
`)
console.log('✅ 1/4 MenuScreen — Swiggy chips + sticky category headers + scroll-to-section')

// ═══════════════════════════════════════════════════════════════════
// FIX 2: FeedbackModal — remove Presentation, add App Experience
// ═══════════════════════════════════════════════════════════════════
const fbPath = BASE + '/components/guest/FeedbackModal.jsx'
let fbContent = fs.readFileSync(fbPath, 'utf8')

fbContent = fbContent.replace(
  `  const [presentation, setPresentation] = useState(0); const [hp, setHp] = useState(0)`,
  `  const [appExp, setAppExp] = useState(0); const [happ, setHapp] = useState(0)`
).replace(
  `presentation_rating: presentation||null,`,
  `app_experience_rating: appExp||null,`
).replace(
  `{[['Food Quality',food,hf,setFood,setHf],['Service Speed',service,hs,setService,setHs],['Presentation',presentation,hp,setPresentation,setHp]].map(([label,val,hov,setVal,setHov]) => (`,
  `{[['Food Quality',food,hf,setFood,setHf],['Service Speed',service,hs,setService,setHs],["Janu's App Experience",appExp,happ,setAppExp,setHapp]].map(([label,val,hov,setVal,setHov]) => (`
)

fs.writeFileSync(fbPath, fbContent)
console.log('✅ 2/4 FeedbackModal — Presentation removed, App Experience added')

// ═══════════════════════════════════════════════════════════════════
// FIX 3: KOTDashboard — live timer + waiter table filter
// ═══════════════════════════════════════════════════════════════════
const kotPath = BASE + '/components/supervisor/KOTDashboard.jsx'
let kotContent = fs.readFileSync(kotPath, 'utf8')

// Add timer hook + waiter filter state
kotContent = kotContent.replace(
  `  const [assigning, setAssigning] = useState(null)
  const prevCount = useRef(-1)
  const audioEnabled = useRef(false)`,
  `  const [assigning, setAssigning] = useState(null)
  const [waiterFilter, setWaiterFilter] = useState(null) // waiter id to filter by
  const [now, setNow] = useState(Date.now())
  const prevCount = useRef(-1)
  const audioEnabled = useRef(false)

  // Tick every second for live timer
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])`
)

// Add timer format helper after loadWaiters function
kotContent = kotContent.replace(
  `  async function loadOrders(showSpinner = false) {`,
  `  function formatTimer(assignedAt) {
    if (!assignedAt) return null
    const secs = Math.floor((Date.now() - new Date(assignedAt).getTime()) / 1000)
    const m = Math.floor(secs/60)
    const s = secs % 60
    return { str: m + ':' + String(s).padStart(2,'0'), mins: m, secs }
  }

  async function loadOrders(showSpinner = false) {`
)

// Add assigned_at to orders query
kotContent = kotContent.replace(
  `.select('*, tables(table_number), order_items(quantity, menu_items(name, is_live_counter)), waiters(name)')`,
  `.select('*, tables(table_number), order_items(quantity, menu_items(name, is_live_counter)), waiters(name), assigned_at')`
)

// Add assigned_at when assigning waiter
kotContent = kotContent.replace(
  `    await supabase.from('orders').update({
      status: 'in_progress',
      waiter_id: waiterId || null
    }).eq('id', orderId)`,
  `    await supabase.from('orders').update({
      status: 'in_progress',
      waiter_id: waiterId || null,
      assigned_at: waiterId ? new Date().toISOString() : null
    }).eq('id', orderId)`
)

// Add waiter filter click on waiter status panel
kotContent = kotContent.replace(
  `              return (
                <div key={w.id} style={{ background:busy?'#FEF2F2':'#F0FDF4', border:'1.5px solid', borderColor:busy?'#FECACA':'#BBF7D0', borderRadius:10, padding:'6px 12px', fontSize:12 }}>
                  <span style={{ fontWeight:800, color:busy?'#DC2626':'#16A34A' }}>{w.name}</span>
                  {busy && assignedOrder && <span style={{ color:'#888', marginLeft:6 }}>→ T{assignedOrder.tables?.table_number}</span>}
                  <span style={{ marginLeft:6, fontSize:11 }}>{busy?'🔴 Busy':'🟢 Free'}</span>
                </div>
              )`,
  `              return (
                <div key={w.id} onClick={()=>setWaiterFilter(waiterFilter===w.id?null:w.id)}
                  style={{ background: waiterFilter===w.id?'#1A0A0A':busy?'#FEF2F2':'#F0FDF4', border:'2px solid', borderColor:waiterFilter===w.id?'#E8890C':busy?'#FECACA':'#BBF7D0', borderRadius:10, padding:'6px 12px', fontSize:12, cursor:'pointer', transition:'all 0.15s' }}>
                  <span style={{ fontWeight:800, color:waiterFilter===w.id?'#E8890C':busy?'#DC2626':'#16A34A' }}>{w.name}</span>
                  {busy && assignedOrder && <span style={{ color:waiterFilter===w.id?'rgba(255,255,255,0.6)':'#888', marginLeft:6 }}>→ T{assignedOrder.tables?.table_number}</span>}
                  <span style={{ marginLeft:6, fontSize:11 }}>{busy?'🔴 Busy':'🟢 Free'}</span>
                  {waiterFilter===w.id && <span style={{ marginLeft:6, fontSize:10, color:'#E8890C', fontWeight:800 }}>● Filtered</span>}
                </div>
              )`
)

// Apply waiter filter to orders list + add timer on order card
kotContent = kotContent.replace(
  `  const filtered = orders.filter(o => {
    if (filter==='active') return !['delivered','cancelled'].includes(o.status)
    if (filter==='delivered') return o.status==='delivered'
    return true
  })`,
  `  const filtered = orders.filter(o => {
    const matchFilter = filter==='active' ? !['delivered','cancelled'].includes(o.status) : filter==='delivered' ? o.status==='delivered' : true
    const matchWaiter = !waiterFilter || o.waiter_id===waiterFilter
    return matchFilter && matchWaiter
  })`
)

// Add timer display on in_progress order cards
kotContent = kotContent.replace(
  `              {order.waiters?.name && <div style={{ fontSize:12, color:'#2563EB', marginTop:2, fontWeight:600 }}>👤 {order.waiters.name}</div>}`,
  `              {order.waiters?.name && <div style={{ fontSize:12, color:'#2563EB', marginTop:2, fontWeight:600 }}>👤 {order.waiters.name}</div>}
              {order.status==='in_progress' && order.assigned_at && (() => {
                const t = formatTimer(order.assigned_at)
                return t ? (
                  <div style={{ fontSize:13, fontWeight:800, marginTop:4, color: t.mins>=15?'#DC2626':t.mins>=10?'#D97706':'#16A34A', display:'flex', alignItems:'center', gap:4 }}>
                    <span>⏱</span>
                    <span>{t.str}</span>
                    {t.mins>=15 && <span style={{ fontSize:11, background:'#FEF2F2', color:'#DC2626', padding:'1px 6px', borderRadius:999, marginLeft:4 }}>Taking long</span>}
                  </div>
                ) : null
              })()}`
)

// Add waiter filter clear indicator
kotContent = kotContent.replace(
  `      {/* Filter tabs */}
      <div style={{ display:'flex', gap:8, marginBottom:14 }}>`,
  `      {/* Waiter filter active indicator */}
      {waiterFilter && (
        <div style={{ background:'#FEF3C7', border:'1px solid #FCD34D', borderRadius:10, padding:'8px 14px', marginBottom:10, display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:13 }}>
          <span style={{ fontWeight:700, color:'#92400E' }}>🔍 Filtered by: {waiters.find(w=>w.id===waiterFilter)?.name}</span>
          <button onClick={()=>setWaiterFilter(null)} style={{ background:'none', border:'none', color:'#92400E', fontWeight:700, cursor:'pointer', fontSize:13 }}>Clear ✕</button>
        </div>
      )}

      {/* Filter tabs */}
      <div style={{ display:'flex', gap:8, marginBottom:14 }}>`
)

fs.writeFileSync(kotPath, kotContent)
console.log('✅ 3/4 KOTDashboard — live timer (green→yellow→red) + waiter table filter')

// ═══════════════════════════════════════════════════════════════════
// FIX 4: ReportsDashboard — detailed feedback/rating section
// ═══════════════════════════════════════════════════════════════════
const rdPath = BASE + '/components/supervisor/ReportsDashboard.jsx'
let rdContent = fs.readFileSync(rdPath, 'utf8')

// Update feedback query to get more fields
rdContent = rdContent.replace(
  `supabase.from('feedback').select('*').eq('event_id', evId),`,
  `supabase.from('feedback').select('*, tables(table_number)').eq('event_id', evId),`
)

// Replace feedback display section with detailed version
rdContent = rdContent.replace(
  `      {/* Feedback */}
      {data.fb.length>0 && (
        <div style={{ background:'#fff', borderRadius:16, padding:16, marginBottom:16, boxShadow:'var(--shadow)' }}>
          <div style={{ fontWeight:800, fontSize:16, marginBottom:12 }}>Guest Feedback ({data.fb.length})</div>
          {data.fb.map((f,i) => (
            <div key={i} style={{ padding:'10px 0', borderBottom:'1px solid var(--line)' }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                <span style={{ fontWeight:700, fontSize:14 }}>{f.guest_name||'Anonymous'}</span>
                <span style={{ color:'#E8890C', fontWeight:700 }}>{'⭐'.repeat(f.rating||0)}</span>
              </div>
              {f.comment && <div style={{ fontSize:13, color:'var(--ink2)' }}>{f.comment}</div>}
            </div>
          ))}
        </div>
      )}`,
  `      {/* Detailed Feedback */}
      {data.fb.length>0 && (
        <div style={{ background:'#fff', borderRadius:16, padding:16, marginBottom:16, boxShadow:'var(--shadow)' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
            <div style={{ fontWeight:800, fontSize:16 }}>Guest Feedback</div>
            <div style={{ fontSize:13, color:'var(--ink2)' }}>{data.fb.length} response{data.fb.length!==1?'s':''}</div>
          </div>

          {/* Rating summary */}
          {(() => {
            const avg = r => data.fb.filter(f=>f[r]).length ? (data.fb.reduce((s,f)=>s+(f[r]||0),0)/data.fb.filter(f=>f[r]).length).toFixed(1) : null
            const rows = [
              { label:'Overall', key:'rating' },
              { label:'Food Quality', key:'food_rating' },
              { label:'Service Speed', key:'service_rating' },
              { label:"App Experience", key:'app_experience_rating' },
            ]
            return (
              <div style={{ background:'var(--bg)', borderRadius:12, padding:14, marginBottom:16 }}>
                <div style={{ fontWeight:700, fontSize:13, marginBottom:10 }}>Average Ratings</div>
                {rows.map(r => {
                  const a = avg(r.key)
                  if (!a) return null
                  const pct = (parseFloat(a)/5)*100
                  return (
                    <div key={r.key} style={{ marginBottom:8 }}>
                      <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:3 }}>
                        <span style={{ fontWeight:600 }}>{r.label}</span>
                        <span style={{ fontWeight:800, color:'#E8890C' }}>{a} ⭐</span>
                      </div>
                      <div style={{ height:6, background:'#E5E7EB', borderRadius:999, overflow:'hidden' }}>
                        <div style={{ height:'100%', width:pct+'%', background:'#E8890C', borderRadius:999, transition:'width 0.5s' }}></div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })()}

          {/* Individual responses */}
          {data.fb.map((f,i) => (
            <div key={i} style={{ padding:'12px 0', borderBottom:'1px solid var(--line)' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:6 }}>
                <div>
                  <span style={{ fontWeight:700, fontSize:14 }}>{f.guest_name||'Anonymous'}</span>
                  {f.tables?.table_number && <span style={{ fontSize:12, color:'var(--ink2)', marginLeft:8 }}>Table {f.tables.table_number}</span>}
                  {f.guest_email && <span style={{ fontSize:11, color:'#888', marginLeft:8 }}>{f.guest_email}</span>}
                  {f.guest_mobile && <span style={{ fontSize:11, color:'#888', marginLeft:8 }}>📞 {f.guest_mobile}</span>}
                </div>
                <div style={{ textAlign:'right' }}>
                  <div style={{ color:'#E8890C', fontWeight:800, fontSize:15 }}>{'⭐'.repeat(f.rating||0)}</div>
                  <div style={{ fontSize:11, color:'var(--ink2)', marginTop:2 }}>{new Date(f.created_at).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true})}</div>
                </div>
              </div>
              {(f.food_rating||f.service_rating||f.app_experience_rating) && (
                <div style={{ display:'flex', gap:8, marginBottom:6, flexWrap:'wrap' }}>
                  {f.food_rating && <span style={{ fontSize:11, background:'#FEF3C7', color:'#92400E', padding:'2px 8px', borderRadius:999, fontWeight:600 }}>Food: {f.food_rating}⭐</span>}
                  {f.service_rating && <span style={{ fontSize:11, background:'#EFF6FF', color:'#2563EB', padding:'2px 8px', borderRadius:999, fontWeight:600 }}>Service: {f.service_rating}⭐</span>}
                  {f.app_experience_rating && <span style={{ fontSize:11, background:'#F5F3FF', color:'#7C3AED', padding:'2px 8px', borderRadius:999, fontWeight:600 }}>App: {f.app_experience_rating}⭐</span>}
                </div>
              )}
              {f.comment && <div style={{ fontSize:13, color:'#444', fontStyle:'italic', lineHeight:1.5 }}>"{f.comment}"</div>}
            </div>
          ))}
        </div>
      )}`
)

fs.writeFileSync(rdPath, rdContent)
console.log('✅ 4/4 ReportsDashboard — detailed feedback with ratings bar chart + table + time')
console.log('\n🎉 All MOM items built! Run SQL then: npm run dev')
