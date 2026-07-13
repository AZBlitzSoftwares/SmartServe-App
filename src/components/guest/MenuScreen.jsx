import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

export default function MenuScreen({ tableNumber, eventData, cart, addToCart, removeFromCart, cartCount, isOnline, onShowSOS, onShowHistory, onShowStatus, currentOrderId }) {
  const [categories, setCategories] = useState([])
  const [items, setItems] = useState([])
  const [activeCategory, setActiveCategory] = useState(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (eventData) loadMenu() }, [eventData])

  async function loadMenu() {
    setLoading(true)
    const { data: cats } = await supabase.from('menu_categories').select('*').eq('event_id', eventData.id).eq('is_visible', true).order('sort_order')
    const { data: menuItems } = await supabase.from('menu_items').select('*').eq('is_available', true)
    setCategories(cats || [])
    setItems(menuItems || [])
    if (cats?.length) setActiveCategory(cats[0].id)
    setLoading(false)
  }

  const filtered = items.filter(i => {
    const matchCat = activeCategory ? i.category_id === activeCategory : true
    const matchSearch = search ? i.name.toLowerCase().includes(search.toLowerCase()) : true
    return matchCat && matchSearch
  })

  const getQty = (id) => cart.find(c => c.id === id)?.quantity || 0

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', paddingBottom: cartCount > 0 ? 100 : 24 }}>
      <div style={{ background: 'var(--ink)', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 40 }}>
        <div style={{ color: '#fff', fontWeight: 800, fontSize: 20 }}>Smart<span style={{ color: '#E8890C' }}>Serve</span></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {isOnline === false && <span style={{ background: '#DC2626', color: '#fff', fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 999 }}>OFFLINE</span>}
          <div style={{ background: 'rgba(255,255,255,0.12)', color: '#fff', fontSize: 13, fontWeight: 700, padding: '6px 14px', borderRadius: 999 }}>TABLE {tableNumber}</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, padding: '12px 16px', overflowX: 'auto' }}>
        {currentOrderId && <button onClick={onShowStatus} style={{ flexShrink: 0, background: '#16A34A', color: '#fff', border: 'none', borderRadius: 999, padding: '8px 16px', fontSize: 13, fontWeight: 700 }}>Track Order</button>}
        <button onClick={onShowHistory} style={{ flexShrink: 0, background: 'var(--card)', color: 'var(--ink)', border: '1.5px solid var(--line)', borderRadius: 999, padding: '8px 16px', fontSize: 13, fontWeight: 600 }}>History</button>
        <button onClick={onShowSOS} style={{ flexShrink: 0, background: '#FEF3C7', color: '#92400E', border: '1.5px solid #FCD34D', borderRadius: 999, padding: '8px 16px', fontSize: 13, fontWeight: 700 }}>Need Help?</button>
      </div>
      <div style={{ padding: '0 16px 12px' }}>
        <div style={{ background: '#fff', borderRadius: 12, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, border: '1.5px solid var(--line)' }}>
          <span>🔍</span>
          <input value={search} onChange={e => { setSearch(e.target.value); setActiveCategory(null) }} placeholder="Search dishes..." style={{ border: 'none', outline: 'none', flex: 1, fontSize: 15, fontFamily: 'Manrope', background: 'transparent' }} />
          {search.length > 0 && <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', fontSize: 18, color: '#999' }}>x</button>}
        </div>
      </div>
      {search.length === 0 && (
        <div style={{ display: 'flex', gap: 8, padding: '0 16px 16px', overflowX: 'auto' }}>
          {categories.map(cat => (
            <button key={cat.id} onClick={() => setActiveCategory(cat.id)} style={{ flexShrink: 0, background: activeCategory === cat.id ? 'var(--ink)' : '#fff', color: activeCategory === cat.id ? '#fff' : 'var(--ink)', border: '1.5px solid', borderColor: activeCategory === cat.id ? 'var(--ink)' : 'var(--line)', borderRadius: 999, padding: '8px 18px', fontSize: 13, fontWeight: 700 }}>
              {cat.name}
            </button>
          ))}
        </div>
      )}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--ink2)' }}>Loading menu...</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--ink2)' }}>No dishes found</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 14, padding: '0 16px' }}>
          {filtered.map((item) => {
            const qty = getQty(item.id)
            return (
              <div key={item.id} style={{ background: '#fff', borderRadius: 18, overflow: 'hidden', boxShadow: 'var(--shadow)' }}>
                <div style={{ height: 130, background: item.photo_url ? 'url(' + item.photo_url + ') center/cover' : 'linear-gradient(135deg, #F7F4FB, #E8E0F0)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 48 }}>
                  {item.photo_url ? null : '🍽️'}
                </div>
                <div style={{ padding: '12px 12px 14px' }}>
                  <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{item.name}</div>
                  {item.description && <div style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 10, lineHeight: 1.4 }}>{item.description}</div>}
                  {item.is_live_counter && <div style={{ fontSize: 11, color: '#D97706', fontWeight: 600, marginBottom: 8 }}>Live counter</div>}
                  {qty === 0 ? (
                    <button onClick={() => addToCart(item)} style={{ width: '100%', background: 'var(--ink)', color: '#fff', border: 'none', borderRadius: 10, padding: '9px 0', fontSize: 13, fontWeight: 800 }}>+ Add</button>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--ink)', borderRadius: 10, padding: '6px 12px' }}>
                      <button onClick={() => removeFromCart(item.id)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 20, fontWeight: 800 }}>-</button>
                      <span style={{ color: '#fff', fontWeight: 800, fontSize: 15 }}>{qty}</span>
                      <button onClick={() => addToCart(item)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 20, fontWeight: 800 }}>+</button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}