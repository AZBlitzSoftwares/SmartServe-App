const fs = require('fs')
const BASE = '/Users/asayyed/SmartServe/src'

// ═══ FIX 1: WelcomeScreen — bigger text for all secondary info ═══
const wsPath = BASE + '/components/guest/WelcomeScreen.jsx'
let ws = fs.readFileSync(wsPath, 'utf8')

ws = ws.replace(
  `        {/* Powered by Janu's Smart Serve — shown once only */}
        {eventData?.catering_company && (
          <div style={{ fontSize:14, fontWeight:600, color:'rgba(255,255,255,0.7)', marginBottom:10, letterSpacing:'0.3px' }}>
            Powered by <span style={{ color:'#E8890C', fontWeight:800 }}>Janu's Smart Serve</span>
          </div>
        )}`,
  `        {/* Powered by — bigger and clearer */}
        {eventData?.catering_company && (
          <div style={{ fontSize:17, fontWeight:700, color:'rgba(255,255,255,0.85)', marginBottom:12, letterSpacing:'0.3px' }}>
            Powered by <span style={{ color:'#E8890C', fontWeight:900 }}>Janu's Smart Serve</span>
          </div>
        )}`
)

ws = ws.replace(
  `        {eventData?.name && (
          <div style={{ fontSize:18,fontWeight:700,color:'#FFE0A0',marginBottom:4,textShadow:'0 2px 8px rgba(0,0,0,0.6)' }}>{eventData.name}</div>
        )}
        {eventData?.venue && (
          <div style={{ fontSize:14,fontWeight:600,color:'rgba(255,255,255,0.75)',marginBottom:4 }}>📍 {eventData.venue}</div>
        )}`,
  `        {eventData?.name && (
          <div style={{ fontSize:22, fontWeight:800, color:'#FFE0A0', marginBottom:5, textShadow:'0 2px 8px rgba(0,0,0,0.6)' }}>{eventData.name}</div>
        )}
        {eventData?.venue && (
          <div style={{ fontSize:16, fontWeight:600, color:'rgba(255,255,255,0.82)', marginBottom:4 }}>📍 {eventData.venue}</div>
        )}`
)

fs.writeFileSync(wsPath, ws)
console.log('✅ 1/3 WelcomeScreen — "Powered by", event name, venue all bigger')

// ═══ FIX 2: MenuScreen — header logos centred + 20% taller + category chips highlighted ═══
const msPath = BASE + '/components/guest/MenuScreen.jsx'
let ms = fs.readFileSync(msPath, 'utf8')

