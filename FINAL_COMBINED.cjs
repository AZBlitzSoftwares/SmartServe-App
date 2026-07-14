const fs = require('fs')
const BASE = '/Users/asayyed/SmartServe/src'

// ═══════════════════════════════════════════════════════
// FINAL COMBINED — all remaining fixes in one script
// ═══════════════════════════════════════════════════════

// 1. MenuScreen — category tabs restored + Zomato layout
fs.writeFileSync(BASE + '/components/guest/MenuScreen.jsx', `import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

export default function MenuScreen({ tableNumber, eventData, cart, addToCart, removeFromCart, cartCount, isOnline, onShowSOS, onShowHistory, onShowStatus, currentOrderId, showFeedbackBubble, onFeedbackBubbleClick, onShowFeedback }) {
  const [categories, setCategories] = useState([])
  const [items, setItems] = useState([])
  const [activeCategory, setActiveCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [vegMode, setVegMode] = useState('all')
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (eventData) loadMenu() }, [eventData])

  async function loadMenu() {
    setLoading(true)
    const { data: cats } = await supabase.from('menu_categories').select('*').eq('event_id', eventData.id).eq('is_visible', true).order('sort_order')
    const { data: menuItems } = await supabase.from('menu_items').select('*').eq('is_available', true)
    setCategories(cats || [])
    setItems(menuItems || [])
    setActiveCategory('all')
    setLoading(false)
  }

  const filtered = items.filter(i => {
    const matchSearch = search.length === 0 || i.name.toLowerCase().includes(search.toLowerCase())
    const matchCat = activeCategory === 'all' || i.category_id === activeCategory
    const matchVeg = vegMode === 'all' || (vegMode === 'veg' ? i.is_veg !== false : i.is_veg === false)
    return matchSearch && matchCat && matchVeg
  })

  const getQty = id => cart.find(c => c.id === id)?.quantity || 0

  return (
    <div style={{ minHeight:'100vh', background:'#f5f5f5', display:'flex', flexDirection:'column', paddingBottom: cartCount > 0 ? 100 : 24 }}>

      <div style={{ background:'#1a0a0a', padding:'12px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:40 }}>
        <div style={{ color:'#fff', fontWeight:800, fontSize:17 }}>Janu's <span style={{ color:'#E8890C' }}>Smart Serve</span></div>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          {isOnline === false && <span style={{ background:'#DC2626', color:'#fff', fontSize:10, fontWeight:700, padding:'2px 6px', borderRadius:999 }}>OFFLINE</span>}
          <div style={{ background:'rgba(255,255,255,0.15)', color:'#fff', fontSize:12, fontWeight:700, padding:'5px 12px', borderRadius:999 }}>TABLE {tableNumber}</div>
        </div>
      </div>

      <div style={{ display:'flex', gap:8, padding:'8px 14px', background:'#fff', borderBottom:'1px solid #eee', overflowX:'auto', alignItems:'center' }}>
        {currentOrderId && <button onClick={onShowStatus} style={{ flexShrink:0, background:'#16A34A', color:'#fff', border:'none', borderRadius:999, padding:'6px 14px', fontSize:12, fontWeight:700, cursor:'pointer' }}>📦 Track Order</button>}
        <button onClick={onShowHistory} style={{ flexShrink:0, background:'#fff', color:'#333', border:'1.5px solid #ddd', borderRadius:999, padding:'6px 14px', fontSize:12, fontWeight:600, cursor:'pointer' }}>📋 History</button>
        <button onClick={onShowSOS} style={{ flexShrink:0, background:'#FEF3C7', color:'#92400E', border:'1.5px solid #FCD34D', borderRadius:999, padding:'6px 14px', fontSize:12, fontWeight:700, cursor:'pointer' }}>🆘 Need Help?</button>
        <button onClick={onShowFeedback} style={{ flexShrink:0, background:'#FFF7ED', color:'#C2410C', border:'1.5px solid #FED7AA', borderRadius:999, padding:'6px 14px', fontSize:12, fontWeight:700, cursor:'pointer' }}>⭐ Feedback</button>
      </div>

      <div style={{ padding:'8px 14px', background:'#fff', borderBottom:'1px solid #eee' }}>
        <div style={{ background:'#f5f5f5', borderRadius:12, padding:'8px 14px', display:'flex', alignItems:'center', gap:8, border:'1.5px solid #eee' }}>
          <span>🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search dishes..."
            style={{ border:'none', outline:'none', flex:1, fontSize:14, fontFamily:'Manrope', background:'transparent' }} />
          {search.length > 0 && <button onClick={() => setSearch('')} style={{ background:'none', border:'none', fontSize:16, color:'#999', cursor:'pointer' }}>✕</button>}
        </div>
      </div>

      <div style={{ display:'flex', gap:8, padding:'8px 14px', background:'#fff', borderBottom:'1px solid #eee', overflowX:'auto' }}>
        {[['all','🍽️ All'],['veg','🟢 Veg Only'],['nonveg','🔴 Non-Veg Only']].map(([val,label]) => (
          <button key={val} onClick={() => setVegMode(val)} style={{
            flexShrink:0, padding:'5px 14px', borderRadius:999, fontSize:12, fontWeight:700, border:'1.5px solid', cursor:'pointer',
            background: vegMode===val ? (val==='veg'?'#16A34A':val==='nonveg'?'#DC2626':'#1a0a0a') : '#fff',
            color: vegMode===val ? '#fff' : '#555', borderColor: vegMode===val ? 'transparent' : '#ddd'
          }}>{label}</button>
        ))}
      </div>

      {search.length === 0 && (
        <div style={{ display:'flex', background:'#fff', borderBottom:'2px solid #f0f0f0', overflowX:'auto', scrollbarWidth:'none' }}>
          {[{ id:'all', name:'All', count:items.length }, ...categories.map(c => ({ id:c.id, name:c.name, count:items.filter(i=>i.category_id===c.id).length }))].map(cat => (
            <button key={cat.id} onClick={() => setActiveCategory(cat.id)} style={{
              flexShrink:0, padding:'10px 16px', border:'none', background:'transparent', cursor:'pointer',
              borderBottom: activeCategory===cat.id ? '3px solid #E8890C' : '3px solid transparent',
              color: activeCategory===cat.id ? '#E8890C' : '#666',
              fontWeight: activeCategory===cat.id ? 800 : 500, fontSize:13, whiteSpace:'nowrap',
              marginBottom:'-2px', fontFamily:'Manrope'
            }}>
              {cat.name} <span style={{ fontSize:11, opacity:0.7 }}>({cat.count})</span>
            </button>
          ))}
        </div>
      )}

      <div style={{ flex:1 }}>
        {loading ? (
          <div style={{ textAlign:'center', padding:60, color:'#888' }}>Loading menu...</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign:'center', padding:60 }}>
            <div style={{ fontSize:40, marginBottom:12 }}>🔍</div>
            <div style={{ fontWeight:600, color:'#888' }}>No dishes found</div>
          </div>
        ) : filtered.map(item => {
          const qty = getQty(item.id)
          const isVeg = item.is_veg !== false
          return (
            <div key={item.id} style={{ background:'#fff', borderBottom:'1px solid #f0f0f0', padding:'14px', display:'flex', gap:12, alignItems:'flex-start' }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ marginBottom:4, display:'flex', alignItems:'center', gap:8 }}>
                  <span style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:16, height:16, borderRadius:3, border:'1.5px solid '+(isVeg?'#16A34A':'#DC2626'), flexShrink:0 }}>
                    <span style={{ width:8, height:8, borderRadius:'50%', background:isVeg?'#16A34A':'#DC2626', display:'block' }}></span>
                  </span>
                  {item.is_live_counter && <span style={{ fontSize:10, color:'#D97706', fontWeight:700, background:'#FEF3C7', padding:'1px 6px', borderRadius:999 }}>⏱ Live counter</span>}
                </div>
                <div style={{ fontWeight:700, fontSize:15, color:'#1a1a1a', marginBottom:3 }}>{item.name}</div>
                {item.description && <div style={{ fontSize:12, color:'#888', lineHeight:1.5, marginBottom:10, display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>{item.description}</div>}
                {qty === 0 ? (
                  <button onClick={() => addToCart(item)} style={{ background:'#fff', color:'#E8890C', border:'1.5px solid #E8890C', borderRadius:8, padding:'6px 22px', fontSize:13, fontWeight:800, cursor:'pointer' }}>ADD +</button>
                ) : (
                  <div style={{ display:'inline-flex', alignItems:'center', background:'#E8890C', borderRadius:8, overflow:'hidden' }}>
                    <button onClick={() => removeFromCart(item.id)} style={{ background:'none', border:'none', color:'#fff', fontSize:18, fontWeight:800, cursor:'pointer', padding:'5px 12px', lineHeight:1 }}>−</button>
                    <span style={{ color:'#fff', fontWeight:800, fontSize:14, minWidth:20, textAlign:'center' }}>{qty}</span>
                    <button onClick={() => addToCart(item)} style={{ background:'none', border:'none', color:'#fff', fontSize:18, fontWeight:800, cursor:'pointer', padding:'5px 12px', lineHeight:1 }}>+</button>
                  </div>
                )}
              </div>
              <div style={{ flexShrink:0, width:100, height:85, borderRadius:10, overflow:'hidden' }}>
                {item.photo_url
                  ? <img src={item.photo_url} alt={item.name} style={{ width:'100%', height:'100%', objectFit:'cover' }} onError={e=>e.target.style.display='none'} />
                  : <div style={{ width:'100%', height:'100%', background:'linear-gradient(135deg,#F7F4FB,#E8E0F0)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:32 }}>🍽️</div>
                }
              </div>
            </div>
          )
        })}
      </div>

      {showFeedbackBubble && (
        <>
          <style>{\`@keyframes fbP{0%,100%{transform:scale(1) translateY(0)}40%{transform:scale(1.1) translateY(-14px)}70%{transform:scale(1.05) translateY(-7px)}}.fbb{animation:fbP 1.8s ease-in-out infinite}\`}</style>
          <button className="fbb" onClick={onFeedbackBubbleClick} style={{ position:'fixed', bottom:cartCount>0?90:28, right:16, zIndex:80, background:'#E8890C', border:'3px solid #fff', borderRadius:50, padding:'14px 18px', display:'flex', flexDirection:'column', alignItems:'center', gap:3, cursor:'pointer', boxShadow:'0 8px 28px rgba(232,137,12,0.6)', color:'#fff', minWidth:76 }}>
            <span style={{ fontSize:28 }}>⭐</span>
            <span style={{ fontSize:10, fontWeight:800, whiteSpace:'nowrap' }}>Rate Us!</span>
          </button>
        </>
      )}
    </div>
  )
}
`)
console.log('✅ 1/3 MenuScreen — categories + Zomato layout')

