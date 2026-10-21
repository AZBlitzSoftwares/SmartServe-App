import { useState, useEffect, useRef } from 'react'
import FoodMaster from './FoodMaster'
import MenuImport from './MenuImport'
import { supabase } from '../../lib/supabase'
import { readSheetFile, menuTemplateCsv } from '../../lib/sheetImport'
import { coursesOf } from '../../maestro/msData'

export default function MenuManager({ eventData, onEventChange }) {
  // Maestro dishes also need a course: the captain takes the order by course
  // and the kitchen fires course by course
  const isMs = !!eventData?.maestro
  const courses = coursesOf(eventData)
  const [courseFilter, setCourseFilter] = useState('all')
  const [importing2, setImporting2] = useState(null)   // { rows, fileName } or { paste:true }
  const [categories, setCategories] = useState([])
  const [items, setItems] = useState([])
  const [activeCategory, setActiveCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [showAddCat, setShowAddCat] = useState(false)
  const [editItem, setEditItem] = useState(null)
  const [newCatName, setNewCatName] = useState('')
  const [newItem, setNewItem] = useState({ name:'', description:'', is_live_counter:false, is_veg:true, photo_url:'', category_id:'', course:'', vip_only:false })
  const [saving, setSaving] = useState(false)
  const [uploadingImg, setUploadingImg] = useState(false)
  const imgFileRef = useRef()
  const [importResult, setImportResult] = useState(null)
  const [showFoodMaster, setShowFoodMaster] = useState(false)
  const [showCopyEvent, setShowCopyEvent] = useState(false)
  const [allEvents, setAllEvents] = useState([])
  const fileRef = useRef()

  useEffect(() => { if (eventData) loadMenu() }, [eventData])
  // One KOT per category (guest / captain events): each category picks its KOT printer here too
  const kpc = !!eventData?.kot_per_category && !isMs && !eventData?.multi_kitchen
  const [printers, setPrinters] = useState([])
  useEffect(() => {
    if (!kpc || !eventData?.id) return
    supabase.from('kitchens').select('id,name,is_default,is_active,sort_order').eq('event_id', eventData.id).order('sort_order')
      .then(({ data }) => setPrinters(data || []))
  }, [kpc, eventData?.id])
  async function setCatPrinter(cat, kid) {
    setCategories(cs => cs.map(c => (c.id === cat.id ? { ...c, kitchen_id: kid || null } : c)))
    const { error } = await supabase.from('menu_categories').update({ kitchen_id: kid || null }).eq('id', cat.id)
    if (error) { alert('Not saved: ' + error.message); loadMenu() }
  }
  useEffect(() => {
    supabase.from('events').select('id,name').order('created_at',{ascending:false}).then(({data})=>setAllEvents(data||[]))
  }, [])

  async function loadMenu() {
    setLoading(true)
    const { data: cats } = await supabase.from('menu_categories').select('*').eq('event_id', eventData.id).order('sort_order')
    const catIds = (cats||[]).map(c=>c.id)
    const { data: menuItems } = catIds.length
      ? await supabase.from('menu_items').select('*').in('category_id', catIds).order('name')
      : { data: [] }
    setCategories(cats||[])
    setItems(menuItems||[])
    // Keep 'all' as default, only switch if activeCategory is null
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

  // Updated in place rather than through loadMenu(). A reload flips the
  // loading flag, tears the list down and drops the supervisor back at the
  // top - which made hiding six sold-out dishes six scroll journeys. The row
  // flips immediately and reverts if the write fails.
  async function toggleAvailability(item) {
    const next = !item.is_available
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, is_available:next } : i))
    const { error } = await supabase.from('menu_items')
      .update({ is_available:next }).eq('id', item.id)
    if (error) {
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, is_available:!next } : i))
      alert('Could not update ' + item.name + '. Check the connection and try again.')
    }
  }

  async function saveItem() {
    const catId = newItem.category_id || activeCategory
    if (!newItem.name.trim() || !catId) { alert('Dish name and category required'); return }
    // a Maestro dish without a course never shows up on the captain's course tabs
    if (isMs && courses.length && !courses.includes(newItem.course)) { alert('Pick the course for this dish (' + courses.join(', ') + ').'); return }
    setSaving(true)
    if (editItem) {
      const { error } = await supabase.from('menu_items').update({ name:newItem.name.trim(), description:newItem.description.trim(), category_id:catId, is_live_counter:newItem.is_live_counter, is_veg:newItem.is_veg, photo_url:newItem.photo_url.trim()||null, ...(isMs ? { course:newItem.course||null, vip_only:!!newItem.vip_only } : {}) }).eq('id', editItem.id)
      if (error) { alert('Could not save the dish: ' + error.message); setSaving(false); return }
    } else {
      const { error } = await supabase.from('menu_items').insert({ category_id:catId, name:newItem.name.trim(), description:newItem.description.trim(), is_live_counter:newItem.is_live_counter, is_veg:newItem.is_veg, photo_url:newItem.photo_url.trim()||null, is_available:true, ...(isMs ? { course:newItem.course||null, vip_only:!!newItem.vip_only } : {}) })
      // a VIP-only special dish stays out of the shared dish library
      if (!error && !(isMs && newItem.vip_only)) await syncToFoodMaster({ name:newItem.name.trim(), description:newItem.description.trim(), category:categories.find(c=>c.id===catId)?.name, is_veg:newItem.is_veg, photo_url:newItem.photo_url.trim()||null })
      if (error) { alert('Error adding dish: ' + error.message); setSaving(false); return }
    }
    setNewItem(p => ({ name:'', description:'', is_live_counter:false, is_veg:true, photo_url:'', category_id:'', course: editItem ? '' : p.course, vip_only:false }))
    setEditItem(null); setShowAdd(false); setSaving(false)
    loadMenu()
  }

  async function uploadFoodImage(file) {
    if (!file) return
    const ext = file.name.split('.').pop().toLowerCase()
    const allowed = ['jpg','jpeg','png','webp']
    if (!allowed.includes(ext)) { alert('Only JPG, PNG, or WebP images supported'); return }
    if (file.size > 5 * 1024 * 1024) { alert('Image too large. Max size is 5MB.'); return }
    setUploadingImg(true)
    try {
      const path = 'food-images/' + Date.now() + '-' + file.name.replace(/[^a-zA-Z0-9.]/g,'_')
      const { error: upErr } = await supabase.storage.from('smartserve').upload(path, file, { upsert:true })
      if (upErr) { alert('Upload failed: ' + upErr.message); return }
      const { data: urlData } = supabase.storage.from('smartserve').getPublicUrl(path)
      setNewItem(p => ({ ...p, photo_url: urlData.publicUrl }))
    } catch(e) { alert('Upload error: ' + e.message) }
    finally { setUploadingImg(false) }
  }

  function startEdit(item) {
    setNewItem({ name:item.name, description:item.description||'', is_live_counter:item.is_live_counter||false, is_veg:item.is_veg!==false, photo_url:item.photo_url||'', category_id:item.category_id, course:item.course||'', vip_only:!!item.vip_only })
    setEditItem(item); setShowAdd(true)
  }

  async function deleteItem(id) {
    if (!confirm('Delete this dish?')) return
    await supabase.from('menu_items').delete().eq('id', id)
    loadMenu()
  }

  // Excel (.xlsx), CSV or text: read here, checked and written by MenuImport
  async function handleFileImport(e) {
    const file = e.target.files[0]; if (!file) return
    setImportResult(null)
    try {
      const rows = await readSheetFile(file)
      setImporting2({ rows, fileName: file.name })
    } catch (err) { setImportResult({ error: err.message }) }
    e.target.value = ''
  }

  function downloadTemplate() {
    const blob = new Blob(['\uFEFF' + menuTemplateCsv(isMs ? courses : [])], { type:'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = 'menu-template.csv'
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }

  // Course of one dish, from the list (Maestro). In place, like availability.
  async function setCourse(item, course) {
    const prev = item.course || null
    setItems(p => p.map(i => i.id === item.id ? { ...i, course: course || null } : i))
    const { error } = await supabase.from('menu_items').update({ course: course || null }).eq('id', item.id)
    if (error) {
      setItems(p => p.map(i => i.id === item.id ? { ...i, course: prev } : i))
      alert('Could not change the course of ' + item.name + ': ' + error.message)
    }
  }

  // Show or hide an entire category (guest tablets update live via Realtime)
  async function toggleCategoryVisible(cat) {
    await supabase.from('menu_categories')
      .update({ is_visible: !(cat.is_visible !== false) }).eq('id', cat.id)
    loadMenu()
  }

  // Show one meal session and hide the others in a single tap.
  // "All Day Items" always stays visible.
  async function showSessionOnly(session) {
    for (const c of categories) {
      const nm = (c.name || '').toLowerCase()
      const isAllDay = nm.includes('all day')
      const belongs = nm.startsWith(session.toLowerCase())
      await supabase.from('menu_categories')
        .update({ is_visible: isAllDay ? true : belongs }).eq('id', c.id)
    }
    loadMenu()
  }

  // A session group only exists when categories are named "Session - Section"
  // (e.g. "Lunch - Rajasthani"). Events whose categories have no prefix show
  // no session bar at all - there is nothing to switch between.
  const sessionGroups = [...new Set(
    categories
      .filter(c => (c.name || '').includes(' - '))
      .map(c => c.name.split(' - ')[0].trim())
      .filter(n => n && !n.toLowerCase().includes('all day'))
  )]

  // Which session is currently showing on the guest tablets? Read it from
  // the data rather than local state, so the highlight survives a reload.
  const activeSession = sessionGroups.find(sg =>
    categories.some(c => (c.name || '').startsWith(sg + ' - ') && c.is_visible !== false)
  ) || null

  // Every dish created anywhere in the app is also filed into the global
  // Food Master library so future events can reuse it. Matching is by name
  // (case-insensitive) - an existing entry is left untouched, never duplicated.
  async function syncToFoodMaster(dish) {
    try {
      const nm = (dish?.name || '').trim()
      if (!nm) return
      const { data: existing } = await supabase.from('food_master')
        .select('id').ilike('name', nm).limit(1)
      if (existing && existing.length > 0) return   // already in the library
      await supabase.from('food_master').insert({
        name: nm,
        description: dish.description || null,
        category: dish.category || 'General',
        is_veg: dish.is_veg !== false,
        photo_url: dish.photo_url || null,
      })
    } catch (e) { /* library sync must never block a menu import */ }
  }

  async function clearAllMenu() {
    if (!confirm('Delete ALL menu items and categories for this event?')) return
    const catIds = categories.map(c=>c.id)
    if (catIds.length) { await supabase.from('menu_items').delete().in('category_id', catIds); await supabase.from('menu_categories').delete().eq('event_id', eventData.id) }
    setActiveCategory(null); loadMenu()
  }

  // Category and search stack, so a supervisor can narrow to Starters and
  // then type. Description is searched too - dishes are often remembered by
  // an ingredient rather than by their menu name.
  const byCourse = !isMs || courseFilter === 'all' ? items
    : courseFilter === '__none' ? items.filter(i => !i.course || !courses.includes(i.course))
    : items.filter(i => i.course === courseFilter)
  const byCategory = activeCategory === 'all' ? byCourse : byCourse.filter(i => i.category_id === activeCategory)
  const q = search.trim().toLowerCase()
  const filtered = !q ? byCategory : byCategory.filter(i =>
    (i.name || '').toLowerCase().includes(q) ||
    (i.description || '').toLowerCase().includes(q))
  const INP = { width:'100%', border:'1.5px solid var(--line)', borderRadius:10, padding:'10px 14px', fontSize:14, marginBottom:10, fontFamily:'Manrope', outline:'none', boxSizing:'border-box' }

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12, gap:10, flexWrap:'wrap' }}>
        <h2 style={{ fontSize:20, fontWeight:800 }}>Menu Manager</h2>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          <button onClick={()=>setShowFoodMaster(true)} style={{ background:'#F5F3FF', border:'1px solid #DDD6FE', color:'#7C3AED', borderRadius:10, padding:'8px 14px', fontSize:13, fontWeight:700, cursor:'pointer' }}>📚 Food Master</button>
          <button onClick={()=>setShowCopyEvent(true)} style={{ background:'#EFF6FF', border:'1px solid #BFDBFE', color:'#2563EB', borderRadius:10, padding:'8px 14px', fontSize:13, fontWeight:700, cursor:'pointer' }}>📋 Copy from Event</button>
          <button onClick={()=>fileRef.current?.click()} style={{ background:'#F0FDF4', border:'1px solid #BBF7D0', color:'#16A34A', borderRadius:10, padding:'8px 14px', fontSize:13, fontWeight:700, cursor:'pointer' }}>
            📥 Import Excel / CSV
          </button>
          <button onClick={()=>{ setImportResult(null); setImporting2({ paste:true }) }} style={{ background:'#F0FDF4', border:'1px solid #BBF7D0', color:'#16A34A', borderRadius:10, padding:'8px 14px', fontSize:13, fontWeight:700, cursor:'pointer' }}>
            📋 Paste from Excel
          </button>
          <button onClick={()=>{ setEditItem(null); setNewItem({ name:'', description:'', is_live_counter:false, is_veg:true, photo_url:'', category_id:'', course:'', vip_only:false }); setShowAdd(true) }} style={{ background:'var(--ink)', color:'#fff', border:'none', borderRadius:10, padding:'8px 16px', fontSize:13, fontWeight:700 }}>+ Add Dish</button>
        </div>
        <input ref={fileRef} type="file" accept=".xlsx,.xlsm,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={handleFileImport} style={{ display:'none' }} />
      </div>

      {importResult && (
        <div style={{ background:importResult.error?'#FEF2F2':'#F0FDF4', border:'1px solid', borderColor:importResult.error?'#FECACA':'#BBF7D0', borderRadius:12, padding:'12px 16px', marginBottom:12 }}>
          <div style={{ display:'flex', justifyContent:'space-between' }}>
            <div>
              <div style={{ fontWeight:700, fontSize:13, color:importResult.error?'#DC2626':'#16A34A' }}>
                {importResult.error ? '❌ '+importResult.error
                  : '✅ ' + importResult.added + ' dishes added' + (importResult.updated ? ', ' + importResult.updated + ' updated' : '')
                    + (importResult.skipped ? ', ' + importResult.skipped + ' left as they were' : '')
                    + (importResult.newCats ? ' · ' + importResult.newCats + ' new cuisine' + (importResult.newCats === 1 ? '' : 's') : '')
                    + (importResult.newCourses?.length ? ' · courses added: ' + importResult.newCourses.join(', ') : '')}
              </div>
              {importResult.errors?.map((err,i)=><div key={i} style={{ color:'#DC2626', fontSize:12, marginTop:4 }}>{err}</div>)}
              {importResult.newCats > 0 && eventData?.multi_kitchen && (
                <div style={{ color:'#15803D', fontSize:12, marginTop:4 }}>New cuisines cook in the default kitchen until you choose their kitchen under Control › Menu routing.</div>
              )}
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
        📋 Import a whole menu from Excel (.xlsx), CSV, or rows pasted from Excel. Columns: <strong>Dish, Cuisine{isMs ? ', Course' : ''}, Description, Veg</strong>{isMs ? <> (and <strong>Barker</strong> A/B if you want to fix it)</> : null} — only Dish is required; a title row above the header is fine.{' '}
        <button onClick={downloadTemplate} style={{ background:'none', border:'none', padding:0, color:'#15803D', fontWeight:800, textDecoration:'underline', cursor:'pointer', fontSize:12 }}>Download the template</button>
      </div>

      {sessionGroups.length > 1 && (
        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap',
          background:'#FFF8EE', border:'1.5px solid #FCD34D', borderRadius:14,
          padding:'10px 14px', marginBottom:12 }}>
          <span style={{ fontSize:12, fontWeight:800, color:'#92400E' }}>
            SHOW ON GUEST TABLETS:
            {activeSession && <span style={{ marginLeft:8, color:'#E8890C' }}>
              (now showing: {activeSession})
            </span>}
          </span>
          {sessionGroups.map(sg => (
            <button key={sg} onClick={()=>showSessionOnly(sg)}
              style={{ background: activeSession===sg ? '#E8890C' : '#fff',
                color: activeSession===sg ? '#fff' : '#1A0A0A',
                border: activeSession===sg ? '2px solid #E8890C' : '2px solid #D6D3D1',
                borderRadius:999, padding:'7px 16px', fontSize:13, fontWeight:800,
                cursor:'pointer', display:'flex', alignItems:'center', gap:6,
                boxShadow: activeSession===sg ? '0 3px 10px rgba(232,137,12,0.4)' : 'none' }}>
              {activeSession===sg && <span>✓</span>}
              {sg} only
            </button>
          ))}
        </div>
      )}

      {/* Search. Sits above the tabs because it narrows whatever the tabs
          have already selected, and it is the first thing reached for on a
          200 dish menu. */}
      <div style={{ position:'relative', marginBottom:10 }}>
        <input value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="Search dishes…"
          style={{ width:'100%', boxSizing:'border-box', padding:'11px 38px 11px 38px',
            fontSize:14, borderRadius:12, border:'1.5px solid var(--line)',
            background:'#fff', outline:'none' }} />
        <span style={{ position:'absolute', left:13, top:'50%', transform:'translateY(-50%)',
          fontSize:15, opacity:0.5, pointerEvents:'none' }}>🔍</span>
        {search && (
          <button onClick={()=>setSearch('')} title="Clear search"
            style={{ position:'absolute', right:8, top:'50%', transform:'translateY(-50%)',
              background:'var(--line)', border:'none', borderRadius:999, width:22, height:22,
              fontSize:12, lineHeight:'22px', color:'var(--ink2)', cursor:'pointer', padding:0 }}>✕</button>
        )}
      </div>
      {search && (
        <div style={{ fontSize:12, color:'var(--ink2)', marginBottom:10 }}>
          {filtered.length} {filtered.length === 1 ? 'dish' : 'dishes'} matching “{search}”
        </div>
      )}

      {isMs && (
        <div style={{ display:'flex', gap:6, marginBottom:10, flexWrap:'wrap', alignItems:'center' }}>
          <span style={{ fontSize:11, fontWeight:800, color:'var(--ink2)', textTransform:'uppercase', letterSpacing:'.4px', marginRight:4 }}>Course</span>
          {[['all', 'All courses', items.length], ...courses.map(c => [c, c, items.filter(i => i.course === c).length]),
            ['__none', 'No course', items.filter(i => !i.course || !courses.includes(i.course)).length]]
            .filter(([k, , n]) => k !== '__none' || n > 0)
            .map(([k, label, n]) => {
              const on = courseFilter === k, warn = k === '__none'
              return (
                <button key={k} onClick={() => setCourseFilter(k)} style={{ borderRadius:999, padding:'6px 13px', fontSize:12.5, fontWeight:800, cursor:'pointer',
                  border:'1.5px solid ' + (on ? (warn ? '#B45309' : '#B8862B') : warn ? '#FED7AA' : 'var(--line)'),
                  background: on ? (warn ? '#B45309' : '#F6E7C8') : warn ? '#FFF7ED' : '#fff', color: on && warn ? '#fff' : warn ? '#B45309' : 'var(--ink)' }}>
                  {label} <span style={{ opacity:.65 }}>{n}</span></button>
              )
            })}
        </div>
      )}

      {/* Category tabs */}
      <div style={{ display:'flex', gap:8, marginBottom:12, overflowX:'auto', flexWrap:'nowrap', paddingBottom:4 }}>

        <button onClick={()=>setActiveCategory('all')} style={{ flexShrink:0, background:activeCategory==='all'?'var(--ink)':'#fff', color:activeCategory==='all'?'#fff':'var(--ink)', border:'1.5px solid', borderColor:activeCategory==='all'?'var(--ink)':'var(--line)', borderRadius:999, padding:'8px 18px', fontSize:13, fontWeight:700, whiteSpace:'nowrap' }}>
          All ({byCourse.length})
        </button>
        {categories.map(cat => (
          <button key={cat.id} onClick={()=>setActiveCategory(cat.id)} style={{ flexShrink:0, background:activeCategory===cat.id?'var(--ink)':'#fff', color:activeCategory===cat.id?'#fff':'var(--ink)', border:'1.5px solid', borderColor:activeCategory===cat.id?'var(--ink)':'var(--line)', borderRadius:999, padding:'8px 18px', fontSize:13, fontWeight:700, whiteSpace:'nowrap' }}>
            {cat.name} ({byCourse.filter(i=>i.category_id===cat.id).length})
            <span onClick={e=>{ e.stopPropagation(); toggleCategoryVisible(cat) }}
              style={{ marginLeft:8, fontSize:11, fontWeight:800, padding:'2px 8px', borderRadius:999,
                background: cat.is_visible===false ? '#FEF2F2' : '#F0FDF4',
                color: cat.is_visible===false ? '#DC2626' : '#16A34A' }}>
              {cat.is_visible===false ? 'HIDDEN' : 'LIVE'}
            </span>
          </button>
        ))}
        <button onClick={()=>setShowAddCat(true)} style={{ flexShrink:0, background:'#FEF3C7', border:'1.5px solid #FCD34D', color:'#92400E', borderRadius:999, padding:'8px 16px', fontSize:13, fontWeight:700 }}>+ Category</button>
      </div>

      {kpc && (() => {
        const cat = categories.find(c => c.id === activeCategory)
        const def = printers.find(p => p.is_default && p.is_active) || printers.find(p => p.is_active)
        return (
          <div data-testid="cat-printer" style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', background:'#EEF2FF', border:'1px solid #C7D2FE',
            borderRadius:12, padding:'8px 12px', marginBottom:12, fontSize:13, color:'#312E81' }}>
            {cat ? <>
              <span>🖨 KOT printer for <b>{cat.name}</b>:</span>
              <select value={cat.kitchen_id || ''} onChange={e => setCatPrinter(cat, e.target.value)}
                style={{ border:'1.5px solid #A5B4FC', borderRadius:8, padding:'5px 8px', fontSize:13, fontWeight:700, background:'#fff' }}>
                <option value="">{def ? 'Default · ' + def.name : 'Desk printer'}</option>
                {printers.filter(p => p.is_active).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <span style={{ color:'#4338CA' }}>Each category prints as its own KOT.</span>
            </> : <span>🖨 One KOT per category is on: pick a category above to choose its KOT printer (all categories: Control › KOT printing).</span>}
          </div>
        )
      })()}

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
          {isMs && (
            <div style={{ marginBottom:10 }}>
              <label style={{ fontSize:13, fontWeight:600, color:'var(--ink2)', display:'block', marginBottom:6 }}>Course *</label>
              <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                {courses.map(c => (
                  <button key={c} type="button" onClick={()=>setNewItem(p=>({...p, course:c}))}
                    style={{ borderRadius:999, padding:'7px 14px', fontSize:13, fontWeight:800, cursor:'pointer',
                      border:'1.5px solid ' + (newItem.course===c ? '#B8862B' : 'var(--line)'),
                      background: newItem.course===c ? '#F6E7C8' : '#fff', color:'var(--ink)' }}>{c}</button>
                ))}
              </div>
              {!newItem.course && <div style={{ fontSize:11.5, color:'#B45309', fontWeight:700, marginTop:5 }}>Pick the course: captains find the dish under it and the kitchen fires it with that course.</div>}
            </div>
          )}
          {/* Image — URL or Upload */}
          <div style={{ marginBottom:10 }}>
            <label style={{ fontSize:13, fontWeight:600, color:'var(--ink2)', display:'block', marginBottom:6 }}>Food Image (optional)</label>
            <input ref={imgFileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>uploadFoodImage(e.target.files[0])} style={{ display:'none' }} />
            <div style={{ display:'flex', gap:8, marginBottom:8 }}>
              <input value={newItem.photo_url} onChange={e=>setNewItem(p=>({...p,photo_url:e.target.value}))}
                placeholder="Paste image URL, or upload below"
                style={{ flex:1, border:'1.5px solid var(--line)', borderRadius:10, padding:'10px 12px', fontSize:13, fontFamily:'Manrope', outline:'none' }} />
              {newItem.photo_url && <img src={newItem.photo_url} alt="preview" style={{ width:44, height:44, objectFit:'cover', borderRadius:8, border:'1px solid var(--line)', flexShrink:0 }} onError={e=>e.target.style.display='none'} />}
            </div>
            <button type="button" onClick={()=>imgFileRef.current?.click()} disabled={uploadingImg}
              style={{ width:'100%', background:uploadingImg?'#999':'#F0FDF4', border:'1.5px solid #BBF7D0', color:uploadingImg?'#fff':'#16A34A', borderRadius:10, padding:'9px', fontSize:13, fontWeight:700, cursor:'pointer', marginBottom:6 }}>
              {uploadingImg ? '⏳ Uploading...' : '📷 Upload from Device'}
            </button>
            <div style={{ fontSize:11, color:'var(--ink2)', lineHeight:1.7 }}>
              ✅ Formats: <strong>JPG, PNG, WebP</strong> &nbsp;·&nbsp; Max: <strong>5MB</strong> &nbsp;·&nbsp; Recommended: <strong>400×300px or square</strong>
            </div>
          </div>
          <div style={{ display:'flex', gap:10, marginBottom:12 }}>
            <button onClick={()=>setNewItem(p=>({...p,is_veg:true}))} style={{ flex:1, background:newItem.is_veg?'#16A34A':'#fff', color:newItem.is_veg?'#fff':'#333', border:'1.5px solid', borderColor:newItem.is_veg?'#16A34A':'#ddd', borderRadius:10, padding:'10px', fontSize:13, fontWeight:700, cursor:'pointer' }}>🟢 Veg</button>
            <button onClick={()=>setNewItem(p=>({...p,is_veg:false}))} style={{ flex:1, background:!newItem.is_veg?'#DC2626':'#fff', color:!newItem.is_veg?'#fff':'#333', border:'1.5px solid', borderColor:!newItem.is_veg?'#DC2626':'#ddd', borderRadius:10, padding:'10px', fontSize:13, fontWeight:700, cursor:'pointer' }}>🔴 Non-Veg</button>
          </div>
          {isMs && (
            <button type="button" onClick={()=>setNewItem(p=>({...p, vip_only:!p.vip_only}))} data-testid="vip-only-toggle"
              style={{ width:'100%', display:'flex', alignItems:'center', gap:10, textAlign:'left', marginBottom:12, cursor:'pointer',
                border:'1.5px solid ' + (newItem.vip_only ? '#B8862B' : 'var(--line)'), background: newItem.vip_only ? '#FFF6E0' : '#fff',
                borderRadius:10, padding:'10px 12px', fontFamily:'Manrope' }}>
              <span style={{ width:20, height:20, borderRadius:5, flexShrink:0, border:'2px solid ' + (newItem.vip_only ? '#B8862B' : '#CBD5E1'),
                background: newItem.vip_only ? '#B8862B' : '#fff', color:'#fff', fontSize:13, fontWeight:900, display:'inline-flex', alignItems:'center', justifyContent:'center' }}>{newItem.vip_only ? '✓' : ''}</span>
              <span>
                <span style={{ display:'block', fontSize:14, fontWeight:800, color:'var(--ink)' }}>★ VIP guests only</span>
                <span style={{ display:'block', fontSize:12, fontWeight:600, color:'var(--ink2)', marginTop:1 }}>A special dish: captains see it only on a VIP guest's cover. Pick it for a guest under Control › VIP guests.</span>
              </span>
            </button>
          )}
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
          <div style={{ color:'var(--ink2)', fontSize:14, marginBottom:20 }}>Import the menu from Excel, paste it, or click "+ Category" to start</div>
          <button onClick={()=>fileRef.current?.click()} style={{ background:'var(--ink)', color:'#fff', border:'none', borderRadius:12, padding:'12px 24px', fontSize:14, fontWeight:800, cursor:'pointer' }}>📥 Import Excel / CSV</button>
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
              {isMs && item.vip_only && <span style={{ fontSize:11, color:'#7A4B00', background:'#FFF1CC', border:'1px solid #EBCB85', padding:'1px 7px', borderRadius:999, fontWeight:800 }}>★ VIP only</span>}
            </div>
            {item.description && <div style={{ fontSize:12, color:'var(--ink2)', marginTop:2 }}>{item.description}</div>}
            {isMs && (
              <select value={courses.includes(item.course) ? item.course : ''} onChange={e => setCourse(item, e.target.value)} title="Course"
                style={{ marginTop:5, marginRight:6, border:'1.5px solid ' + (courses.includes(item.course) ? '#E7D3A6' : '#FED7AA'), borderRadius:999,
                  padding:'2px 8px', fontSize:11.5, fontWeight:800, background: courses.includes(item.course) ? '#FBF3E2' : '#FFF7ED',
                  color: courses.includes(item.course) ? '#7A561A' : '#B45309', fontFamily:'Manrope', cursor:'pointer' }}>
                <option value="">{item.course && !courses.includes(item.course) ? item.course + ' (not a course here)' : 'No course'}</option>
                {courses.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            <span style={{ fontSize:11, fontWeight:600, background:item.is_available?'#F0FDF4':'#FEF2F2', color:item.is_available?'#16A34A':'#DC2626', padding:'1px 7px', borderRadius:999, marginTop:4, display:'inline-block' }}>{item.is_available?'Available':'Hidden'}</span>
          </div>
          <div style={{ display:'flex', gap:6, marginLeft:8 }}>
            <button onClick={()=>startEdit(item)} style={{ background:'#EFF6FF', border:'none', borderRadius:8, padding:'6px 12px', fontSize:12, fontWeight:600, color:'#2563EB', cursor:'pointer' }}>Edit</button>
            <button onClick={()=>toggleAvailability(item)} style={{ background:item.is_available?'#FEF2F2':'#F0FDF4', border:'none', borderRadius:8, padding:'6px 12px', fontSize:12, fontWeight:700, color:item.is_available?'#DC2626':'#16A34A', cursor:'pointer' }}>{item.is_available?'Hide':'Show'}</button>
            <button onClick={()=>deleteItem(item.id)} style={{ background:'#FEF2F2', border:'none', borderRadius:8, padding:'6px 10px', fontSize:12, fontWeight:700, color:'#DC2626', cursor:'pointer' }}>✕</button>
          </div>
        </div>
      ))}
      {showFoodMaster && <FoodMaster eventData={eventData} onClose={()=>{ setShowFoodMaster(false); loadMenu() }} />}
      {importing2 && (
        <MenuImport eventData={eventData} rows={importing2.rows} fileName={importing2.fileName}
          onEventChange={onEventChange}
          onClose={() => setImporting2(null)}
          onDone={r => { setImporting2(null); setImportResult(r); loadMenu() }} />
      )}

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
              // Load existing names for dedup
              const { data: destCatsFull } = await supabase.from('menu_categories').select('id').eq('event_id', eventData.id)
              const destCatIds = (destCatsFull||[]).map(c=>c.id)
              const { data: destItemsFull } = destCatIds.length ? await supabase.from('menu_items').select('name').in('category_id', destCatIds) : { data:[] }
              const destNames = new Set((destItemsFull||[]).map(i=>i.name.toLowerCase().trim()))
              let copyAdded=0, copySkipped=0

              for (const item of srcItems) {
                // Skip duplicates
                if (destNames.has(item.name.toLowerCase().trim())) { copySkipped++; continue }
                const srcCat = srcCats.find(c=>c.id===item.category_id)
                const catKey = (srcCat?.name||'General').toLowerCase()
                if (!catCache[catKey]) {
                  const { data: nc } = await supabase.from('menu_categories').insert({ event_id:eventData.id, name:srcCat?.name||'General', sort_order:Object.keys(catCache).length+1, is_visible:true }).select().single()
                  if (nc) catCache[catKey] = nc.id
                }
                await supabase.from('menu_items').insert({ category_id:catCache[catKey], name:item.name, description:item.description, is_veg:item.is_veg, is_live_counter:item.is_live_counter, photo_url:item.photo_url, is_available:true,
                  ...(isMs ? { course: courses.includes(item.course) ? item.course : null, barker: item.barker || null } : {}) })
                await syncToFoodMaster({ name:item.name, description:item.description, category:catKey, is_veg:item.is_veg, photo_url:item.photo_url })
                destNames.add(item.name.toLowerCase().trim())
                copyAdded++
              }
              alert('✅ Copied ' + copyAdded + ' items!' + (copySkipped>0?' Skipped '+copySkipped+' duplicates.':''))
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