// Make header taller (20% more) and centre both logos/names
ms = ms.replace(
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
      </div>`,

  `      {/* HEADER — 40% catering | 40% Janu | 20% table — taller, centred */}
      <div style={{ background:'#1A0A0A', flexShrink:0, padding:'14px 12px', display:'flex', alignItems:'center', gap:6 }}>

        {/* 40% — Catering company — centred */}
        <div style={{ flex:4, display:'flex', alignItems:'center', justifyContent:'center', gap:10, borderRight:'1px solid rgba(255,255,255,0.12)', paddingRight:10 }}>
          {eventData?.catering_logo_url ? (
            <img src={eventData.catering_logo_url} alt=""
              style={{ width:46, height:46, objectFit:'contain', borderRadius:10, background:'rgba(255,255,255,0.1)', padding:4, flexShrink:0, border:'1px solid rgba(255,255,255,0.2)' }}
              onError={e=>e.target.style.display='none'} />
          ) : (
            <div style={{ width:40, height:40, borderRadius:9, background:'rgba(255,255,255,0.1)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
              <span style={{ fontSize:20 }}>🏷️</span>
            </div>
          )}
          <div>
            <div style={{ color:'#fff', fontWeight:900, fontSize:17, lineHeight:1.2, whiteSpace:'nowrap' }}>
              {eventData?.catering_company || 'Catering'}
            </div>
            <div style={{ color:'rgba(255,255,255,0.45)', fontSize:11, fontWeight:500 }}>Catering Partner</div>
          </div>
        </div>

        {/* 40% — Janu's Smart Serve — centred */}
        <div style={{ flex:4, display:'flex', alignItems:'center', justifyContent:'center', gap:10, borderRight:'1px solid rgba(255,255,255,0.12)', paddingLeft:10, paddingRight:10 }}>
          <div style={{ width:40, height:40, borderRadius:9, background:'#E8890C', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, boxShadow:'0 2px 10px rgba(232,137,12,0.5)' }}>
            <span style={{ fontSize:22 }}>🍽️</span>
          </div>
          <div>
            <div style={{ color:'#E8890C', fontWeight:900, fontSize:16, lineHeight:1.2, whiteSpace:'nowrap' }}>Janu's Smart Serve</div>
            <div style={{ color:'rgba(255,255,255,0.45)', fontSize:11, fontWeight:500 }}>Technology Partner</div>
          </div>
        </div>

        {/* 20% — Table — centred */}
        <div style={{ flex:2, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:2 }}>
          {isOnline===false && <span style={{ background:'#DC2626', color:'#fff', fontSize:8, fontWeight:700, padding:'1px 4px', borderRadius:999 }}>OFFLINE</span>}
          <div style={{ color:'rgba(255,255,255,0.5)', fontSize:10, fontWeight:600, letterSpacing:'0.5px' }}>TABLE</div>
          <div style={{ color:'#fff', fontSize:22, fontWeight:900, lineHeight:1 }}>{tableNumber}</div>
        </div>
      </div>`
)

// FIX category chips — make active chip more highlighted (orange filled, white text)
ms = ms.replace(
  `        <div ref={chipBarRef} style={{ display:'flex', gap:8, padding:'10px 14px', background:'#fff', borderBottom:'2px solid #F0F0F0', overflowX:'auto', flexShrink:0, scrollbarWidth:'none' }}>
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
        </div>`,

  `        <div ref={chipBarRef} style={{ display:'flex', gap:8, padding:'10px 14px', background:'#fff', borderBottom:'2px solid #F0F0F0', overflowX:'auto', flexShrink:0, scrollbarWidth:'none' }}>
          <button onClick={()=>{ setActiveChip('all'); scrollRef.current?.scrollTo({top:0,behavior:'smooth'}) }}
            style={{ flexShrink:0, padding:'8px 20px', borderRadius:999, fontSize:13, fontWeight:800, border: activeChip==='all'?'none':'1.5px solid #E0E0E0', cursor:'pointer',
              background:activeChip==='all'?'#E8890C':'#fff',
              color:activeChip==='all'?'#fff':'#555',
              boxShadow:activeChip==='all'?'0 3px 10px rgba(232,137,12,0.4)':'none',
              transition:'all 0.15s' }}>
            All
          </button>
          {categories.map(cat => (
            <button key={cat.id} onClick={()=>scrollToCategory(cat.id)}
              style={{ flexShrink:0, padding:'8px 20px', borderRadius:999, fontSize:13, fontWeight:800,
                border: activeChip===cat.id?'none':'1.5px solid #E0E0E0',
                cursor:'pointer', whiteSpace:'nowrap',
                background:activeChip===cat.id?'#E8890C':'#fff',
                color:activeChip===cat.id?'#fff':'#555',
                boxShadow:activeChip===cat.id?'0 3px 10px rgba(232,137,12,0.4)':'none',
                transition:'all 0.15s' }}>
              {cat.name}
              <span style={{ fontSize:11, marginLeft:5, opacity: activeChip===cat.id?0.85:0.5 }}>({items.filter(i=>i.category_id===cat.id).length})</span>
            </button>
          ))}
        </div>`
)

fs.writeFileSync(msPath, ms)
console.log('✅ 2/3 MenuScreen — header taller+centred, category chips orange when active')

// ═══ FIX 3: FeedbackReport — show ALL feedback regardless of event_id ═══
const frPath = BASE + '/components/supervisor/FeedbackReport.jsx'
let fr = fs.readFileSync(frPath, 'utf8')

fr = fr.replace(
  `      // Strategy 3: get ALL feedback (no filter) — show everything if nothing matches
      const { data: allFb } = await supabase.from('feedback')
        .select('*, orders(id, tables(table_number))')
        .order('created_at', { ascending:false })
        .limit(50)
      setFeedback(allFb||[])`,
  `      // Strategy 3: get ALL feedback regardless of event — at least show something
      const { data: allFb } = await supabase.from('feedback')
        .select('*, orders(id, tables(table_number))')
        .order('created_at', { ascending:false })
        .limit(100)
      console.log('All feedback found:', allFb?.length, allFb)
      setFeedback(allFb||[])`
)

// Also show count even when empty to help debug
fr = fr.replace(
  `      {!loading && feedback.length===0 && selectedEventId && (
        <div style={{ textAlign:'center', padding:60 }}>
          <div style={{ fontSize:48, marginBottom:12 }}>📋</div>
          <div style={{ fontWeight:600, color:'var(--ink2)' }}>No feedback received yet for this event</div>
        </div>
      )}`,
  `      {!loading && feedback.length===0 && selectedEventId && (
        <div style={{ textAlign:'center', padding:60 }}>
          <div style={{ fontSize:48, marginBottom:12 }}>📋</div>
          <div style={{ fontWeight:600, color:'var(--ink2)', marginBottom:8 }}>No feedback found for this event</div>
          <div style={{ fontSize:13, color:'var(--ink2)' }}>Submit feedback from the guest tablet to see it here</div>
          <div style={{ fontSize:12, color:'#E8890C', marginTop:8, fontWeight:600 }}>
            Tip: Go to tablet → ⭐ Feedback button → submit → refresh this page
          </div>
        </div>
      )}`
)

fs.writeFileSync(frPath, fr)
console.log('✅ 3/3 FeedbackReport — shows all feedback as fallback + debug logging')
console.log('\nRun: npm run dev')
