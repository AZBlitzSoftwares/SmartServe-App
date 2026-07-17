const fs = require('fs')
const BASE = '/Users/asayyed/SmartServe/src'

// ═══════════════════════════════════════════════════════════════════
// FILE 7: FoodMaster component — global food list, pick for event
// ═══════════════════════════════════════════════════════════════════
fs.mkdirSync(BASE + '/components/supervisor', { recursive:true })

fs.writeFileSync(BASE + '/components/supervisor/FoodMaster.jsx', `import { useState, useEffect } from 'react'
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

    for (const food of selectedFoods) {
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
    }
    alert('✅ Added ' + selected.size + ' items to ' + eventData.name)
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
            {adding ? 'Adding...' : \`Add \${selected.size || 0} Items to Event →\`}
          </button>
        </div>
      </div>
    </div>
  )
}
`)
console.log('✅ 7/8 FoodMaster component — pick from global food list')

// ═══════════════════════════════════════════════════════════════════
// FILE 8: MenuManager — integrate FoodMaster + copy from event
//          + max_orders field in event + catering logo in header
// ═══════════════════════════════════════════════════════════════════
const menuMgrContent = fs.readFileSync(BASE + '/components/supervisor/MenuManager.jsx', 'utf8')

// Add FoodMaster import and button at top
const updatedMenuMgr = menuMgrContent
  .replace(
    "import { useState, useEffect, useRef } from 'react'",
    "import { useState, useEffect, useRef } from 'react'\nimport FoodMaster from './FoodMaster'"
  )
  .replace(
    "const [importResult, setImportResult] = useState(null)",
    "const [importResult, setImportResult] = useState(null)\n  const [showFoodMaster, setShowFoodMaster] = useState(false)\n  const [showCopyEvent, setShowCopyEvent] = useState(false)\n  const [allEvents, setAllEvents] = useState([])"
  )
  .replace(
    "  useEffect(() => { if (eventData) loadMenu() }, [eventData])",
    `  useEffect(() => { if (eventData) loadMenu() }, [eventData])
  useEffect(() => {
    supabase.from('events').select('id,name').order('created_at',{ascending:false}).then(({data})=>setAllEvents(data||[]))
  }, [])`
  )
  .replace(
    "<button onClick={()=>fileRef.current?.click()} disabled={importing}",
    `<button onClick={()=>setShowFoodMaster(true)} style={{ background:'#F5F3FF', border:'1px solid #DDD6FE', color:'#7C3AED', borderRadius:10, padding:'8px 14px', fontSize:13, fontWeight:700, cursor:'pointer' }}>📚 Food Master</button>
          <button onClick={()=>setShowCopyEvent(true)} style={{ background:'#EFF6FF', border:'1px solid #BFDBFE', color:'#2563EB', borderRadius:10, padding:'8px 14px', fontSize:13, fontWeight:700, cursor:'pointer' }}>📋 Copy from Event</button>
          <button onClick={()=>fileRef.current?.click()} disabled={importing}`
  )

// Add FoodMaster modal and CopyEvent modal before closing return
const finalMenuMgr = updatedMenuMgr.replace(
  /(\s*<\/div>\s*\)\s*\}\s*)$/,
  `
      {showFoodMaster && <FoodMaster eventData={eventData} onClose={()=>{ setShowFoodMaster(false); loadMenu() }} />}

      {showCopyEvent && (
        <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',zIndex:100,display:'flex',alignItems:'center',justifyContent:'center',padding:24 }}>
          <div style={{ background:'#fff',borderRadius:20,padding:24,width:'100%',maxWidth:380 }}>
            <h3 style={{ fontSize:18,fontWeight:800,marginBottom:8 }}>Copy Menu from Event</h3>
            <p style={{ fontSize:13,color:'#888',marginBottom:16 }}>All items from the selected event will be added to <strong>{eventData?.name}</strong></p>
            <select onChange={async e => {
              if (!e.target.value) return
              const srcId = e.target.value
              const { data: srcCats } = await supabase.from('menu_categories').select('*').eq('event_id', srcId)
              const srcCatIds = (srcCats||[]).map(c=>c.id)
              if (!srcCatIds.length) { alert('No menu found in that event'); return }
              const { data: srcItems } = await supabase.from('menu_items').select('*').in('category_id', srcCatIds)
              if (!srcItems?.length) { alert('No items found'); return }
              if (!confirm('Copy ' + srcItems.length + ' items to ' + eventData.name + '?')) return
              const catCache = {}
              const { data: existingCats } = await supabase.from('menu_categories').select('*').eq('event_id', eventData.id)
              existingCats?.forEach(c => { catCache[c.name.toLowerCase()] = c.id })
              for (const item of srcItems) {
                const srcCat = srcCats.find(c=>c.id===item.category_id)
                const catKey = (srcCat?.name||'General').toLowerCase()
                if (!catCache[catKey]) {
                  const { data: nc } = await supabase.from('menu_categories').insert({ event_id:eventData.id, name:srcCat?.name||'General', sort_order:Object.keys(catCache).length+1, is_visible:true }).select().single()
                  if (nc) catCache[catKey] = nc.id
                }
                await supabase.from('menu_items').insert({ category_id:catCache[catKey], name:item.name, description:item.description, is_veg:item.is_veg, is_live_counter:item.is_live_counter, photo_url:item.photo_url, is_available:true })
              }
              alert('✅ Copied ' + srcItems.length + ' items!')
              setShowCopyEvent(false); loadMenu()
            }} style={{ width:'100%',border:'1.5px solid var(--line)',borderRadius:10,padding:'10px 14px',fontSize:14,fontFamily:'Manrope',outline:'none',background:'#fff',marginBottom:16 }}>
              <option value="">Select source event...</option>
              {allEvents.filter(e=>e.id!==eventData?.id).map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <button onClick={()=>setShowCopyEvent(false)} style={{ width:'100%',background:'var(--bg)',border:'1.5px solid var(--line)',borderRadius:12,padding:'12px',fontSize:14,fontWeight:700 }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
`
)

fs.writeFileSync(BASE + '/components/supervisor/MenuManager.jsx', finalMenuMgr)
console.log('✅ 8/8 MenuManager — Food Master + Copy from Event integrated')

console.log('\n🎉 All Phase 2 files written! Now run the SQL then: npm run dev')
