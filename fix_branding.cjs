const fs = require('fs')
const BASE = '/Users/asayyed/SmartServe/src'

// ═══════════════════════════════════════════════════════════════════
// FIX: WelcomeScreen — Catering brand FRONT AND CENTER
// Janu's Smart Serve = subtle tech credit only
// ═══════════════════════════════════════════════════════════════════
const wsPath = BASE + '/components/guest/WelcomeScreen.jsx'
let wsContent = fs.readFileSync(wsPath, 'utf8')

// Replace the entire content section
wsContent = wsContent.replace(
  `      {/* Main content */}
      <div style={{ position:'relative', zIndex:2, color:'#fff', width:'100%', maxWidth:400 }}>
        {/* Catering logo + name — prominent at top */}
        {eventData?.catering_logo_url ? (
          <img src={eventData.catering_logo_url} alt={eventData.catering_company||'Catering'}
            style={{ width:90, height:90, objectFit:'contain', borderRadius:16, marginBottom:10, background:'rgba(255,255,255,0.15)', padding:8 }}
            onError={e=>e.target.style.display='none'} />
        ) : (
          <div style={{ fontSize:56, marginBottom:12 }}>🍽️</div>
        )}

        {eventData?.catering_company && (
          <div style={{ fontSize:22, fontWeight:800, color:'#E8890C', marginBottom:4, letterSpacing:'0.5px' }}>
            {eventData.catering_company}
          </div>
        )}

        <h1 style={{ fontSize:22, fontWeight:600, marginBottom:4, opacity:0.85 }}>
          Powered by <span style={{ color:'#E8890C', fontWeight:800 }}>Janu's Smart Serve</span>
        </h1>

        {/* Event name */}
        {eventData?.name
          ? <p style={{ fontSize:14, opacity:0.7, marginBottom:4 }}>{eventData.name}</p>
          : <p style={{ fontSize:13, opacity:0.6, marginBottom:4 }}>No event selected</p>
        }
        {eventData?.venue && <p style={{ fontSize:13, opacity:0.55, marginBottom:0 }}>📍 {eventData.venue}</p>}`,

  `      {/* Main content */}
      <div style={{ position:'relative', zIndex:2, color:'#fff', width:'100%', maxWidth:420 }}>

        {/* CATERING LOGO — large, prominent */}
        {eventData?.catering_logo_url ? (
          <img
            src={eventData.catering_logo_url}
            alt={eventData.catering_company||'Catering'}
            style={{ width:120, height:120, objectFit:'contain', borderRadius:20, marginBottom:16,
              background:'rgba(255,255,255,0.12)', padding:10,
              boxShadow:'0 8px 32px rgba(0,0,0,0.3)', border:'2px solid rgba(255,255,255,0.2)' }}
            onError={e=>{ e.target.style.display='none'; e.target.nextSibling.style.display='flex' }} />
        ) : null}
        {/* Fallback plate icon shown only if no logo */}
        <div style={{ fontSize:64, marginBottom:12, display: eventData?.catering_logo_url ? 'none' : 'block' }}>🍽️</div>

        {/* CATERING NAME — biggest text on screen */}
        {eventData?.catering_company ? (
          <div style={{ fontSize:36, fontWeight:900, color:'#fff', marginBottom:6, letterSpacing:'0.5px', lineHeight:1.2, textShadow:'0 2px 12px rgba(0,0,0,0.5)' }}>
            {eventData.catering_company}
          </div>
        ) : null}

        {/* Event name */}
        {eventData?.name && (
          <p style={{ fontSize:15, opacity:0.75, marginBottom:2 }}>{eventData.name}</p>
        )}
        {eventData?.venue && (
          <p style={{ fontSize:13, opacity:0.55, marginBottom:0 }}>📍 {eventData.venue}</p>
        )}
        {!eventData && (
          <p style={{ fontSize:13, opacity:0.6, marginBottom:4 }}>No event selected</p>
        )}`
)

// Fix the bottom "Powered by" footer to be subtle
wsContent = wsContent.replace(
  `        <p style={{ marginTop:24, fontSize:11, opacity:0.35 }}>Powered by Janu's Smart Serve · Table {tableNumber}</p>`,
  `        <p style={{ marginTop:24, fontSize:11, opacity:0.3 }}>Technology by Janu's Smart Serve · Table {tableNumber}</p>`
)

