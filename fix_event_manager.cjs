const fs = require('fs')
const BASE = '/Users/asayyed/SmartServe/src'

// ═══════════════════════════════════════════════════════════════════
// Complete EventManager rewrite with all fixes:
// 1. Remove button actually works (was using wrong delete approach)
// 2. Max orders — text input + preset buttons (no limit of 5)
// 3. Catering company name + logo field
// 4. Video section — both URL paste + upload file option
// 5. Waiter sequential assignment logic in KOTDashboard
// ═══════════════════════════════════════════════════════════════════

fs.writeFileSync(BASE + '/components/supervisor/EventManager.jsx', `import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'

const INP = { width:'100%', border:'1.5px solid var(--line)', borderRadius:10, padding:'10px 14px', fontSize:14, marginBottom:10, fontFamily:'Manrope', outline:'none', boxSizing:'border-box' }

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
  const [newEvent, setNewEvent] = useState({ name:'', date:'', venue:'', number_of_tables:'', catering_company:'', catering_logo_url:'', max_orders_per_table:1 })
  const [newSup, setNewSup] = useState({ name:'', pin:'', mobile:'' })
  const [newWaiter, setNewWaiter] = useState({ name:'', mobile:'' })
  const [videoInputs, setVideoInputs] = useState({})
  const [videoMode, setVideoMode] = useState({}) // 'url' or 'upload' per event
  const [uploading, setUploading] = useState(null)
  const videoFileRefs = useRef({})

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    const [{ data:evs }, { data:sups }, { data:ws }] = await Promise.all([
      supabase.from('events').select('*').order('created_at', { ascending:false }),
      supabase.from('supervisors').select('*').order('name'),
      supabase.from('waiters').select('*').order('name')
    ])
    setEvents(evs||[]); setSupervisors(sups||[]); setWaiters(ws||[])
    const vi = {}; (evs||[]).forEach(e => { vi[e.id] = e.video_url||'' })
    setVideoInputs(vi)
    setLoading(false)
  }

  async function createEvent() {
    if (!newEvent.name||!newEvent.date) { alert('Name and date required'); return }
    setSaving(true)
    await supabase.from('events').insert({
      name: newEvent.name.trim(),
      date: newEvent.date,
      venue: newEvent.venue.trim()||null,
      number_of_tables: newEvent.number_of_tables ? parseInt(newEvent.number_of_tables) : null,
      catering_company: newEvent.catering_company.trim()||null,
      catering_logo_url: newEvent.catering_logo_url.trim()||null,
      max_orders_per_table: parseInt(newEvent.max_orders_per_table)||1,
      is_closed: false, ai_enabled: false
    })
    setNewEvent({ name:'',date:'',venue:'',number_of_tables:'',catering_company:'',catering_logo_url:'',max_orders_per_table:1 })
    setShowCreate(false); setSaving(false); loadAll()
  }

  async function toggleEvent(ev) {
    await supabase.from('events').update({ is_closed:!ev.is_closed }).eq('id', ev.id); loadAll()
  }

  async function saveVideoUrl(eventId) {
    const url = videoInputs[eventId]?.trim()||null
    await supabase.from('events').update({ video_url:url }).eq('id', eventId)
    alert(url ? '✅ Video URL saved! Refresh tablet to see it.' : 'Video removed.')
    loadAll()
  }

  async function uploadVideo(eventId, file) {
    if (!file) return
    setUploading(eventId)
    try {
      const ext = file.name.split('.').pop().toLowerCase()
      const allowed = ['mp4','webm','mov']
      if (!allowed.includes(ext)) { alert('Only MP4, WebM, or MOV files supported'); return }
      if (file.size > 100 * 1024 * 1024) { alert('File too large. Max size is 100MB.'); return }

      const path = 'event-videos/' + eventId + '/' + Date.now() + '.' + ext
      const { error: upErr } = await supabase.storage.from('smartserve').upload(path, file, { upsert:true })
      if (upErr) { alert('Upload failed: ' + upErr.message); return }

      const { data: urlData } = supabase.storage.from('smartserve').getPublicUrl(path)
      const publicUrl = urlData.publicUrl
      await supabase.from('events').update({ video_url: publicUrl }).eq('id', eventId)
      setVideoInputs(p => ({ ...p, [eventId]: publicUrl }))
      alert('✅ Video uploaded and saved!')
      loadAll()
    } catch(e) { alert('Upload error: ' + e.message) }
    finally { setUploading(null) }
  }

  async function addSupervisor() {
    if (!newSup.name.trim()||!newSup.pin.trim()||!selEvent) { alert('Name, PIN and event required'); return }
    setSaving(true)
    const { error } = await supabase.from('supervisors').insert({
      event_id:selEvent, name:newSup.name.trim(), pin:newSup.pin.trim(),
      mobile:newSup.mobile.trim()||null, is_active:true
    })
    if (error) { alert('Error: ' + error.message); setSaving(false); return }
    setNewSup({ name:'',pin:'',mobile:'' }); setShowAddSup(false); setSaving(false); loadAll()
  }

  async function addWaiter() {
    if (!newWaiter.name.trim()||!selEvent) { alert('Name and event required'); return }
    setSaving(true)
    const { error } = await supabase.from('waiters').insert({
      event_id:selEvent, name:newWaiter.name.trim(),
      mobile:newWaiter.mobile.trim()||null, is_active:true
    })
    if (error) { alert('Error: ' + error.message); setSaving(false); return }
    setNewWaiter({ name:'',mobile:'' }); setShowAddWaiter(false); setSaving(false); loadAll()
  }

  async function removeSup(id) {
    if (!confirm('Remove this supervisor?')) return
    setRemoving(id)
    const { error } = await supabase.from('supervisors').delete().eq('id', id)
    if (error) alert('Error: ' + error.message)
    setRemoving(null)
    loadAll()
  }

  async function removeWaiter(id) {
    if (!confirm('Remove this waiter?')) return
    setRemoving(id)
    const { error } = await supabase.from('waiters').delete().eq('id', id)
    if (error) alert('Error: ' + error.message)
    setRemoving(null)
    loadAll()
  }

  async function updateCateringLogo(eventId, logoUrl) {
    await supabase.from('events').update({ catering_logo_url: logoUrl||null }).eq('id', eventId)
    loadAll()
  }

  const getSups = eid => supervisors.filter(s=>s.event_id===eid)
  const getWaiters = eid => waiters.filter(w=>w.event_id===eid)

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <h2 style={{ fontSize:20, fontWeight:800 }}>Events & Staff</h2>
        <button onClick={()=>setShowCreate(true)} style={{ background:'var(--ink)', color:'#fff', border:'none', borderRadius:10, padding:'8px 16px', fontSize:13, fontWeight:700 }}>+ New Event</button>
      </div>

      <div style={{ background:'#EFF6FF', border:'1px solid #BFDBFE', borderRadius:12, padding:'12px 16px', marginBottom:16, fontSize:13, color:'#1d4ed8' }}>
        💡 <strong>Supervisor login:</strong> Username = Name · Password = PIN &nbsp;|&nbsp;
        🎯 <strong>Switch events:</strong> Tap event name in the header bar above
      </div>

      {/* Create Event */}
      {showCreate && (
        <div style={{ background:'#fff', borderRadius:16, padding:20, marginBottom:20, boxShadow:'var(--shadow)', border:'2px solid var(--ink)' }}>
          <h3 style={{ fontSize:16, fontWeight:800, marginBottom:16 }}>Create New Event</h3>
          <input value={newEvent.name} onChange={e=>setNewEvent(p=>({...p,name:e.target.value}))} placeholder="Event name *" style={INP} />
          <input type="date" value={newEvent.date} onChange={e=>setNewEvent(p=>({...p,date:e.target.value}))} style={INP} />
          <input value={newEvent.venue} onChange={e=>setNewEvent(p=>({...p,venue:e.target.value}))} placeholder="Venue / Location" style={INP} />
          <input value={newEvent.catering_company} onChange={e=>setNewEvent(p=>({...p,catering_company:e.target.value}))} placeholder="Catering company name (e.g. Delhi Darbar) *" style={INP} />
          <input value={newEvent.catering_logo_url} onChange={e=>setNewEvent(p=>({...p,catering_logo_url:e.target.value}))} placeholder="Catering logo URL (paste image link)" style={INP} />
          <input type="number" value={newEvent.number_of_tables} onChange={e=>setNewEvent(p=>({...p,number_of_tables:e.target.value}))} placeholder="Number of tables" style={INP} />

          {/* Max orders per table */}
          <div style={{ marginBottom:14 }}>
            <label style={{ fontSize:13, fontWeight:600, color:'var(--ink2)', display:'block', marginBottom:8 }}>Max Orders Per Table (default: 1)</label>
            <div style={{ display:'flex', gap:8, marginBottom:8, flexWrap:'wrap' }}>
              {[1,2,3,4,5,6,7,8].map(n => (
                <button key={n} type="button" onClick={()=>setNewEvent(p=>({...p,max_orders_per_table:n}))}
                  style={{ width:44, height:40, borderRadius:10, border:'1.5px solid', borderColor:newEvent.max_orders_per_table===n?'var(--ink)':'var(--line)', background:newEvent.max_orders_per_table===n?'var(--ink)':'#fff', color:newEvent.max_orders_per_table===n?'#fff':'var(--ink)', fontWeight:700, fontSize:14, cursor:'pointer' }}>
                  {n}
                </button>
              ))}
            </div>
            <input type="number" min="1" max="50"
              value={newEvent.max_orders_per_table}
              onChange={e => setNewEvent(p=>({...p, max_orders_per_table: parseInt(e.target.value)||1}))}
              placeholder="Or type a custom number"
              style={{ ...INP, marginBottom:4 }} />
            <div style={{ fontSize:11, color:'var(--ink2)' }}>Guests can place this many simultaneous orders per table before needing to wait for delivery</div>
          </div>

          <div style={{ display:'flex', gap:10 }}>
            <button onClick={createEvent} disabled={saving} style={{ flex:1, background:'var(--ink)', color:'#fff', border:'none', borderRadius:12, padding:'12px', fontSize:14, fontWeight:800 }}>{saving?'Creating...':'Create Event'}</button>
            <button onClick={()=>setShowCreate(false)} style={{ flex:1, background:'var(--bg)', border:'1.5px solid var(--line)', borderRadius:12, padding:'12px', fontSize:14, fontWeight:700 }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Add Supervisor */}
      {showAddSup && (
        <div style={{ background:'#fff', borderRadius:16, padding:20, marginBottom:20, boxShadow:'var(--shadow)', border:'2px solid #E8890C' }}>
          <h3 style={{ fontSize:16, fontWeight:800, marginBottom:16 }}>Add Supervisor</h3>
          <select value={selEvent||''} onChange={e=>setSelEvent(e.target.value)} style={{ ...INP, background:'#fff' }}>
            <option value="">Select Event *</option>
            {events.map(ev=><option key={ev.id} value={ev.id}>{ev.name}</option>)}
          </select>
          <input value={newSup.name} onChange={e=>setNewSup(p=>({...p,name:e.target.value}))} placeholder="Full name * (becomes username)" style={INP} />
          <input value={newSup.mobile} onChange={e=>setNewSup(p=>({...p,mobile:e.target.value}))} placeholder="Mobile number (optional)" type="tel" style={INP} />
          <input value={newSup.pin} onChange={e=>setNewSup(p=>({...p,pin:e.target.value.replace(/\\D/g,'').slice(0,6)}))} placeholder="PIN * 4-6 digits (becomes password)" style={{ ...INP, letterSpacing:'0.2em' }} />
          {newSup.name && newSup.pin && <div style={{ background:'#F0FDF4', border:'1px solid #BBF7D0', borderRadius:8, padding:'8px 12px', fontSize:12, color:'#15803D', marginBottom:10 }}>Login: <strong>{newSup.name}</strong> / <strong>{newSup.pin}</strong></div>}
          <div style={{ display:'flex', gap:10 }}>
            <button onClick={addSupervisor} disabled={saving} style={{ flex:1, background:'#E8890C', color:'#fff', border:'none', borderRadius:12, padding:'12px', fontSize:14, fontWeight:800 }}>{saving?'Adding...':'Add Supervisor'}</button>
            <button onClick={()=>setShowAddSup(false)} style={{ flex:1, background:'var(--bg)', border:'1.5px solid var(--line)', borderRadius:12, padding:'12px', fontSize:14, fontWeight:700 }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Add Waiter */}
      {showAddWaiter && (
        <div style={{ background:'#fff', borderRadius:16, padding:20, marginBottom:20, boxShadow:'var(--shadow)', border:'2px solid #2563EB' }}>
          <h3 style={{ fontSize:16, fontWeight:800, marginBottom:16 }}>Add Waiter</h3>
          <select value={selEvent||''} onChange={e=>setSelEvent(e.target.value)} style={{ ...INP, background:'#fff' }}>
            <option value="">Select Event *</option>
            {events.map(ev=><option key={ev.id} value={ev.id}>{ev.name}</option>)}
          </select>
          <input value={newWaiter.name} onChange={e=>setNewWaiter(p=>({...p,name:e.target.value}))} placeholder="Waiter name or number (e.g. 01 or Raj) *" style={INP} />
          <input value={newWaiter.mobile} onChange={e=>setNewWaiter(p=>({...p,mobile:e.target.value}))} placeholder="Mobile number (optional)" type="tel" style={INP} />
          <div style={{ display:'flex', gap:10 }}>
            <button onClick={addWaiter} disabled={saving} style={{ flex:1, background:'#2563EB', color:'#fff', border:'none', borderRadius:12, padding:'12px', fontSize:14, fontWeight:800 }}>{saving?'Adding...':'Add Waiter'}</button>
            <button onClick={()=>setShowAddWaiter(false)} style={{ flex:1, background:'var(--bg)', border:'1.5px solid var(--line)', borderRadius:12, padding:'12px', fontSize:14, fontWeight:700 }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Quick action buttons */}
      {!showAddSup && !showAddWaiter && !showCreate && (
        <div style={{ display:'flex', gap:10, marginBottom:20 }}>
          <button onClick={()=>{ setShowAddSup(true); setShowAddWaiter(false) }} style={{ flex:1, background:'#FEF3C7', border:'1.5px solid #FCD34D', color:'#92400E', borderRadius:12, padding:'12px', fontSize:13, fontWeight:700 }}>+ Add Supervisor</button>
          <button onClick={()=>{ setShowAddWaiter(true); setShowAddSup(false) }} style={{ flex:1, background:'#EFF6FF', border:'1.5px solid #BFDBFE', color:'#2563EB', borderRadius:12, padding:'12px', fontSize:13, fontWeight:700 }}>+ Add Waiter</button>
        </div>
      )}

      {loading ? <div style={{ textAlign:'center', padding:40, color:'var(--ink2)' }}>Loading...</div>
      : events.map(ev => {
        const sups = getSups(ev.id)
        const ws = getWaiters(ev.id)
        const isActive = !ev.is_closed
        const mode = videoMode[ev.id] || 'url'

        return (
          <div key={ev.id} style={{ background:'#fff', borderRadius:18, padding:18, marginBottom:14, boxShadow:'var(--shadow)', borderLeft:'5px solid '+(isActive?'#16A34A':'#D1D5DB') }}>

            {/* Event header */}
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:14 }}>
              <div style={{ flex:1 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                  {ev.catering_logo_url && <img src={ev.catering_logo_url} alt="logo" style={{ width:32, height:32, objectFit:'contain', borderRadius:6 }} onError={e=>e.target.style.display='none'} />}
                  <div style={{ fontSize:17, fontWeight:800 }}>{ev.name}</div>
                  <div style={{ background:isActive?'#F0FDF4':'#F3F4F6', color:isActive?'#16A34A':'#6B7280', fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:999 }}>{isActive?'● Active':'○ Closed'}</div>
                </div>
                <div style={{ fontSize:13, color:'var(--ink2)', marginTop:4, lineHeight:1.8 }}>
                  📍 {ev.venue||'No venue'} &nbsp;·&nbsp; 📅 {new Date(ev.date).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}
                  {ev.number_of_tables && <span> &nbsp;·&nbsp; 🪑 {ev.number_of_tables} tables</span>}
                  {ev.max_orders_per_table > 1 && <span> &nbsp;·&nbsp; 📋 Max {ev.max_orders_per_table} orders/table</span>}
                  {ev.catering_company && <><br/>🍽️ <strong>{ev.catering_company}</strong></>}
                </div>
              </div>
              <button onClick={()=>toggleEvent(ev)} style={{ background:isActive?'#F3F4F6':'#F0FDF4', border:'1px solid #D1D5DB', borderRadius:8, padding:'6px 12px', fontSize:12, fontWeight:600, color:isActive?'#6B7280':'#16A34A', cursor:'pointer', flexShrink:0 }}>
                {isActive?'Close':'Reopen'}
              </button>
            </div>

            {/* Catering logo update */}
            <div style={{ background:'var(--bg)', borderRadius:12, padding:'12px 14px', marginBottom:14 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--ink2)', marginBottom:8, textTransform:'uppercase' }}>🏷️ Catering Branding</div>
              <input
                defaultValue={ev.catering_company||''}
                onBlur={async e => { await supabase.from('events').update({ catering_company:e.target.value||null }).eq('id',ev.id); loadAll() }}
                placeholder="Catering company name (shown on tablet)"
                style={{ width:'100%', border:'1.5px solid var(--line)', borderRadius:10, padding:'8px 12px', fontSize:13, fontFamily:'Manrope', outline:'none', marginBottom:8, boxSizing:'border-box' }} />
              <div style={{ display:'flex', gap:8 }}>
                <input
                  defaultValue={ev.catering_logo_url||''}
                  onBlur={async e => { await supabase.from('events').update({ catering_logo_url:e.target.value||null }).eq('id',ev.id); loadAll() }}
                  placeholder="Logo URL (paste image link)"
                  style={{ flex:1, border:'1.5px solid var(--line)', borderRadius:10, padding:'8px 12px', fontSize:13, fontFamily:'Manrope', outline:'none' }} />
                {ev.catering_logo_url && <img src={ev.catering_logo_url} alt="logo" style={{ width:36, height:36, objectFit:'contain', borderRadius:6, border:'1px solid var(--line)' }} onError={e=>e.target.style.display='none'} />}
              </div>
              <div style={{ fontSize:11, color:'var(--ink2)', marginTop:6 }}>Logo appears on guest welcome screen and menu header</div>
            </div>

            {/* Video — URL + Upload */}
            <div style={{ background:'var(--bg)', borderRadius:12, padding:'12px 14px', marginBottom:14 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--ink2)', marginBottom:8, textTransform:'uppercase' }}>🎥 Welcome Screen Video</div>
              {ev.video_url && <div style={{ fontSize:12, color:'#16A34A', marginBottom:8, wordBreak:'break-all' }}>✅ Currently set: {ev.video_url.slice(0,60)}{ev.video_url.length>60?'...':''}</div>}

              {/* Mode toggle */}
              <div style={{ display:'flex', gap:8, marginBottom:10 }}>
                <button onClick={()=>setVideoMode(p=>({...p,[ev.id]:'url'}))} style={{ flex:1, padding:'7px', borderRadius:8, border:'1.5px solid', borderColor:mode==='url'?'var(--ink)':'var(--line)', background:mode==='url'?'var(--ink)':'#fff', color:mode==='url'?'#fff':'var(--ink)', fontSize:12, fontWeight:700, cursor:'pointer' }}>🔗 Paste URL</button>
                <button onClick={()=>setVideoMode(p=>({...p,[ev.id]:'upload'}))} style={{ flex:1, padding:'7px', borderRadius:8, border:'1.5px solid', borderColor:mode==='upload'?'var(--ink)':'var(--line)', background:mode==='upload'?'var(--ink)':'#fff', color:mode==='upload'?'#fff':'var(--ink)', fontSize:12, fontWeight:700, cursor:'pointer' }}>📤 Upload File</button>
              </div>

              {mode==='url' ? (
                <div style={{ display:'flex', gap:8 }}>
                  <input value={videoInputs[ev.id]||''} onChange={e=>setVideoInputs(p=>({...p,[ev.id]:e.target.value}))}
                    placeholder="https://example.com/video.mp4"
                    style={{ flex:1, border:'1.5px solid var(--line)', borderRadius:10, padding:'8px 12px', fontSize:13, fontFamily:'Manrope', outline:'none' }} />
                  <button onClick={()=>saveVideoUrl(ev.id)} style={{ background:'var(--ink)', color:'#fff', border:'none', borderRadius:10, padding:'8px 14px', fontSize:13, fontWeight:700, cursor:'pointer' }}>Save</button>
                  {ev.video_url && <button onClick={()=>{ setVideoInputs(p=>({...p,[ev.id]:''})); supabase.from('events').update({video_url:null}).eq('id',ev.id).then(loadAll) }} style={{ background:'#FEF2F2', border:'1px solid #FECACA', color:'#DC2626', borderRadius:10, padding:'8px 10px', fontSize:13, cursor:'pointer' }}>✕</button>}
                </div>
              ) : (
                <div>
                  <input ref={el=>videoFileRefs.current[ev.id]=el} type="file" accept="video/mp4,video/webm,video/quicktime" onChange={e=>uploadVideo(ev.id, e.target.files[0])} style={{ display:'none' }} />
                  <button onClick={()=>videoFileRefs.current[ev.id]?.click()} disabled={uploading===ev.id} style={{ width:'100%', background:uploading===ev.id?'#999':'var(--ink)', color:'#fff', border:'none', borderRadius:10, padding:'10px', fontSize:13, fontWeight:700, cursor:'pointer', marginBottom:8 }}>
                    {uploading===ev.id ? '⏳ Uploading...' : '📤 Choose Video File'}
                  </button>
                  <div style={{ fontSize:11, color:'var(--ink2)', lineHeight:1.8 }}>
                    ✅ Supported: <strong>MP4, WebM, MOV</strong><br/>
                    ✅ Max size: <strong>100MB</strong><br/>
                    ✅ Recommended: <strong>Landscape (16:9), 720p or 1080p</strong><br/>
                    ✅ Duration: <strong>10-60 seconds</strong> works best (loops automatically)
                  </div>
                </div>
              )}
            </div>

            {/* Supervisors */}
            <div style={{ borderTop:'1px solid var(--line)', paddingTop:12, marginBottom:12 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--ink2)', marginBottom:8, textTransform:'uppercase' }}>👔 Supervisors ({sups.length})</div>
              {sups.length===0 ? <div style={{ fontSize:13, color:'var(--ink2)', fontStyle:'italic' }}>None — click "+ Add Supervisor"</div>
              : sups.map(sup => (
                <div key={sup.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 10px', marginBottom:6, background:'var(--bg)', borderRadius:10 }}>
                  <div>
                    <span style={{ fontWeight:700, fontSize:14 }}>{sup.name}</span>
                    <span style={{ fontSize:12, color:'#888', marginLeft:8 }}>PIN: {sup.pin}</span>
                    {sup.mobile && <span style={{ fontSize:12, color:'#888', marginLeft:8 }}>📞 {sup.mobile}</span>}
                    <div style={{ fontSize:11, color:'var(--ink2)', marginTop:2 }}>Login: <strong>{sup.name}</strong> / <strong>{sup.pin}</strong></div>
                  </div>
                  <button onClick={()=>removeSup(sup.id)} disabled={removing===sup.id}
                    style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:8, padding:'4px 12px', fontSize:12, fontWeight:700, color:'#DC2626', cursor:'pointer', opacity:removing===sup.id?0.5:1 }}>
                    {removing===sup.id ? '...' : 'Remove'}
                  </button>
                </div>
              ))}
            </div>

            {/* Waiters */}
            <div style={{ borderTop:'1px solid var(--line)', paddingTop:12 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--ink2)', marginBottom:8, textTransform:'uppercase' }}>🧑‍🍳 Waiters ({ws.length})</div>
              {ws.length===0 ? <div style={{ fontSize:13, color:'var(--ink2)', fontStyle:'italic' }}>None — click "+ Add Waiter"</div>
              : ws.map(w => (
                <div key={w.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 10px', marginBottom:6, background:'var(--bg)', borderRadius:10 }}>
                  <div>
                    <span style={{ fontWeight:700, fontSize:14 }}>{w.name}</span>
                    {w.mobile && <span style={{ fontSize:12, color:'#888', marginLeft:8 }}>📞 {w.mobile}</span>}
                  </div>
                  <button onClick={()=>removeWaiter(w.id)} disabled={removing===w.id}
                    style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:8, padding:'4px 12px', fontSize:12, fontWeight:700, color:'#DC2626', cursor:'pointer', opacity:removing===w.id?0.5:1 }}>
                    {removing===w.id ? '...' : 'Remove'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
`)
console.log('✅ 1/2 EventManager — Remove works, max orders input+presets, catering logo, video URL+upload')

