import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

export default function FoodMaster({ eventData, onClose }) {
  const [foods, setFoods] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [catFilter, setCatFilter] = useState('all')

  useEffect(() => { loadFoods() }, [])

  async function loadFoods() {
    setLoading(true)
    const { data } = await supabase.from('food_master')
      .select('*').order('category').order('name')
    setFoods(data || [])
    setLoading(false)
  }

  function toggle(id) {
    setSelected(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  function toggleAll() {
    if (selected.size === filtered.length) setSelected(new Set())
    else setSelected(new Set(filtered.map(f=>f.id)))
  }

  async function addToEvent() {
    if (!selected.size || !eventData) return
    setAdding(true)
    const selectedFoods = foods.filter(f => selected.has(f.id))
    // Get or create categories for this event
    const catCache = {}
    const { data: existingCats } = await supabase.from('menu_categories')
      .select('*').eq('event_id', eventData.id)
    existingCats?.forEach(c => { catCache[c.name.toLowerCase()] = c.id })

    // Load existing item names to prevent duplicates
    const { data: existCats } = await supabase.from('menu_categories').select('id').eq('event_id', eventData.id)
    const existCatIds = (existCats||[]).map(c=>c.id)
    const { data: existItems } = existCatIds.length ? await supabase.from('menu_items').select('name').in('category_id', existCatIds) : { data:[] }
    const existNames = new Set((existItems||[]).map(i=>i.name.toLowerCase().trim()))

    let fmAdded=0, fmSkipped=0
    for (const food of selectedFoods) {
      if (existNames.has(food.name.toLowerCase().trim())) { fmSkipped++; continue }
      const catKey = (food.category||'General').toLowerCase()
      if (!catCache[catKey]) {
        const { data: newCat } = await supabase.from('menu_categories')
          .insert({ event_id:eventData.id, name:food.category||'General', sort_order:Object.keys(catCache).length+1, is_visible:true })
          .select().single()
        if (newCat) catCache[catKey] = newCat.id
      }
      await supabase.from('menu_items').insert({
        category_id: catCache[catKey],
        name: food.name,
        description: food.description||null,
        is_veg: food.is_veg,
        is_live_counter: false,
        photo_url: food.photo_url||null,
        is_available: true
      })
      existNames.add(food.name.toLowerCase().trim())
      fmAdded++
    }
    alert('✅ Added ' + fmAdded + ' items to ' + eventData.name + (fmSkipped>0?' · Skipped '+fmSkipped+' duplicates':''))
    setAdding(false)
    onClose()
  }

  const categories = ['all', ...new Set(foods.map(f=>f.category||'General').filter(Boolean))]
  const filtered = foods.filter(f => {
    const matchSearch = !search || f.name.toLowerCase().includes(search.toLowerCase())
    const matchCat = catFilter==='all' || (f.category||'General')===catFilter
    return matchSearch && matchCat
  })

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', zIndex:100, display:'flex', alignItems:'flex-end' }}>
      <div style={{ width:'100%', background:'#fff', borderRadius:'20px 20px 0 0', maxHeight:'90vh', display:'flex', flexDirection:'column' }}>
        {/* Header */}
        <div style={{ padding:'20px 20px 12px', borderBottom:'1px solid var(--line)', flexShrink:0 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
            <h3 style={{ fontSize:18, fontWeight:800 }}>Food Master</h3>
            <button onClick={onClose} style={{ background:'none', border:'none', fontSize:22, color:'#999', cursor:'pointer' }}>✕</button>
          </div>
          <p style={{ fontSize:13, color:'#888', marginBottom:12 }}>Select items to add to <strong>{eventData?.name}</strong></p>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search foods..."
            style={{ width:'100%', border:'1.5px solid var(--line)', borderRadius:10, padding:'8px 12px', fontSize:14, fontFamily:'Manrope', outline:'none', boxSizing:'border-box', marginBottom:10 }} />
          <div style={{ display:'flex', gap:6, overflowX:'auto', scrollbarWidth:'none' }}>
            {categories.map(cat => (
              <button key={cat} onClick={()=>setCatFilter(cat)} style={{ flexShrink:0, padding:'5px 12px', borderRadius:999, fontSize:12, fontWeight:600, border:'1.5px solid', background:catFilter===cat?'var(--ink)':'#fff', color:catFilter===cat?'#fff':'var(--ink)', borderColor:catFilter===cat?'var(--ink)':'var(--line)', cursor:'pointer' }}>
                {cat==='all'?'All':cat}
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        <div style={{ flex:1, overflowY:'auto', padding:'0 16px' }}>
          {loading ? <div style={{ textAlign:'center', padding:40, color:'var(--ink2)' }}>Loading...</div>
          : filtered.length===0 ? <div style={{ textAlign:'center', padding:40, color:'var(--ink2)' }}>No foods found</div>
          : (
            <>
              <div style={{ padding:'10px 0', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <span style={{ fontSize:13, color:'var(--ink2)' }}>{filtered.length} items</span>
                <button onClick={toggleAll} style={{ background:'none', border:'none', fontSize:13, fontWeight:600, color:'var(--ink)', cursor:'pointer' }}>
                  {selected.size===filtered.length?'Deselect All':'Select All'}
                </button>
              </div>
              {filtered.map(food => (
                <div key={food.id} onClick={()=>toggle(food.id)} style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 0', borderBottom:'1px solid #f5f5f5', cursor:'pointer' }}>
                  <div style={{ width:22, height:22, borderRadius:6, border:'2px solid', borderColor:selected.has(food.id)?'var(--ink)':'#ddd', background:selected.has(food.id)?'var(--ink)':'#fff', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                    {selected.has(food.id) && <span style={{ color:'#fff', fontSize:14, fontWeight:800 }}>✓</span>}
                  </div>
                  {food.photo_url && <img src={food.photo_url} alt={food.name} style={{ width:40, height:40, objectFit:'cover', borderRadius:8, flexShrink:0 }} onError={e=>e.target.style.display='none'} />}
                  <div style={{ flex:1 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                      <span style={{ display:'inline-block', width:10, height:10, borderRadius:2, border:'1.5px solid', borderColor:food.is_veg!==false?'#16A34A':'#DC2626', background:food.is_veg!==false?'#16A34A':'#DC2626' }}></span>
                      <span style={{ fontWeight:700, fontSize:14 }}>{food.name}</span>
                    </div>
                    {food.category && <div style={{ fontSize:11, color:'#888', marginTop:2 }}>{food.category}</div>}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding:'14px 16px', borderTop:'1px solid var(--line)', flexShrink:0 }}>
          <button onClick={addToEvent} disabled={!selected.size||adding}
            style={{ width:'100%', background:!selected.size?'#ccc':'var(--ink)', color:'#fff', border:'none', borderRadius:14, padding:'16px', fontSize:16, fontWeight:800, cursor:!selected.size?'not-allowed':'pointer' }}>
            {adding ? 'Adding...' : `Add ${selected.size || 0} Items to Event →`}
          </button>
        </div>
      </div>
    </div>
  )
}
