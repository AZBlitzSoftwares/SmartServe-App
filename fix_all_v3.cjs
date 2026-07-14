const fs = require('fs')
const BASE = '/Users/asayyed/SmartServe/src'
const INP = `{ width:'100%', border:'1.5px solid var(--line)', borderRadius:10, padding:'10px 14px', fontSize:14, marginBottom:10, fontFamily:'Manrope', outline:'none', boxSizing:'border-box' }`

// ═══════════════════════════════════════════════════════════════════
// FIX 1: EventManager — supervisors with mobile + username, waiters,
//         video per event, close others when activating one
// ═══════════════════════════════════════════════════════════════════
fs.writeFileSync(BASE + '/components/supervisor/EventManager.jsx', `import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

const INP = { width:'100%', border:'1.5px solid var(--line)', borderRadius:10, padding:'10px 14px', fontSize:14, marginBottom:10, fontFamily:'Manrope', outline:'none', boxSizing:'border-box' }

export default function EventManager() {
  const [events, setEvents] = useState([])
  const [supervisors, setSupervisors] = useState([])
  const [waiters, setWaiters] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [showAddSup, setShowAddSup] = useState(false)
  const [showAddWaiter, setShowAddWaiter] = useState(false)
  const [selEvent, setSelEvent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [newEvent, setNewEvent] = useState({ name:'', date:'', venue:'', number_of_tables:'', catering_company:'' })
  const [newSup, setNewSup] = useState({ name:'', pin:'', mobile:'' })
  const [newWaiter, setNewWaiter] = useState({ name:'', mobile:'', table_numbers:'' })
  const [saving, setSaving] = useState(false)
  const [videoUrls, setVideoUrls] = useState({})
  const [videoInputs, setVideoInputs] = useState({})

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    const { data: evs } = await supabase.from('events').select('*').order('created_at', { ascending:false })
    const { data: sups } = await supabase.from('supervisors').select('*').order('created_at', { ascending:false })
    const { data: ws } = await supabase.from('waiters').select('*').order('created_at', { ascending:false })
    setEvents(evs||[])
    setSupervisors(sups||[])
    setWaiters(ws||[])
    // Pre-fill video inputs
    const vmap = {}; const vimap = {}
    ;(evs||[]).forEach(e => { vmap[e.id]=e.video_url||''; vimap[e.id]=e.video_url||'' })
    setVideoUrls(vmap); setVideoInputs(vimap)
    setLoading(false)
  }

  async function createEvent() {
    if (!newEvent.name||!newEvent.date) return
    setSaving(true)
    await supabase.from('events').insert({
      name:newEvent.name, date:newEvent.date, venue:newEvent.venue,
      number_of_tables: newEvent.number_of_tables ? parseInt(newEvent.number_of_tables) : null,
      catering_company: newEvent.catering_company || null,
      status:'upcoming', is_closed:false, ai_enabled:false
    })
    setNewEvent({ name:'',date:'',venue:'',number_of_tables:'',catering_company:'' })
    setShowCreate(false); setSaving(false); loadAll()
  }

  async function setActiveEvent(ev) {
    // Close all other events, open this one
    await supabase.from('events').update({ is_closed:true }).neq('id', ev.id)
    await supabase.from('events').update({ is_closed:false }).eq('id', ev.id)
    loadAll()
  }

  async function toggleEvent(ev) {
    await supabase.from('events').update({ is_closed:!ev.is_closed }).eq('id', ev.id)
    loadAll()
  }

  async function saveVideoUrl(eventId) {
    const url = videoInputs[eventId]?.trim()||null
    await supabase.from('events').update({ video_url:url }).eq('id', eventId)
    setVideoUrls(p => ({ ...p, [eventId]:url||'' }))
    alert(url ? 'Video URL saved!' : 'Video removed.')
    loadAll()
  }

  async function addSupervisor() {
    if (!newSup.name||!newSup.pin||!selEvent) { alert('Please fill name, PIN and select event'); return }
    if (newSup.pin.length < 4) { alert('PIN must be 4 digits'); return }
    setSaving(true)
    await supabase.from('supervisors').insert({ event_id:selEvent, name:newSup.name, pin:newSup.pin, mobile:newSup.mobile||null, is_active:true })
    setNewSup({ name:'',pin:'',mobile:'' }); setShowAddSup(false); setSaving(false); loadAll()
  }

  async function addWaiter() {
    if (!newWaiter.name||!selEvent) { alert('Please fill waiter name and select event'); return }
    setSaving(true)
    await supabase.from('waiters').insert({ event_id:selEvent, name:newWaiter.name, mobile:newWaiter.mobile||null, table_numbers:newWaiter.table_numbers||null, is_active:true })
    setNewWaiter({ name:'',mobile:'',table_numbers:'' }); setShowAddWaiter(false); setSaving(false); loadAll()
  }

  async function toggleSup(sup) { await supabase.from('supervisors').update({ is_active:!sup.is_active }).eq('id', sup.id); loadAll() }
  async function toggleWaiter(w) { await supabase.from('waiters').update({ is_active:!w.is_active }).eq('id', w.id); loadAll() }

  const getSups = (eid) => supervisors.filter(s => s.event_id === eid)
  const getWaiters = (eid) => waiters.filter(w => w.event_id === eid)

  return (
    <div>
      <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20 }}>
        <h2 style={{ fontSize:20,fontWeight:800 }}>Events & Staff</h2>
        <button onClick={() => setShowCreate(true)} style={{ background:'var(--ink)',color:'#fff',border:'none',borderRadius:10,padding:'8px 16px',fontSize:13,fontWeight:700 }}>+ New Event</button>
      </div>

      {/* Info banner */}
      <div style={{ background:'#EFF6FF',border:'1px solid #BFDBFE',borderRadius:12,padding:'10px 14px',marginBottom:16,fontSize:13,color:'#2563EB' }}>
        💡 <strong>Supervisor login:</strong> use their <strong>Name</strong> as username and their <strong>PIN</strong> as password.
        Only one event can be Active at a time — use "Set Active" to switch.
      </div>

      {showCreate && (
        <div style={{ background:'#fff',borderRadius:16,padding:20,marginBottom:20,boxShadow:'var(--shadow)',border:'2px solid var(--ink)' }}>
          <h3 style={{ fontSize:16,fontWeight:800,marginBottom:16 }}>Create New Event</h3>
          <input value={newEvent.name} onChange={e => setNewEvent(p=>({...p,name:e.target.value}))} placeholder="Event name *" style={INP} />
          <input type="date" value={newEvent.date} onChange={e => setNewEvent(p=>({...p,date:e.target.value}))} style={INP} />
          <input value={newEvent.venue} onChange={e => setNewEvent(p=>({...p,venue:e.target.value}))} placeholder="Venue / Location" style={INP} />
          <input value={newEvent.catering_company} onChange={e => setNewEvent(p=>({...p,catering_company:e.target.value}))} placeholder="Catering company name (optional)" style={INP} />
          <input type="number" value={newEvent.number_of_tables} onChange={e => setNewEvent(p=>({...p,number_of_tables:e.target.value}))} placeholder="Number of tables (optional)" style={INP} />
          <div style={{ display:'flex',gap:10 }}>
            <button onClick={createEvent} disabled={saving} style={{ flex:1,background:'var(--ink)',color:'#fff',border:'none',borderRadius:12,padding:'12px',fontSize:14,fontWeight:800 }}>{saving?'Creating...':'Create Event'}</button>
            <button onClick={() => setShowCreate(false)} style={{ flex:1,background:'var(--bg)',border:'1.5px solid var(--line)',borderRadius:12,padding:'12px',fontSize:14,fontWeight:700 }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Add Supervisor form */}
      {showAddSup && (
        <div style={{ background:'#fff',borderRadius:16,padding:20,marginBottom:20,boxShadow:'var(--shadow)',border:'2px solid #E8890C' }}>
          <h3 style={{ fontSize:16,fontWeight:800,marginBottom:16 }}>Add Supervisor</h3>
          <select value={selEvent||''} onChange={e => setSelEvent(e.target.value)} style={{ ...INP,background:'#fff' }}>
            <option value="">Select Event *</option>
            {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
          </select>
          <input value={newSup.name} onChange={e => setNewSup(p=>({...p,name:e.target.value}))} placeholder="Supervisor name * (used as username)" style={INP} />
          <input value={newSup.mobile} onChange={e => setNewSup(p=>({...p,mobile:e.target.value}))} placeholder="Mobile number (optional)" type="tel" style={INP} />
          <input value={newSup.pin} onChange={e => setNewSup(p=>({...p,pin:e.target.value.replace(/\\D/g,'').slice(0,6)}))} placeholder="PIN * (used as password, 4-6 digits)" style={{ ...INP,letterSpacing:'0.2em' }} />
          <div style={{ background:'#FEF3C7',border:'1px solid #FCD34D',borderRadius:8,padding:'8px 12px',fontSize:12,color:'#92400E',marginBottom:10 }}>
            Login: Username = <strong>{newSup.name||'their name'}</strong> · Password = <strong>{newSup.pin||'their PIN'}</strong>
          </div>
          <div style={{ display:'flex',gap:10 }}>
            <button onClick={addSupervisor} disabled={saving} style={{ flex:1,background:'#E8890C',color:'#fff',border:'none',borderRadius:12,padding:'12px',fontSize:14,fontWeight:800 }}>{saving?'Adding...':'Add Supervisor'}</button>
            <button onClick={() => setShowAddSup(false)} style={{ flex:1,background:'var(--bg)',border:'1.5px solid var(--line)',borderRadius:12,padding:'12px',fontSize:14,fontWeight:700 }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Add Waiter form */}
      {showAddWaiter && (
        <div style={{ background:'#fff',borderRadius:16,padding:20,marginBottom:20,boxShadow:'var(--shadow)',border:'2px solid #2563EB' }}>
          <h3 style={{ fontSize:16,fontWeight:800,marginBottom:16 }}>Add Waiter</h3>
          <select value={selEvent||''} onChange={e => setSelEvent(e.target.value)} style={{ ...INP,background:'#fff' }}>
            <option value="">Select Event *</option>
            {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
          </select>
          <input value={newWaiter.name} onChange={e => setNewWaiter(p=>({...p,name:e.target.value}))} placeholder="Waiter name *" style={INP} />
          <input value={newWaiter.mobile} onChange={e => setNewWaiter(p=>({...p,mobile:e.target.value}))} placeholder="Mobile number" type="tel" style={INP} />
          <input value={newWaiter.table_numbers} onChange={e => setNewWaiter(p=>({...p,table_numbers:e.target.value}))} placeholder="Assigned tables (e.g. 1,2,3 or 1-5)" style={INP} />
          <div style={{ display:'flex',gap:10 }}>
            <button onClick={addWaiter} disabled={saving} style={{ flex:1,background:'#2563EB',color:'#fff',border:'none',borderRadius:12,padding:'12px',fontSize:14,fontWeight:800 }}>{saving?'Adding...':'Add Waiter'}</button>
            <button onClick={() => setShowAddWaiter(false)} style={{ flex:1,background:'var(--bg)',border:'1.5px solid var(--line)',borderRadius:12,padding:'12px',fontSize:14,fontWeight:700 }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Action buttons */}
      {!showAddSup && !showAddWaiter && (
        <div style={{ display:'flex',gap:10,marginBottom:20 }}>
          <button onClick={() => { setShowAddSup(true); setShowAddWaiter(false) }} style={{ flex:1,background:'#FEF3C7',border:'1.5px solid #FCD34D',color:'#92400E',borderRadius:12,padding:'12px',fontSize:13,fontWeight:700 }}>+ Add Supervisor</button>
          <button onClick={() => { setShowAddWaiter(true); setShowAddSup(false) }} style={{ flex:1,background:'#EFF6FF',border:'1.5px solid #BFDBFE',color:'#2563EB',borderRadius:12,padding:'12px',fontSize:13,fontWeight:700 }}>+ Add Waiter</button>
        </div>
      )}

      {loading ? <div style={{ textAlign:'center',padding:40,color:'var(--ink2)' }}>Loading...</div>
      : events.map(ev => (
        <div key={ev.id} style={{ background:'#fff',borderRadius:18,padding:18,marginBottom:14,boxShadow:'var(--shadow)',borderLeft:'4px solid '+(ev.is_closed?'#999':'#16A34A') }}>
          {/* Event header */}
          <div style={{ display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12 }}>
            <div>
              <div style={{ fontSize:17,fontWeight:800 }}>{ev.name}</div>
              <div style={{ fontSize:13,color:'var(--ink2)',marginTop:3 }}>
                📍 {ev.venue||'No venue'} · 📅 {new Date(ev.date).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}
                {ev.number_of_tables && <span> · 🪑 {ev.number_of_tables} tables</span>}
                {ev.catering_company && <span> · 🍽️ {ev.catering_company}</span>}
              </div>
            </div>
            <div style={{ display:'flex',flexDirection:'column',alignItems:'flex-end',gap:6 }}>
              <div style={{ background:ev.is_closed?'#F3F4F6':'#F0FDF4',color:ev.is_closed?'#6B7280':'#16A34A',fontSize:12,fontWeight:700,padding:'3px 10px',borderRadius:999 }}>{ev.is_closed?'Closed':'Active'}</div>
              <div style={{ display:'flex',gap:6 }}>
                {ev.is_closed && <button onClick={() => setActiveEvent(ev)} style={{ background:'#F0FDF4',border:'1px solid #BBF7D0',borderRadius:8,padding:'4px 10px',fontSize:12,fontWeight:600,color:'#16A34A' }}>Set Active</button>}
                {!ev.is_closed && <button onClick={() => toggleEvent(ev)} style={{ background:'none',border:'1px solid var(--line)',borderRadius:8,padding:'4px 10px',fontSize:12,fontWeight:600,color:'var(--ink2)' }}>Close</button>}
              </div>
            </div>
          </div>

          {/* Video per event */}
          <div style={{ borderTop:'1px solid var(--line)',paddingTop:12,marginBottom:12 }}>
            <div style={{ fontSize:12,fontWeight:700,color:'var(--ink2)',marginBottom:8,textTransform:'uppercase' }}>Welcome Screen Video</div>
            {videoUrls[ev.id] && (
              <div style={{ fontSize:12,color:'#16A34A',marginBottom:6,wordBreak:'break-all' }}>✅ {videoUrls[ev.id].slice(0,60)}...</div>
            )}
            <div style={{ display:'flex',gap:8 }}>
              <input value={videoInputs[ev.id]||''} onChange={e => setVideoInputs(p=>({...p,[ev.id]:e.target.value}))}
                placeholder="Paste video URL (MP4)..." style={{ flex:1,border:'1.5px solid var(--line)',borderRadius:10,padding:'8px 12px',fontSize:13,fontFamily:'Manrope',outline:'none' }} />
              <button onClick={() => saveVideoUrl(ev.id)} style={{ background:'var(--ink)',color:'#fff',border:'none',borderRadius:10,padding:'8px 14px',fontSize:13,fontWeight:700 }}>Save</button>
              {videoUrls[ev.id] && <button onClick={() => { setVideoInputs(p=>({...p,[ev.id]:''})); saveVideoUrl(ev.id) }} style={{ background:'#FEF2F2',border:'1px solid #FECACA',color:'#DC2626',borderRadius:10,padding:'8px 12px',fontSize:13,fontWeight:600 }}>Remove</button>}
            </div>
          </div>

          {/* Supervisors */}
          <div style={{ borderTop:'1px solid var(--line)',paddingTop:12,marginBottom:12 }}>
            <div style={{ fontSize:12,fontWeight:700,color:'var(--ink2)',marginBottom:8,textTransform:'uppercase' }}>Supervisors</div>
            {getSups(ev.id).length === 0
              ? <div style={{ fontSize:13,color:'var(--ink2)',fontStyle:'italic' }}>No supervisors assigned</div>
              : getSups(ev.id).map(sup => (
                <div key={sup.id} style={{ display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:'1px solid var(--line)' }}>
                  <div>
                    <span style={{ fontWeight:700,fontSize:14 }}>{sup.name}</span>
                    <span style={{ fontSize:11,color:'#888',marginLeft:8 }}>PIN: {sup.pin}</span>
                    {sup.mobile && <span style={{ fontSize:11,color:'#888',marginLeft:8 }}>📞 {sup.mobile}</span>}
                  </div>
                  <button onClick={() => toggleSup(sup)} style={{ background:sup.is_active?'#FEF2F2':'#F0FDF4',border:'none',borderRadius:8,padding:'4px 12px',fontSize:12,fontWeight:700,color:sup.is_active?'#DC2626':'#16A34A' }}>{sup.is_active?'Disable':'Enable'}</button>
                </div>
              ))
            }
          </div>

          {/* Waiters */}
          <div style={{ borderTop:'1px solid var(--line)',paddingTop:12 }}>
            <div style={{ fontSize:12,fontWeight:700,color:'var(--ink2)',marginBottom:8,textTransform:'uppercase' }}>Waiters</div>
            {getWaiters(ev.id).length === 0
              ? <div style={{ fontSize:13,color:'var(--ink2)',fontStyle:'italic' }}>No waiters assigned</div>
              : getWaiters(ev.id).map(w => (
                <div key={w.id} style={{ display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:'1px solid var(--line)' }}>
                  <div>
                    <span style={{ fontWeight:700,fontSize:14 }}>{w.name}</span>
                    {w.mobile && <span style={{ fontSize:11,color:'#888',marginLeft:8 }}>📞 {w.mobile}</span>}
                    {w.table_numbers && <span style={{ fontSize:11,color:'#2563EB',marginLeft:8,background:'#EFF6FF',padding:'2px 6px',borderRadius:999 }}>Tables: {w.table_numbers}</span>}
                  </div>
                  <button onClick={() => toggleWaiter(w)} style={{ background:w.is_active?'#FEF2F2':'#F0FDF4',border:'none',borderRadius:8,padding:'4px 12px',fontSize:12,fontWeight:700,color:w.is_active?'#DC2626':'#16A34A' }}>{w.is_active?'Disable':'Enable'}</button>
                </div>
              ))
            }
          </div>
        </div>
      ))}
    </div>
  )
}
`)
console.log('✅ 1/4 EventManager — supervisors + mobile + waiters + video per event + Set Active')