// ═══════════════════════════════════════════════════════════════════
// Fix KOTDashboard — sequential waiter suggestion (round-robin)
// Waiter who has done fewest orders gets suggested first
// ═══════════════════════════════════════════════════════════════════
const kotPath = BASE + '/components/supervisor/KOTDashboard.jsx'
let kotContent = fs.readFileSync(kotPath, 'utf8')

// Replace the availableWaiters logic with round-robin sequential ordering
kotContent = kotContent.replace(
  `  // Available waiters = not currently assigned to any in_progress order
  const busyWaiterIds = orders.filter(o=>o.status==='in_progress' && o.waiter_id).map(o=>o.waiter_id)
  const availableWaiters = waiters.filter(w => !busyWaiterIds.includes(w.id))
  const busyWaiters = waiters.filter(w => busyWaiterIds.includes(w.id))`,
  `  // Available waiters = not assigned to any in_progress order
  const busyWaiterIds = orders.filter(o=>o.status==='in_progress' && o.waiter_id).map(o=>o.waiter_id)
  const busyWaiters = waiters.filter(w => busyWaiterIds.includes(w.id))

  // Sequential/round-robin: sort available waiters by how many total orders they've done
  // Waiter with fewest completed orders goes first — ensures fair distribution
  const waiterOrderCount = {}
  waiters.forEach(w => { waiterOrderCount[w.id] = 0 })
  orders.forEach(o => { if (o.waiter_id && waiterOrderCount[o.waiter_id] !== undefined) waiterOrderCount[o.waiter_id]++ })
  const availableWaiters = waiters
    .filter(w => !busyWaiterIds.includes(w.id))
    .sort((a,b) => (waiterOrderCount[a.id]||0) - (waiterOrderCount[b.id]||0))`
)

