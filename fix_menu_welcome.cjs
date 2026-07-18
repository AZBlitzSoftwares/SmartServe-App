const fs = require('fs')
const BASE = '/Users/asayyed/SmartServe/src'

// ═══ FIX 1: MenuScreen — move category chips BELOW veg filter, fix scroll ═══
const msPath = BASE + '/components/guest/MenuScreen.jsx'
let msContent = fs.readFileSync(msPath, 'utf8')

// The chips should be right below veg filter — they already are but
// the issue is the chip for "Beverages" is highlighted when scrolled
// Fix: reorder sections so chips are ABOVE the content and BELOW veg
// Current order: header > action bar > search > veg filter > chips > content
// This is correct — issue is chips position highlight when scroll offset
// Actually looking at image 1: chips row shows "Beverages" selected but
// content shows DESSERTS — scroll detection offset is off
// Fix the scroll detection offset to account for all sticky bars

msContent = msContent.replace(
  `  // Detect which category is in view while scrolling
  function handleScroll(e) {
    if (search.length > 0) return
    const scrollTop = e.target.scrollTop + 120
    let current = 'all'
    categories.forEach(cat => {
      const el = sectionRefs.current[cat.id]
      if (el && el.offsetTop <= scrollTop) current = cat.id
    })
    setActiveChip(current)
  }`,
  `  // Detect which category is in view while scrolling
  function handleScroll(e) {
    if (search.length > 0) return
    const scrollTop = e.target.scrollTop + 20 // small offset for sticky header
    let current = 'all'
    categories.forEach(cat => {
      const el = sectionRefs.current[cat.id]
      if (el && el.offsetTop <= scrollTop) current = cat.id
    })
    setActiveChip(current)
  }`
)

fs.writeFileSync(msPath, msContent)
console.log('✅ 1/2 MenuScreen — category chip scroll detection fixed')

// ═══ FIX 2: WelcomeScreen — catering logo big and centered above name ═══
// Janu's logo small, next to "Powered by" text at bottom
const wsPath = BASE + '/components/guest/WelcomeScreen.jsx'
let wsContent = fs.readFileSync(wsPath, 'utf8')

wsContent = wsContent.replace(
  `        {/* Logos row — Janu logo + Catering logo */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:16, marginBottom:16 }}>
          {/* Janu's Smart Serve logo — always shown */}
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
            <div style={{ width:64, height:64, borderRadius:14, background:'#E8890C', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 4px 16px rgba(232,137,12,0.4)', border:'2px solid rgba(255,255,255,0.2)' }}>
              <span style={{ fontSize:34 }}>🍽️</span>
            </div>
            <span style={{ fontSize:9, fontWeight:800, color:'#E8890C', letterSpacing:'0.5px', textTransform:'uppercase' }}>Janu's</span>
          </div>
          {/* Divider */}
          {eventData?.catering_logo_url && (
            <div style={{ fontSize:18, color:'rgba(255,255,255,0.3)', fontWeight:300 }}>×</div>
          )}
          {/* Catering logo */}
          {eventData?.catering_logo_url && (
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
              <img src={eventData.catering_logo_url} alt={eventData.catering_company||''}
                style={{ width:64, height:64, objectFit:'contain', borderRadius:14, background:'rgba(255,255,255,0.12)', padding:6, boxShadow:'0 4px 16px rgba(0,0,0,0.3)', border:'2px solid rgba(255,255,255,0.2)' }}
                onError={e=>e.target.parentElement.style.display='none'} />
              {eventData.catering_company && <span style={{ fontSize:9, fontWeight:800, color:'rgba(255,255,255,0.7)', letterSpacing:'0.3px', textTransform:'uppercase', maxWidth:70, textAlign:'center', lineHeight:1.2 }}>{eventData.catering_company.split(' ')[0]}</span>}
            </div>
          )}
        </div>`,

  `        {/* CATERING LOGO — large, centered, most prominent */}
        {eventData?.catering_logo_url ? (
          <img src={eventData.catering_logo_url} alt={eventData.catering_company||''}
            style={{ width:120, height:120, objectFit:'contain', borderRadius:24, marginBottom:16, background:'rgba(255,255,255,0.12)', padding:10, boxShadow:'0 8px 32px rgba(0,0,0,0.5)', border:'2px solid rgba(255,255,255,0.25)', display:'block', margin:'0 auto 16px' }}
            onError={e=>e.target.style.display='none'} />
        ) : (
          <div style={{ width:80, height:80, borderRadius:20, background:'#E8890C', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 16px', boxShadow:'0 8px 24px rgba(232,137,12,0.4)' }}>
            <span style={{ fontSize:40 }}>🍽️</span>
          </div>
        )}`
)

// Fix the "Powered by" line — add small Janu icon inline
wsContent = wsContent.replace(
  `        {/* Janu's Smart Serve — ONE LINE only, clearly readable */}
        {eventData?.catering_company && (
          <div style={{ fontSize:14,fontWeight:600,color:'rgba(255,255,255,0.7)',marginBottom:12,letterSpacing:'0.3px' }}>
            Powered by <span style={{ color:'#E8890C',fontWeight:800 }}>Janu's Smart Serve</span>
          </div>
        )}`,
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
        )}`
)

fs.writeFileSync(wsPath, wsContent)
console.log('✅ 2/2 WelcomeScreen — catering logo large+centered, Janu inline with powered by')
console.log('\nRun: npm run dev')