// ═══════════════════════════════════════════
// FIX 2: SupervisorApp — remove VideoManager tab (moved into EventManager)
//         + show waiter list in KOT dashboard
// ═══════════════════════════════════════════
fs.writeFileSync(BASE + '/pages/SupervisorApp.jsx', `import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import SupervisorLogin from '../components/supervisor/SupervisorLogin'
import KOTDashboard from '../components/supervisor/KOTDashboard'
import SOSRequests from '../components/supervisor/SOSRequests'
import MenuManager from '../components/supervisor/MenuManager'
import ReportsDashboard from '../components/supervisor/ReportsDashboard'
import EventManager from '../components/supervisor/EventManager'

export default function SupervisorApp() {
  const [authed, setAuthed] = useState(false)
  const [currentUser, setCurrentUser] = useState(null)
  const [activeTab, setActiveTab] = useState('kot')
  const [eventData, setEventData] = useState(null)
  const [orderCount, setOrderCount] = useState(0)
  const [sosCount, setSosCount] = useState(0)

  useEffect(() => { if (authed) loadEvent() }, [authed])

  async function loadEvent() {
    const { data } = await supabase.from('events').select('*').eq('is_closed', false).order('created_at', { ascending:false }).limit(1)
    if (data?.length) setEventData(data[0])
  }

  if (!authed) return <SupervisorLogin onLogin={(user) => { setCurrentUser(user); setAuthed(true) }} />

  const isAdmin = currentUser?.role === 'admin'

  const TABS = [
    { id:'kot',     label:'Orders',   emoji:'🎫', badge:orderCount },
    { id:'sos',     label:'Requests', emoji:'🆘', badge:sosCount },
    { id:'menu',    label:'Menu',     emoji:'📋', badge:0 },
    { id:'reports', label:'Reports',  emoji:'📊', badge:0 },
    ...(isAdmin ? [{ id:'events', label:'Events', emoji:'📅', badge:0 }] : []),
  ]

  return (
    <div style={{ minHeight:'100vh',background:'var(--bg)',paddingBottom:80 }}>
      <div style={{ background:'var(--ink)',padding:'14px 20px',display:'flex',alignItems:'center',justifyContent:'space-between' }}>
        <div>
          <div style={{ color:'#fff',fontWeight:800,fontSize:16 }}>Janu's <span style={{ color:'#E8890C' }}>Smart Serve</span> <span style={{ color:'rgba(255,255,255,0.5)',fontSize:12,fontWeight:500 }}>{isAdmin?'Admin':'Supervisor'}</span></div>
          {eventData && <div style={{ color:'rgba(255,255,255,0.6)',fontSize:12,marginTop:1 }}>📍 {eventData.name}</div>}
        </div>
        <button onClick={() => setAuthed(false)} style={{ background:'rgba(255,255,255,0.1)',border:'none',color:'#fff',borderRadius:8,padding:'6px 12px',fontSize:12,fontWeight:600 }}>Logout</button>
      </div>
      <div style={{ padding:'16px' }}>
        {activeTab==='kot'     && <KOTDashboard eventData={eventData} onOrderCountChange={setOrderCount} />}
        {activeTab==='sos'     && <SOSRequests eventData={eventData} onSosCountChange={setSosCount} />}
        {activeTab==='menu'    && <MenuManager eventData={eventData} />}
        {activeTab==='reports' && <ReportsDashboard eventData={eventData} onEventChange={setEventData} />}
        {activeTab==='events'  && <EventManager />}
      </div>
      <div style={{ position:'fixed',bottom:0,left:0,right:0,background:'#fff',borderTop:'1px solid var(--line)',display:'flex',zIndex:50 }}>
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{ flex:1,padding:'10px 4px',background:'none',border:'none',display:'flex',flexDirection:'column',alignItems:'center',gap:2,cursor:'pointer',borderTop:activeTab===tab.id?'3px solid var(--ink)':'3px solid transparent',position:'relative' }}>
            <span style={{ fontSize:20 }}>{tab.emoji}</span>
            <span style={{ fontSize:10,fontWeight:activeTab===tab.id?800:500,color:activeTab===tab.id?'var(--ink)':'#999' }}>{tab.label}</span>
            {tab.badge>0 && <div style={{ position:'absolute',top:6,right:'18%',background:'#DC2626',color:'#fff',fontSize:9,fontWeight:800,borderRadius:999,minWidth:15,height:15,display:'flex',alignItems:'center',justifyContent:'center',padding:'0 3px' }}>{tab.badge}</div>}
          </button>
        ))}
      </div>
    </div>
  )
}
`)
console.log('✅ 2/4 SupervisorApp — clean tabs, event name in header')

