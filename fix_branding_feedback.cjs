const fs = require('fs')
const BASE = '/Users/asayyed/SmartServe/src'

// ═══ FIX 1: WelcomeScreen — equal prominence for both logos ═══
const wsPath = BASE + '/components/guest/WelcomeScreen.jsx'
let wsContent = fs.readFileSync(wsPath, 'utf8')

wsContent = wsContent.replace(
  `        {/* CATERING LOGO — large, centered, most prominent */}
        {eventData?.catering_logo_url ? (
          <img src={eventData.catering_logo_url} alt={eventData.catering_company||''}
            style={{ width:120, height:120, objectFit:'contain', borderRadius:24, marginBottom:16, background:'rgba(255,255,255,0.12)', padding:10, boxShadow:'0 8px 32px rgba(0,0,0,0.5)', border:'2px solid rgba(255,255,255,0.25)', display:'block', margin:'0 auto 16px' }}
            onError={e=>e.target.style.display='none'} />
        ) : (
          <div style={{ width:80, height:80, borderRadius:20, background:'#E8890C', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 16px', boxShadow:'0 8px 24px rgba(232,137,12,0.4)' }}>
            <span style={{ fontSize:40 }}>🍽️</span>
          </div>
        )}`,

  `        {/* DUAL LOGO ROW — Janu + Catering side by side, equal size */}
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'center', gap:24, marginBottom:18 }}>
          {/* Janu's Smart Serve */}
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:6 }}>
            <div style={{ width:90, height:90, borderRadius:20, background:'linear-gradient(135deg,#E8890C,#c97010)', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 8px 24px rgba(232,137,12,0.5)', border:'2px solid rgba(255,255,255,0.2)' }}>
              <span style={{ fontSize:46 }}>🍽️</span>
            </div>
            <div style={{ textAlign:'center' }}>
              <div style={{ fontSize:15, fontWeight:900, color:'#E8890C', letterSpacing:'0.5px' }}>JANU'S</div>
              <div style={{ fontSize:11, fontWeight:700, color:'rgba(255,255,255,0.6)', letterSpacing:'0.3px' }}>SMART SERVE</div>
            </div>
          </div>

          {/* × divider — only when catering logo exists */}
          {eventData?.catering_logo_url && (
            <div style={{ fontSize:24, color:'rgba(255,255,255,0.25)', marginTop:32 }}>×</div>
          )}

          {/* Catering company */}
          {eventData?.catering_logo_url && (
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:6 }}>
              <img src={eventData.catering_logo_url} alt={eventData.catering_company||''}
                style={{ width:90, height:90, objectFit:'contain', borderRadius:20, background:'rgba(255,255,255,0.1)', padding:8, boxShadow:'0 8px 24px rgba(0,0,0,0.4)', border:'2px solid rgba(255,255,255,0.2)' }}
                onError={e=>e.target.parentElement.style.display='none'} />
              {eventData.catering_company && (
                <div style={{ textAlign:'center' }}>
                  <div style={{ fontSize:15, fontWeight:900, color:'#fff', letterSpacing:'0.3px' }}>{eventData.catering_company.toUpperCase().split(' ')[0]}</div>
                  {eventData.catering_company.split(' ').length > 1 && (
                    <div style={{ fontSize:11, fontWeight:700, color:'rgba(255,255,255,0.6)' }}>{eventData.catering_company.toUpperCase().split(' ').slice(1).join(' ')}</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>`
)

// Fix Powered by line — remove since we now show logos equally
wsContent = wsContent.replace(
  `        {/* Janu branding — inline with small icon */}
        {eventData?.catering_company && (
          <div style={{ display:'inline-flex', alignItems:'center', gap:6, marginBottom:12, background:'rgba(255,255,255,0.08)', border:'1px solid rgba(255,255,255,0.15)', borderRadius:999, padding:'5px 14px' }}>
            <div style={{ width:18, height:18, borderRadius:4, background:'#E8890C', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
              <span style={{ fontSize:11 }}>🍽️</span>
            </div>
            <span style={{ fontSize:12, fontWeight:600, color:'rgba(255,255,255,0.75)' }}>
              Powered by <span style={{ color:'#E8890C', fontWeight:800 }}>Janu's Smart Serve</span>
            </span>
          </div>
        )}`,
  `        {/* Catering company LARGE name */}
        {eventData?.catering_company && (
          <div style={{ fontSize:40, fontWeight:900, color:'#fff', marginBottom:4, letterSpacing:'0.5px', lineHeight:1.1, textShadow:'0 3px 16px rgba(0,0,0,0.7)' }}>
            {eventData.catering_company}
          </div>
        )}`
)

