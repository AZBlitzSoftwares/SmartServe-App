import { useState, useEffect } from 'react'
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
  const [newEvent, setNewEvent] = useState({ name:'', date:'', venue:'', number_of_tables:'', catering_company:'' })
  const [newSup, setNewSup] = useState({ name:'', pin:'', mobile:'' })
  const [newWaiter, setNewWaiter] = useState({ name:'', mobile:'', table_numbers:'' })
  const [videoInputs, setVideoInputs] = useState({})

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
    await supabase.from('events').insert({ name:newEvent.name, date:newEvent.date, venue:newEvent.venue||null, number_of_tables:newEvent.number_of_tables?parseInt(newEvent.number_of_tables):null, catering_company:newEvent.catering_company||null, is_closed:false, ai_enabled:false })
    setNewEvent({ name:'',date:'',venue:'',number_of_tables:'',catering_company:'' }); setShowCreate(false); setSaving(false); loadAll()
  }

  async function toggleEvent(ev) {
    await supabase.from('events').update({ is_closed:!ev.is_closed }).eq('id', ev.id); loadAll()
  }

  async function saveVideoUrl(eventId) {
    const url = videoInputs[eventId]?.trim()||null
    await supabase.from('events').update({ video_url:url }).eq('id', eventId)
    alert(url ? '✅ Video saved!' : 'Video removed.')
    loadAll()
  }

  async function addSupervisor() {
    if (!newSup.name.trim()||!newSup.pin.trim()||!selEvent) { alert('Name, PIN and event required'); return }
    setSaving(true)
    await supabase.from('supervisors').insert({ event_id:selEvent, name:newSup.name.trim(), pin:newSup.pin.trim(), mobile:newSup.mobile.trim()||null, is_active:true })
    setNewSup({ name:'',pin:'',mobile:'' }); setShowAddSup(false); setSaving(false); loadAll()
  }

  async function addWaiter() {
    if (!newWaiter.name.trim()||!selEvent) { alert('Name and event required'); return }
    setSaving(true)
    await supabase.from('waiters').insert({ event_id:selEvent, name:newWaiter.name.trim(), mobile:newWaiter.mobile.trim()||null, table_numbers:newWaiter.table_numbers.trim()||null, is_active:true })
    setNewWaiter({ name:'',mobile:'',table_numbers:'' }); setShowAddWaiter(false); setSaving(false); loadAll()
  }

  async function deleteSup(id) { if (!confirm('Remove supervisor?')) return; await supabase.from('supervisors').delete().eq('id',id); loadAll() }
  async function deleteWaiter(id) { if (!confirm('Remove waiter?')) return; await supabase.from('waiters').delete().eq('id',id); loadAll() }

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

      {showCreate && (
        <div style={{ background:'#fff', borderRadius:16, padding:20, marginBottom:20, boxShadow:'var(--shadow)', border:'2px solid var(--ink)' }}>
          <h3 style={{ fontSize:16, fontWeight:800, marginBottom:16 }}>Create New Event</h3>
          <input value={newEvent.name} onChange={e=>setNewEvent(p=>({...p,name:e.target.value}))} placeholder="Event name *" style={INP} />
          <input type="date" value={newEvent.date} onChange={e=>setNewEvent(p=>({...p,date:e.target.value}))} style={INP} />
          <input value={newEvent.venue} onChange={e=>setNewEvent(p=>({...p,venue:e.target.value}))} placeholder="Venue / Location" style={INP} />
          <input value={newEvent.catering_company} onChange={e=>setNewEvent(p=>({...p,catering_company:e.target.value}))} placeholder="Catering company name (optional)" style={INP} />
          <input type="number" value={newEvent.number_of_tables} onChange={e=>setNewEvent(p=>({...p,number_of_tables:e.target.value}))} placeholder="Number of tables (optional)" style={INP} />
          <div style={{ display:'flex', gap:10 }}>
            <button onClick={createEvent} disabled={saving} style={{ flex:1, background:'var(--ink)', color:'#fff', border:'none', borderRadius:12, padding:'12px', fontSize:14, fontWeight:800 }}>{saving?'Creating...':'Create Event'}</button>
            <button onClick={()=>setShowCreate(false)} style={{ flex:1, background:'var(--bg)', border:'1.5px solid var(--line)', borderRadius:12, padding:'12px', fontSize:14, fontWeight:700 }}>Cancel</button>
          </div>
        </div>
      )}

      {showAddSup && (
        <div style={{ background:'#fff', borderRadius:16, padding:20, marginBottom:20, boxShadow:'var(--shadow)', border:'2px solid #E8890C' }}>
          <h3 style={{ fontSize:16, fontWeight:800, marginBottom:16 }}>Add Supervisor</h3>
          <select value={selEvent||''} onChange={e=>setSelEvent(e.target.value)} style={{ ...INP, background:'#fff' }}>
            <option value="">Select Event *</option>
            {events.map(ev=><option key={ev.id} value={ev.id}>{ev.name}</option>)}
          </select>
          <input value={newSup.name} onChange={e=>setNewSup(p=>({...p,name:e.target.value}))} placeholder="Full name * (becomes username)" style={INP} />
          <input value={newSup.mobile} onChange={e=>setNewSup(p=>({...p,mobile:e.target.value}))} placeholder="Mobile number (optional)" type="tel" style={INP} />
          <input value={newSup.pin} onChange={e=>setNewSup(p=>({...p,pin:e.target.value.replace(/\D/g,'').slice(0,6)}))} placeholder="PIN * 4-6 digits (becomes password)" style={{ ...INP, letterSpacing:'0.2em' }} />
          {newSup.name && newSup.pin && <div style={{ background:'#F0FDF4', border:'1px solid #BBF7D0', borderRadius:8, padding:'8px 12px', fontSize:12, color:'#15803D', marginBottom:10 }}>Login: <strong>{newSup.name}</strong> / <strong>{newSup.pin}</strong></div>}
          <div style={{ display:'flex', gap:10 }}>
            <button onClick={addSupervisor} disabled={saving} style={{ flex:1, background:'#E8890C', color:'#fff', border:'none', borderRadius:12, padding:'12px', fontSize:14, fontWeight:800 }}>{saving?'Adding...':'Add Supervisor'}</button>
            <button onClick={()=>setShowAddSup(false)} style={{ flex:1, background:'var(--bg)', border:'1.5px solid var(--line)', borderRadius:12, padding:'12px', fontSize:14, fontWeight:700 }}>Cancel</button>
          </div>
        </div>
      )}

      {showAddWaiter && (
        <div style={{ background:'#fff', borderRadius:16, padding:20, marginBottom:20, boxShadow:'var(--shadow)', border:'2px solid #2563EB' }}>
          <h3 style={{ fontSize:16, fontWeight:800, marginBottom:16 }}>Add Waiter</h3>
          <select value={selEvent||''} onChange={e=>setSelEvent(e.target.value)} style={{ ...INP, background:'#fff' }}>
            <option value="">Select Event *</option>
            {events.map(ev=><option key={ev.id} value={ev.id}>{ev.name}</option>)}
          </select>
          <input value={newWaiter.name} onChange={e=>setNewWaiter(p=>({...p,name:e.target.value}))} placeholder="Waiter name *" style={INP} />
          <input value={newWaiter.mobile} onChange={e=>setNewWaiter(p=>({...p,mobile:e.target.value}))} placeholder="Mobile number" type="tel" style={INP} />
          <input value={newWaiter.table_numbers} onChange={e=>setNewWaiter(p=>({...p,table_numbers:e.target.value}))} placeholder="Assigned tables e.g. 1,2,3 or 1-5" style={INP} />
          <div style={{ display:'flex', gap:10 }}>
            <button onClick={addWaiter} disabled={saving} style={{ flex:1, background:'#2563EB', color:'#fff', border:'none', borderRadius:12, padding:'12px', fontSize:14, fontWeight:800 }}>{saving?'Adding...':'Add Waiter'}</button>
            <button onClick={()=>setShowAddWaiter(false)} style={{ flex:1, background:'var(--bg)', border:'1.5px solid var(--line)', borderRadius:12, padding:'12px', fontSize:14, fontWeight:700 }}>Cancel</button>
          </div>
        </div>
      )}

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
        return (
          <div key={ev.id} style={{ background:'#fff', borderRadius:18, padding:18, marginBottom:14, boxShadow:'var(--shadow)', borderLeft:'5px solid '+(isActive?'#16A34A':'#D1D5DB') }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:14 }}>
              <div>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <div style={{ fontSize:17, fontWeight:800 }}>{ev.name}</div>
                  <div style={{ background:isActive?'#F0FDF4':'#F3F4F6', color:isActive?'#16A34A':'#6B7280', fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:999 }}>{isActive?'● Active':'○ Closed'}</div>
                </div>
                <div style={{ fontSize:13, color:'var(--ink2)', marginTop:4, lineHeight:1.8 }}>
                  📍 {ev.venue||'No venue'} &nbsp;·&nbsp; 📅 {new Date(ev.date).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}
                  {ev.number_of_tables && <span> &nbsp;·&nbsp; 🪑 {ev.number_of_tables} tables</span>}
                  {ev.catering_company && <><br/>🍽️ {ev.catering_company}</>}
                </div>
              </div>
              <button onClick={()=>toggleEvent(ev)} style={{ background:isActive?'#F3F4F6':'#F0FDF4', border:'1px solid #D1D5DB', borderRadius:8, padding:'6px 12px', fontSize:12, fontWeight:600, color:isActive?'#6B7280':'#16A34A', cursor:'pointer' }}>
                {isActive?'Close':'Reopen'}
              </button>
            </div>

            <div style={{ background:'var(--bg)', borderRadius:12, padding:'12px 14px', marginBottom:14 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--ink2)', marginBottom:8, textTransform:'uppercase' }}>🎥 Welcome Screen Video</div>
              {ev.video_url && <div style={{ fontSize:12, color:'#16A34A', marginBottom:6, wordBreak:'break-all' }}>✅ {ev.video_url.slice(0,55)}...</div>}
              <div style={{ display:'flex', gap:8 }}>
                <input value={videoInputs[ev.id]||''} onChange={e=>setVideoInputs(p=>({...p,[ev.id]:e.target.value}))}
                  placeholder="Paste MP4 video URL..."
                  style={{ flex:1, border:'1.5px solid var(--line)', borderRadius:10, padding:'8px 12px', fontSize:13, fontFamily:'Manrope', outline:'none' }} />
                <button onClick={()=>saveVideoUrl(ev.id)} style={{ background:'var(--ink)', color:'#fff', border:'none', borderRadius:10, padding:'8px 16px', fontSize:13, fontWeight:700, cursor:'pointer' }}>Save</button>
                {ev.video_url && <button onClick={()=>{ setVideoInputs(p=>({...p,[ev.id]:''})); supabase.from('events').update({video_url:null}).eq('id',ev.id).then(loadAll) }} style={{ background:'#FEF2F2', border:'1px solid #FECACA', color:'#DC2626', borderRadius:10, padding:'8px 10px', fontSize:13, cursor:'pointer' }}>✕</button>}
              </div>
            </div>

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
                  <button onClick={()=>deleteSup(sup.id)} style={{ background:'#FEF2F2', border:'none', borderRadius:8, padding:'4px 10px', fontSize:12, fontWeight:700, color:'#DC2626', cursor:'pointer' }}>Remove</button>
                </div>
              ))}
            </div>

            <div style={{ borderTop:'1px solid var(--line)', paddingTop:12 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--ink2)', marginBottom:8, textTransform:'uppercase' }}>🧑‍🍳 Waiters ({ws.length})</div>
              {ws.length===0 ? <div style={{ fontSize:13, color:'var(--ink2)', fontStyle:'italic' }}>None — click "+ Add Waiter"</div>
              : ws.map(w => (
                <div key={w.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 10px', marginBottom:6, background:'var(--bg)', borderRadius:10 }}>
                  <div>
                    <span style={{ fontWeight:700, fontSize:14 }}>{w.name}</span>
                    {w.mobile && <span style={{ fontSize:12, color:'#888', marginLeft:8 }}>📞 {w.mobile}</span>}
                    {w.table_numbers && <span style={{ fontSize:11, color:'#2563EB', marginLeft:8, background:'#EFF6FF', padding:'2px 8px', borderRadius:999 }}>Tables: {w.table_numbers}</span>}
                  </div>
                  <button onClick={()=>deleteWaiter(w.id)} style={{ background:'#FEF2F2', border:'none', borderRadius:8, padding:'4px 10px', fontSize:12, fontWeight:700, color:'#DC2626', cursor:'pointer' }}>Remove</button>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