// ═══════════════════════════════════════════
// FIX 3: ReportsDashboard — event selector dropdown
// ═══════════════════════════════════════════
fs.writeFileSync(BASE + '/components/supervisor/ReportsDashboard.jsx', `import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

export default function ReportsDashboard({ eventData: defaultEvent, onEventChange }) {
  const [allEvents, setAllEvents] = useState([])
  const [selectedEventId, setSelectedEventId] = useState(defaultEvent?.id||null)
  const [eventData, setEventData] = useState(defaultEvent)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    supabase.from('events').select('*').order('created_at',{ascending:false}).then(({data}) => {
      setAllEvents(data||[])
      if (!selectedEventId && data?.length) {
        const active = data.find(e=>!e.is_closed) || data[0]
        setSelectedEventId(active.id)
        setEventData(active)
      }
    })
  }, [])

  useEffect(() => {
    if (selectedEventId) loadReport(selectedEventId)
  }, [selectedEventId])

  async function loadReport(evId) {
    setLoading(true); setData(null)
    const ev = allEvents.find(e=>e.id===evId) || eventData
    setEventData(ev)
    const [ordersRes, sosRes, fbRes, waitersRes] = await Promise.all([
      supabase.from('orders').select('*, tables(table_number), order_items(quantity, menu_items(name))').eq('event_id', evId),
      supabase.from('sos_requests').select('*, tables(table_number)').eq('event_id', evId),
      supabase.from('feedback').select('*').eq('event_id', evId),
      supabase.from('waiters').select('*').eq('event_id', evId)
    ])
    const orders = ordersRes.data||[]; const sos = sosRes.data||[]; const fb = fbRes.data||[]; const ws = waitersRes.data||[]
    const tableMap = {}
    orders.forEach(o => {
      const t = o.tables?.table_number||'?'
      if (!tableMap[t]) tableMap[t] = { table:t, orders:0, items:0, delivered:0, cancelled:0, waiter:null }
      tableMap[t].orders++
      if (o.status==='delivered') tableMap[t].delivered++
      if (o.status==='cancelled') tableMap[t].cancelled++
      o.order_items?.forEach(oi => { tableMap[t].items += oi.quantity })
    })
    // Link waiters to tables
    ws.forEach(w => {
      if (!w.table_numbers) return
      w.table_numbers.split(',').forEach(tStr => {
        const t = tStr.trim().replace(/[^0-9]/g,'')
        if (t && tableMap[t]) tableMap[t].waiter = w.name + (w.mobile ? ' ('+w.mobile+')' : '')
      })
    })
    const itemMap = {}
    orders.forEach(o => o.order_items?.forEach(oi => {
      const n = oi.menu_items?.name||'?'
      if (!itemMap[n]) itemMap[n] = { name:n, qty:0 }
      itemMap[n].qty += oi.quantity
    }))
    const delivered = orders.filter(o=>o.status==='delivered').length
    const cancelled = orders.filter(o=>o.status==='cancelled').length
    const active = orders.filter(o=>!['delivered','cancelled'].includes(o.status)).length
    const avgRating = fb.length ? (fb.reduce((s,f)=>s+(f.rating||0),0)/fb.length).toFixed(1) : null
    setData({ orders, sos, fb, ws, stats:{ total:orders.length, delivered, cancelled, active }, tableStats:Object.values(tableMap).sort((a,b)=>a.table-b.table), itemStats:Object.values(itemMap).sort((a,b)=>b.qty-a.qty), avgRating })
    setLoading(false)
  }

  function printReport() {
    if (!data||!eventData) return
    const dateStr = new Date(eventData.date||Date.now()).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})
    const now = new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true})
    const w = window.open('','_blank')
    w.document.write(\`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Event Report — \${eventData.name}</title>
<style>body{font-family:Arial,sans-serif;font-size:13px;padding:24px;color:#111;max-width:800px;margin:0 auto}h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:20px 0 8px;border-bottom:1px solid #ddd;padding-bottom:4px}.meta{color:#666;font-size:12px;margin-bottom:20px;line-height:1.8}.stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px}.stat{background:#f5f5f5;border-radius:8px;padding:12px;text-align:center}.stat-num{font-size:24px;font-weight:bold;color:#E8890C}.stat-label{font-size:11px;color:#666;margin-top:4px}table{width:100%;border-collapse:collapse;margin-bottom:20px}th{background:#f0f0f0;text-align:left;padding:8px 10px;font-size:12px}td{padding:8px 10px;border-bottom:1px solid #eee;font-size:12px}.badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:bold}.g{background:#dcfce7;color:#16a34a}.r{background:#fee2e2;color:#dc2626}.y{background:#fef9c3;color:#ca8a04}@media print{body{padding:8px}}</style>
</head><body>
<h1>Janu's Smart Serve — Event Report</h1>
<div class="meta">
  <strong>\${eventData.name}</strong><br>
  📍 Venue: \${eventData.venue||'—'}<br>
  📅 Date: \${dateStr}<br>
  🍽️ Catering: \${eventData.catering_company||'—'}<br>
  🪑 Tables: \${eventData.number_of_tables||'—'}<br>
  🕐 Report generated: \${now}
</div>
<div class="stat-grid">
  <div class="stat"><div class="stat-num">\${data.stats.total}</div><div class="stat-label">Total Orders</div></div>
  <div class="stat"><div class="stat-num" style="color:#16a34a">\${data.stats.delivered}</div><div class="stat-label">Delivered</div></div>
  <div class="stat"><div class="stat-num" style="color:#d97706">\${data.stats.active}</div><div class="stat-label">Active</div></div>
  <div class="stat"><div class="stat-num" style="color:#dc2626">\${data.stats.cancelled}</div><div class="stat-label">Cancelled</div></div>
</div>
\${data.avgRating?'<p>⭐ Avg Guest Rating: <strong>'+data.avgRating+'/5</strong> from '+data.fb.length+' responses</p>':''}
<h2>Table-wise Summary</h2>
<table><tr><th>Table</th><th>Waiter</th><th>Orders</th><th>Items</th><th>Delivered</th><th>Cancelled</th></tr>
\${data.tableStats.map(t=>'<tr><td><strong>Table '+t.table+'</strong></td><td>'+(t.waiter||'—')+'</td><td>'+t.orders+'</td><td>'+t.items+'</td><td><span class="badge g">'+t.delivered+'</span></td><td><span class="badge r">'+t.cancelled+'</span></td></tr>').join('')}
</table>
<h2>Most Ordered Dishes</h2>
<table><tr><th>#</th><th>Dish</th><th>Qty</th></tr>
\${data.itemStats.slice(0,15).map((item,i)=>'<tr><td>'+( i+1)+'</td><td>'+item.name+'</td><td><strong>'+item.qty+'</strong></td></tr>').join('')}
</table>
<h2>SOS / Service Requests (\${data.sos.length})</h2>
\${data.sos.length===0?'<p style="color:#888">None.</p>':'<table><tr><th>Type</th><th>Table</th><th>Time</th><th>Status</th></tr>'+data.sos.map(s=>'<tr><td>'+s.request_type?.replace(/_/g,' ')+'</td><td>Table '+(s.tables?.table_number||'?')+'</td><td>'+new Date(s.created_at).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true})+'</td><td><span class="badge '+(s.status==='resolved'?'g':s.status==='acknowledged'?'y':'r')+'">'+s.status+'</span></td></tr>').join('')+'</table>'}
\${data.fb.length>0?'<h2>Guest Feedback</h2><table><tr><th>Name</th><th>Rating</th><th>Comment</th></tr>'+data.fb.map(f=>'<tr><td>'+(f.guest_name||'Anonymous')+'</td><td>'+'⭐'.repeat(f.rating||0)+'</td><td>'+(f.comment||'—')+'</td></tr>').join('')+'</table>':''}
<div style="margin-top:32px;text-align:center;font-size:11px;color:#aaa">Generated by Janu's Smart Serve · \${new Date().toLocaleString('en-IN')}</div>
</body></html>\`)
    w.document.close(); w.focus(); setTimeout(()=>{ w.print(); w.close() },400)
  }

  function exportCSV() {
    if (!data) return
    const rows = [['Table','Waiter','Orders','Items','Delivered','Cancelled']]
    data.tableStats.forEach(t => rows.push([t.table, t.waiter||'', t.orders, t.items, t.delivered, t.cancelled]))
    const blob = new Blob([rows.map(r=>r.join(',')).join('\\n')],{type:'text/csv'})
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download=(eventData?.name||'report')+'.csv'; a.click(); URL.revokeObjectURL(url)
  }

  const CARDS = data ? [
    { label:'Total Orders', value:data.stats.total, color:'#2563EB', bg:'#EFF6FF' },
    { label:'Delivered',    value:data.stats.delivered, color:'#16A34A', bg:'#F0FDF4' },
    { label:'Active',       value:data.stats.active, color:'#D97706', bg:'#FEF3C7' },
    { label:'Cancelled',    value:data.stats.cancelled, color:'#DC2626', bg:'#FEF2F2' },
    { label:'SOS Requests', value:data.sos.length, color:'#0891B2', bg:'#ECFEFF' },
    { label:'Avg Rating',   value:data.avgRating?data.avgRating+'★':'N/A', color:'#7C3AED', bg:'#F5F3FF' },
  ] : []

  return (
    <div>
      {/* Event selector */}
      <div style={{ background:'#fff',borderRadius:16,padding:'14px 16px',marginBottom:16,boxShadow:'var(--shadow)' }}>
        <div style={{ fontSize:13,fontWeight:700,color:'var(--ink2)',marginBottom:8 }}>Select Event for Report</div>
        <select value={selectedEventId||''} onChange={e => setSelectedEventId(e.target.value)}
          style={{ width:'100%',border:'1.5px solid var(--line)',borderRadius:10,padding:'10px 14px',fontSize:14,fontFamily:'Manrope',outline:'none',background:'#fff' }}>
          <option value="">Choose an event...</option>
          {allEvents.map(ev => <option key={ev.id} value={ev.id}>{ev.name} — {new Date(ev.date).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})} {ev.is_closed?'(Closed)':'(Active)'}</option>)}
        </select>
      </div>

      {loading && <div style={{ textAlign:'center',padding:60,color:'var(--ink2)' }}>Loading report...</div>}

      {data && eventData && (
        <>
          {/* Event info */}
          <div style={{ background:'#fff',borderRadius:16,padding:'14px 18px',marginBottom:16,boxShadow:'var(--shadow)' }}>
            <div style={{ display:'flex',justifyContent:'space-between',alignItems:'flex-start' }}>
              <div>
                <div style={{ fontWeight:800,fontSize:18,marginBottom:4 }}>{eventData.name}</div>
                {eventData.venue && <div style={{ fontSize:13,color:'var(--ink2)' }}>📍 {eventData.venue}</div>}
                {eventData.date && <div style={{ fontSize:13,color:'var(--ink2)' }}>📅 {new Date(eventData.date).toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'})}</div>}
                {eventData.catering_company && <div style={{ fontSize:13,color:'var(--ink2)' }}>🍽️ {eventData.catering_company}</div>}
                {eventData.number_of_tables && <div style={{ fontSize:13,color:'var(--ink2)' }}>🪑 {eventData.number_of_tables} tables</div>}
              </div>
              <div style={{ display:'flex',flexDirection:'column',gap:8 }}>
                <button onClick={printReport} style={{ background:'var(--ink)',color:'#fff',border:'none',borderRadius:10,padding:'8px 14px',fontSize:13,fontWeight:700 }}>🖨 Print PDF</button>
                <button onClick={exportCSV} style={{ background:'#F0FDF4',border:'1px solid #BBF7D0',color:'#16A34A',borderRadius:10,padding:'8px 14px',fontSize:13,fontWeight:700 }}>📊 CSV</button>
                <button onClick={() => loadReport(selectedEventId)} style={{ background:'var(--bg)',border:'1px solid var(--line)',borderRadius:10,padding:'8px 14px',fontSize:13,fontWeight:600 }}>↻ Refresh</button>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div style={{ display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,marginBottom:16 }}>
            {CARDS.map(c => <div key={c.label} style={{ background:c.bg,borderRadius:14,padding:'14px 16px' }}><div style={{ fontSize:26,fontWeight:800,color:c.color }}>{c.value}</div><div style={{ fontSize:11,color:'var(--ink2)',fontWeight:600,marginTop:2 }}>{c.label}</div></div>)}
          </div>

          {/* Table stats */}
          <div style={{ background:'#fff',borderRadius:16,padding:16,marginBottom:16,boxShadow:'var(--shadow)' }}>
            <div style={{ fontWeight:800,fontSize:16,marginBottom:12 }}>Table-wise Summary</div>
            {data.tableStats.length===0 ? <div style={{ color:'var(--ink2)',fontSize:13 }}>No orders yet</div>
            : data.tableStats.map(t => (
              <div key={t.table} style={{ padding:'10px 0',borderBottom:'1px solid var(--line)' }}>
                <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center' }}>
                  <div style={{ fontWeight:700,fontSize:15 }}>Table {t.table}</div>
                  <div style={{ display:'flex',gap:10,fontSize:13 }}>
                    <span><strong style={{ color:'var(--ink)' }}>{t.orders}</strong> orders</span>
                    <span style={{ color:'#16A34A',fontWeight:700 }}>✓{t.delivered}</span>
                    {t.cancelled>0 && <span style={{ color:'#DC2626',fontWeight:700 }}>✗{t.cancelled}</span>}
                  </div>
                </div>
                {t.waiter && <div style={{ fontSize:12,color:'#2563EB',marginTop:3 }}>👤 Waiter: {t.waiter}</div>}
              </div>
            ))}
          </div>

          {/* Top dishes */}
          <div style={{ background:'#fff',borderRadius:16,padding:16,marginBottom:16,boxShadow:'var(--shadow)' }}>
            <div style={{ fontWeight:800,fontSize:16,marginBottom:12 }}>Most Ordered Dishes</div>
            {data.itemStats.length===0 ? <div style={{ color:'var(--ink2)',fontSize:13 }}>No data</div>
            : data.itemStats.map((item,i) => (
              <div key={item.name} style={{ display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 0',borderBottom:'1px solid var(--line)' }}>
                <div style={{ display:'flex',alignItems:'center',gap:10 }}>
                  <div style={{ width:24,height:24,borderRadius:'50%',background:i<3?'#E8890C':'var(--bg)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:800,color:i<3?'#fff':'var(--ink2)' }}>{i+1}</div>
                  <span style={{ fontWeight:600,fontSize:14 }}>{item.name}</span>
                </div>
                <div style={{ fontWeight:800,fontSize:16,color:'#E8890C' }}>{item.qty}x</div>
              </div>
            ))}
          </div>

          {/* SOS */}
          <div style={{ background:'#fff',borderRadius:16,padding:16,marginBottom:16,boxShadow:'var(--shadow)' }}>
            <div style={{ fontWeight:800,fontSize:16,marginBottom:12 }}>Service Requests ({data.sos.length})</div>
            {data.sos.length===0 ? <div style={{ color:'var(--ink2)',fontSize:13 }}>No SOS requests</div>
            : data.sos.map((s,i) => (
              <div key={i} style={{ display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:'1px solid var(--line)',fontSize:13 }}>
                <span style={{ fontWeight:600,textTransform:'capitalize' }}>{s.request_type?.replace(/_/g,' ')}</span>
                <span style={{ color:'var(--ink2)' }}>Table {s.tables?.table_number} · {new Date(s.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span>
                <span style={{ fontWeight:700,color:s.status==='resolved'?'#16A34A':s.status==='acknowledged'?'#D97706':'#DC2626' }}>{s.status}</span>
              </div>
            ))}
          </div>

          {/* Feedback */}
          {data.fb.length>0 && (
            <div style={{ background:'#fff',borderRadius:16,padding:16,marginBottom:16,boxShadow:'var(--shadow)' }}>
              <div style={{ fontWeight:800,fontSize:16,marginBottom:12 }}>Guest Feedback ({data.fb.length})</div>
              {data.fb.map((f,i) => (
                <div key={i} style={{ padding:'10px 0',borderBottom:'1px solid var(--line)' }}>
                  <div style={{ display:'flex',justifyContent:'space-between',marginBottom:4 }}>
                    <span style={{ fontWeight:700,fontSize:14 }}>{f.guest_name||'Anonymous'}</span>
                    <span style={{ color:'#E8890C',fontWeight:700 }}>{'⭐'.repeat(f.rating||0)}</span>
                  </div>
                  {f.comment && <div style={{ fontSize:13,color:'var(--ink2)' }}>{f.comment}</div>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
`)
console.log('✅ 3/4 ReportsDashboard — event selector, waiter per table, print PDF')