// 2. FeedbackModal — thank you screen → auto-return
fs.writeFileSync(BASE + '/components/guest/FeedbackModal.jsx', `import { useState } from 'react'
import { supabase } from '../../lib/supabase'

export default function FeedbackModal({ orderId, tableData, eventData, onClose }) {
  const [rating, setRating] = useState(0)
  const [hoverRating, setHoverRating] = useState(0)
  const [food, setFood] = useState(0); const [hf, setHf] = useState(0)
  const [service, setService] = useState(0); const [hs, setHs] = useState(0)
  const [presentation, setPresentation] = useState(0); const [hp, setHp] = useState(0)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [mobile, setMobile] = useState('')
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [errors, setErrors] = useState({})

  const MOOD = { 5:'Excellent! 🎉', 4:'Great! 😊', 3:'Good 👍', 2:'Could be better 😐', 1:'Poor 😞' }
  const MOOD_COLOR = { 5:'#16A34A', 4:'#16A34A', 3:'#D97706', 2:'#D97706', 1:'#DC2626' }

  function Stars({ value, hover, onSet, onHover, size=36 }) {
    return (
      <div style={{ display:'flex', gap:6 }}>
        {[1,2,3,4,5].map(s => (
          <button key={s} onClick={() => onSet(s)} onMouseEnter={() => onHover(s)} onMouseLeave={() => onHover(0)}
            style={{ background:'none', border:'none', fontSize:size, cursor:'pointer', transition:'transform 0.15s', transform:(hover||value)>=s?'scale(1.2)':'scale(1)', filter:(hover||value)>=s?'none':'grayscale(1) opacity(0.3)', padding:0 }}>⭐</button>
        ))}
      </div>
    )
  }

  async function submit() {
    if (!rating) { setErrors({ rating:'Please select a rating' }); return }
    setSubmitting(true)
    await supabase.from('feedback').insert({
      order_id:orderId, event_id:eventData?.id||null, table_id:tableData?.id||null,
      rating, food_rating:food||null, service_rating:service||null, presentation_rating:presentation||null,
      guest_name:name.trim()||null, guest_email:email.trim()||null, guest_mobile:mobile.trim()||null,
      comment:comment.trim()||null
    })
    setSubmitted(true)
    setTimeout(() => onClose(), 3500)
  }

  if (submitted) return (
    <div style={{ position:'fixed', inset:0, background:'linear-gradient(160deg,#2A1B2E,#4A2340,#8E2A5C)', zIndex:100, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:24, textAlign:'center' }}>
      <div style={{ fontSize:80, marginBottom:20 }}>🙏</div>
      <h2 style={{ color:'#fff', fontSize:28, fontWeight:800, marginBottom:12 }}>Thank You!</h2>
      <p style={{ color:'rgba(255,255,255,0.75)', fontSize:16, lineHeight:1.6, maxWidth:280, marginBottom:16 }}>Your feedback means a lot to us. We hope you had a wonderful experience!</p>
      <div style={{ display:'flex', gap:2, marginBottom:24 }}>
        {[...Array(rating)].map((_,i) => <span key={i} style={{ fontSize:36 }}>⭐</span>)}
      </div>
      <p style={{ color:'rgba(255,255,255,0.4)', fontSize:13 }}>Returning to home screen...</p>
    </div>
  )

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', zIndex:100, display:'flex', alignItems:'flex-end', justifyContent:'center' }}>
      <div style={{ background:'#fff', borderRadius:'24px 24px 0 0', padding:'24px 24px 48px', width:'100%', maxWidth:500, maxHeight:'92vh', overflowY:'auto' }}>
        <div style={{ width:40, height:4, background:'#E8E0F0', borderRadius:999, margin:'0 auto 20px' }}></div>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
          <h3 style={{ fontSize:20, fontWeight:800 }}>Share Your Experience</h3>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:22, color:'#999', cursor:'pointer' }}>✕</button>
        </div>
        <p style={{ fontSize:13, color:'#888', marginBottom:20 }}>Your feedback helps us serve you better</p>

        <div style={{ marginBottom:20 }}>
          <div style={{ fontWeight:700, fontSize:14, marginBottom:10 }}>Overall Rating *</div>
          <Stars value={rating} hover={hoverRating} onSet={setRating} onHover={setHoverRating} size={40} />
          {rating > 0 && <div style={{ marginTop:8, fontSize:14, fontWeight:700, color:MOOD_COLOR[rating] }}>{MOOD[rating]}</div>}
          {errors.rating && <div style={{ color:'#DC2626', fontSize:12, marginTop:4 }}>{errors.rating}</div>}
        </div>

        <div style={{ background:'#f9f9f9', borderRadius:14, padding:14, marginBottom:20 }}>
          <div style={{ fontWeight:700, fontSize:14, marginBottom:12 }}>Rate by Category</div>
          {[['Food Quality',food,hf,setFood,setHf],['Service Speed',service,hs,setService,setHs],['Presentation',presentation,hp,setPresentation,setHp]].map(([label,val,hov,setVal,setHov]) => (
            <div key={label} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 0', borderBottom:'1px solid #eee' }}>
              <span style={{ fontSize:13, fontWeight:600 }}>{label}</span>
              <Stars value={val} hover={hov} onSet={setVal} onHover={setHov} size={22} />
            </div>
          ))}
        </div>

        <div style={{ marginBottom:16 }}>
          <div style={{ fontWeight:700, fontSize:14, marginBottom:10 }}>Your Details (optional)</div>
          {[['name','Your name','text',name,setName],['email','Email address','email',email,setEmail],['mobile','Mobile number','tel',mobile,setMobile]].map(([key,ph,type,val,set]) => (
            <input key={key} value={val} onChange={e=>set(e.target.value)} placeholder={ph} type={type}
              style={{ width:'100%', border:'1.5px solid #ddd', borderRadius:10, padding:'10px 14px', fontSize:14, fontFamily:'Manrope', outline:'none', boxSizing:'border-box', marginBottom:8 }} />
          ))}
        </div>

        <div style={{ marginBottom:24 }}>
          <div style={{ fontWeight:700, fontSize:14, marginBottom:10 }}>Comments</div>
          <textarea value={comment} onChange={e=>setComment(e.target.value)} placeholder="Tell us about your experience..."
            style={{ width:'100%', border:'1.5px solid #ddd', borderRadius:12, padding:'12px 16px', fontSize:14, fontFamily:'Manrope', outline:'none', resize:'none', height:80, boxSizing:'border-box' }} />
        </div>

        <div style={{ display:'flex', gap:10 }}>
          <button onClick={onClose} style={{ flex:1, background:'#f5f5f5', border:'none', borderRadius:14, padding:'16px', fontSize:15, fontWeight:700, color:'#888' }}>Skip</button>
          <button onClick={submit} disabled={submitting} style={{ flex:2, background:submitting?'#999':'#1a0a0a', color:'#E8890C', border:'none', borderRadius:14, padding:'16px', fontSize:15, fontWeight:800, cursor:submitting?'wait':'pointer' }}>
            {submitting?'Submitting...':'Submit Feedback →'}
          </button>
        </div>
      </div>
    </div>
  )
}
`)
console.log('✅ 2/3 FeedbackModal — thank you screen + auto-return to home')

// 3. EventManager — remove the "multiple active events" warning, keep everything else clean
fs.writeFileSync(BASE + '/components/supervisor/EventManager.jsx', `import { useState, useEffect } from 'react'
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
          <input value={newSup.pin} onChange={e=>setNewSup(p=>({...p,pin:e.target.value.replace(/\\D/g,'').slice(0,6)}))} placeholder="PIN * 4-6 digits (becomes password)" style={{ ...INP, letterSpacing:'0.2em' }} />
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
`)
console.log('✅ 3/3 EventManager — no warning banner, clean UI')
console.log('\n🎉 ALL DONE — now push to GitHub')
