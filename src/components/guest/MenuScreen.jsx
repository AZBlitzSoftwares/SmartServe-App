import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

export default function MenuScreen({ tableNumber, eventData, cart, addToCart, removeFromCart, cartCount, isOnline, onShowSOS, onShowHistory, onShowStatus, currentOrderId, showFeedbackBubble, onFeedbackBubbleClick, onShowFeedback }) {
  const [categories, setCategories] = useState([])
  const [items, setItems] = useState([])
  const [activeCategory, setActiveCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [vegMode, setVegMode] = useState('all')
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (eventData) loadMenu() }, [eventData])

  async function loadMenu() {
    setLoading(true)
    const { data: cats } = await supabase.from('menu_categories').select('*').eq('event_id', eventData.id).eq('is_visible', true).order('sort_order')
    const catIds = (cats||[]).map(c=>c.id)
    const { data: menuItems } = catIds.length
      ? await supabase.from('menu_items').select('*').in('category_id', catIds).eq('is_available', true).order('name')
      : { data: [] }
    setCategories(cats || [])
    setItems(menuItems || [])
    setActiveCategory('all')
    setLoading(false)
  }

  const filtered = items.filter(i => {
    const matchSearch = search.length === 0 || i.name.toLowerCase().includes(search.toLowerCase())
    const matchCat = activeCategory === 'all' || i.category_id === activeCategory
    const matchVeg = vegMode === 'all' || (vegMode === 'veg' ? i.is_veg !== false : i.is_veg === false)
    return matchSearch && matchCat && matchVeg
  })

  const getQty = id => cart.find(c => c.id === id)?.quantity || 0

  return (
    <div style={{ minHeight:'100vh', background:'#f5f5f5', display:'flex', flexDirection:'column', paddingBottom: cartCount > 0 ? 100 : 24 }}>

      <div style={{ background:'#1a0a0a', padding:'10px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:40, gap:10 }}>
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
      </div>

      <div style={{ display:'flex', gap:8, padding:'8px 14px', background:'#fff', borderBottom:'1px solid #eee', overflowX:'auto', alignItems:'center' }}>
        {currentOrderId && <button onClick={onShowStatus} style={{ flexShrink:0, background:'#16A34A', color:'#fff', border:'none', borderRadius:999, padding:'6px 14px', fontSize:12, fontWeight:700, cursor:'pointer' }}>📦 Track Order</button>}
        <button onClick={onShowHistory} style={{ flexShrink:0, background:'#fff', color:'#333', border:'1.5px solid #ddd', borderRadius:999, padding:'6px 14px', fontSize:12, fontWeight:600, cursor:'pointer' }}>📋 History</button>
        <button onClick={onShowSOS} style={{ flexShrink:0, background:'#FEF3C7', color:'#92400E', border:'1.5px solid #FCD34D', borderRadius:999, padding:'6px 14px', fontSize:12, fontWeight:700, cursor:'pointer' }}>🛎️ Call Waiter</button>
        <button onClick={onShowFeedback} style={{ flexShrink:0, background:'#FFF7ED', color:'#C2410C', border:'1.5px solid #FED7AA', borderRadius:999, padding:'6px 14px', fontSize:12, fontWeight:700, cursor:'pointer' }}>⭐ Feedback</button>
      </div>

      <div style={{ padding:'8px 14px', background:'#fff', borderBottom:'1px solid #eee' }}>
        <div style={{ background:'#f5f5f5', borderRadius:12, padding:'8px 14px', display:'flex', alignItems:'center', gap:8, border:'1.5px solid #eee' }}>
          <span>🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search dishes..."
            style={{ border:'none', outline:'none', flex:1, fontSize:14, fontFamily:'Manrope', background:'transparent' }} />
          {search.length > 0 && <button onClick={() => setSearch('')} style={{ background:'none', border:'none', fontSize:16, color:'#999', cursor:'pointer' }}>✕</button>}
        </div>
      </div>

      <div style={{ display:'flex', gap:8, padding:'8px 14px', background:'#fff', borderBottom:'1px solid #eee', overflowX:'auto' }}>
        {[['all','🍽️ All'],['veg','🟢 Veg Only'],['nonveg','🔴 Non-Veg Only']].map(([val,label]) => (
          <button key={val} onClick={() => setVegMode(val)} style={{
            flexShrink:0, padding:'5px 14px', borderRadius:999, fontSize:12, fontWeight:700, border:'1.5px solid', cursor:'pointer',
            background: vegMode===val ? (val==='veg'?'#16A34A':val==='nonveg'?'#DC2626':'#1a0a0a') : '#fff',
            color: vegMode===val ? '#fff' : '#555', borderColor: vegMode===val ? 'transparent' : '#ddd'
          }}>{label}</button>
        ))}
      </div>

      {search.length === 0 && (
        <div style={{ display:'flex', background:'#fff', borderBottom:'2px solid #f0f0f0', overflowX:'auto', scrollbarWidth:'none' }}>
          {[{ id:'all', name:'All', count:items.length }, ...categories.map(c => ({ id:c.id, name:c.name, count:items.filter(i=>i.category_id===c.id).length }))].map(cat => (
            <button key={cat.id} onClick={() => setActiveCategory(cat.id)} style={{
              flexShrink:0, padding:'10px 16px', border:'none', background:'transparent', cursor:'pointer',
              borderBottom: activeCategory===cat.id ? '3px solid #E8890C' : '3px solid transparent',
              color: activeCategory===cat.id ? '#E8890C' : '#666',
              fontWeight: activeCategory===cat.id ? 800 : 500, fontSize:13, whiteSpace:'nowrap',
              marginBottom:'-2px', fontFamily:'Manrope'
            }}>
              {cat.name} <span style={{ fontSize:11, opacity:0.7 }}>({cat.count})</span>
            </button>
          ))}
        </div>
      )}

      <div style={{ flex:1 }}>
        {loading ? (
          <div style={{ textAlign:'center', padding:60, color:'#888' }}>Loading menu...</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign:'center', padding:60 }}>
            <div style={{ fontSize:40, marginBottom:12 }}>🔍</div>
            <div style={{ fontWeight:600, color:'#888' }}>No dishes found</div>
          </div>
        ) : filtered.map(item => {
          const qty = getQty(item.id)
          const isVeg = item.is_veg !== false
          return (
            <div key={item.id} style={{ background:'#fff', borderBottom:'1px solid #f0f0f0', padding:'14px', display:'flex', gap:12, alignItems:'flex-start' }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ marginBottom:4, display:'flex', alignItems:'center', gap:8 }}>
                  <span style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:16, height:16, borderRadius:3, border:'1.5px solid '+(isVeg?'#16A34A':'#DC2626'), flexShrink:0 }}>
                    <span style={{ width:8, height:8, borderRadius:'50%', background:isVeg?'#16A34A':'#DC2626', display:'block' }}></span>
                  </span>
                  {item.is_live_counter && <span style={{ fontSize:10, color:'#D97706', fontWeight:700, background:'#FEF3C7', padding:'1px 6px', borderRadius:999 }}>⏱ Live counter</span>}
                </div>
                <div style={{ fontWeight:700, fontSize:15, color:'#1a1a1a', marginBottom:3 }}>{item.name}</div>
                {item.description && <div style={{ fontSize:12, color:'#888', lineHeight:1.5, marginBottom:10, display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>{item.description}</div>}
                {qty === 0 ? (
                  <button onClick={() => addToCart(item)} style={{ background:'#fff', color:'#E8890C', border:'1.5px solid #E8890C', borderRadius:8, padding:'6px 22px', fontSize:13, fontWeight:800, cursor:'pointer' }}>ADD +</button>
                ) : (
                  <div style={{ display:'inline-flex', alignItems:'center', background:'#E8890C', borderRadius:8, overflow:'hidden' }}>
                    <button onClick={() => removeFromCart(item.id)} style={{ background:'none', border:'none', color:'#fff', fontSize:18, fontWeight:800, cursor:'pointer', padding:'5px 12px', lineHeight:1 }}>−</button>
                    <span style={{ color:'#fff', fontWeight:800, fontSize:14, minWidth:20, textAlign:'center' }}>{qty}</span>
                    <button onClick={() => addToCart(item)} style={{ background:'none', border:'none', color:'#fff', fontSize:18, fontWeight:800, cursor:'pointer', padding:'5px 12px', lineHeight:1 }}>+</button>
                  </div>
                )}
              </div>
              <div style={{ flexShrink:0, width:100, height:85, borderRadius:10, overflow:'hidden' }}>
                {item.photo_url
                  ? <img src={item.photo_url} alt={item.name} style={{ width:'100%', height:'100%', objectFit:'cover' }} onError={e=>e.target.style.display='none'} />
                  : <div style={{ width:'100%', height:'100%', background:'linear-gradient(135deg,#F7F4FB,#E8E0F0)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:32 }}>🍽️</div>
                }
              </div>
            </div>
          )
        })}
      </div>

      {showFeedbackBubble && (
        <>
          <style>{`@keyframes fbP{0%,100%{transform:scale(1) translateY(0)}40%{transform:scale(1.1) translateY(-14px)}70%{transform:scale(1.05) translateY(-7px)}}.fbb{animation:fbP 1.8s ease-in-out infinite}`}</style>
          <button className="fbb" onClick={onFeedbackBubbleClick} style={{ position:'fixed', bottom:cartCount>0?90:28, right:16, zIndex:80, background:'#E8890C', border:'3px solid #fff', borderRadius:50, padding:'14px 18px', display:'flex', flexDirection:'column', alignItems:'center', gap:3, cursor:'pointer', boxShadow:'0 8px 28px rgba(232,137,12,0.6)', color:'#fff', minWidth:76 }}>
            <span style={{ fontSize:28 }}>⭐</span>
            <span style={{ fontSize:10, fontWeight:800, whiteSpace:'nowrap' }}>Rate Us!</span>
          </button>
        </>
      )}
    </div>
  )
}
