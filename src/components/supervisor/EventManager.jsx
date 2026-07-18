import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'

const INP = { width:'100%', border:'1.5px solid var(--line)', borderRadius:10, padding:'10px 14px', fontSize:14, marginBottom:0, fontFamily:'Manrope', outline:'none', boxSizing:'border-box', background:'#fff' }
const LBL = { fontSize:12, fontWeight:700, color:'#666', display:'block', marginBottom:4, textTransform:'uppercase', letterSpacing:'0.04em' }

export default function EventManager({ onEventChange }) {
  const [events, setEvents] = useState([])
  const [supervisors, setSupervisors] = useState([])
  const [waiters, setWaiters] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [showAddSup, setShowAddSup] = useState(false)
  const [showAddWaiter, setShowAddWaiter] = useState(false)
  const [selEvent, setSelEvent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(null)
  const [uploading, setUploading] = useState(null)
  const [uploadingLogo, setUploadingLogo] = useState(null)
  const [editingField, setEditingField] = useState({})
  const [viewMode, setViewMode] = useState('list') // 'list' | 'detail'
  const [selectedEvent, setSelectedEvent] = useState(null)

  const [newEvent, setNewEvent] = useState({
    name:'', date:'', venue:'', number_of_tables:'',
    catering_company:'', catering_logo_url:'', max_orders_per_table:1,
    video_url:'', call_waiter_enabled:true
  })
  const [createStep, setCreateStep] = useState(1) // 1=basic, 2=config, 3=branding
  const [newLogoFile, setNewLogoFile] = useState(null)
  const [newLogoPreview, setNewLogoPreview] = useState('')
  const [newVideoMode, setNewVideoMode] = useState('url')
  const [newVideoFile, setNewVideoFile] = useState(null)

  const [newSup, setNewSup] = useState({ name:'', pin:'', mobile:'' })
  const [newWaiter, setNewWaiter] = useState({ name:'', mobile:'' })
  const videoFileRefs = useRef({})
  const logoFileRefs = useRef({})
  const newLogoRef = useRef()
  const newVideoRef = useRef()

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    const [{ data:evs }, { data:sups }, { data:ws }] = await Promise.all([
      supabase.from('events').select('*').order('created_at', { ascending:false }),
      supabase.from('supervisors').select('*').order('name'),
      supabase.from('waiters').select('*').order('name')
    ])
    setEvents(evs||[]); setSupervisors(sups||[]); setWaiters(ws||[])
    setLoading(false)
  }

  function resetCreate() {
    setNewEvent({ name:'', date:'', venue:'', number_of_tables:'', catering_company:'', catering_logo_url:'', max_orders_per_table:1, video_url:'', call_waiter_enabled:true })
    setCreateStep(1); setNewLogoFile(null); setNewLogoPreview(''); setNewVideoFile(null); setNewVideoMode('url')
    setShowCreate(false)
  }

  function handleNewLogoFile(file) {
    if (!file) return
    const ext = file.name.split('.').pop().toLowerCase()
    if (!['jpg','jpeg','png','webp','svg'].includes(ext)) { alert('Only JPG, PNG, WebP or SVG'); return }
    if (file.size > 2*1024*1024) { alert('Max 2MB'); return }
    setNewLogoFile(file)
    const reader = new FileReader()
    reader.onload = e => setNewLogoPreview(e.target.result)
    reader.readAsDataURL(file)
  }

  function handleNewVideoFile(file) {
    if (!file) return
    if (file.size > 100*1024*1024) { alert('Max 100MB'); return }
    setNewVideoFile(file)
  }

  async function createEvent() {
    if (!newEvent.name||!newEvent.date) { alert('Event name and date are required'); return }
    setSaving(true)
    try {
      // Upload logo if file selected
      let logoUrl = newEvent.catering_logo_url || null
      if (newLogoFile) {
        const path = 'catering-logos/' + Date.now() + '-' + newLogoFile.name.replace(/[^a-zA-Z0-9.]/g,'_')
        const { error: upErr } = await supabase.storage.from('smartserve').upload(path, newLogoFile, { upsert:true })
        if (!upErr) {
          const { data } = supabase.storage.from('smartserve').getPublicUrl(path)
          logoUrl = data.publicUrl
        }
      }

      // Insert event
      const { data: ev } = await supabase.from('events').insert({
        name: newEvent.name.trim(), date: newEvent.date,
        venue: newEvent.venue.trim()||null,
        number_of_tables: newEvent.number_of_tables ? parseInt(newEvent.number_of_tables) : null,
        catering_company: newEvent.catering_company.trim()||null,
        catering_logo_url: logoUrl,
        max_orders_per_table: parseInt(newEvent.max_orders_per_table)||1,
        video_url: newEvent.video_url.trim()||null,
        call_waiter_enabled: newEvent.call_waiter_enabled,
        is_closed: false, ai_enabled: false
      }).select().single()

      // Upload video if file selected
      if (newVideoFile && ev) {
        const ext = newVideoFile.name.split('.').pop().toLowerCase()
        const path = 'event-videos/' + ev.id + '/' + Date.now() + '.' + ext
        const { error: vErr } = await supabase.storage.from('smartserve').upload(path, newVideoFile, { upsert:true })
        if (!vErr) {
          const { data: vd } = supabase.storage.from('smartserve').getPublicUrl(path)
          await supabase.from('events').update({ video_url: vd.publicUrl }).eq('id', ev.id)
        }
      }

      resetCreate(); loadAll()
    } catch(e) { alert('Error: ' + e.message) }
    finally { setSaving(false) }
  }

  async function updateEventField(eventId, field, value) {
    await supabase.from('events').update({ [field]: value }).eq('id', eventId)
    loadAll()
  }

  async function toggleEvent(ev) {
    await supabase.from('events').update({ is_closed:!ev.is_closed }).eq('id', ev.id); loadAll()
  }

  async function uploadLogo(eventId, file) {
    if (!file) return
    setUploadingLogo(eventId)
    try {
      const ext = file.name.split('.').pop().toLowerCase()
      const path = 'catering-logos/' + eventId + '-' + Date.now() + '.' + ext
      const { error } = await supabase.storage.from('smartserve').upload(path, file, { upsert:true })
      if (error) { alert('Upload failed: ' + error.message); return }
      const { data } = supabase.storage.from('smartserve').getPublicUrl(path)
      await supabase.from('events').update({ catering_logo_url: data.publicUrl }).eq('id', eventId)
      loadAll()
    } catch(e) { alert('Error: ' + e.message) }
    finally { setUploadingLogo(null) }
  }

  async function uploadVideo(eventId, file) {
    if (!file) return
    setUploading(eventId)
    try {
      const ext = file.name.split('.').pop().toLowerCase()
      const path = 'event-videos/' + eventId + '/' + Date.now() + '.' + ext
      const { error } = await supabase.storage.from('smartserve').upload(path, file, { upsert:true })
      if (error) { alert('Upload failed: ' + error.message); return }
      const { data } = supabase.storage.from('smartserve').getPublicUrl(path)
      await supabase.from('events').update({ video_url: data.publicUrl }).eq('id', eventId)
      loadAll()
    } catch(e) { alert('Error: ' + e.message) }
    finally { setUploading(null) }
  }

  async function addSupervisor() {
    if (!newSup.name.trim()||!newSup.pin.trim()||!selEvent) { alert('Name, PIN and event required'); return }
    setSaving(true)
    const { error } = await supabase.from('supervisors').insert({ event_id:selEvent, name:newSup.name.trim(), pin:newSup.pin.trim(), mobile:newSup.mobile.trim()||null, is_active:true })
    if (error) { alert('Error: ' + error.message); setSaving(false); return }
    setNewSup({ name:'',pin:'',mobile:'' }); setShowAddSup(false); setSaving(false); loadAll()
  }

  async function addWaiter() {
    if (!newWaiter.name.trim()||!selEvent) { alert('Name and event required'); return }
    setSaving(true)
    const { error } = await supabase.from('waiters').insert({ event_id:selEvent, name:newWaiter.name.trim(), mobile:newWaiter.mobile.trim()||null, is_active:true })
    if (error) { alert('Error: ' + error.message); setSaving(false); return }
    setNewWaiter({ name:'',mobile:'' }); setShowAddWaiter(false); setSaving(false); loadAll()
  }

  async function removeSup(id) {
    if (!confirm('Remove this supervisor?')) return
    setRemoving(id)
    const { error } = await supabase.from('supervisors').delete().eq('id', id)
    if (error) {
      console.error('Remove supervisor error:', error)
      alert('Failed to remove: ' + error.message)
    }
    setRemoving(null)
    await loadAll()
  }

  async function removeWaiter(id) {
    if (!confirm('Remove this waiter?')) return
    setRemoving(id)
    const { error } = await supabase.from('waiters').delete().eq('id', id)
    if (error) {
      console.error('Remove waiter error:', error)
      alert('Failed to remove: ' + error.message)
    }
    setRemoving(null)
    await loadAll()
  }

  const getSups = eid => supervisors.filter(s=>s.event_id===eid)
  const getWaiters = eid => waiters.filter(w=>w.event_id===eid)

  // ── STEPS for create form ──
  const STEPS = ['Basic Info', 'Configuration', 'Branding & Media']

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <h2 style={{ fontSize:20, fontWeight:800 }}>Events & Staff</h2>
        {!showCreate && <button onClick={()=>setShowCreate(true)} style={{ background:'var(--ink)', color:'#fff', border:'none', borderRadius:10, padding:'8px 16px', fontSize:13, fontWeight:700 }}>+ New Event</button>}
      </div>

      <div style={{ background:'#EFF6FF', border:'1px solid #BFDBFE', borderRadius:12, padding:'10px 16px', marginBottom:16, fontSize:13, color:'#1d4ed8' }}>
        💡 <strong>Supervisor login:</strong> Username = Name · Password = PIN &nbsp;|&nbsp;
        🎯 <strong>Switch events:</strong> Tap event name in the header
      </div>

      {/* ═══ CREATE EVENT — 3-step wizard ═══ */}
      {showCreate && (
        <div style={{ background:'#fff', borderRadius:20, marginBottom:20, boxShadow:'0 4px 24px rgba(0,0,0,0.1)', border:'1px solid var(--line)', overflow:'hidden' }}>
          {/* Step indicator */}
          <div style={{ background:'var(--ink)', padding:'16px 24px' }}>
            <div style={{ color:'rgba(255,255,255,0.6)', fontSize:12, marginBottom:8 }}>Create New Event</div>
            <div style={{ display:'flex', gap:0 }}>
              {STEPS.map((s,i) => (
                <div key={i} style={{ display:'flex', alignItems:'center', flex:1 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer' }} onClick={()=>createStep>i+1&&setCreateStep(i+1)}>
                    <div style={{ width:28, height:28, borderRadius:'50%', background:createStep>i+1?'#16A34A':createStep===i+1?'#E8890C':'rgba(255,255,255,0.2)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:800, color:'#fff', flexShrink:0 }}>
                      {createStep>i+1 ? '✓' : i+1}
                    </div>
                    <span style={{ color:createStep===i+1?'#fff':'rgba(255,255,255,0.5)', fontSize:12, fontWeight:createStep===i+1?700:400, whiteSpace:'nowrap' }}>{s}</span>
                  </div>
                  {i<STEPS.length-1 && <div style={{ flex:1, height:1, background:'rgba(255,255,255,0.2)', margin:'0 8px' }}></div>}
                </div>
              ))}
            </div>
          </div>

          <div style={{ padding:'24px' }}>

            {/* STEP 1: Basic Info */}
            {createStep===1 && (
              <div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:16 }}>
                  <div style={{ gridColumn:'1/-1' }}>
                    <label style={LBL}>Event Name *</label>
                    <input value={newEvent.name} onChange={e=>setNewEvent(p=>({...p,name:e.target.value}))} placeholder="e.g. Sharma Wedding Reception" style={INP} autoFocus />
                  </div>
                  <div>
                    <label style={LBL}>Event Date *</label>
                    <input type="date" value={newEvent.date} onChange={e=>setNewEvent(p=>({...p,date:e.target.value}))} style={INP} />
                  </div>
                  <div>
                    <label style={LBL}>Number of Tables</label>
                    <input type="number" value={newEvent.number_of_tables} onChange={e=>setNewEvent(p=>({...p,number_of_tables:e.target.value}))} placeholder="e.g. 15" style={INP} />
                  </div>
                  <div style={{ gridColumn:'1/-1' }}>
                    <label style={LBL}>Venue / Location</label>
                    <input value={newEvent.venue} onChange={e=>setNewEvent(p=>({...p,venue:e.target.value}))} placeholder="e.g. Grand Ballroom, Taj Hotel, Pune" style={INP} />
                  </div>
                </div>
                <div style={{ display:'flex', gap:10, marginTop:8 }}>
                  <button onClick={resetCreate} style={{ flex:1, background:'var(--bg)', border:'1.5px solid var(--line)', borderRadius:12, padding:'12px', fontSize:14, fontWeight:700 }}>Cancel</button>
                  <button onClick={()=>{ if(!newEvent.name||!newEvent.date){alert('Name and date required');return} setCreateStep(2) }} style={{ flex:2, background:'var(--ink)', color:'#fff', border:'none', borderRadius:12, padding:'12px', fontSize:14, fontWeight:800 }}>Next: Configuration →</button>
                </div>
              </div>
            )}

            {/* STEP 2: Configuration */}
            {createStep===2 && (
              <div>
                <div style={{ marginBottom:20 }}>
                  <label style={LBL}>Max Orders Per Table</label>
                  <div style={{ fontSize:12, color:'var(--ink2)', marginBottom:10 }}>Guests must wait for delivery before placing another order</div>
                  <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:10 }}>
                    {[1,2,3,4,5,6,7,8].map(n => (
                      <button key={n} type="button" onClick={()=>setNewEvent(p=>({...p,max_orders_per_table:n}))}
                        style={{ width:48, height:44, borderRadius:10, border:'1.5px solid', borderColor:newEvent.max_orders_per_table===n?'var(--ink)':'var(--line)', background:newEvent.max_orders_per_table===n?'var(--ink)':'#fff', color:newEvent.max_orders_per_table===n?'#fff':'var(--ink)', fontWeight:700, fontSize:15, cursor:'pointer' }}>
                        {n}
                      </button>
                    ))}
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <span style={{ fontSize:13, color:'var(--ink2)' }}>Custom:</span>
                    <input type="number" min="1" max="50" value={newEvent.max_orders_per_table} onChange={e=>setNewEvent(p=>({...p,max_orders_per_table:parseInt(e.target.value)||1}))}
                      style={{ ...INP, width:80, marginBottom:0 }} />
                  </div>
                </div>

                <div style={{ marginBottom:20, background:'#F9FAFB', borderRadius:12, padding:'14px 16px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                  <div>
                    <div style={{ fontWeight:700, fontSize:14 }}>🛎️ Enable Call Waiter</div>
                    <div style={{ fontSize:12, color:'var(--ink2)', marginTop:2 }}>Guests can request waiter assistance from their tablet</div>
                  </div>
                  <button type="button" onClick={()=>setNewEvent(p=>({...p,call_waiter_enabled:!p.call_waiter_enabled}))}
                    style={{ width:52, height:28, borderRadius:999, border:'none', cursor:'pointer', position:'relative', background:newEvent.call_waiter_enabled?'#16A34A':'#D1D5DB', transition:'background 0.2s', flexShrink:0 }}>
                    <span style={{ position:'absolute', top:3, left:newEvent.call_waiter_enabled?26:3, width:22, height:22, borderRadius:'50%', background:'#fff', boxShadow:'0 1px 4px rgba(0,0,0,0.2)', transition:'left 0.2s', display:'block' }}></span>
                  </button>
                </div>

                <div style={{ display:'flex', gap:10 }}>
                  <button onClick={()=>setCreateStep(1)} style={{ flex:1, background:'var(--bg)', border:'1.5px solid var(--line)', borderRadius:12, padding:'12px', fontSize:14, fontWeight:700 }}>← Back</button>
                  <button onClick={()=>setCreateStep(3)} style={{ flex:2, background:'var(--ink)', color:'#fff', border:'none', borderRadius:12, padding:'12px', fontSize:14, fontWeight:800 }}>Next: Branding →</button>
                </div>
              </div>
            )}

            {/* STEP 3: Branding & Media */}
            {createStep===3 && (
              <div>
                {/* Catering company */}
                <div style={{ marginBottom:16 }}>
                  <label style={LBL}>Catering Company Name</label>
                  <input value={newEvent.catering_company} onChange={e=>setNewEvent(p=>({...p,catering_company:e.target.value}))} placeholder="e.g. Delhi Darbar, Barbeque Nation" style={INP} />
                </div>

                {/* Logo */}
                <div style={{ marginBottom:16 }}>
                  <label style={LBL}>Catering Logo</label>
                  <input ref={newLogoRef} type="file" accept="image/jpeg,image/png,image/webp,image/svg+xml" onChange={e=>handleNewLogoFile(e.target.files[0])} style={{ display:'none' }} />
                  {newLogoPreview && (
                    <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10, background:'var(--bg)', borderRadius:10, padding:'8px 12px', border:'1px solid var(--line)' }}>
                      <img src={newLogoPreview} style={{ width:48, height:48, objectFit:'contain', borderRadius:8 }} />
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:12, fontWeight:600, color:'#16A34A' }}>✅ Logo ready to upload</div>
                        <div style={{ fontSize:11, color:'var(--ink2)' }}>{newLogoFile?.name}</div>
                      </div>
                      <button onClick={()=>{ setNewLogoFile(null); setNewLogoPreview('') }} style={{ background:'#FEF2F2', border:'none', borderRadius:8, padding:'4px 10px', fontSize:12, color:'#DC2626', cursor:'pointer' }}>Remove</button>
                    </div>
                  )}
                  <button onClick={()=>newLogoRef.current?.click()} style={{ width:'100%', background:'var(--bg)', border:'1.5px solid var(--line)', borderRadius:10, padding:'10px', fontSize:13, fontWeight:700, cursor:'pointer', marginBottom:8 }}>
                    📷 Upload Logo from Device
                  </button>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                    <div style={{ flex:1, height:1, background:'var(--line)' }}></div>
                    <span style={{ fontSize:11, color:'var(--ink2)' }}>or paste URL</span>
                    <div style={{ flex:1, height:1, background:'var(--line)' }}></div>
                  </div>
                  <input value={newEvent.catering_logo_url} onChange={e=>setNewEvent(p=>({...p,catering_logo_url:e.target.value}))} placeholder="https://example.com/logo.png" style={INP} />
                  <div style={{ fontSize:11, color:'var(--ink2)', marginTop:6 }}>JPG, PNG, WebP, SVG · Max 2MB · Recommended: square 200×200px</div>
                </div>

                {/* Video */}
                <div style={{ marginBottom:20 }}>
                  <label style={LBL}>Welcome Screen Video (optional)</label>
                  <div style={{ display:'flex', gap:8, marginBottom:10 }}>
                    <button onClick={()=>setNewVideoMode('url')} style={{ flex:1, padding:'8px', borderRadius:8, border:'1.5px solid', borderColor:newVideoMode==='url'?'var(--ink)':'var(--line)', background:newVideoMode==='url'?'var(--ink)':'#fff', color:newVideoMode==='url'?'#fff':'var(--ink)', fontSize:13, fontWeight:700, cursor:'pointer' }}>🔗 Paste URL</button>
                    <button onClick={()=>setNewVideoMode('upload')} style={{ flex:1, padding:'8px', borderRadius:8, border:'1.5px solid', borderColor:newVideoMode==='upload'?'var(--ink)':'var(--line)', background:newVideoMode==='upload'?'var(--ink)':'#fff', color:newVideoMode==='upload'?'#fff':'var(--ink)', fontSize:13, fontWeight:700, cursor:'pointer' }}>📤 Upload File</button>
                  </div>
                  {newVideoMode==='url'
                    ? <input value={newEvent.video_url} onChange={e=>setNewEvent(p=>({...p,video_url:e.target.value}))} placeholder="https://example.com/video.mp4" style={INP} />
                    : <>
                        <input ref={newVideoRef} type="file" accept="video/mp4,video/webm,video/quicktime" onChange={e=>handleNewVideoFile(e.target.files[0])} style={{ display:'none' }} />
                        {newVideoFile && <div style={{ fontSize:12, color:'#16A34A', marginBottom:8, background:'#F0FDF4', padding:'8px 12px', borderRadius:8 }}>✅ {newVideoFile.name}</div>}
                        <button onClick={()=>newVideoRef.current?.click()} style={{ width:'100%', background:'var(--bg)', border:'1.5px solid var(--line)', borderRadius:10, padding:'10px', fontSize:13, fontWeight:700, cursor:'pointer' }}>📤 Choose Video File</button>
                      </>
                  }
                  <div style={{ fontSize:11, color:'var(--ink2)', marginTop:6 }}>MP4, WebM, MOV · Max 100MB · Recommended: 16:9, 720p</div>
                </div>

                <div style={{ display:'flex', gap:10 }}>
                  <button onClick={()=>setCreateStep(2)} style={{ flex:1, background:'var(--bg)', border:'1.5px solid var(--line)', borderRadius:12, padding:'12px', fontSize:14, fontWeight:700 }}>← Back</button>
                  <button onClick={createEvent} disabled={saving} style={{ flex:2, background:saving?'#999':'#16A34A', color:'#fff', border:'none', borderRadius:12, padding:'12px', fontSize:14, fontWeight:800 }}>
                    {saving?'Creating...':'✓ Create Event'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add Supervisor */}
      {showAddSup && (
        <div style={{ background:'#fff', borderRadius:16, padding:20, marginBottom:20, boxShadow:'var(--shadow)', border:'2px solid #E8890C' }}>
          <h3 style={{ fontSize:16, fontWeight:800, marginBottom:16 }}>Add Supervisor</h3>
          <select value={selEvent||''} onChange={e=>setSelEvent(e.target.value)} style={{ ...INP, background:'#fff', marginBottom:10 }}>
            <option value="">Select Event *</option>
            {events.map(ev=><option key={ev.id} value={ev.id}>{ev.name}</option>)}
          </select>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 }}>
            <input value={newSup.name} onChange={e=>setNewSup(p=>({...p,name:e.target.value}))} placeholder="Full name * (username)" style={INP} />
            <input value={newSup.pin} onChange={e=>setNewSup(p=>({...p,pin:e.target.value.replace(/D/g,'').slice(0,6)}))} placeholder="PIN * (password)" style={{ ...INP, letterSpacing:'0.2em' }} />
          </div>
          <input value={newSup.mobile} onChange={e=>setNewSup(p=>({...p,mobile:e.target.value}))} placeholder="Mobile number (optional)" type="tel" style={{ ...INP, marginBottom:10 }} />
          {newSup.name && newSup.pin && <div style={{ background:'#F0FDF4', border:'1px solid #BBF7D0', borderRadius:8, padding:'8px 12px', fontSize:12, color:'#15803D', marginBottom:10 }}>Login: <strong>{newSup.name}</strong> / <strong>{newSup.pin}</strong></div>}
          <div style={{ display:'flex', gap:10 }}>
            <button onClick={addSupervisor} disabled={saving} style={{ flex:1, background:'#E8890C', color:'#fff', border:'none', borderRadius:12, padding:'11px', fontSize:14, fontWeight:800 }}>{saving?'Adding...':'Add Supervisor'}</button>
            <button onClick={()=>setShowAddSup(false)} style={{ flex:1, background:'var(--bg)', border:'1.5px solid var(--line)', borderRadius:12, padding:'11px', fontSize:14, fontWeight:700 }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Add Waiter */}
      {showAddWaiter && (
        <div style={{ background:'#fff', borderRadius:16, padding:20, marginBottom:20, boxShadow:'var(--shadow)', border:'2px solid #2563EB' }}>
          <h3 style={{ fontSize:16, fontWeight:800, marginBottom:16 }}>Add Waiter</h3>
          <select value={selEvent||''} onChange={e=>setSelEvent(e.target.value)} style={{ ...INP, background:'#fff', marginBottom:10 }}>
            <option value="">Select Event *</option>
            {events.map(ev=><option key={ev.id} value={ev.id}>{ev.name}</option>)}
          </select>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 }}>
            <input value={newWaiter.name} onChange={e=>setNewWaiter(p=>({...p,name:e.target.value}))} placeholder="Name or number (e.g. 01)" style={INP} />
            <input value={newWaiter.mobile} onChange={e=>setNewWaiter(p=>({...p,mobile:e.target.value}))} placeholder="Mobile (optional)" type="tel" style={INP} />
          </div>
          <div style={{ display:'flex', gap:10 }}>
            <button onClick={addWaiter} disabled={saving} style={{ flex:1, background:'#2563EB', color:'#fff', border:'none', borderRadius:12, padding:'11px', fontSize:14, fontWeight:800 }}>{saving?'Adding...':'Add Waiter'}</button>
            <button onClick={()=>setShowAddWaiter(false)} style={{ flex:1, background:'var(--bg)', border:'1.5px solid var(--line)', borderRadius:12, padding:'11px', fontSize:14, fontWeight:700 }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Action buttons */}
      {!showAddSup && !showAddWaiter && !showCreate && (
        <div style={{ display:'flex', gap:10, marginBottom:20 }}>
          <button onClick={()=>{ setShowAddSup(true); setShowAddWaiter(false) }} style={{ flex:1, background:'#FEF3C7', border:'1.5px solid #FCD34D', color:'#92400E', borderRadius:12, padding:'11px', fontSize:13, fontWeight:700 }}>+ Add Supervisor</button>
          <button onClick={()=>{ setShowAddWaiter(true); setShowAddSup(false) }} style={{ flex:1, background:'#EFF6FF', border:'1.5px solid #BFDBFE', color:'#2563EB', borderRadius:12, padding:'11px', fontSize:13, fontWeight:700 }}>+ Add Waiter</button>
        </div>
      )}

      {/* ═══ VIEW TOGGLE ═══ */}
      {!loading && events.length > 0 && (
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
          <div style={{ fontSize:13, color:'var(--ink2)', fontWeight:600 }}>{events.length} event{events.length!==1?'s':''}</div>
          <div style={{ display:'flex', background:'#F3F4F6', borderRadius:10, padding:3, gap:2 }}>
            <button onClick={()=>setViewMode('list')} style={{ padding:'6px 14px', borderRadius:8, border:'none', fontSize:13, fontWeight:700, cursor:'pointer', background:viewMode==='list'?'#fff':'transparent', color:viewMode==='list'?'var(--ink)':'#888', boxShadow:viewMode==='list'?'0 1px 4px rgba(0,0,0,0.1)':'none', transition:'all 0.15s' }}>
              ☰ List
            </button>
            <button onClick={()=>setViewMode('detail')} style={{ padding:'6px 14px', borderRadius:8, border:'none', fontSize:13, fontWeight:700, cursor:'pointer', background:viewMode==='detail'?'#fff':'transparent', color:viewMode==='detail'?'var(--ink)':'#888', boxShadow:viewMode==='detail'?'0 1px 4px rgba(0,0,0,0.1)':'none', transition:'all 0.15s' }}>
              ⊞ Detail
            </button>
          </div>
        </div>
      )}

      {/* ═══ LIST VIEW ═══ */}
      {!loading && viewMode==='list' && (
        <div style={{ background:'#fff', borderRadius:16, boxShadow:'var(--shadow)', overflow:'hidden', border:'1px solid var(--line)', marginBottom:20 }}>
          {events.map((ev, idx) => {
            const sups = getSups(ev.id)
            const ws = getWaiters(ev.id)
            const isActive = !ev.is_closed
            return (
              <div key={ev.id} onClick={()=>{ setSelectedEvent(ev.id); setViewMode('detail') }}
                style={{ display:'flex', alignItems:'center', gap:14, padding:'14px 18px', borderBottom: idx<events.length-1?'1px solid var(--line)':'none', cursor:'pointer', transition:'background 0.15s' }}
                onMouseEnter={e=>e.currentTarget.style.background='#F9FAFB'}
                onMouseLeave={e=>e.currentTarget.style.background='#fff'}>

                {/* Logo or initial */}
                {ev.catering_logo_url
                  ? <img src={ev.catering_logo_url} alt="" style={{ width:44, height:44, objectFit:'contain', borderRadius:10, background:'#f5f5f5', padding:4, flexShrink:0 }} onError={e=>e.target.style.display='none'} />
                  : <div style={{ width:44, height:44, borderRadius:10, background:'var(--ink)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, fontWeight:800, color:'#E8890C', flexShrink:0 }}>
                      {(ev.catering_company||ev.name||'?')[0].toUpperCase()}
                    </div>
                }

                {/* Event info */}
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:3 }}>
                    <span style={{ fontWeight:800, fontSize:15, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{ev.name}</span>
                    <span style={{ flexShrink:0, fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:999, background:isActive?'#DCFCE7':'#F3F4F6', color:isActive?'#16A34A':'#6B7280' }}>{isActive?'Active':'Closed'}</span>
                  </div>
                  <div style={{ fontSize:12, color:'var(--ink2)', display:'flex', gap:12, flexWrap:'wrap' }}>
                    <span>📅 {new Date(ev.date).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</span>
                    {ev.venue && <span>📍 {ev.venue}</span>}
                    {ev.catering_company && <span>🍽️ {ev.catering_company}</span>}
                  </div>
                </div>

                {/* Stats badges */}
                <div style={{ display:'flex', gap:6, flexShrink:0 }}>
                  {ev.number_of_tables && <span style={{ background:'#EFF6FF', color:'#2563EB', fontSize:11, fontWeight:700, padding:'3px 8px', borderRadius:999 }}>🪑 {ev.number_of_tables}</span>}
                  <span style={{ background:'#F5F3FF', color:'#7C3AED', fontSize:11, fontWeight:700, padding:'3px 8px', borderRadius:999 }}>👔 {sups.length}</span>
                  <span style={{ background:'#FEF3C7', color:'#92400E', fontSize:11, fontWeight:700, padding:'3px 8px', borderRadius:999 }}>🧑‍🍳 {ws.length}</span>
                </div>

                {/* Arrow */}
                <span style={{ color:'#CCC', fontSize:18, flexShrink:0 }}>›</span>
              </div>
            )
          })}
        </div>
      )}

      {/* ═══ DETAIL VIEW ═══ */}
      {!loading && viewMode==='detail' && (
        <>
          {/* Back to list */}
          <button onClick={()=>{ setViewMode('list'); setSelectedEvent(null) }}
            style={{ display:'flex', alignItems:'center', gap:6, background:'none', border:'none', color:'var(--ink2)', fontSize:13, fontWeight:600, cursor:'pointer', marginBottom:12, padding:0 }}>
            ← Back to list
          </button>
        </>
      )}

      {/* ═══ DETAIL CARDS (shown in detail view) ═══ */}
      {loading ? <div style={{ textAlign:'center', padding:40, color:'var(--ink2)' }}>Loading...</div>
      : viewMode==='detail' && events.filter(ev => !selectedEvent || ev.id===selectedEvent).map(ev => {
        const sups = getSups(ev.id)
        const ws = getWaiters(ev.id)
        const isActive = !ev.is_closed

        return (
          <div key={ev.id} style={{ background:'#fff', borderRadius:18, marginBottom:14, boxShadow:'var(--shadow)', overflow:'hidden', border:'1px solid var(--line)' }}>

            {/* Event header bar */}
            <div style={{ background:isActive?'#F0FDF4':'#F9FAFB', padding:'14px 18px', borderBottom:'1px solid var(--line)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                {ev.catering_logo_url && <img src={ev.catering_logo_url} alt="" style={{ width:36, height:36, objectFit:'contain', borderRadius:8, background:'#fff', padding:3, border:'1px solid var(--line)' }} onError={e=>e.target.style.display='none'} />}
                <div>
                  <div style={{ fontWeight:800, fontSize:16 }}>{ev.name}</div>
                  <div style={{ fontSize:12, color:'var(--ink2)', marginTop:1 }}>
                    📅 {new Date(ev.date).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}
                    {ev.venue && <span> · 📍 {ev.venue}</span>}
                    {ev.catering_company && <span> · 🍽️ {ev.catering_company}</span>}
                  </div>
                </div>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <span style={{ background:isActive?'#DCFCE7':'#F3F4F6', color:isActive?'#16A34A':'#6B7280', fontSize:11, fontWeight:700, padding:'3px 10px', borderRadius:999 }}>{isActive?'● Active':'○ Closed'}</span>
                <button onClick={()=>toggleEvent(ev)} style={{ background:'#fff', border:'1px solid var(--line)', borderRadius:8, padding:'5px 12px', fontSize:12, fontWeight:600, color:'var(--ink2)', cursor:'pointer' }}>
                  {isActive?'Close':'Reopen'}
                </button>
              </div>
            </div>

            <div style={{ padding:'16px 18px' }}>

              {/* Quick edit fields — tables + max orders + call waiter */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:16 }}>
                <div>
                  <label style={LBL}>Tables</label>
                  <input type="number" defaultValue={ev.number_of_tables||''} placeholder="e.g. 15"
                    onBlur={async e => { if (e.target.value !== String(ev.number_of_tables||'')) await updateEventField(ev.id, 'number_of_tables', parseInt(e.target.value)||null) }}
                    style={{ ...INP, fontSize:13 }} />
                </div>
                <div>
                  <label style={LBL}>Max Orders/Table</label>
                  <input type="number" min="1" max="50" defaultValue={ev.max_orders_per_table||1}
                    onBlur={async e => { await updateEventField(ev.id, 'max_orders_per_table', parseInt(e.target.value)||1) }}
                    style={{ ...INP, fontSize:13 }} />
                </div>
                <div>
                  <label style={LBL}>Call Waiter</label>
                  <div style={{ display:'flex', alignItems:'center', height:40, gap:8 }}>
                    <button type="button" onClick={async()=>{ await updateEventField(ev.id,'call_waiter_enabled',!ev.call_waiter_enabled) }}
                      style={{ width:52, height:28, borderRadius:999, border:'none', cursor:'pointer', position:'relative', background:ev.call_waiter_enabled!==false?'#16A34A':'#D1D5DB', transition:'background 0.2s' }}>
                      <span style={{ position:'absolute', top:3, left:ev.call_waiter_enabled!==false?26:3, width:22, height:22, borderRadius:'50%', background:'#fff', boxShadow:'0 1px 4px rgba(0,0,0,0.2)', transition:'left 0.2s', display:'block' }}></span>
                    </button>
                    <span style={{ fontSize:12, color:'var(--ink2)' }}>{ev.call_waiter_enabled!==false?'On':'Off'}</span>
                  </div>
                </div>
              </div>

              {/* Catering branding */}
              <div style={{ background:'var(--bg)', borderRadius:12, padding:'12px 14px', marginBottom:12 }}>
                <div style={{ fontSize:11, fontWeight:700, color:'var(--ink2)', marginBottom:10, textTransform:'uppercase' }}>🏷️ Catering Branding</div>
                <input defaultValue={ev.catering_company||''} key={'cn'+ev.id}
                  onBlur={async e=>{ await updateEventField(ev.id,'catering_company',e.target.value||null) }}
                  placeholder="Catering company name" style={{ ...INP, marginBottom:10, fontSize:13 }} />

                <div style={{ fontSize:11, fontWeight:600, color:'var(--ink2)', marginBottom:6 }}>Logo</div>
                <input ref={el=>logoFileRefs.current[ev.id]=el} type="file" accept="image/jpeg,image/png,image/webp,image/svg+xml" onChange={e=>uploadLogo(ev.id,e.target.files[0])} style={{ display:'none' }} />
                {ev.catering_logo_url && (
                  <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8, background:'#fff', borderRadius:8, padding:'6px 10px', border:'1px solid var(--line)' }}>
                    <img src={ev.catering_logo_url} style={{ width:36, height:36, objectFit:'contain', borderRadius:6 }} onError={e=>e.target.style.display='none'} />
                    <span style={{ fontSize:12, color:'#16A34A', fontWeight:600, flex:1 }}>✅ Logo set</span>
                    <button onClick={async()=>{ await updateEventField(ev.id,'catering_logo_url',null) }} style={{ background:'#FEF2F2', border:'1px solid #FECACA', color:'#DC2626', borderRadius:6, padding:'3px 8px', fontSize:11, cursor:'pointer' }}>Remove</button>
                  </div>
                )}
                <div style={{ display:'flex', gap:8 }}>
                  <button onClick={()=>logoFileRefs.current[ev.id]?.click()} disabled={uploadingLogo===ev.id}
                    style={{ flex:1, background:'var(--ink)', color:'#fff', border:'none', borderRadius:8, padding:'8px', fontSize:12, fontWeight:700, cursor:'pointer' }}>
                    {uploadingLogo===ev.id?'⏳ Uploading...':'📷 Upload Logo'}
                  </button>
                  <input defaultValue={ev.catering_logo_url||''} key={'cl'+ev.id}
                    onBlur={async e=>{ if(e.target.value.trim()&&e.target.value!==ev.catering_logo_url){ await updateEventField(ev.id,'catering_logo_url',e.target.value.trim()||null) } }}
                    placeholder="or paste URL" style={{ flex:2, border:'1.5px solid var(--line)', borderRadius:8, padding:'8px 10px', fontSize:12, fontFamily:'Manrope', outline:'none' }} />
                </div>
              </div>

              {/* Video */}
              <div style={{ background:'var(--bg)', borderRadius:12, padding:'12px 14px', marginBottom:12 }}>
                <div style={{ fontSize:11, fontWeight:700, color:'var(--ink2)', marginBottom:8, textTransform:'uppercase' }}>🎥 Welcome Video</div>
                <input ref={el=>videoFileRefs.current[ev.id]=el} type="file" accept="video/mp4,video/webm,video/quicktime" onChange={e=>uploadVideo(ev.id,e.target.files[0])} style={{ display:'none' }} />
                {ev.video_url && <div style={{ fontSize:12, color:'#16A34A', marginBottom:6 }}>✅ Video set &nbsp;<button onClick={async()=>updateEventField(ev.id,'video_url',null)} style={{ background:'none', border:'none', color:'#DC2626', fontSize:11, cursor:'pointer', fontWeight:600 }}>Remove</button></div>}
                <div style={{ display:'flex', gap:8 }}>
                  <button onClick={()=>videoFileRefs.current[ev.id]?.click()} disabled={uploading===ev.id}
                    style={{ flex:1, background:'var(--ink)', color:'#fff', border:'none', borderRadius:8, padding:'8px', fontSize:12, fontWeight:700, cursor:'pointer' }}>
                    {uploading===ev.id?'⏳ Uploading...':'📤 Upload Video'}
                  </button>
                  <input defaultValue={ev.video_url||''} key={'vd'+ev.id}
                    onBlur={async e=>{ if(e.target.value.trim()!==ev.video_url){ await updateEventField(ev.id,'video_url',e.target.value.trim()||null) } }}
                    placeholder="or paste MP4 URL" style={{ flex:2, border:'1.5px solid var(--line)', borderRadius:8, padding:'8px 10px', fontSize:12, fontFamily:'Manrope', outline:'none' }} />
                </div>
                <div style={{ fontSize:11, color:'var(--ink2)', marginTop:6 }}>MP4/WebM/MOV · Max 100MB · Landscape 16:9 recommended</div>
              </div>

              {/* Supervisors */}
              <div style={{ marginBottom:12 }}>
                <div style={{ fontSize:11, fontWeight:700, color:'var(--ink2)', marginBottom:8, textTransform:'uppercase' }}>👔 Supervisors ({sups.length})</div>
                {sups.length===0 ? <div style={{ fontSize:13, color:'var(--ink2)', fontStyle:'italic' }}>None assigned</div>
                : sups.map(sup => (
                  <div key={sup.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 10px', marginBottom:6, background:'var(--bg)', borderRadius:10 }}>
                    <div>
                      <span style={{ fontWeight:700, fontSize:14 }}>{sup.name}</span>
                      <span style={{ fontSize:12, color:'#888', marginLeft:8 }}>PIN: {sup.pin}</span>
                      {sup.mobile && <span style={{ fontSize:12, color:'#888', marginLeft:8 }}>📞 {sup.mobile}</span>}
                      <div style={{ fontSize:11, color:'var(--ink2)', marginTop:1 }}>Login: <strong>{sup.name}</strong> / <strong>{sup.pin}</strong></div>
                    </div>
                    <button onClick={()=>removeSup(sup.id)} disabled={removing===sup.id}
                      style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:8, padding:'4px 12px', fontSize:12, fontWeight:700, color:'#DC2626', cursor:'pointer' }}>
                      {removing===sup.id?'...':'Remove'}
                    </button>
                  </div>
                ))}
              </div>

              {/* Waiters */}
              <div>
                <div style={{ fontSize:11, fontWeight:700, color:'var(--ink2)', marginBottom:8, textTransform:'uppercase' }}>🧑‍🍳 Waiters ({ws.length})</div>
                {ws.length===0 ? <div style={{ fontSize:13, color:'var(--ink2)', fontStyle:'italic' }}>None assigned</div>
                : <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                    {ws.map(w => (
                      <div key={w.id} style={{ background:'var(--bg)', border:'1px solid var(--line)', borderRadius:10, padding:'6px 12px', display:'flex', alignItems:'center', gap:8 }}>
                        <span style={{ fontWeight:700, fontSize:13 }}>{w.name}</span>
                        {w.mobile && <span style={{ fontSize:12, color:'#888' }}>📞 {w.mobile}</span>}
                        <button onClick={()=>removeWaiter(w.id)} disabled={removing===w.id}
                          style={{ background:'none', border:'none', color:'#DC2626', fontSize:14, cursor:'pointer', padding:0, lineHeight:1 }}>×</button>
                      </div>
                    ))}
                  </div>
                }
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
