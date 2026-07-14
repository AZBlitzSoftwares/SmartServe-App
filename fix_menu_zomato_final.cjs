const fs = require('fs')
const BASE = '/Users/asayyed/SmartServe/src'

fs.writeFileSync(BASE + '/components/guest/MenuScreen.jsx', `import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

export default function MenuScreen({ tableNumber, eventData, cart, addToCart, removeFromCart, cartCount, isOnline, onShowSOS, onShowHistory, onShowStatus, currentOrderId, showFeedbackBubble, onFeedbackBubbleClick }) {
  const [categories, setCategories] = useState([])
  const [items, setItems] = useState([])
  const [activeCategory, setActiveCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [vegMode, setVegMode] = useState('all') // 'all' | 'veg' | 'nonveg'
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (eventData) loadMenu() }, [eventData])

  async function loadMenu() {
    setLoading(true)
    const { data: cats } = await supabase
      .from('menu_categories').select('*')
      .eq('event_id', eventData.id).eq('is_visible', true).order('sort_order')
    const { data: menuItems } = await supabase
      .from('menu_items').select('*').eq('is_available', true)
    setCategories(cats || [])
    setItems(menuItems || [])
    setActiveCategory('all')
    setLoading(false)
  }

  const filtered = items.filter(i => {
    if (search.length > 0) return i.name.toLowerCase().includes(search.toLowerCase())
    const catMatch = activeCategory === 'all' || i.category_id === activeCategory
    const vegMatch = vegMode === 'all' || (vegMode === 'veg' ? i.is_veg !== false : i.is_veg === false)
    return catMatch && vegMatch
  })

  const getQty = (id) => cart.find(c => c.id === id)?.quantity || 0

  const sidebarCats = [
    { id: 'all', name: 'All', count: items.length },
    ...categories.map(c => ({
      id: c.id,
      name: c.name,
      count: items.filter(i => i.category_id === c.id).length
    }))
  ]

  return (
    <div style={{ minHeight:'100vh', background:'#f5f5f5', display:'flex', flexDirection:'column', paddingBottom: cartCount > 0 ? 100 : 24 }}>

      {/* ── HEADER ── */}
      <div style={{ background:'#1a0a0a', padding:'12px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:40 }}>
        <div style={{ color:'#fff', fontWeight:800, fontSize:17 }}>Janu's <span style={{ color:'#E8890C' }}>Smart Serve</span></div>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          {isOnline === false && <span style={{ background:'#DC2626', color:'#fff', fontSize:10, fontWeight:700, padding:'2px 6px', borderRadius:999 }}>OFFLINE</span>}
          <div style={{ background:'rgba(255,255,255,0.15)', color:'#fff', fontSize:12, fontWeight:700, padding:'5px 12px', borderRadius:999 }}>TABLE {tableNumber}</div>
        </div>
      </div>

      {/* ── ACTION BAR ── */}
      <div style={{ display:'flex', gap:8, padding:'8px 14px', background:'#fff', borderBottom:'1px solid #eee', overflowX:'auto' }}>
        {currentOrderId && (
          <button onClick={onShowStatus} style={{ flexShrink:0, background:'#16A34A', color:'#fff', border:'none', borderRadius:999, padding:'6px 14px', fontSize:12, fontWeight:700, cursor:'pointer' }}>📦 Track Order</button>
        )}
        <button onClick={onShowHistory} style={{ flexShrink:0, background:'#fff', color:'#333', border:'1.5px solid #ddd', borderRadius:999, padding:'6px 14px', fontSize:12, fontWeight:600, cursor:'pointer' }}>📋 History</button>
        <button onClick={onShowSOS} style={{ flexShrink:0, background:'#FEF3C7', color:'#92400E', border:'1.5px solid #FCD34D', borderRadius:999, padding:'6px 14px', fontSize:12, fontWeight:700, cursor:'pointer' }}>🆘 Need Help?</button>

        {/* Veg / Non-veg toggle */}
        <div style={{ marginLeft:'auto', display:'flex', gap:6, flexShrink:0 }}>
          {[['all','All'],['veg','🟢 Veg'],['nonveg','🔴 Non-Veg']].map(([val,label]) => (
            <button key={val} onClick={() => setVegMode(val)} style={{
              padding:'6px 12px', borderRadius:999, fontSize:11, fontWeight:700, border:'1.5px solid',
              background: vegMode===val ? (val==='veg'?'#16A34A':val==='nonveg'?'#DC2626':'#1a0a0a') : '#fff',
              color: vegMode===val ? '#fff' : '#555',
              borderColor: vegMode===val ? 'transparent' : '#ddd',
              cursor:'pointer'
            }}>{label}</button>
          ))}
        </div>
      </div>

      {/* ── SEARCH ── */}
      <div style={{ padding:'10px 14px', background:'#fff', borderBottom:'1px solid #eee' }}>
        <div style={{ background:'#f5f5f5', borderRadius:12, padding:'9px 14px', display:'flex', alignItems:'center', gap:8, border:'1.5px solid #eee' }}>
          <span style={{ fontSize:16 }}>🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search dishes..."
            style={{ border:'none', outline:'none', flex:1, fontSize:14, fontFamily:'Manrope', background:'transparent' }} />
          {search.length > 0 && <button onClick={() => setSearch('')} style={{ background:'none', border:'none', fontSize:16, color:'#999', cursor:'pointer' }}>✕</button>}
        </div>
      </div>

      {/* ── ZOMATO LAYOUT: LEFT SIDEBAR + RIGHT LIST ── */}
      <div style={{ display:'flex', flex:1 }}>

        {/* LEFT SIDEBAR — vertical category list */}
        {search.length === 0 && (
          <div style={{ width:88, minWidth:88, background:'#EDEDED', borderRight:'1px solid #ddd', overflowY:'auto' }}>
            {sidebarCats.map(cat => (
              <button key={cat.id} onClick={() => setActiveCategory(cat.id)} style={{
                width:'100%', border:'none',
                background: activeCategory === cat.id ? '#fff' : 'transparent',
                borderLeft: activeCategory === cat.id ? '3px solid #E8890C' : '3px solid transparent',
                padding:'14px 4px 14px 8px',
                textAlign:'center', cursor:'pointer',
                display:'flex', flexDirection:'column', alignItems:'center', gap:3,
                transition:'all 0.15s'
              }}>
                <span style={{
                  fontSize:11, lineHeight:1.3, wordBreak:'break-word', textAlign:'center',
                  fontWeight: activeCategory === cat.id ? 800 : 600,
                  color: activeCategory === cat.id ? '#E8890C' : '#555'
                }}>{cat.name}</span>
                <span style={{ fontSize:10, fontWeight:600, color: activeCategory === cat.id ? '#E8890C' : '#aaa' }}>
                  {cat.count}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* RIGHT SIDE — Zomato-style 1 item per row */}
        <div style={{ flex:1, overflowY:'auto' }}>
          {loading ? (
            <div style={{ textAlign:'center', padding:60, color:'#888' }}>Loading menu...</div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign:'center', padding:60 }}>
              <div style={{ fontSize:40, marginBottom:12 }}>🔍</div>
              <div style={{ fontWeight:600, color:'#888' }}>No dishes found</div>
            </div>
          ) : (
            <div>
              {filtered.map((item, idx) => {
                const qty = getQty(item.id)
                const isVeg = item.is_veg !== false
                return (
                  <div key={item.id} style={{
                    background:'#fff',
                    borderBottom:'1px solid #f0f0f0',
                    padding:'16px 14px',
                    display:'flex',
                    gap:12,
                    alignItems:'flex-start'
                  }}>
                    {/* LEFT: Details */}
                    <div style={{ flex:1, minWidth:0 }}>
                      {/* Veg / Non-veg dot */}
                      <div style={{ marginBottom:6 }}>
                        <span style={{
                          display:'inline-flex', alignItems:'center', justifyContent:'center',
                          width:16, height:16, borderRadius:3,
                          border: '1.5px solid ' + (isVeg ? '#16A34A' : '#DC2626'),
                        }}>
                          <span style={{ width:8, height:8, borderRadius:'50%', background: isVeg ? '#16A34A' : '#DC2626', display:'block' }}></span>
                        </span>
                        {item.is_live_counter && (
                          <span style={{ marginLeft:8, fontSize:10, color:'#D97706', fontWeight:700, background:'#FEF3C7', padding:'2px 7px', borderRadius:999 }}>⏱ Live counter</span>
                        )}
                      </div>

                      {/* Name */}
                      <div style={{ fontWeight:700, fontSize:15, color:'#1a1a1a', marginBottom:4, lineHeight:1.3 }}>{item.name}</div>

                      {/* Description */}
                      {item.description && (
                        <div style={{ fontSize:12, color:'#888', lineHeight:1.5, marginBottom:10, display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>
                          {item.description}
                        </div>
                      )}

                      {/* Add / Qty control */}
                      {qty === 0 ? (
                        <button onClick={() => addToCart(item)} style={{
                          background:'#fff', color:'#E8890C',
                          border:'1.5px solid #E8890C',
                          borderRadius:8, padding:'7px 24px',
                          fontSize:13, fontWeight:800, cursor:'pointer',
                          letterSpacing:'0.3px'
                        }}>ADD +</button>
                      ) : (
                        <div style={{ display:'inline-flex', alignItems:'center', background:'#E8890C', borderRadius:8, overflow:'hidden' }}>
                          <button onClick={() => removeFromCart(item.id)} style={{ background:'none', border:'none', color:'#fff', fontSize:18, fontWeight:800, cursor:'pointer', padding:'6px 14px', lineHeight:1 }}>−</button>
                          <span style={{ color:'#fff', fontWeight:800, fontSize:14, minWidth:20, textAlign:'center' }}>{qty}</span>
                          <button onClick={() => addToCart(item)} style={{ background:'none', border:'none', color:'#fff', fontSize:18, fontWeight:800, cursor:'pointer', padding:'6px 14px', lineHeight:1 }}>+</button>
                        </div>
                      )}
                    </div>

                    {/* RIGHT: Image */}
                    <div style={{ flexShrink:0, width:110, height:90, borderRadius:12, overflow:'hidden', position:'relative' }}>
                      {item.photo_url ? (
                        <img src={item.photo_url} alt={item.name} style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                      ) : (
                        <div style={{ width:'100%', height:'100%', background:'linear-gradient(135deg,#F7F4FB,#E8E0F0)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:36 }}>
                          🍽️
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── FLOATING FEEDBACK BUBBLE ── */}
      {showFeedbackBubble && (
        <>
          <style>{\`@keyframes fbBounce{0%,100%{transform:translateY(0) scale(1)}40%{transform:translateY(-14px) scale(1.1)}70%{transform:translateY(-6px) scale(1.05)}}.fb-bubble{animation:fbBounce 2s ease-in-out infinite}\`}</style>
          <button className="fb-bubble" onClick={onFeedbackBubbleClick}
            style={{ position:'fixed', bottom: cartCount > 0 ? 90 : 28, right:16, zIndex:80,
              background:'linear-gradient(135deg,#E8890C,#c97010)', border:'none', borderRadius:50,
              padding:'13px 16px', display:'flex', flexDirection:'column', alignItems:'center', gap:3,
              cursor:'pointer', boxShadow:'0 8px 28px rgba(232,137,12,0.55)', color:'#fff', minWidth:72 }}>
            <span style={{ fontSize:26 }}>⭐</span>
            <span style={{ fontSize:10, fontWeight:800, whiteSpace:'nowrap' }}>Rate Us!</span>
          </button>
        </>
      )}
    </div>
  )
}
`)

console.log('✅ MenuScreen.jsx — Zomato-style 1-per-row + veg/non-veg toggle + sidebar categories')
console.log('Done! Run: npm run dev')
