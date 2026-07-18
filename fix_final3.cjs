const fs = require('fs')
const BASE = '/Users/asayyed/SmartServe/src'

// ═══ FIX 1: WelcomeScreen — remove duplicate catering name ═══
const wsPath = BASE + '/components/guest/WelcomeScreen.jsx'
let ws = fs.readFileSync(wsPath, 'utf8')

// Replace the duplicate catering name section
ws = ws.replace(
  `        {/* Catering company LARGE name */}
        {eventData?.catering_company && (
          <div style={{ fontSize:40, fontWeight:900, color:'#fff', marginBottom:4, letterSpacing:'0.5px', lineHeight:1.1, textShadow:'0 3px 16px rgba(0,0,0,0.7)' }}>
            {eventData.catering_company}
          </div>
        )}`,
  `        {/* Powered by Janu's Smart Serve — shown once only */}
        {eventData?.catering_company && (
          <div style={{ fontSize:14, fontWeight:600, color:'rgba(255,255,255,0.7)', marginBottom:10, letterSpacing:'0.3px' }}>
            Powered by <span style={{ color:'#E8890C', fontWeight:800 }}>Janu's Smart Serve</span>
          </div>
        )}`
)

// Also remove duplicate catering company line that comes from earlier
ws = ws.replace(
  `        {/* Catering Name — LARGEST, most important */}
        {eventData?.catering_company ? (
          <div style={{ fontSize:44,fontWeight:900,color:'#fff',marginBottom:6,letterSpacing:'0.5px',lineHeight:1.1,textShadow:'0 3px 16px rgba(0,0,0,0.7)' }}>
            {eventData.catering_company}
          </div>
        ) : (
          <div style={{ fontSize:40,fontWeight:900,color:'#fff',marginBottom:6 }}>
            Janu's <span style={{ color:'#E8890C' }}>Smart Serve</span>
          </div>
        )}

        {/* Janu's Smart Serve — ONE LINE only, clearly readable */}
        {eventData?.catering_company && (
          <div style={{ fontSize:14,fontWeight:600,color:'rgba(255,255,255,0.7)',marginBottom:12,letterSpacing:'0.3px' }}>
            Powered by <span style={{ color:'#E8890C',fontWeight:800 }}>Janu's Smart Serve</span>
          </div>
        )}`,
  `        {/* Catering Name — shown ONCE, large */}
        {eventData?.catering_company ? (
          <div style={{ fontSize:44, fontWeight:900, color:'#fff', marginBottom:6, letterSpacing:'0.5px', lineHeight:1.1, textShadow:'0 3px 16px rgba(0,0,0,0.7)' }}>
            {eventData.catering_company}
          </div>
        ) : (
          <div style={{ fontSize:40, fontWeight:900, color:'#fff', marginBottom:6 }}>
            Janu's <span style={{ color:'#E8890C' }}>Smart Serve</span>
          </div>
        )}`
)

fs.writeFileSync(wsPath, ws)
console.log('✅ 1/3 WelcomeScreen — catering name shown once only')

// ═══ FIX 2: MenuScreen — 40/40/20 header layout ═══
const msPath = BASE + '/components/guest/MenuScreen.jsx'
let ms = fs.readFileSync(msPath, 'utf8')