fs.writeFileSync(wsPath, wsContent)
console.log('✅ 1/3 WelcomeScreen — equal dual logos, catering name large')

// ═══ FIX 2: MenuScreen header — split into 2 rows properly ═══
const msPath = BASE + '/components/guest/MenuScreen.jsx'
let msContent = fs.readFileSync(msPath, 'utf8')

msContent = msContent.replace(
  `      {/* HEADER — two rows: catering brand top, Janu brand bottom */}
      <div style={{ background:'#1A0A0A', flexShrink:0 }}>
        {/* Row 1: Catering company (primary) */}
        <div style={{ padding:'10px 16px 6px', display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:'1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, minWidth:0 }}>
            {eventData?.catering_logo_url && (
              <img src={eventData.catering_logo_url} alt=""
                style={{ width:44, height:44, objectFit:'contain', borderRadius:10, background:'rgba(255,255,255,0.1)', padding:4, flexShrink:0, border:'1px solid rgba(255,255,255,0.2)' }}
                onError={e=>e.target.style.display='none'} />
            )}
            <div style={{ minWidth:0 }}>
              {eventData?.catering_company
                ? <div style={{ color:'#fff', fontWeight:900, fontSize:20, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', lineHeight:1.2 }}>{eventData.catering_company}</div>
                : <div style={{ color:'#fff', fontWeight:900, fontSize:20 }}>Janu's <span style={{ color:'#E8890C' }}>Smart Serve</span></div>
              }
            </div>
          </div>
          <div style={{ background:'rgba(255,255,255,0.15)', color:'#fff', fontSize:12, fontWeight:800, padding:'6px 14px', borderRadius:999, flexShrink:0 }}>TABLE {tableNumber}</div>
        </div>
        {/* Row 2: Janu's Smart Serve branding (secondary) */}
        {eventData?.catering_company && (
          <div style={{ padding:'5px 16px 7px', display:'flex', alignItems:'center', gap:8 }}>
            <div style={{ width:18, height:18, borderRadius:4, background:'#E8890C', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
              <span style={{ fontSize:11 }}>🍽️</span>
            </div>
            <span style={{ color:'rgba(255,255,255,0.6)', fontSize:11, fontWeight:600 }}>
              Powered by <span style={{ color:'#E8890C', fontWeight:800 }}>Janu's Smart Serve</span>
            </span>
            {isOnline===false && <span style={{ background:'#DC2626', color:'#fff', fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:999, marginLeft:'auto' }}>OFFLINE</span>}
          </div>
        )}
        {!eventData?.catering_company && isOnline===false && (
          <div style={{ padding:'3px 16px 5px' }}>
            <span style={{ background:'#DC2626', color:'#fff', fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:999 }}>OFFLINE</span>
          </div>
        )}
      </div>`,

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
      </div>`
)

fs.writeFileSync(msPath, msContent)
console.log('✅ 2/3 MenuScreen — header: catering logo+name on left, Janu orange below it, table right')

// ═══ FIX 3: FeedbackReport — query without event_id filter as fallback ═══
const frPath = BASE + '/components/supervisor/FeedbackReport.jsx'
let frContent = fs.readFileSync(frPath, 'utf8')

// Fix feedback query — if event_id is null, try matching via orders
frContent = frContent.replace(
  `  async function loadFeedback() {
    setLoading(true)
    const { data } = await supabase.from('feedback')
      .select('*, orders(id, tables(table_number))')
      .eq('event_id', selectedEventId)
      .order('created_at', { ascending:false })
    setFeedback(data||[])
    setLoading(false)
  }`,
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
  }`
)

// Also update event_id when feedback is submitted — fix GuestApp
fs.writeFileSync(frPath, frContent)
console.log('✅ 3/3 FeedbackReport — dual query: by event_id first, then by order_id fallback')
console.log('\nRun: npm run dev')
