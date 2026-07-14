const fs = require('fs')
const BASE = '/Users/asayyed/SmartServe/src'

// Fix MenuManager — show existing items with edit, better import error display
fs.writeFileSync(BASE + '/components/supervisor/MenuManager.jsx', `import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'

export default function MenuManager({ eventData }) {
  const [categories, setCategories] = useState([])
  const [items, setItems] = useState([])
  const [activeCategory, setActiveCategory] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [showAddCat, setShowAddCat] = useState(false)
  const [editItem, setEditItem] = useState(null)
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
    const catIds = (cats||[]).map(c=>c.id)
    const { data: menuItems } = catIds.length
      ? await supabase.from('menu_items').select('*').in('category_id', catIds).order('name')
      : { data: [] }
    setCategories(cats||[])
    setItems(menuItems||[])
    if (cats?.length && !activeCategory) setActiveCategory(cats[0].id)
    setLoading(false)
  }

  async function addCategory() {
    if (!newCatName.trim()) return
    setSaving(true)
    const { data, error } = await supabase.from('menu_categories').insert({ event_id:eventData.id, name:newCatName.trim(), sort_order:categories.length+1, is_visible:true }).select().single()
    if (error) { alert('Error: ' + error.message); setSaving(false); return }
    setNewCatName(''); setShowAddCat(false); setSaving(false)
    if (data) setActiveCategory(data.id)
    loadMenu()
  }

  async function toggleAvailability(item) {
    await supabase.from('menu_items').update({ is_available:!item.is_available }).eq('id', item.id)
    loadMenu()
  }

  async function saveItem() {
    const catId = newItem.category_id || activeCategory
    if (!newItem.name.trim() || !catId) { alert('Dish name and category required'); return }
    setSaving(true)
    if (editItem) {
      await supabase.from('menu_items').update({ name:newItem.name.trim(), description:newItem.description.trim(), category_id:catId, is_live_counter:newItem.is_live_counter, is_veg:newItem.is_veg, photo_url:newItem.photo_url.trim()||null }).eq('id', editItem.id)
    } else {
      const { error } = await supabase.from('menu_items').insert({ category_id:catId, name:newItem.name.trim(), description:newItem.description.trim(), is_live_counter:newItem.is_live_counter, is_veg:newItem.is_veg, photo_url:newItem.photo_url.trim()||null, is_available:true })
      if (error) { alert('Error adding dish: ' + error.message); setSaving(false); return }
    }
    setNewItem({ name:'', description:'', is_live_counter:false, is_veg:true, photo_url:'', category_id:'' })
    setEditItem(null); setShowAdd(false); setSaving(false)
    loadMenu()
  }

  function startEdit(item) {
    setNewItem({ name:item.name, description:item.description||'', is_live_counter:item.is_live_counter||false, is_veg:item.is_veg!==false, photo_url:item.photo_url||'', category_id:item.category_id })
    setEditItem(item); setShowAdd(true)
  }

  async function deleteItem(id) {
    if (!confirm('Delete this dish?')) return
    await supabase.from('menu_items').delete().eq('id', id)
    loadMenu()
  }

  async function handleCSVImport(e) {
    const file = e.target.files[0]; if (!file) return
    setImporting(true); setImportResult(null)
    let text = await file.text()
    text = text.replace(/^\\uFEFF/, '').replace(/\\r\\n/g,'\\n').replace(/\\r/g,'\\n')
    const lines = text.split('\\n').map(l=>l.trim()).filter(Boolean)
    if (lines.length < 2) { setImportResult({ error:'File is empty or has no data rows.' }); setImporting(false); e.target.value=''; return }

    const rawHeaders = lines[0].split(',').map(h=>h.trim().replace(/^"|"$/g,'').toLowerCase().replace(/[^a-z_]/g,'_'))
    const find = (...terms) => rawHeaders.findIndex(h => terms.some(t => h.includes(t)))
    const nameIdx = find('name','dish','item')
    const descIdx = find('desc')
    const catIdx  = find('cat')
    const liveIdx = find('live')
    const vegIdx  = find('veg')
    const imgIdx  = find('image','photo','url','img')

    if (nameIdx === -1) { setImportResult({ error:'No "name" column found. Headers: ' + rawHeaders.join(', ') }); setImporting(false); e.target.value=''; return }

    const { data: freshCats } = await supabase.from('menu_categories').select('*').eq('event_id', eventData.id)
    const catCache = {}; (freshCats||[]).forEach(c => { catCache[c.name.toLowerCase()] = c.id })

    let added=0, skipped=0, errors=[]
    function splitLine(line) { const r=[]; let cur=''; let q=false; for(let i=0;i<line.length;i++){if(line[i]==='"'){q=!q}else if(line[i]===','&&!q){r.push(cur.trim());cur=''}else{cur+=line[i]}} r.push(cur.trim()); return r }

    for (let i=1; i<lines.length; i++) {
      try {
        const cols = splitLine(lines[i])
        const itemName = cols[nameIdx]?.replace(/^"|"$/g,'').trim(); if (!itemName) { skipped++; continue }
        const desc    = descIdx>=0 ? cols[descIdx]?.replace(/^"|"$/g,'').trim()||'' : ''
        const catName = catIdx>=0  ? cols[catIdx]?.replace(/^"|"$/g,'').trim()||'General' : 'General'
        const isLive  = liveIdx>=0 ? ['yes','true','1','y'].includes((cols[liveIdx]?.replace(/^"|"$/g,'')||'').toLowerCase().trim()) : false
        const vegVal  = vegIdx>=0  ? (cols[vegIdx]?.replace(/^"|"$/g,'')||'yes').toLowerCase().trim() : 'yes'
        const isVeg   = !['no','false','0','nonveg','non-veg','n'].includes(vegVal)
        const imgUrl  = imgIdx>=0  ? cols[imgIdx]?.replace(/^"|"$/g,'').trim()||'' : ''

        const catKey = catName.toLowerCase()
        if (!catCache[catKey]) {
          const { data: nc, error: ce } = await supabase.from('menu_categories').insert({ event_id:eventData.id, name:catName, sort_order:Object.keys(catCache).length+1, is_visible:true }).select().single()
          if (ce) { errors.push('Category "'+catName+'": '+ce.message); skipped++; continue }
          catCache[catKey] = nc.id
        }
        const { error: ie } = await supabase.from('menu_items').insert({ category_id:catCache[catKey], name:itemName, description:desc, is_live_counter:isLive, is_veg:isVeg, photo_url:imgUrl||null, is_available:true })
        if (ie) { errors.push(itemName+': '+ie.message); skipped++ } else added++
      } catch(err) { errors.push('Row '+(i+1)+': '+err.message); skipped++ }
    }
    setImportResult({ added, skipped, errors:errors.slice(0,5) })
    setImporting(false); loadMenu(); e.target.value=''
  }

  async function clearAllMenu() {
    if (!confirm('Delete ALL menu items and categories for this event?')) return
    const catIds = categories.map(c=>c.id)
    if (catIds.length) { await supabase.from('menu_items').delete().in('category_id', catIds); await supabase.from('menu_categories').delete().eq('event_id', eventData.id) }
    setActiveCategory(null); loadMenu()
  }

  const filtered = items.filter(i => i.category_id === activeCategory)
  const INP = { width:'100%', border:'1.5px solid var(--line)', borderRadius:10, padding:'10px 14px', fontSize:14, marginBottom:10, fontFamily:'Manrope', outline:'none', boxSizing:'border-box' }

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
        <h2 style={{ fontSize:20, fontWeight:800 }}>Menu Manager</h2>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={()=>fileRef.current?.click()} disabled={importing} style={{ background:'#F0FDF4', border:'1px solid #BBF7D0', color:'#16A34A', borderRadius:10, padding:'8px 14px', fontSize:13, fontWeight:700, cursor:'pointer' }}>
            {importing?'⏳ Importing...':'📥 Import CSV'}
          </button>
          <button onClick={()=>{ setEditItem(null); setNewItem({ name:'', description:'', is_live_counter:false, is_veg:true, photo_url:'', category_id:'' }); setShowAdd(true) }} style={{ background:'var(--ink)', color:'#fff', border:'none', borderRadius:10, padding:'8px 16px', fontSize:13, fontWeight:700 }}>+ Add Dish</button>
        </div>
        <input ref={fileRef} type="file" accept=".csv,.txt" onChange={handleCSVImport} style={{ display:'none' }} />
      </div>

      {importResult && (
        <div style={{ background:importResult.error?'#FEF2F2':'#F0FDF4', border:'1px solid', borderColor:importResult.error?'#FECACA':'#BBF7D0', borderRadius:12, padding:'12px 16px', marginBottom:12 }}>
          <div style={{ display:'flex', justifyContent:'space-between' }}>
            <div>
              <div style={{ fontWeight:700, fontSize:13, color:importResult.error?'#DC2626':'#16A34A' }}>
                {importResult.error ? '❌ '+importResult.error : '✅ Imported '+importResult.added+' dishes, skipped '+importResult.skipped}
              </div>
              {importResult.errors?.map((err,i)=><div key={i} style={{ color:'#DC2626', fontSize:12, marginTop:4 }}>{err}</div>)}
            </div>
            <button onClick={()=>setImportResult(null)} style={{ background:'none', border:'none', fontSize:18, cursor:'pointer', color:'#999' }}>✕</button>
          </div>
        </div>
      )}

      {eventData && (
        <div style={{ background:'#EFF6FF', border:'1px solid #BFDBFE', borderRadius:12, padding:'10px 14px', marginBottom:12, fontSize:13, color:'#2563EB', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span>📅 Menu for: <strong>{eventData.name}</strong></span>
          {categories.length > 0 && <button onClick={clearAllMenu} style={{ background:'#FEF2F2', border:'1px solid #FECACA', color:'#DC2626', borderRadius:8, padding:'4px 12px', fontSize:12, fontWeight:600, cursor:'pointer' }}>Clear All Menu</button>}
        </div>
      )}

      <div style={{ background:'#F0FDF4', border:'1px solid #BBF7D0', borderRadius:12, padding:'10px 14px', marginBottom:14, fontSize:12, color:'#15803D' }}>
        📋 CSV: <strong>name, description, category, is_live_counter, is_veg, image_url</strong> — only name required. Save as .csv not .xlsx
      </div>

      {/* Category tabs */}
      <div style={{ display:'flex', gap:8, marginBottom:12, overflowX:'auto', flexWrap:'nowrap', paddingBottom:4 }}>
        {categories.map(cat => (
          <button key={cat.id} onClick={()=>setActiveCategory(cat.id)} style={{ flexShrink:0, background:activeCategory===cat.id?'var(--ink)':'#fff', color:activeCategory===cat.id?'#fff':'var(--ink)', border:'1.5px solid', borderColor:activeCategory===cat.id?'var(--ink)':'var(--line)', borderRadius:999, padding:'8px 18px', fontSize:13, fontWeight:700, whiteSpace:'nowrap' }}>
            {cat.name} ({items.filter(i=>i.category_id===cat.id).length})
          </button>
        ))}
        <button onClick={()=>setShowAddCat(true)} style={{ flexShrink:0, background:'#FEF3C7', border:'1.5px solid #FCD34D', color:'#92400E', borderRadius:999, padding:'8px 16px', fontSize:13, fontWeight:700 }}>+ Category</button>
      </div>

      {showAddCat && (
        <div style={{ background:'#fff', borderRadius:14, padding:16, marginBottom:14, boxShadow:'var(--shadow)', border:'2px solid #E8890C' }}>
          <div style={{ fontWeight:800, fontSize:14, marginBottom:10 }}>New Category</div>
          <input value={newCatName} onChange={e=>setNewCatName(e.target.value)} placeholder="e.g. Starters, Main Course" style={INP} onKeyDown={e=>e.key==='Enter'&&addCategory()} autoFocus />
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={addCategory} disabled={saving} style={{ flex:1, background:'#E8890C', color:'#fff', border:'none', borderRadius:10, padding:'10px', fontSize:14, fontWeight:800 }}>{saving?'Saving...':'Save'}</button>
            <button onClick={()=>{ setShowAddCat(false); setNewCatName('') }} style={{ flex:1, background:'var(--bg)', border:'1.5px solid var(--line)', borderRadius:10, padding:'10px', fontSize:14, fontWeight:700 }}>Cancel</button>
          </div>
        </div>
      )}

      {showAdd && (
        <div style={{ background:'#fff', borderRadius:16, padding:20, marginBottom:16, boxShadow:'var(--shadow)', border:'2px solid var(--ink)' }}>
          <h3 style={{ fontSize:16, fontWeight:800, marginBottom:16 }}>{editItem?'Edit Dish':'Add New Dish'}</h3>
          <input value={newItem.name} onChange={e=>setNewItem(p=>({...p,name:e.target.value}))} placeholder="Dish name *" style={INP} autoFocus />
          <textarea value={newItem.description} onChange={e=>setNewItem(p=>({...p,description:e.target.value}))} placeholder="Description (optional)" style={{ ...INP, resize:'none', height:72 }} />
          <select value={newItem.category_id||activeCategory||''} onChange={e=>setNewItem(p=>({...p,category_id:e.target.value}))} style={{ ...INP, background:'#fff' }}>
            <option value="">Select category *</option>
            {categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input value={newItem.photo_url} onChange={e=>setNewItem(p=>({...p,photo_url:e.target.value}))} placeholder="Image URL (optional) — paste any direct image link" style={INP} />
          <div style={{ display:'flex', gap:10, marginBottom:12 }}>
            <button onClick={()=>setNewItem(p=>({...p,is_veg:true}))} style={{ flex:1, background:newItem.is_veg?'#16A34A':'#fff', color:newItem.is_veg?'#fff':'#333', border:'1.5px solid', borderColor:newItem.is_veg?'#16A34A':'#ddd', borderRadius:10, padding:'10px', fontSize:13, fontWeight:700, cursor:'pointer' }}>🟢 Veg</button>
            <button onClick={()=>setNewItem(p=>({...p,is_veg:false}))} style={{ flex:1, background:!newItem.is_veg?'#DC2626':'#fff', color:!newItem.is_veg?'#fff':'#333', border:'1.5px solid', borderColor:!newItem.is_veg?'#DC2626':'#ddd', borderRadius:10, padding:'10px', fontSize:13, fontWeight:700, cursor:'pointer' }}>🔴 Non-Veg</button>
          </div>
          <label style={{ display:'flex', alignItems:'center', gap:10, marginBottom:16, cursor:'pointer' }}>
            <input type="checkbox" checked={newItem.is_live_counter} onChange={e=>setNewItem(p=>({...p,is_live_counter:e.target.checked}))} />
            <span style={{ fontSize:14, fontWeight:600 }}>Live counter item</span>
          </label>
          <div style={{ display:'flex', gap:10 }}>
            <button onClick={saveItem} disabled={saving} style={{ flex:1, background:'var(--ink)', color:'#fff', border:'none', borderRadius:12, padding:'12px', fontSize:14, fontWeight:800 }}>{saving?'Saving...':editItem?'Update Dish':'Save Dish'}</button>
            <button onClick={()=>{ setShowAdd(false); setEditItem(null) }} style={{ flex:1, background:'var(--bg)', border:'1.5px solid var(--line)', borderRadius:12, padding:'12px', fontSize:14, fontWeight:700 }}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? <div style={{ textAlign:'center', padding:40, color:'var(--ink2)' }}>Loading...</div>
      : categories.length === 0 ? (
        <div style={{ textAlign:'center', padding:40 }}>
          <div style={{ fontSize:40, marginBottom:12 }}>📋</div>
          <div style={{ fontWeight:700, fontSize:16, marginBottom:8 }}>No menu yet</div>
          <div style={{ color:'var(--ink2)', fontSize:14, marginBottom:20 }}>Import a CSV or click "+ Category" to start</div>
          <button onClick={()=>fileRef.current?.click()} style={{ background:'var(--ink)', color:'#fff', border:'none', borderRadius:12, padding:'12px 24px', fontSize:14, fontWeight:800, cursor:'pointer' }}>📥 Import Menu CSV</button>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign:'center', padding:40, color:'var(--ink2)' }}>No dishes here yet.</div>
      ) : filtered.map(item => (
        <div key={item.id} style={{ background:'#fff', borderRadius:14, padding:'14px 16px', marginBottom:10, boxShadow:'var(--shadow)', display:'flex', alignItems:'center', opacity:item.is_available?1:0.55 }}>
          {item.photo_url && <img src={item.photo_url} alt={item.name} style={{ width:52, height:52, objectFit:'cover', borderRadius:8, marginRight:12, flexShrink:0 }} onError={e=>e.target.style.display='none'} />}
          <div style={{ flex:1 }}>
            <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:2 }}>
              <span style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:14, height:14, borderRadius:2, border:'1.5px solid '+(item.is_veg!==false?'#16A34A':'#DC2626') }}>
                <span style={{ width:6, height:6, borderRadius:'50%', background:item.is_veg!==false?'#16A34A':'#DC2626', display:'block' }}></span>
              </span>
              <span style={{ fontWeight:700, fontSize:15 }}>{item.name}</span>
              {item.is_live_counter && <span style={{ fontSize:11, color:'#D97706', background:'#FEF3C7', padding:'1px 6px', borderRadius:999, fontWeight:600 }}>Live</span>}
            </div>
            {item.description && <div style={{ fontSize:12, color:'var(--ink2)', marginTop:2 }}>{item.description}</div>}
            <span style={{ fontSize:11, fontWeight:600, background:item.is_available?'#F0FDF4':'#FEF2F2', color:item.is_available?'#16A34A':'#DC2626', padding:'1px 7px', borderRadius:999, marginTop:4, display:'inline-block' }}>{item.is_available?'Available':'Hidden'}</span>
          </div>
          <div style={{ display:'flex', gap:6, marginLeft:8 }}>
            <button onClick={()=>startEdit(item)} style={{ background:'#EFF6FF', border:'none', borderRadius:8, padding:'6px 12px', fontSize:12, fontWeight:600, color:'#2563EB', cursor:'pointer' }}>Edit</button>
            <button onClick={()=>toggleAvailability(item)} style={{ background:item.is_available?'#FEF2F2':'#F0FDF4', border:'none', borderRadius:8, padding:'6px 12px', fontSize:12, fontWeight:700, color:item.is_available?'#DC2626':'#16A34A', cursor:'pointer' }}>{item.is_available?'Hide':'Show'}</button>
            <button onClick={()=>deleteItem(item.id)} style={{ background:'#FEF2F2', border:'none', borderRadius:8, padding:'6px 10px', fontSize:12, fontWeight:700, color:'#DC2626', cursor:'pointer' }}>✕</button>
          </div>
        </div>
      ))}
    </div>
  )
}
`)
console.log('✅ MenuManager — edit/delete existing items, better CSV import, clear errors')
console.log('Push: git add . && git commit -m "Fix RLS menu_items, edit dishes, CSV import" && git push')
