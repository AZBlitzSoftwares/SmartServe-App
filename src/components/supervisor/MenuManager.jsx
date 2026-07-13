import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

export default function MenuManager({ eventData }) {
  const [categories, setCategories] = useState([])
  const [items, setItems] = useState([])
  const [activeCategory, setActiveCategory] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [newItem, setNewItem] = useState({ name: '', description: '', is_live_counter: false })
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (eventData) loadMenu() }, [eventData])

  async function loadMenu() {
    setLoading(true)
    const { data: cats } = await supabase.from('menu_categories').select('*').eq('event_id', eventData.id).order('sort_order')
    const { data: menuItems } = await supabase.from('menu_items').select('*').in('category_id', (cats || []).map(c => c.id)).order('name')
    setCategories(cats || [])
    setItems(menuItems || [])
    if (cats?.length && !activeCategory) setActiveCategory(cats[0].id)
    setLoading(false)
  }

  async function toggleAvailability(item) {
    await supabase.from('menu_items').update({ is_available: !item.is_available }).eq('id', item.id)
    loadMenu()
  }

  async function addItem() {
    if (!newItem.name.trim() || !activeCategory) return
    setSaving(true)
    await supabase.from('menu_items').insert({ category_id: activeCategory, name: newItem.name, description: newItem.description, is_live_counter: newItem.is_live_counter, is_available: true })
    setNewItem({ name: '', description: '', is_live_counter: false })
    setShowAdd(false)
    setSaving(false)
    loadMenu()
  }

  const filtered = items.filter(i => i.category_id === activeCategory)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 800 }}>Menu Manager</h2>
        <button onClick={() => setShowAdd(true)} style={{ background: 'var(--ink)', color: '#fff', border: 'none', borderRadius: 10, padding: '8px 16px', fontSize: 13, fontWeight: 700 }}>+ Add Dish</button>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, overflowX: 'auto' }}>
        {categories.map(cat => (
          <button key={cat.id} onClick={() => setActiveCategory(cat.id)} style={{ flexShrink: 0, background: activeCategory === cat.id ? 'var(--ink)' : '#fff', color: activeCategory === cat.id ? '#fff' : 'var(--ink)', border: '1.5px solid', borderColor: activeCategory === cat.id ? 'var(--ink)' : 'var(--line)', borderRadius: 999, padding: '8px 18px', fontSize: 13, fontWeight: 700 }}>
            {cat.name} ({items.filter(i => i.category_id === cat.id).length})
          </button>
        ))}
      </div>
      {showAdd && (
        <div style={{ background: '#fff', borderRadius: 16, padding: 20, marginBottom: 16, boxShadow: 'var(--shadow)', border: '2px solid var(--ink)' }}>
          <h3 style={{ fontSize: 16, fontWeight: 800, marginBottom: 16 }}>Add New Dish</h3>
          <input value={newItem.name} onChange={e => setNewItem(p => ({...p, name: e.target.value}))} placeholder="Dish name *" style={{ width: '100%', border: '1.5px solid var(--line)', borderRadius: 10, padding: '10px 14px', fontSize: 14, marginBottom: 10, fontFamily: 'Manrope', outline: 'none', boxSizing: 'border-box' }} />
          <textarea value={newItem.description} onChange={e => setNewItem(p => ({...p, description: e.target.value}))} placeholder="Description (optional)" style={{ width: '100%', border: '1.5px solid var(--line)', borderRadius: 10, padding: '10px 14px', fontSize: 14, marginBottom: 10, fontFamily: 'Manrope', outline: 'none', resize: 'none', height: 72, boxSizing: 'border-box' }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, cursor: 'pointer' }}>
            <input type="checkbox" checked={newItem.is_live_counter} onChange={e => setNewItem(p => ({...p, is_live_counter: e.target.checked}))} />
            <span style={{ fontSize: 14, fontWeight: 600 }}>Live counter item</span>
          </label>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={addItem} disabled={saving} style={{ flex: 1, background: 'var(--ink)', color: '#fff', border: 'none', borderRadius: 12, padding: '12px', fontSize: 14, fontWeight: 800 }}>{saving ? 'Saving...' : 'Save Dish'}</button>
            <button onClick={() => setShowAdd(false)} style={{ flex: 1, background: 'var(--bg)', border: '1.5px solid var(--line)', borderRadius: 12, padding: '12px', fontSize: 14, fontWeight: 700 }}>Cancel</button>
          </div>
        </div>
      )}
      {loading ? <div style={{ textAlign: 'center', padding: 40, color: 'var(--ink2)' }}>Loading...</div>
      : filtered.length === 0 ? <div style={{ textAlign: 'center', padding: 40, color: 'var(--ink2)' }}>No dishes in this category</div>
      : filtered.map(item => (
        <div key={item.id} style={{ background: '#fff', borderRadius: 14, padding: '14px 16px', marginBottom: 10, boxShadow: 'var(--shadow)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', opacity: item.is_available ? 1 : 0.5 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{item.name}</div>
            {item.description && <div style={{ fontSize: 12, color: 'var(--ink2)', marginTop: 2 }}>{item.description}</div>}
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              {item.is_live_counter && <span style={{ fontSize: 11, color: '#D97706', fontWeight: 600, background: '#FEF3C7', padding: '2px 8px', borderRadius: 999 }}>Live</span>}
              <span style={{ fontSize: 11, fontWeight: 600, background: item.is_available ? '#F0FDF4' : '#FEF2F2', color: item.is_available ? '#16A34A' : '#DC2626', padding: '2px 8px', borderRadius: 999 }}>{item.is_available ? 'Available' : 'Hidden'}</span>
            </div>
          </div>
          <button onClick={() => toggleAvailability(item)} style={{ background: item.is_available ? '#FEF2F2' : '#F0FDF4', border: 'none', borderRadius: 10, padding: '8px 14px', fontSize: 13, fontWeight: 700, color: item.is_available ? '#DC2626' : '#16A34A', marginLeft: 12 }}>
            {item.is_available ? 'Hide' : 'Show'}
          </button>
        </div>
      ))}
    </div>
  )
}