// ═══════════════════════════════════════════
// FIX 4: WelcomeScreen — load video from correct active event
// ═══════════════════════════════════════════
fs.writeFileSync(BASE + '/components/guest/WelcomeScreen.jsx', `import { useEffect, useRef } from 'react'
export default function WelcomeScreen({ tableNumber, onStart, eventData }) {
  const videoRef = useRef(null)
  useEffect(() => {
    if (videoRef.current && eventData?.video_url) {
      videoRef.current.load()
      videoRef.current.play().catch(()=>{})
    }
  }, [eventData?.video_url])

  return (
    <div style={{ minHeight:'100vh',position:'relative',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',textAlign:'center',padding:'40px 24px',overflow:'hidden' }}>
      {eventData?.video_url
        ? <video ref={videoRef} src={eventData.video_url} autoPlay loop muted playsInline style={{ position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover',zIndex:0 }} />
        : <div style={{ position:'absolute',inset:0,background:'linear-gradient(160deg, #2A1B2E 0%, #4A2340 50%, #8E2A5C 100%)',zIndex:0 }} />
      }
      <div style={{ position:'absolute',inset:0,background:'rgba(0,0,0,0.55)',zIndex:1 }} />
      <div style={{ position:'relative',zIndex:2,color:'#fff' }}>
        <div style={{ fontSize:64,marginBottom:16 }}>🍽️</div>
        <h1 style={{ fontSize:34,fontWeight:800,marginBottom:4,letterSpacing:'-0.02em' }}>
          Janu's <span style={{ color:'#E8890C' }}>Smart Serve</span>
        </h1>
        {eventData?.name && <p style={{ fontSize:15,opacity:0.8,marginBottom:8 }}>{eventData.name}</p>}
        <div style={{ display:'inline-flex',alignItems:'center',gap:8,background:'rgba(255,255,255,0.12)',border:'1px solid rgba(255,255,255,0.25)',borderRadius:999,padding:'10px 24px',margin:'24px 0 36px',fontSize:16,fontWeight:700 }}>
          <span style={{ width:8,height:8,borderRadius:'50%',background:'#4ADE80',display:'inline-block',boxShadow:'0 0 8px #4ADE80' }}></span>
          TABLE {tableNumber}
        </div>
        <p style={{ fontSize:15,opacity:0.7,marginBottom:40,maxWidth:280,lineHeight:1.6,margin:'0 auto 40px' }}>Browse our menu and place your order directly from this tablet</p>
        <button onClick={onStart} style={{ background:'#E8890C',color:'#fff',border:'none',borderRadius:16,padding:'20px 56px',fontSize:19,fontWeight:800,boxShadow:'0 10px 30px rgba(232,137,12,0.5)',display:'block',margin:'0 auto',cursor:'pointer' }}>
          Start Ordering →
        </button>
        <p style={{ marginTop:32,fontSize:12,opacity:0.4 }}>Powered by Janu's Smart Serve · Table {tableNumber}</p>
      </div>
    </div>
  )
}
`)
console.log('✅ 4/4 WelcomeScreen — video reloads when eventData changes')

console.log('\n🎉 All 4 fixes done!')
console.log('Now run the Supabase SQL, then: npm run dev')