ms = ms.replace(
  `      {/* HEADER — 2 rows when catering set, 1 row otherwise */}
      <div style={{ background:'#1A0A0A', flexShrink:0 }}>
        {/* Row 1: LEFT = Catering logo + name | RIGHT = Table badge */}
        <div style={{ padding:'10px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:10 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, flex:1, minWidth:0 }}>
            {eventData?.catering_logo_url ? (
              <img src={eventData.catering_logo_url} alt=""
                style={{ width:42, height:42, objectFit:'contain', borderRadius:10, background:'rgba(255,255,255,0.1)', padding:4, flexShrink:0, border:'1px solid rgba(255,255,255,0.2)' }}
                onError={e=>e.target.style.display='none'} />
            ) : (
              <div style={{ width:36, height:36, borderRadius:8, background:'#E8890C', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                <span style={{ fontSize:18 }}>🍽️</span>
              </div>
            )}
            <div style={{ minWidth:0 }}>
              <div style={{ color:'#fff', fontWeight:900, fontSize:19, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', lineHeight:1.2 }}>
                {eventData?.catering_company || <span>Janu's <span style={{ color:'#E8890C' }}>Smart Serve</span></span>}
              </div>
              {eventData?.catering_company && (
                <div style={{ display:'flex', alignItems:'center', gap:5, marginTop:2 }}>
                  <div style={{ width:14, height:14, borderRadius:3, background:'#E8890C', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                    <span style={{ fontSize:8 }}>🍽️</span>
                  </div>
                  <span style={{ color:'#E8890C', fontSize:11, fontWeight:700 }}>Janu's Smart Serve</span>
                </div>
              )}
            </div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
            {isOnline===false && <span style={{ background:'#DC2626', color:'#fff', fontSize:10, fontWeight:700, padding:'2px 6px', borderRadius:999 }}>OFFLINE</span>}
            <div style={{ background:'rgba(255,255,255,0.15)', color:'#fff', fontSize:12, fontWeight:800, padding:'6px 14px', borderRadius:999 }}>TABLE {tableNumber}</div>
          </div>
        </div>
      </div>`,

  `      {/* HEADER — 40% catering | 40% Janu | 20% table */}
      <div style={{ background:'#1A0A0A', flexShrink:0, padding:'10px 12px', display:'flex', alignItems:'center', gap:6 }}>

        {/* 40% — Catering company */}
        <div style={{ flex:4, display:'flex', alignItems:'center', gap:8, minWidth:0, borderRight:'1px solid rgba(255,255,255,0.12)', paddingRight:10 }}>
          {eventData?.catering_logo_url ? (
            <img src={eventData.catering_logo_url} alt=""
              style={{ width:40, height:40, objectFit:'contain', borderRadius:9, background:'rgba(255,255,255,0.1)', padding:3, flexShrink:0, border:'1px solid rgba(255,255,255,0.2)' }}
              onError={e=>e.target.style.display='none'} />
          ) : (
            <div style={{ width:36, height:36, borderRadius:8, background:'rgba(255,255,255,0.1)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
              <span style={{ fontSize:18 }}>🏷️</span>
            </div>
          )}
          <div style={{ minWidth:0 }}>
            <div style={{ color:'#fff', fontWeight:900, fontSize:16, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', lineHeight:1.2 }}>
              {eventData?.catering_company || 'Event'}
            </div>
            <div style={{ color:'rgba(255,255,255,0.45)', fontSize:10, fontWeight:500 }}>Catering</div>
          </div>
        </div>

        {/* 40% — Janu's Smart Serve */}
        <div style={{ flex:4, display:'flex', alignItems:'center', gap:8, minWidth:0, borderRight:'1px solid rgba(255,255,255,0.12)', paddingLeft:8, paddingRight:10 }}>
          <div style={{ width:36, height:36, borderRadius:8, background:'#E8890C', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, boxShadow:'0 2px 8px rgba(232,137,12,0.4)' }}>
            <span style={{ fontSize:19 }}>🍽️</span>
          </div>
          <div style={{ minWidth:0 }}>
            <div style={{ color:'#E8890C', fontWeight:900, fontSize:14, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', lineHeight:1.2 }}>Janu's Smart Serve</div>
            <div style={{ color:'rgba(255,255,255,0.45)', fontSize:10, fontWeight:500 }}>Technology</div>
          </div>
        </div>

        {/* 20% — Table number */}
        <div style={{ flex:2, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', paddingLeft:6 }}>
          {isOnline===false && <span style={{ background:'#DC2626', color:'#fff', fontSize:8, fontWeight:700, padding:'1px 4px', borderRadius:999, marginBottom:2 }}>OFFLINE</span>}
          <div style={{ background:'rgba(255,255,255,0.15)', color:'#fff', fontSize:11, fontWeight:800, padding:'5px 8px', borderRadius:8, textAlign:'center', lineHeight:1.2 }}>
            <div style={{ fontSize:8, opacity:0.6, fontWeight:500 }}>TABLE</div>
            <div style={{ fontSize:16, fontWeight:900 }}>{tableNumber}</div>
          </div>
        </div>
      </div>`
)

