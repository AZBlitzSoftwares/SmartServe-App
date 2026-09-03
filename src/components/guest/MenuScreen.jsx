import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import janusLogo from '../../assets/janus_logo.jpg'
import igQrCode from '../../assets/ig_qr.jpg'

// Categories may be stored session-prefixed ("Lunch - Starters") so the
// supervisor can show or hide a whole meal. Guests only ever see the
// course part ("Starters"). Module scope so every component here can use it.
function catLabel(name) {
  if (!name) return ''
  const i = name.indexOf(' - ')
  return i === -1 ? name : name.slice(i + 3).trim()
}


/* ── Animated Header Carousel ─────────────────────────────────────────── */
function HeaderCarousel({ eventData, tableNumber, isOnline, captain, onSwitchCaptain }) {
  const hasWelcomeNote = !!(eventData?.welcome_note)
  const hasCatering = !!(eventData?.catering_company || eventData?.catering_logo_url)
  const totalSlides = 1 + (hasCatering ? 1 : 0) + (hasWelcomeNote ? 1 : 0)
  // slide 0 = janus, 1 = catering (if exists), 2 = welcome note (if exists)
  // simplified: always 0=catering(if exists), 1=janus, 2=welcome(if exists)
  const slideOrder = [
    ...(hasCatering ? ['catering'] : []),
    'janus',
    ...(hasWelcomeNote ? ['welcome'] : []),
  ]
  const [slideIdx, setSlideIdx] = useState(0)
  const [fade, setFade] = useState(true)

  useEffect(() => {
    if (slideOrder.length < 2) return
    const timer = setInterval(() => {
      setFade(false)
      setTimeout(() => {
        setSlideIdx(s => (s + 1) % slideOrder.length)
        setFade(true)
      }, 350)
    }, 5000)
    return () => clearInterval(timer)
  }, [slideOrder.length])

  const currentSlide = slideOrder[slideIdx] || 'janus'
  const isCateringSlide = currentSlide === 'catering'
  const isJanusSlide = currentSlide === 'janus'
  const isWelcomeSlide = currentSlide === 'welcome'

  return (
    <div style={{ background:'#1A0A0A', flexShrink:0, padding:'18px 12px', display:'flex', alignItems:'center', gap:6 }}>
      {/* Brand carousel — 80% width, 3 panels */}
      <div style={{ flex:8, borderRight:'1px solid rgba(255,255,255,0.12)', paddingRight:10, overflow:'hidden', position:'relative', minHeight:78 }}>

        {/* Catering Slide */}
        <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', gap:10, opacity: isCateringSlide ? (fade?1:0) : 0, transition:'opacity 0.35s ease', pointerEvents: isCateringSlide ? 'auto' : 'none' }}>
          {eventData?.catering_logo_url
            ? <img src={eventData.catering_logo_url} alt="" style={{ width:56, height:56, objectFit:'contain', borderRadius:12, background:'rgba(255,255,255,0.1)', padding:4, flexShrink:0, border:'1px solid rgba(255,255,255,0.2)' }} onError={e=>e.target.style.display='none'} />
            : <div style={{ width:52, height:52, borderRadius:11, background:'rgba(255,255,255,0.1)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}><span style={{ fontSize:26 }}>🏷️</span></div>
          }
          <div>
            <div style={{ color:'#fff', fontWeight:900, fontSize:20, lineHeight:1.2 }}>{eventData?.catering_company || 'Catering Partner'}</div>
            <div style={{ color:'rgba(255,255,255,0.45)', fontSize:12, fontWeight:500 }}>Catering Partner</div>
          </div>
        </div>

        {/* Janu's Smart Serve Slide */}
        <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', gap:10, opacity: isJanusSlide ? (fade?1:0) : 0, transition:'opacity 0.35s ease', pointerEvents: isJanusSlide ? 'auto' : 'none' }}>
          <img src={janusLogo} alt="Janu's Smart Serve" style={{ width:56, height:56, objectFit:'contain', borderRadius:12, background:'rgba(255,255,255,0.08)', flexShrink:0, border:'1px solid rgba(255,255,255,0.2)' }} />
          <div>
            <div style={{ color:'#E8890C', fontWeight:900, fontSize:19, lineHeight:1.2, whiteSpace:'nowrap' }}>Janu's Smart Serve</div>
            <div style={{ color:'rgba(255,255,255,0.45)', fontSize:12, fontWeight:500 }}>Technology Partner</div>
          </div>
        </div>

        {/* Welcome Note Slide — 3rd panel */}
        {hasWelcomeNote && (
          <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', gap:10, opacity: isWelcomeSlide ? (fade?1:0) : 0, transition:'opacity 0.35s ease', pointerEvents: isWelcomeSlide ? 'auto' : 'none' }}>
            {eventData?.banner_image_url
              ? <img src={eventData.banner_image_url} alt="" style={{ width:44, height:44, objectFit:'cover', borderRadius:10, flexShrink:0, border:'1px solid rgba(255,255,255,0.2)' }} onError={e=>e.target.style.display='none'} />
              : <span style={{ fontSize:28, flexShrink:0 }}>🎉</span>
            }
            <div style={{ textAlign:'center' }}>
              <div style={{ color:'#FFE0A0', fontWeight:900, fontSize:18, lineHeight:1.3 }}>{eventData.welcome_note}</div>
            </div>
          </div>
        )}

        {/* Dot indicators */}
        {slideOrder.length > 1 && (
          <div style={{ position:'absolute', bottom:2, left:'50%', transform:'translateX(-50%)', display:'flex', gap:4 }}>
            {slideOrder.map((_, i) => (
              <span key={i} style={{ width:5, height:5, borderRadius:'50%', background: slideIdx===i ? '#E8890C' : 'rgba(255,255,255,0.3)', display:'block', transition:'background 0.3s' }} />
            ))}
          </div>
        )}
      </div>

      {/* Instagram QR strip removed — just carousel + table */}

      {/* Captain, or table. A captain's tablet moves between tables all
          evening, so a fixed table number here would be a lie. Switch hands
          the device to another captain without a restart or a reinstall. */}
      {captain ? (
        <div style={{ flex:2, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:3 }}>
          {isOnline===false && <span style={{ background:'#DC2626', color:'#fff', fontSize:8, fontWeight:700, padding:'1px 4px', borderRadius:999 }}>OFFLINE</span>}
          <div style={{ color:'rgba(255,255,255,0.5)', fontSize:11, fontWeight:600, letterSpacing:'0.5px' }}>CAPTAIN</div>
          <div style={{ color:'#fff', fontSize:20, fontWeight:900, lineHeight:1.1, maxWidth:110,
            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{captain.name}</div>
          <button onClick={onSwitchCaptain}
            style={{ background:'rgba(255,255,255,0.12)', border:'1px solid rgba(255,255,255,0.25)',
              color:'rgba(255,255,255,0.75)', borderRadius:999, padding:'2px 10px', fontSize:10,
              fontWeight:700, cursor:'pointer', marginTop:2 }}>Switch</button>
        </div>
      ) : (
      <div style={{ flex:2, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:3 }}>
        {isOnline===false && <span style={{ background:'#DC2626', color:'#fff', fontSize:8, fontWeight:700, padding:'1px 4px', borderRadius:999 }}>OFFLINE</span>}
        <div style={{ color:'rgba(255,255,255,0.5)', fontSize:11, fontWeight:600, letterSpacing:'0.5px' }}>TABLE</div>
        <div style={{ color:'#fff', fontSize:28, fontWeight:900, lineHeight:1 }}>{tableNumber}</div>
      </div>
      )}
    </div>
  )
}

function MenuModal({ categories, items, onSelect, cartCount, hasActiveOrders, onShowStatus, menuSheetOpen, onMenuSheetChange, onBack }) {
  const open = menuSheetOpen
  const setOpen = onMenuSheetChange
  return (
    <>
      {/* Bottom-right button group: Track Order + MENU */}
      {/* TRACK - bottom CENTRE, only when something is live. Centre because
          every menu row is left-aligned text with the image on the right,
          so the middle column is clear on every row.
          Lifts above the cart bar when the bar is showing. */}
      {hasActiveOrders && (
        <div style={{ position:'fixed', bottom: cartCount>0 ? 96 : 24, left:'50%',
          transform:'translateX(-50%)', zIndex:60 }}>
          <button onClick={onShowStatus} style={{
            background:'#16A34A', color:'#fff', border:'none', borderRadius:999,
            padding:'12px 20px', fontSize:14, fontWeight:800, cursor:'pointer',
            boxShadow:'0 6px 20px rgba(22,163,74,0.45)',
            display:'flex', alignItems:'center', gap:6
          }}>
            📦 Track
          </button>
        </div>
      )}

      {/* MENU - bottom RIGHT corner, always present */}
      <div style={{ position:'fixed', bottom: cartCount>0 ? 96 : 24, right:16, zIndex:60, display:'flex', gap:8, alignItems:'center' }}>
        <button onClick={()=>setOpen(true)} style={{
          background:'#1A0A0A', color:'#fff', border:'none', borderRadius:999,
          padding:'12px 22px', fontSize:14, fontWeight:800, cursor:'pointer',
          boxShadow:'0 6px 20px rgba(0,0,0,0.4)',
          display:'flex', alignItems:'center', gap:8, letterSpacing:'0.5px'
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          MENU
        </button>
      </div>

      {/* Category picker modal */}
      {open && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:200, display:'flex', alignItems:'flex-end' }} onClick={()=>setOpen(false)}>
          <div onClick={e=>e.stopPropagation()} style={{ width:'100%', background:'#fff', borderRadius:'20px 20px 0 0', padding:'20px 16px 40px', maxHeight:'70vh', overflowY:'auto' }}>
            <div style={{ width:40, height:4, background:'#ddd', borderRadius:999, margin:'0 auto 16px' }}></div>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
              <div style={{ width:40 }}></div>
              <h3 style={{ fontSize:18, fontWeight:800, textAlign:'center', flex:1 }}>Browse Menu</h3>
              <button onClick={()=>setOpen(false)} style={{ background:'#1A0A0A', border:'none', borderRadius:999, width:40, height:40, fontSize:19, fontWeight:800, color:'#fff', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, boxShadow:'0 2px 8px rgba(0,0,0,0.25)' }}>✕</button>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
              {/* Only list categories that actually have dishes right now.
                  Matches the rule the menu page already uses, so Browse Menu
                  never offers a section that turns out to be empty. */}
              {categories.filter(cat => items.some(i=>i.category_id===cat.id)).map(cat => {
                const count = items.filter(i=>i.category_id===cat.id).length
                return (
                  <button key={cat.id} onClick={()=>{ onSelect(cat.id); setOpen(false) }}
                    style={{ background:'#F8F8F8', border:'1.5px solid #EBEBEB', borderRadius:14, padding:'16px 12px', textAlign:'left', cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ fontWeight:700, fontSize:14, color:'#1A1A1A' }}>{catLabel(cat.name)}</span>
                    <span style={{ fontSize:12, color:'#888', fontWeight:600 }}>{count}</span>
                  </button>
                )
              })}
            </div>
            <button onClick={()=>setOpen(false)} style={{ width:'100%', marginTop:16, background:'#1A0A0A', color:'#fff', border:'none', borderRadius:14, padding:'15px', fontSize:15, fontWeight:800, cursor:'pointer' }}>
              ✕ Close
            </button>
          </div>
        </div>
      )}
    </>
  )
}

export default function MenuScreen({ tableNumber, eventData, cart, addToCart, removeFromCart, cartCount, isOnline, onShowSOS, onShowHistory, onShowStatus, hasActiveOrders, showFeedbackBubble, onFeedbackBubbleClick, onShowFeedback, menuSheetOpen, setMenuSheetOpen, onBack, captain, onSwitchCaptain }) {
  const [categories, setCategories] = useState([])
  const [items, setItems] = useState([])
  const [search, setSearch] = useState('')
  const [vegMode, setVegMode] = useState('all')
  const [loading, setLoading] = useState(true)
  const sectionRefs = useRef({})
  const scrollRef = useRef()

  // Category order comes straight from sort_order, which the CSV importer sets
  // from the order categories first appear in the import file. This gives full
  // control from the sheet and supports custom names like "Lunch - Starters".
  // The Veg / Non-Veg filter is only useful when the menu actually has both.
  // On an all-veg menu the Non-Veg button would return nothing, which looks
  // like a fault to a guest - so we hide the whole row and save the space.
  const hasVeg    = items.some(i => i.is_veg !== false)
  const hasNonVeg = items.some(i => i.is_veg === false)

  function sortCategories(cats) {
    return [...cats].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  }

  useEffect(() => {
    if (!eventData) return
    loadMenu()
    // Real-time updates when supervisor hides/shows items
    const sub = supabase.channel('menu-realtime-'+eventData.id)
      .on('postgres_changes', { event:'UPDATE', schema:'public', table:'menu_items' }, () => loadMenu(false))
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'menu_items' }, () => loadMenu(false))
      .subscribe()
    // Also poll every 15s as fallback
    const poll = setInterval(() => loadMenu(false), 15000)
    return () => { supabase.removeChannel(sub); clearInterval(poll) }
  }, [eventData?.id])

  async function loadMenu(showSpinner = true) {
    if (showSpinner) setLoading(true)
    const { data: cats } = await supabase.from('menu_categories').select('*').eq('event_id', eventData.id).eq('is_visible', true).order('sort_order')
    const { data: catIds } = { data: (cats||[]).map(c=>c.id) }
    const { data: menuItems } = catIds.length
      ? await supabase.from('menu_items').select('*').in('category_id', catIds).eq('is_available', true).order('name')
      : { data: [] }
    setCategories(sortCategories(cats||[]))
    setItems(menuItems||[])
    setLoading(false)
  }

  // Scroll to category section
  function scrollToCategory(catId) {
    const el = sectionRefs.current[catId]
    if (el) el.scrollIntoView({ behavior:'smooth', block:'start' })
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

      {/* HEADER — Animated carousel brand | Table */}
      <HeaderCarousel eventData={eventData} tableNumber={tableNumber} isOnline={isOnline}
        captain={captain} onSwitchCaptain={onSwitchCaptain} />

      {/* ACTION BAR + SEARCH on one row */}
      <div style={{ display:'flex', gap:8, padding:'8px 14px', background:'#fff',
        borderBottom:'1px solid #eee', flexShrink:0, alignItems:'center' }}>

        {/* Guest features. A captain is taking someone else's order, so their
            history and their rating are not the captain's to give. */}
        <button onClick={onShowHistory} style={{ display: captain ? 'none' : 'inline-block', flexShrink:0, background:'#fff', color:'#333',
          border:'1.5px solid #ddd', borderRadius:999, padding:'8px 14px', fontSize:12,
          fontWeight:600, cursor:'pointer', whiteSpace:'nowrap' }}>📋 History</button>

        {/* ss-help-captain - a captain raises this for whichever table they
            are standing at; the table is asked for when it is sent. */}
        {eventData?.call_waiter_enabled!==false && (
          <button onClick={onShowSOS} style={{ flexShrink:0, background:'#FEF3C7', color:'#92400E',
            border:'1.5px solid #FCD34D', borderRadius:999, padding:'8px 14px', fontSize:12,
            fontWeight:700, cursor:'pointer', whiteSpace:'nowrap' }}>🔔 Help</button>
        )}

        {/* Feedback - opens the detailed page directly, no face popup first */}
        {/* Amber like the rest, but deliberately not flashing: two pulsing
            things on one screen compete, and the one we want pressed is
            Order Now. Add ss-cta on its own to make it flash. */}
        <button onClick={onShowFeedback} className="ss-cta ss-cta-still"
          style={{ display: captain ? 'none' : 'inline-flex', flexShrink:0, borderRadius:999,
            padding:'8px 15px', fontSize:12, whiteSpace:'nowrap' }}>⭐ Feedback</button>

        <div style={{ flex:1, minWidth:0, background:'#F5F5F5', borderRadius:999,
          padding:'7px 14px', display:'flex', alignItems:'center', gap:6 }}>
          <span style={{ fontSize:14 }}>🔍</span>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search dishes..."
            style={{ border:'none', outline:'none', flex:1, minWidth:0, fontSize:13,
              fontFamily:'Manrope', background:'transparent' }} />
          {search.length>0 && (
            <button onClick={()=>setSearch('')} style={{ background:'none', border:'none',
              fontSize:15, color:'#999', cursor:'pointer', padding:0 }}>✕</button>
          )}
        </div>
      </div>

      {/* VEG FILTER — only shown when the menu contains both veg and non-veg */}
      {hasVeg && hasNonVeg && (
        <div style={{ display:'flex', gap:8, padding:'8px 14px', background:'#fff', borderBottom:'1px solid #eee', flexShrink:0, overflowX:'auto', scrollbarWidth:'none' }}>
          {[['all','🍽️ All'],['veg','🟢 Veg Only'],['nonveg','🔴 Non-Veg']].map(([val,label]) => (
            <button key={val} onClick={()=>setVegMode(val)} style={{ flexShrink:0, padding:'5px 14px', borderRadius:999, fontSize:12, fontWeight:700, border:'1.5px solid', cursor:'pointer', background:vegMode===val?(val==='veg'?'#16A34A':val==='nonveg'?'#DC2626':'#1A0A0A'):'#fff', color:vegMode===val?'#fff':'#555', borderColor:vegMode===val?'transparent':'#ddd' }}>{label}</button>
          ))}
        </div>
      )}

      {/* SCROLLABLE MENU CONTENT */}
      <div ref={scrollRef} style={{ flex:1, overflowY:'auto', paddingBottom: cartCount>0?190:96 }}>
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
                {/* Sticky category header — dark, bold, unmissable */}
                <div style={{ position:'sticky', top:0, zIndex:10, background:'#1A0A0A', padding:'10px 16px', display:'flex', alignItems:'center', gap:10 }}>
                  <span style={{ fontWeight:900, fontSize:15, color:'#E8890C', letterSpacing:'0.5px', textTransform:'uppercase' }}>{catLabel(cat.name)}</span>
                  <span style={{ fontSize:11, color:'rgba(255,255,255,0.5)', background:'rgba(255,255,255,0.1)', padding:'2px 8px', borderRadius:999, fontWeight:600 }}>{catItems.length} item{catItems.length!==1?'s':''}</span>
                </div>
                {catItems.map(item => <ItemCard key={item.id} item={item} />)}
              </div>
            ))
        )}
      </div>

      {/* FLOATING BOTTOM BUTTONS — MENU (right) + Track Order (left of menu) */}
      {search.length === 0 && categories.length > 0 && (
        <MenuModal categories={categories} items={items} onSelect={scrollToCategory} cartCount={cartCount} hasActiveOrders={hasActiveOrders} onShowStatus={onShowStatus} menuSheetOpen={menuSheetOpen} onMenuSheetChange={setMenuSheetOpen} onBack={onBack} />
      )}

      {/* FEEDBACK BUBBLE */}
      {showFeedbackBubble && (
        <>
          <style>{`@keyframes fbP{0%,100%{transform:translateY(0)}40%{transform:translateY(-12px)}70%{transform:translateY(-5px)}}.fbb{animation:fbP 1.8s ease-in-out infinite}`}</style>
          <button className="fbb" onClick={onFeedbackBubbleClick} style={{ position:'fixed', bottom:cartCount>0?90:28, right:16, zIndex:80, background:'#E8890C', border:'3px solid #fff', borderRadius:50, padding:'13px 16px', display:'flex', flexDirection:'column', alignItems:'center', gap:3, cursor:'pointer', boxShadow:'0 8px 28px rgba(232,137,12,0.6)', color:'#fff', minWidth:76 }}>
            <span style={{ fontSize:28 }}>⭐</span>
            <span style={{ fontSize:10, fontWeight:800, whiteSpace:'nowrap' }}>Rate Us!</span>
          </button>
        </>
      )}
    </div>
  )
}
