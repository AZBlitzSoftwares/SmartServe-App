const fs = require('fs')
const BASE = '/Users/asayyed/SmartServe/src'

// ═══ FIX 1: FeedbackModal — fix submit stuck issue ═══
const fbPath = BASE + '/components/guest/FeedbackModal.jsx'
let fbContent = fs.readFileSync(fbPath, 'utf8')

// Replace entire submit function with proper error handling
fbContent = fbContent.replace(
  `  async function submit() {
    if (!rating) { setErrors({ rating:'Please select a rating' }); return }
    setSubmitting(true)
    await supabase.from('feedback').insert({
      order_id:orderId, event_id:eventData?.id||null, table_id:tableData?.id||null,
      rating, food_rating:food||null, service_rating:service||null, presentation_rating:presentation||null,
      guest_name:name.trim()||null, guest_email:email.trim()||null, guest_mobile:mobile.trim()||null,
      comment:comment.trim()||null
    })
    setSubmitted(true)
    setTimeout(() => onClose(), 3500)
  }`,
  `  async function submit() {
    if (!rating) { setErrors({ rating:'Please select a rating' }); return }
    setSubmitting(true)
    try {
      const payload = {
        event_id: eventData?.id || null,
        table_id: tableData?.id || null,
        rating,
        food_rating: food || null,
        service_rating: service || null,
        app_experience_rating: appExp || null,
        guest_name: name.trim() || null,
        guest_email: email.trim() || null,
        guest_mobile: mobile.trim() || null,
        comment: comment.trim() || null
      }
      // Only add order_id if it's a valid UUID (not offline-)
      if (orderId && !orderId.startsWith('offline-')) {
        payload.order_id = orderId
      }
      const { error } = await supabase.from('feedback').insert(payload)
      if (error) {
        console.error('Feedback error:', error)
        // Still show thank you — don't block guest
      }
      setSubmitted(true)
      setTimeout(() => onClose(), 3500)
    } catch(e) {
      console.error('Feedback submit error:', e)
      setSubmitted(true) // show thank you anyway
      setTimeout(() => onClose(), 3500)
    } finally {
      setSubmitting(false)
    }
  }`
)

fs.writeFileSync(fbPath, fbContent)
console.log('✅ 1/3 FeedbackModal — submit fixed, no longer stucks')

// ═══ FIX 2 & 3: Header — show BOTH Janu logo + catering logo+name ═══
const msPath = BASE + '/components/guest/MenuScreen.jsx'
let msContent = fs.readFileSync(msPath, 'utf8')

msContent = msContent.replace(
  `      {/* HEADER */}
      <div style={{ background:'#1A0A0A', padding:'11px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, minWidth:0 }}>
          {eventData?.catering_logo_url && (
            <img src={eventData.catering_logo_url} alt=""
              style={{ width:42, height:42, objectFit:'contain', borderRadius:10, background:'rgba(255,255,255,0.1)', padding:4, flexShrink:0, border:'1px solid rgba(255,255,255,0.15)' }}
              onError={e=>e.target.style.display='none'} />
          )}
          <div style={{ minWidth:0 }}>
            {eventData?.catering_company ? (
              <>
                <div style={{ color:'#fff', fontWeight:900, fontSize:18, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', lineHeight:1.2 }}>{eventData.catering_company}</div>
                <div style={{ color:'rgba(255,255,255,0.55)', fontSize:11, fontWeight:600, marginTop:1 }}>by Janu's Smart Serve</div>
              </>
            ) : (
              <div style={{ color:'#fff', fontWeight:800, fontSize:18 }}>Janu's <span style={{ color:'#E8890C' }}>Smart Serve</span></div>
            )}
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
          {isOnline===false && <span style={{ background:'#DC2626', color:'#fff', fontSize:10, fontWeight:700, padding:'2px 6px', borderRadius:999 }}>OFFLINE</span>}
          <div style={{ background:'rgba(255,255,255,0.15)', color:'#fff', fontSize:12, fontWeight:800, padding:'6px 14px', borderRadius:999 }}>TABLE {tableNumber}</div>
        </div>
      </div>`,

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
      </div>`
)

fs.writeFileSync(msPath, msContent)
console.log('✅ 2/3 MenuScreen header — two rows: catering on top, Janu brand below')

// ═══ FIX 3: WelcomeScreen — add Janu logo placeholder ═══
const wsPath = BASE + '/components/guest/WelcomeScreen.jsx'
let wsContent = fs.readFileSync(wsPath, 'utf8')

// Replace the no-logo fallback with Janu's logo + catering logo side by side
wsContent = wsContent.replace(
  `        {/* Catering Logo */}
        {eventData?.catering_logo_url && (
          <img src={eventData.catering_logo_url} alt={eventData.catering_company||''}
            style={{ width:110,height:110,objectFit:'contain',borderRadius:20,marginBottom:14,background:'rgba(255,255,255,0.12)',padding:10,boxShadow:'0 8px 32px rgba(0,0,0,0.4)',border:'2px solid rgba(255,255,255,0.25)',display:'block',margin:'0 auto 14px' }}
            onError={e=>e.target.style.display='none'} />
        )}
        {!eventData?.catering_logo_url && (
          <div style={{ fontSize:64,marginBottom:14 }}>🍽️</div>
        )}`,

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
        </div>`
)

fs.writeFileSync(wsPath, wsContent)
console.log('✅ 3/3 WelcomeScreen — Janu logo + catering logo side by side')
console.log('\nRun: npm run dev')