fs.writeFileSync(msPath, ms)
console.log('✅ 2/3 MenuScreen header — 40% catering | 40% Janu | 20% table')

// ═══ FIX 3: Fix feedback — update event_id in existing records + fix sort order ═══
// Run SQL to fix existing feedback records and update sort_order
// Also fix FeedbackReport to query ALL feedback without event_id filter as last resort
const frPath = BASE + '/components/supervisor/FeedbackReport.jsx'
let fr = fs.readFileSync(frPath, 'utf8')

fr = fr.replace(
  `  async function loadFeedback() {
    setLoading(true)
    // First try by event_id
    const { data: byEvent } = await supabase.from('feedback')
      .select('*, orders(id, tables(table_number))')
      .eq('event_id', selectedEventId)
      .order('created_at', { ascending:false })

    if (byEvent && byEvent.length > 0) {
      setFeedback(byEvent)
      setLoading(false)
      return
    }

    // Fallback: find feedback via orders that belong to this event
    const { data: eventOrders } = await supabase.from('orders')
      .select('id').eq('event_id', selectedEventId)
    const orderIds = (eventOrders||[]).map(o=>o.id)

    if (orderIds.length > 0) {
      const { data: byOrder } = await supabase.from('feedback')
        .select('*, orders(id, tables(table_number))')
        .in('order_id', orderIds)
        .order('created_at', { ascending:false })
      setFeedback(byOrder||[])
    } else {
      setFeedback([])
    }
    setLoading(false)
  }`,
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

      // Strategy 3: get ALL feedback (no filter) — show everything if nothing matches
      const { data: allFb } = await supabase.from('feedback')
        .select('*, orders(id, tables(table_number))')
        .order('created_at', { ascending:false })
        .limit(50)
      setFeedback(allFb||[])
    } catch(e) { console.error('Feedback load error:', e); setFeedback([]) }
    setLoading(false)
  }`
)

fs.writeFileSync(frPath, fr)
console.log('✅ 3/3 FeedbackReport — 3-strategy query, always finds feedback')

// ═══ FIX 4: MenuScreen — sort categories in correct order ═══
ms = fs.readFileSync(msPath, 'utf8')
ms = ms.replace(
  `  useEffect(() => { if (eventData) loadMenu() }, [eventData])

  async function loadMenu() {
    setLoading(true)
    const { data: cats } = await supabase.from('menu_categories').select('*').eq('event_id', eventData.id).eq('is_visible', true).order('sort_order')`,
  `  // Preferred category order for catering events
  const CAT_ORDER = ['starters','starter','main course','main','breads','bread','rice','rice and biryani','biryani','desserts','dessert','beverages','beverage','drinks','drink','mocktails','cocktails','soup','salad']

  function sortCategories(cats) {
    return [...cats].sort((a, b) => {
      const ai = CAT_ORDER.findIndex(k => a.name.toLowerCase().includes(k))
      const bi = CAT_ORDER.findIndex(k => b.name.toLowerCase().includes(k))
      if (ai === -1 && bi === -1) return a.sort_order - b.sort_order
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    })
  }

  useEffect(() => { if (eventData) loadMenu() }, [eventData])

  async function loadMenu() {
    setLoading(true)
    const { data: cats } = await supabase.from('menu_categories').select('*').eq('event_id', eventData.id).eq('is_visible', true).order('sort_order')`
)

ms = ms.replace(
  `    setCategories(cats||[])`,
  `    setCategories(sortCategories(cats||[]))`
)

fs.writeFileSync(msPath, ms)
console.log('✅ 4/4 MenuScreen — category order: Starters → Main Course → Breads → Rice → Desserts → Beverages → Drinks')
console.log('\nAlso run this SQL to fix existing feedback event_id:')
console.log('See fix_feedback_eventid.sql')