// Add "Suggested" badge on the first available waiter button
kotContent = kotContent.replace(
  `                {availableWaiters.map(w => (
                  <button key={w.id} onClick={()=>assignWaiter(order.id, w.id)} disabled={assigning===order.id}
                    style={{ background:'var(--ink)', color:'#fff', border:'none', borderRadius:10, padding:'8px 14px', fontSize:13, fontWeight:700, cursor:'pointer' }}>
                    {assigning===order.id ? '...' : w.name}
                  </button>
                ))}`,
  `                {availableWaiters.map((w, idx) => (
                  <button key={w.id} onClick={()=>assignWaiter(order.id, w.id)} disabled={assigning===order.id}
                    style={{ background: idx===0?'#16A34A':'var(--ink)', color:'#fff', border:'none', borderRadius:10, padding:'8px 14px', fontSize:13, fontWeight:700, cursor:'pointer', position:'relative' }}>
                    {idx===0 && <span style={{ position:'absolute', top:-8, left:'50%', transform:'translateX(-50%)', background:'#E8890C', color:'#fff', fontSize:9, fontWeight:800, padding:'1px 6px', borderRadius:999, whiteSpace:'nowrap' }}>Suggested</span>}
                    {assigning===order.id ? '...' : w.name}
                  </button>
                ))}`
)

fs.writeFileSync(kotPath, kotContent)
console.log('✅ 2/2 KOTDashboard — sequential waiter suggestion (round-robin), green = suggested')

console.log('\n🎉 Done! Run: npm run dev')
console.log('Also run SQL: ALTER TABLE events ADD COLUMN IF NOT EXISTS catering_logo_url text;')