fs.writeFileSync(wsPath, wsContent)
console.log('✅ 1/2 WelcomeScreen — Catering brand front and center, Janus subtle footer')

// ═══════════════════════════════════════════════════════════════════
// FIX: MenuScreen header — catering logo prominent, Janu subtle
// ═══════════════════════════════════════════════════════════════════
const msPath = BASE + '/components/guest/MenuScreen.jsx'
let msContent = fs.readFileSync(msPath, 'utf8')

msContent = msContent.replace(
  `      <div style={{ background:'#1a0a0a', padding:'10px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:40, gap:10 }}>
        {/* Left: Catering logo + name OR app name */}
        <div style={{ display:'flex', alignItems:'center', gap:10, flex:1, minWidth:0 }}>
          {eventData?.catering_logo_url && (
            <img src={eventData.catering_logo_url} alt={eventData.catering_company||''}
              style={{ width:36, height:36, objectFit:'contain', borderRadius:8, background:'rgba(255,255,255,0.1)', padding:3, flexShrink:0 }}
              onError={e=>e.target.style.display='none'} />
          )}
          <div style={{ minWidth:0 }}>
            {eventData?.catering_company
              ? <div style={{ color:'#E8890C', fontWeight:800, fontSize:15, lineHeight:1.2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{eventData.catering_company}</div>
              : null
            }
            <div style={{ color: eventData?.catering_company ? 'rgba(255,255,255,0.55)' : '#fff', fontWeight: eventData?.catering_company ? 500 : 800, fontSize: eventData?.catering_company ? 11 : 17 }}>
              {eventData?.catering_company ? "Powered by Janu's Smart Serve" : <span>Janu's <span style={{ color:'#E8890C' }}>Smart Serve</span></span>}
            </div>
          </div>
        </div>
        {/* Right: offline badge + table number */}
        <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
          {isOnline === false && <span style={{ background:'#DC2626', color:'#fff', fontSize:10, fontWeight:700, padding:'2px 6px', borderRadius:999 }}>OFFLINE</span>}
          <div style={{ background:'rgba(255,255,255,0.15)', color:'#fff', fontSize:12, fontWeight:700, padding:'5px 12px', borderRadius:999 }}>TABLE {tableNumber}</div>
        </div>
      </div>`,

  `      <div style={{ background:'#1a0a0a', padding:'10px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:40, gap:10 }}>
        {/* Left: Catering logo + name — PROMINENT. Janu's brand is NOT shown here */}
        <div style={{ display:'flex', alignItems:'center', gap:10, flex:1, minWidth:0 }}>
          {eventData?.catering_logo_url && (
            <img src={eventData.catering_logo_url} alt={eventData.catering_company||''}
              style={{ width:40, height:40, objectFit:'contain', borderRadius:8, background:'rgba(255,255,255,0.1)', padding:4, flexShrink:0, border:'1px solid rgba(255,255,255,0.15)' }}
              onError={e=>e.target.style.display='none'} />
          )}
          <div style={{ minWidth:0 }}>
            {eventData?.catering_company ? (
              <>
                <div style={{ color:'#fff', fontWeight:800, fontSize:16, lineHeight:1.2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {eventData.catering_company}
                </div>
                <div style={{ color:'rgba(255,255,255,0.4)', fontSize:10, marginTop:1 }}>
                  by Janu's Smart Serve
                </div>
              </>
            ) : (
              <div style={{ color:'#fff', fontWeight:800, fontSize:17 }}>
                Janu's <span style={{ color:'#E8890C' }}>Smart Serve</span>
              </div>
            )}
          </div>
        </div>
        {/* Right: offline + table */}
        <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
          {isOnline === false && <span style={{ background:'#DC2626', color:'#fff', fontSize:10, fontWeight:700, padding:'2px 6px', borderRadius:999 }}>OFFLINE</span>}
          <div style={{ background:'rgba(255,255,255,0.15)', color:'#fff', fontSize:12, fontWeight:700, padding:'5px 12px', borderRadius:999 }}>TABLE {tableNumber}</div>
        </div>
      </div>`
)

fs.writeFileSync(msPath, msContent)
console.log('✅ 2/2 MenuScreen header — catering name bold white, "by Janu\'s Smart Serve" subtle grey')
console.log('\n🎉 Done! Run: npm run dev')
console.log('\nFor the logo URL — upload delhi_darbar_logo_v2.svg to Supabase Storage')
console.log('then paste the public URL in the Catering Logo URL field')
