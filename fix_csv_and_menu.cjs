const fs = require('fs')
const BASE = '/Users/asayyed/SmartServe/src'

// ═══════════════════════════════════════════
// FIX: MenuManager with robust CSV import
// Handles BOM, Excel encoding, missing headers
// ═══════════════════════════════════════════
fs.writeFileSync(BASE + '/components/supervisor/MenuManager.jsx', `import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'

export default function MenuManager({ eventData }) {
  const [categories, setCategories] = useState([])
  const [items, setItems] = useState([])
  const [activeCategory, setActiveCategory] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [showAddCat, setShowAddCat] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [newItem, setNewItem] = useState({ name:'', description:'', is_live_counter:false, is_veg:true, photo_url:'', category_id:'' })
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const fileRef = useRef()

  useEffect(() => { if (eventData) loadMenu() }, [eventData])

  async function loadMenu() {
    setLoading(true)
    const { data: cats } = await supabase.from('menu_categories').select('*').eq('event_id', eventData.id).order('sort_order')
    const { data: menuItems } = await supabase.from('menu_items').select('*').in('category_id', (cats||[]).map(c=>c.id)).order('name')
    setCategories(cats||[])
    setItems(menuItems||[])
    if (cats?.length && !activeCategory) setActiveCategory(cats[0].id)
    setLoading(false)
  }

  async function addCategory() {
    if (!newCatName.trim()) return
    setSaving(true)
    const { data } = await supabase.from('menu_categories').insert({ event_id:eventData.id, name:newCatName.trim(), sort_order:categories.length+1, is_visible:true }).select().single()
    setNewCatName(''); setShowAddCat(false); setSaving(false)
    if (data) setActiveCategory(data.id)
    loadMenu()
  }

  async function toggleAvailability(item) {
    await supabase.from('menu_items').update({ is_available:!item.is_available }).eq('id', item.id)
    loadMenu()
  }

  async function addItem() {
    const catId = newItem.category_id || activeCategory
    if (!newItem.name.trim() || !catId) { alert('Please enter dish name and select a category'); return }
    setSaving(true)
    await supabase.from('menu_items').insert({
      category_id:catId, name:newItem.name.trim(), description:newItem.description.trim(),
      is_live_counter:newItem.is_live_counter, is_veg:newItem.is_veg,
      photo_url:newItem.photo_url.trim()||null, is_available:true
    })
    setNewItem({ name:'', description:'', is_live_counter:false, is_veg:true, photo_url:'', category_id:'' })
    setShowAdd(false); setSaving(false); loadMenu()
  }

  async function clearAllMenu() {
    if (!confirm('Delete ALL menu items and categories for this event? This cannot be undone.')) return
    const catIds = categories.map(c=>c.id)
    if (catIds.length) {
      await supabase.from('menu_items').delete().in('category_id', catIds)
      await supabase.from('menu_categories').delete().eq('event_id', eventData.id)
    }
    setActiveCategory(null)
    loadMenu()
  }

  async function handleCSVImport(e) {
    const file = e.target.files[0]
    if (!file) return
    setImporting(true); setImportResult(null)

    let text = await file.text()
    // Strip BOM (byte order mark) — common from Excel/Numbers exports
    text = text.replace(/^\\uFEFF/, '').replace(/^\\xEF\\xBB\\xBF/, '')
    // Normalise line endings
    text = text.replace(/\\r\\n/g, '\\n').replace(/\\r/g, '\\n')

    const lines = text.split('\\n').map(l=>l.trim()).filter(Boolean)
    if (lines.length < 2) {
      setImportResult({ error:'CSV file is empty or has no data rows.' })
      setImporting(false); e.target.value=''; return
    }

    // Parse header — strip quotes and normalise
    const rawHeaders = lines[0].split(',').map(h=>h.trim().replace(/^"|"$/g,'').toLowerCase().replace(/[^a-z_]/g,'_').replace(/_+/g,'_').replace(/^_|_$/g,''))
    console.log('CSV headers found:', rawHeaders)

    // Find columns flexibly
    const find = (...terms) => rawHeaders.findIndex(h => terms.some(t => h.includes(t)))
    const nameIdx = find('name','dish','item','food')
    const descIdx = find('desc','description','detail')
    const catIdx  = find('cat','category','section','type')
    const liveIdx = find('live','counter')
    const vegIdx  = find('veg','vegetarian')
    const imgIdx  = find('image','photo','url','img','pic')

    if (nameIdx === -1) {
      setImportResult({ error:'Could not find a "name" column. Headers found: ' + rawHeaders.join(', ') + '. Please make sure first row has column names.' })
      setImporting(false); e.target.value=''; return
    }

    // Reload fresh categories so catCache is current
    const { data: freshCats } = await supabase.from('menu_categories').select('*').eq('event_id', eventData.id)
    const { data: freshItems } = await supabase.from('menu_items').select('name, category_id').in('category_id', (freshCats||[]).map(c=>c.id))

    let added=0, skipped=0, errors=[]
    const catCache = {}
    ;(freshCats||[]).forEach(c => { catCache[c.name.toLowerCase()] = c.id })

    // Helper to split CSV line respecting quoted fields
    function splitCSVLine(line) {
      const result = []; let current = ''; let inQuotes = false
      for (let i=0; i<line.length; i++) {
        if (line[i] === '"') { inQuotes = !inQuotes }
        else if (line[i] === ',' && !inQuotes) { result.push(current.trim()); current='' }
        else { current += line[i] }
      }
      result.push(current.trim()); return result
    }

    for (let i=1; i<lines.length; i++) {
      try {
        const cols = splitCSVLine(lines[i])
        const itemName = cols[nameIdx]?.replace(/^"|"$/g,'').trim()
        if (!itemName) { skipped++; continue }

        const desc    = descIdx>=0 ? (cols[descIdx]?.replace(/^"|"$/g,'').trim()||'') : ''
        const catName = catIdx>=0  ? (cols[catIdx]?.replace(/^"|"$/g,'').trim()||'General') : 'General'
        const isLive  = liveIdx>=0 ? ['yes','true','1','y'].includes((cols[liveIdx]?.replace(/^"|"$/g,'')||'').toLowerCase().trim()) : false
        const vegVal  = vegIdx>=0  ? (cols[vegIdx]?.replace(/^"|"$/g,'')||'').toLowerCase().trim() : 'yes'
        const isVeg   = !['no','false','0','nonveg','non-veg','non veg','n'].includes(vegVal)
        const imgUrl  = imgIdx>=0  ? (cols[imgIdx]?.replace(/^"|"$/g,'').trim()||'') : ''

        // Check duplicate
        const isDupe = (freshItems||[]).some(it => it.name.toLowerCase() === itemName.toLowerCase())
        if (isDupe) { skipped++; continue }

        // Get or create category
        const catKey = catName.toLowerCase()
        if (!catCache[catKey]) {
          const { data: newCat, error: catErr } = await supabase.from('menu_categories').insert({
            event_id:eventData.id, name:catName,
            sort_order:Object.keys(catCache).length+1, is_visible:true
          }).select().single()
          if (catErr) { errors.push('Category error: '+catErr.message); skipped++; continue }
          catCache[catKey] = newCat.id
        }

        const { error: itemErr } = await supabase.from('menu_items').insert({
          category_id:catCache[catKey], name:itemName, description:desc,
          is_live_counter:isLive, is_veg:isVeg,
          photo_url:imgUrl||null, is_available:true
        })
        if (itemErr) { errors.push(itemName+': '+itemErr.message); skipped++ }
        else added++

      } catch(err) { errors.push('Row '+(i+1)+': '+err.message); skipped++ }
    }

    setImportResult({ added, skipped, errors: errors.slice(0,3) })
    setImporting(false)
    loadMenu()
    e.target.value=''
  }

  const filtered = items.filter(i => i.category_id === activeCategory)
  const INP = { width:'100%', border:'1.5px solid var(--line)', borderRadius:10, padding:'10px 14px', fontSize:14, marginBottom:10, fontFamily:'Manrope', outline:'none', boxSizing:'border-box' }

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
        <h2 style={{ fontSize:20, fontWeight:800 }}>Menu Manager</h2>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={() => fileRef.current?.click()} disabled={importing} style={{ background:'#F0FDF4', border:'1px solid #BBF7D0', color:'#16A34A', borderRadius:10, padding:'8px 14px', fontSize:13, fontWeight:700, cursor:'pointer' }}>
            {importing ? '⏳ Importing...' : '📥 Import CSV'}
          </button>
          <button onClick={() => setShowAdd(true)} style={{ background:'var(--ink)', color:'#fff', border:'none', borderRadius:10, padding:'8px 16px', fontSize:13, fontWeight:700 }}>+ Add Dish</button>
        </div>
        <input ref={fileRef} type="file" accept=".csv,.txt" onChange={handleCSVImport} style={{ display:'none' }} />
      </div>

      {importResult && (
        <div style={{ background:importResult.error?'#FEF2F2':'#F0FDF4', border:'1px solid', borderColor:importResult.error?'#FECACA':'#BBF7D0', borderRadius:12, padding:'12px 16px', marginBottom:12 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
            <div>
              {importResult.error
                ? <div style={{ color:'#DC2626', fontWeight:700, fontSize:13 }}>❌ {importResult.error}</div>
                : <div style={{ color:'#16A34A', fontWeight:700, fontSize:13 }}>✅ Imported {importResult.added} dishes, skipped {importResult.skipped} duplicates</div>
              }
              {importResult.errors?.map((err,i) => <div key={i} style={{ color:'#DC2626', fontSize:12, marginTop:4 }}>{err}</div>)}
            </div>
            <button onClick={() => setImportResult(null)} style={{ background:'none', border:'none', fontSize:18, cursor:'pointer', color:'#999', marginLeft:12 }}>✕</button>
          </div>
        </div>
      )}

      {/* Current event info */}
      {eventData && (
        <div style={{ background:'#EFF6FF', border:'1px solid #BFDBFE', borderRadius:12, padding:'10px 14px', marginBottom:12, fontSize:13, color:'#2563EB' }}>
          📅 Managing menu for: <strong>{eventData.name}</strong>
          {categories.length > 0 && <button onClick={clearAllMenu} style={{ marginLeft:12, background:'#FEF2F2', border:'1px solid #FECACA', color:'#DC2626', borderRadius:8, padding:'3px 10px', fontSize:12, fontWeight:600, cursor:'pointer' }}>Clear All Menu</button>}
        </div>
      )}

      <div style={{ background:'#F0FDF4', border:'1px solid #BBF7D0', borderRadius:12, padding:'10px 14px', marginBottom:14, fontSize:12, color:'#15803D' }}>
        📋 CSV format: <strong>name, description, category, is_live_counter, is_veg, image_url</strong><br/>
        • Only "name" column is required &nbsp;•&nbsp; Use Yes/No for is_live_counter and is_veg<br/>
        • Save as CSV (not Excel .xlsx) &nbsp;•&nbsp; Categories are created automatically from your CSV
      </div>

      {/* Category tabs */}
      <div style={{ display:'flex', gap:8, marginBottom:12, overflowX:'auto', flexWrap:'nowrap', paddingBottom:4 }}>
        {categories.map(cat => (
          <button key={cat.id} onClick={() => setActiveCategory(cat.id)} style={{ flexShrink:0, background:activeCategory===cat.id?'var(--ink)':'#fff', color:activeCategory===cat.id?'#fff':'var(--ink)', border:'1.5px solid', borderColor:activeCategory===cat.id?'var(--ink)':'var(--line)', borderRadius:999, padding:'8px 18px', fontSize:13, fontWeight:700, whiteSpace:'nowrap' }}>
            {cat.name} ({items.filter(i=>i.category_id===cat.id).length})
          </button>
        ))}
        <button onClick={() => setShowAddCat(true)} style={{ flexShrink:0, background:'#FEF3C7', border:'1.5px solid #FCD34D', color:'#92400E', borderRadius:999, padding:'8px 16px', fontSize:13, fontWeight:700 }}>+ Category</button>
      </div>

      {showAddCat && (
        <div style={{ background:'#fff', borderRadius:14, padding:16, marginBottom:14, boxShadow:'var(--shadow)', border:'2px solid #E8890C' }}>
          <div style={{ fontWeight:800, fontSize:14, marginBottom:10 }}>New Category</div>
          <input value={newCatName} onChange={e => setNewCatName(e.target.value)} placeholder="e.g. Starters, Main Course, Desserts" style={INP} onKeyDown={e => e.key==='Enter' && addCategory()} />
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={addCategory} disabled={saving} style={{ flex:1, background:'#E8890C', color:'#fff', border:'none', borderRadius:10, padding:'10px', fontSize:14, fontWeight:800 }}>{saving?'Saving...':'Save Category'}</button>
            <button onClick={() => { setShowAddCat(false); setNewCatName('') }} style={{ flex:1, background:'var(--bg)', border:'1.5px solid var(--line)', borderRadius:10, padding:'10px', fontSize:14, fontWeight:700 }}>Cancel</button>
          </div>
        </div>
      )}

      {showAdd && (
        <div style={{ background:'#fff', borderRadius:16, padding:20, marginBottom:16, boxShadow:'var(--shadow)', border:'2px solid var(--ink)' }}>
          <h3 style={{ fontSize:16, fontWeight:800, marginBottom:16 }}>Add New Dish</h3>
          <input value={newItem.name} onChange={e => setNewItem(p=>({...p,name:e.target.value}))} placeholder="Dish name *" style={INP} />
          <textarea value={newItem.description} onChange={e => setNewItem(p=>({...p,description:e.target.value}))} placeholder="Description (optional)" style={{ ...INP, resize:'none', height:72 }} />
          <select value={newItem.category_id||activeCategory||''} onChange={e => setNewItem(p=>({...p,category_id:e.target.value}))} style={{ ...INP, background:'#fff' }}>
            <option value="">Select category *</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input value={newItem.photo_url} onChange={e => setNewItem(p=>({...p,photo_url:e.target.value}))} placeholder="Image URL (optional)" style={INP} />
          <div style={{ display:'flex', gap:10, marginBottom:12 }}>
            <button onClick={() => setNewItem(p=>({...p,is_veg:true}))} style={{ flex:1, background:newItem.is_veg?'#16A34A':'#fff', color:newItem.is_veg?'#fff':'#333', border:'1.5px solid', borderColor:newItem.is_veg?'#16A34A':'#ddd', borderRadius:10, padding:'10px', fontSize:13, fontWeight:700, cursor:'pointer' }}>🟢 Veg</button>
            <button onClick={() => setNewItem(p=>({...p,is_veg:false}))} style={{ flex:1, background:!newItem.is_veg?'#DC2626':'#fff', color:!newItem.is_veg?'#fff':'#333', border:'1.5px solid', borderColor:!newItem.is_veg?'#DC2626':'#ddd', borderRadius:10, padding:'10px', fontSize:13, fontWeight:700, cursor:'pointer' }}>🔴 Non-Veg</button>
          </div>
          <label style={{ display:'flex', alignItems:'center', gap:10, marginBottom:16, cursor:'pointer' }}>
            <input type="checkbox" checked={newItem.is_live_counter} onChange={e => setNewItem(p=>({...p,is_live_counter:e.target.checked}))} />
            <span style={{ fontSize:14, fontWeight:600 }}>Live counter item (may have delay)</span>
          </label>
          <div style={{ display:'flex', gap:10 }}>
            <button onClick={addItem} disabled={saving} style={{ flex:1, background:'var(--ink)', color:'#fff', border:'none', borderRadius:12, padding:'12px', fontSize:14, fontWeight:800 }}>{saving?'Saving...':'Save Dish'}</button>
            <button onClick={() => setShowAdd(false)} style={{ flex:1, background:'var(--bg)', border:'1.5px solid var(--line)', borderRadius:12, padding:'12px', fontSize:14, fontWeight:700 }}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? <div style={{ textAlign:'center', padding:40, color:'var(--ink2)' }}>Loading...</div>
      : categories.length === 0 ? (
        <div style={{ textAlign:'center', padding:40 }}>
          <div style={{ fontSize:40, marginBottom:12 }}>📋</div>
          <div style={{ fontWeight:700, fontSize:16, marginBottom:8 }}>No menu yet for this event</div>
          <div style={{ color:'var(--ink2)', fontSize:14, marginBottom:20 }}>Import a CSV file or click "+ Category" to start</div>
          <button onClick={() => fileRef.current?.click()} style={{ background:'var(--ink)', color:'#fff', border:'none', borderRadius:12, padding:'12px 24px', fontSize:14, fontWeight:800, cursor:'pointer' }}>📥 Import Menu CSV</button>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign:'center', padding:40, color:'var(--ink2)' }}>No dishes here yet. Click "+ Add Dish".</div>
      ) : filtered.map(item => (
        <div key={item.id} style={{ background:'#fff', borderRadius:14, padding:'14px 16px', marginBottom:10, boxShadow:'var(--shadow)', display:'flex', alignItems:'center', justifyContent:'space-between', opacity:item.is_available?1:0.5 }}>
          {item.photo_url && <img src={item.photo_url} alt={item.name} style={{ width:48, height:48, objectFit:'cover', borderRadius:8, marginRight:12, flexShrink:0 }} onError={e => e.target.style.display='none'} />}
          <div style={{ flex:1 }}>
            <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:2 }}>
              <span style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:14, height:14, borderRadius:2, border:'1.5px solid '+(item.is_veg!==false?'#16A34A':'#DC2626') }}>
                <span style={{ width:6, height:6, borderRadius:'50%', background:item.is_veg!==false?'#16A34A':'#DC2626', display:'block' }}></span>
              </span>
              <span style={{ fontWeight:700, fontSize:15 }}>{item.name}</span>
            </div>
            {item.description && <div style={{ fontSize:12, color:'var(--ink2)', marginTop:2 }}>{item.description}</div>}
            <div style={{ display:'flex', gap:6, marginTop:6 }}>
              {item.is_live_counter && <span style={{ fontSize:11, color:'#D97706', fontWeight:600, background:'#FEF3C7', padding:'2px 8px', borderRadius:999 }}>⏱ Live</span>}
              <span style={{ fontSize:11, fontWeight:600, background:item.is_available?'#F0FDF4':'#FEF2F2', color:item.is_available?'#16A34A':'#DC2626', padding:'2px 8px', borderRadius:999 }}>{item.is_available?'Available':'Hidden'}</span>
            </div>
          </div>
          <button onClick={() => toggleAvailability(item)} style={{ background:item.is_available?'#FEF2F2':'#F0FDF4', border:'none', borderRadius:10, padding:'8px 14px', fontSize:13, fontWeight:700, color:item.is_available?'#DC2626':'#16A34A', marginLeft:12 }}>
            {item.is_available?'Hide':'Show'}
          </button>
        </div>
      ))}
    </div>
  )
}
`)
console.log('✅ MenuManager.jsx — robust CSV import, BOM stripping, better error messages')
console.log('Done! Run: npm run dev')
