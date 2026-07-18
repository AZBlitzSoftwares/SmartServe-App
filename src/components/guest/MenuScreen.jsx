import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'

function MenuModal({ categories, items, onSelect, cartCount }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      {/* Floating MENU button — bottom RIGHT corner */}
      <button onClick={()=>setOpen(true)} style={{
        position:'fixed', bottom: cartCount>0 ? 110 : 28, right:16,
        background:'#1A0A0A', color:'#fff', border:'none', borderRadius:999,
        padding:'12px 22px', fontSize:14, fontWeight:800, cursor:'pointer',
        boxShadow:'0 6px 20px rgba(0,0,0,0.4)', zIndex:60,
        display:'flex', alignItems:'center', gap:8, letterSpacing:'0.5px'
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        MENU
      </button>

      {/* Category picker modal */}
      {open && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:200, display:'flex', alignItems:'flex-end' }} onClick={()=>setOpen(false)}>
          <div onClick={e=>e.stopPropagation()} style={{ width:'100%', background:'#fff', borderRadius:'20px 20px 0 0', padding:'20px 16px 40px', maxHeight:'70vh', overflowY:'auto' }}>
            <div style={{ width:40, height:4, background:'#ddd', borderRadius:999, margin:'0 auto 16px' }}></div>
            <h3 style={{ fontSize:18, fontWeight:800, marginBottom:16, textAlign:'center' }}>Browse Menu</h3>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
              {categories.map(cat => {
                const count = items.filter(i=>i.category_id===cat.id).length
                return (
                  <button key={cat.id} onClick={()=>{ onSelect(cat.id); setOpen(false) }}
                    style={{ background:'#F8F8F8', border:'1.5px solid #EBEBEB', borderRadius:14, padding:'16px 12px', textAlign:'left', cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ fontWeight:700, fontSize:14, color:'#1A1A1A' }}>{cat.name}</span>
                    <span style={{ fontSize:12, color:'#888', fontWeight:600 }}>{count}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

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

  // Preferred category order for catering events
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
    setActiveChip(catId)
    const el = sectionRefs.current[catId]
    if (el) el.scrollIntoView({ behavior:'smooth', block:'start' })
  }

  // Detect which category is in view while scrolling
  function handleScroll(e) {
    if (search.length > 0) return
    const scrollTop = e.target.scrollTop + 20 // small offset for sticky header
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

      {/* HEADER — 40% catering | 40% Janu | 20% table — taller, centred */}
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
                {/* Sticky category header — dark, bold, unmissable */}
                <div style={{ position:'sticky', top:0, zIndex:10, background:'#1A0A0A', padding:'10px 16px', display:'flex', alignItems:'center', gap:10 }}>
                  <span style={{ fontWeight:900, fontSize:15, color:'#E8890C', letterSpacing:'0.5px', textTransform:'uppercase' }}>{cat.name}</span>
                  <span style={{ fontSize:11, color:'rgba(255,255,255,0.5)', background:'rgba(255,255,255,0.1)', padding:'2px 8px', borderRadius:999, fontWeight:600 }}>{catItems.length} item{catItems.length!==1?'s':''}</span>
                </div>
                {catItems.map(item => <ItemCard key={item.id} item={item} />)}
              </div>
            ))
        )}
      </div>

      {/* FLOATING MENU BUTTON — bottom right */}
      {search.length === 0 && categories.length > 0 && (
        <MenuModal categories={categories} items={items} onSelect={scrollToCategory} cartCount={cartCount} />
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
