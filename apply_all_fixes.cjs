const fs = require('fs')
const path = require('path')

const BASE = '/Users/asayyed/SmartServe/src'

const files = {}

// ─────────────────────────────────────────────────────────────
// FIX 2: MenuScreen — Add "All" tab + fix category filtering
// ─────────────────────────────────────────────────────────────
files[BASE + '/components/guest/MenuScreen.jsx'] = `import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

export default function MenuScreen({ tableNumber, eventData, cart, addToCart, removeFromCart, cartCount, isOnline, onShowSOS, onShowHistory, onShowStatus, currentOrderId }) {
  const [categories, setCategories] = useState([])
  const [items, setItems] = useState([])
  const [activeCategory, setActiveCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (eventData) loadMenu() }, [eventData])

  async function loadMenu() {
    setLoading(true)
    const { data: cats } = await supabase
      .from('menu_categories').select('*')
      .eq('event_id', eventData.id).eq('is_visible', true).order('sort_order')
    const { data: menuItems } = await supabase
      .from('menu_items').select('*').eq('is_available', true)
    setCategories(cats || [])
    setItems(menuItems || [])
    setActiveCategory('all')
    setLoading(false)
  }

  const filtered = items.filter(i => {
    if (search.length > 0) return i.name.toLowerCase().includes(search.toLowerCase())
    if (activeCategory === 'all') return true
    return i.category_id === activeCategory
  })

  const getQty = (id) => cart.find(c => c.id === id)?.quantity || 0

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', paddingBottom: cartCount > 0 ? 100 : 24 }}>

      {/* Header */}
      <div style={{ background:'var(--ink)', padding:'12px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:40 }}>
        <div style={{ color:'#fff', fontWeight:800, fontSize:17 }}>Janu's <span style={{ color:'#E8890C' }}>Smart Serve</span></div>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          {isOnline === false && <span style={{ background:'#DC2626', color:'#fff', fontSize:10, fontWeight:700, padding:'2px 6px', borderRadius:999 }}>OFFLINE</span>}
          <div style={{ background:'rgba(255,255,255,0.15)', color:'#fff', fontSize:12, fontWeight:700, padding:'5px 12px', borderRadius:999 }}>TABLE {tableNumber}</div>
        </div>
      </div>

      {/* Action bar */}
      <div style={{ display:'flex', gap:8, padding:'10px 14px', overflowX:'auto' }}>
        {currentOrderId && (
          <button onClick={onShowStatus} style={{ flexShrink:0, background:'#16A34A', color:'#fff', border:'none', borderRadius:999, padding:'7px 14px', fontSize:12, fontWeight:700, cursor:'pointer' }}>
            📦 Track Order
          </button>
        )}
        <button onClick={onShowHistory} style={{ flexShrink:0, background:'#fff', color:'var(--ink)', border:'1.5px solid var(--line)', borderRadius:999, padding:'7px 14px', fontSize:12, fontWeight:600, cursor:'pointer' }}>
          📋 History
        </button>
        <button onClick={onShowSOS} style={{ flexShrink:0, background:'#FEF3C7', color:'#92400E', border:'1.5px solid #FCD34D', borderRadius:999, padding:'7px 14px', fontSize:12, fontWeight:700, cursor:'pointer' }}>
          🆘 Need Help?
        </button>
      </div>

      {/* Search bar */}
      <div style={{ padding:'0 14px 10px' }}>
        <div style={{ background:'#fff', borderRadius:12, padding:'9px 14px', display:'flex', alignItems:'center', gap:8, border:'1.5px solid var(--line)', boxShadow:'0 2px 8px rgba(0,0,0,0.06)' }}>
          <span style={{ fontSize:16 }}>🔍</span>
          <input
            value={search}
            onChange={e => { setSearch(e.target.value) }}
            placeholder="Search dishes..."
            style={{ border:'none', outline:'none', flex:1, fontSize:14, fontFamily:'Manrope', background:'transparent' }}
          />
          {search.length > 0 && (
            <button onClick={() => setSearch('')}
              style={{ background:'none', border:'none', fontSize:16, color:'#999', cursor:'pointer' }}>✕</button>
          )}
        </div>
      </div>

      {/* Category tabs — always visible when not searching */}
      {search.length === 0 && (
        <div style={{ display:'flex', gap:8, padding:'0 14px 14px', overflowX:'auto', scrollbarWidth:'none' }}>
          {/* ALL tab */}
          <button
            onClick={() => setActiveCategory('all')}
            style={{
              flexShrink:0,
              background: activeCategory === 'all' ? 'var(--ink)' : '#fff',
              color: activeCategory === 'all' ? '#fff' : 'var(--ink)',
              border: '1.5px solid',
              borderColor: activeCategory === 'all' ? 'var(--ink)' : 'var(--line)',
              borderRadius:999, padding:'7px 18px', fontSize:13, fontWeight:700,
              whiteSpace:'nowrap', cursor:'pointer', transition:'all 0.15s'
            }}>
            All ({items.length})
          </button>
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              style={{
                flexShrink:0,
                background: activeCategory === cat.id ? 'var(--ink)' : '#fff',
                color: activeCategory === cat.id ? '#fff' : 'var(--ink)',
                border: '1.5px solid',
                borderColor: activeCategory === cat.id ? 'var(--ink)' : 'var(--line)',
                borderRadius:999, padding:'7px 18px', fontSize:13, fontWeight:700,
                whiteSpace:'nowrap', cursor:'pointer', transition:'all 0.15s'
              }}>
              {cat.name} ({items.filter(i => i.category_id === cat.id).length})
            </button>
          ))}
        </div>
      )}

      {/* Items */}
      {loading ? (
        <div style={{ textAlign:'center', padding:60, color:'var(--ink2)' }}>Loading menu...</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign:'center', padding:60 }}>
          <div style={{ fontSize:40, marginBottom:12 }}>🔍</div>
          <div style={{ fontWeight:600, color:'var(--ink2)' }}>No dishes found</div>
        </div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(155px, 1fr))', gap:12, padding:'0 14px' }}>
          {filtered.map(item => {
            const qty = getQty(item.id)
            return (
              <div key={item.id} style={{ background:'#fff', borderRadius:16, overflow:'hidden', boxShadow:'var(--shadow)' }}>
                <div style={{
                  height:120,
                  background: item.photo_url
                    ? 'url(' + item.photo_url + ') center/cover no-repeat'
                    : 'linear-gradient(135deg,#F7F4FB,#E8E0F0)',
                  display:'flex', alignItems:'center', justifyContent:'center', fontSize:40
                }}>
                  {item.photo_url ? null : '🍽️'}
                </div>
                <div style={{ padding:'10px 10px 12px' }}>
                  <div style={{ fontWeight:700, fontSize:13, marginBottom:3, lineHeight:1.3 }}>{item.name}</div>
                  {item.description && (
                    <div style={{ fontSize:11, color:'var(--ink2)', marginBottom:8, lineHeight:1.4,
                      display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>
                      {item.description}
                    </div>
                  )}
                  {item.is_live_counter && (
                    <div style={{ fontSize:10, color:'#D97706', fontWeight:600, marginBottom:6 }}>⏱ Live counter</div>
                  )}
                  {qty === 0 ? (
                    <button onClick={() => addToCart(item)}
                      style={{ width:'100%', background:'var(--ink)', color:'#fff', border:'none', borderRadius:8, padding:'8px 0', fontSize:13, fontWeight:800, cursor:'pointer' }}>
                      + Add
                    </button>
                  ) : (
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', background:'var(--ink)', borderRadius:8, padding:'5px 10px' }}>
                      <button onClick={() => removeFromCart(item.id)} style={{ background:'none', border:'none', color:'#fff', fontSize:18, fontWeight:800, cursor:'pointer', lineHeight:1 }}>−</button>
                      <span style={{ color:'#fff', fontWeight:800, fontSize:14 }}>{qty}</span>
                      <button onClick={() => addToCart(item)} style={{ background:'none', border:'none', color:'#fff', fontSize:18, fontWeight:800, cursor:'pointer', lineHeight:1 }}>+</button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
`

// ─────────────────────────────────────────────────────────────
// FIX 3: KOTDashboard — printKOT with event name + app name
// ─────────────────────────────────────────────────────────────
files[BASE + '/components/supervisor/KOTDashboard.jsx'] = `import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

const STATUS_FLOW = { pending: 'in_preparation', in_preparation: 'ready', ready: 'delivered' }
const STATUS_LABELS = { pending: 'Placed', in_preparation: 'In Preparation', ready: 'Ready', delivered: 'Delivered', cancelled: 'Cancelled' }
const STATUS_COLORS = { pending: '#D97706', in_preparation: '#2563EB', ready: '#7C3AED', delivered: '#16A34A', cancelled: '#DC2626' }
const STATUS_NEXT_LABEL = { pending: 'Mark In Preparation', in_preparation: 'Mark Ready', ready: 'Mark Delivered' }

export default function KOTDashboard({ eventData, onOrderCountChange }) {
  const [orders, setOrders] = useState([])
  const [filter, setFilter] = useState('active')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!eventData) return
    loadOrders(true)
    const interval = setInterval(() => loadOrders(false), 4000)
    return () => clearInterval(interval)
  }, [eventData])

  async function loadOrders(showSpinner = false) {
    if (!eventData) return
    if (showSpinner) setLoading(true)
    const { data } = await supabase.from('orders').select('*, tables(table_number), order_items(quantity, menu_items(name, is_live_counter))').eq('event_id', eventData.id).order('created_at', { ascending: false })
    const all = data || []
    setOrders(all)
    onOrderCountChange(all.filter(o => !['delivered','cancelled'].includes(o.status)).length)
    if (showSpinner) setLoading(false)
  }

  async function updateStatus(order) {
    const next = STATUS_FLOW[order.status]
    if (!next) return
    const { error } = await supabase.from('orders').update({ status: next }).eq('id', order.id)
    if (error) { alert('Update failed: ' + error.message); return }
    loadOrders(false)
  }

  async function cancelOrder(id) {
    if (!confirm('Cancel this order?')) return
    await supabase.from('orders').update({ status: 'cancelled', cancelled_at: new Date().toISOString() }).eq('id', id)
    loadOrders()
  }

  function printKOT(order) {
    const eventName = eventData?.name || 'Event'
    const tableNum = order.tables?.table_number || '?'
    const orderId = '#' + order.id.slice(-6).toUpperCase()
    const now = new Date(order.created_at)
    const dateStr = now.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })
    const timeStr = now.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', hour12:true })
    const items = order.order_items?.map(i => '  - ' + i.menu_items?.name + ' x' + i.quantity + (i.menu_items?.is_live_counter ? ' [Live]' : '')).join('\\n') || ''

    const w = window.open('', '_blank', 'width=320,height=500')
    w.document.write(\`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>KOT \${orderId}</title>
<style>
  body { font-family: 'Courier New', monospace; font-size: 13px; padding: 16px; width: 280px; margin: 0 auto; color: #000; }
  .center { text-align: center; }
  .bold { font-weight: bold; }
  .divider { border-top: 1px dashed #000; margin: 8px 0; }
  .app { font-size: 15px; font-weight: bold; text-align: center; text-transform: uppercase; letter-spacing: 1px; }
  .event { font-size: 12px; text-align: center; margin-bottom: 6px; font-weight: bold; }
  .table-num { font-size: 26px; font-weight: 900; text-align: center; border: 2px solid #000; padding: 6px; margin: 8px 0; letter-spacing: 3px; }
  .row { display: flex; justify-content: space-between; font-size: 12px; margin: 2px 0; }
  .item { font-size: 13px; padding: 3px 0; }
  .status { text-align: center; border: 1px solid #000; padding: 5px; font-weight: bold; text-transform: uppercase; font-size: 12px; margin-top: 8px; letter-spacing: 1px; }
  .footer { text-align: center; font-size: 10px; color: #666; margin-top: 10px; }
</style>
</head><body>
<div class="app">Janu's Smart Serve</div>
<div class="event">\${eventName}</div>
<div class="divider"></div>
<div class="row"><span>Date:</span><span>\${dateStr}</span></div>
<div class="row"><span>Time:</span><span>\${timeStr}</span></div>
<div class="row"><span>Order:</span><span>\${orderId}</span></div>
<div class="divider"></div>
<div class="table-num">TABLE \${tableNum}</div>
<div class="divider"></div>
\${(order.order_items || []).map(i => \`<div class="item">• \${i.menu_items?.name} x\${i.quantity}\${i.menu_items?.is_live_counter ? ' <em>[Live]</em>' : ''}</div>\`).join('')}
<div class="divider"></div>
<div class="status">Status: \${STATUS_LABELS[order.status] || order.status}</div>
<div class="footer">Powered by Janu's Smart Serve</div>
</body></html>\`)
    w.document.close(); w.focus(); setTimeout(() => { w.print(); w.close() }, 300)
  }

  const filtered = orders.filter(o => {
    if (filter === 'active') return !['delivered','cancelled'].includes(o.status)
    if (filter === 'delivered') return o.status === 'delivered'
    return true
  })

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 800 }}>Live Orders</h2>
        <button onClick={loadOrders} style={{ background: 'var(--ink)', color: '#fff', border: 'none', borderRadius: 10, padding: '8px 16px', fontSize: 13, fontWeight: 700 }}>Refresh</button>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[['active','Active'],['delivered','Delivered'],['all','All']].map(([val, label]) => (
          <button key={val} onClick={() => setFilter(val)} style={{ flex: 1, padding: '8px 4px', background: filter === val ? 'var(--ink)' : '#fff', color: filter === val ? '#fff' : 'var(--ink)', border: '1.5px solid', borderColor: filter === val ? 'var(--ink)' : 'var(--line)', borderRadius: 10, fontSize: 13, fontWeight: 700 }}>{label}</button>
        ))}
      </div>
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--ink2)' }}>Loading orders...</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📭</div>
          <div style={{ color: 'var(--ink2)', fontWeight: 600 }}>No orders yet</div>
          <div style={{ color: 'var(--ink2)', fontSize: 13, marginTop: 4 }}>Orders from guests will appear here instantly</div>
        </div>
      ) : filtered.map(order => (
        <div key={order.id} style={{ background: '#fff', borderRadius: 18, padding: 18, marginBottom: 14, boxShadow: 'var(--shadow)', borderLeft: '4px solid ' + (STATUS_COLORS[order.status] || '#999') }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 800 }}>Table {order.tables?.table_number}</div>
              <div style={{ fontSize: 12, color: 'var(--ink2)', marginTop: 2 }}>{new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · #{order.id.slice(-6).toUpperCase()}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
              <div style={{ background: (STATUS_COLORS[order.status] || '#999') + '20', color: STATUS_COLORS[order.status] || '#999', fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 999 }}>{STATUS_LABELS[order.status]}</div>
              <button onClick={() => printKOT(order)} style={{ background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 8, padding: '4px 10px', fontSize: 12, fontWeight: 600, color: 'var(--ink2)' }}>🖨 Print KOT</button>
            </div>
          </div>
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12, marginBottom: 12 }}>
            {order.order_items?.map((oi, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 14 }}>
                <span style={{ fontWeight: 600 }}>{oi.menu_items?.name} {oi.menu_items?.is_live_counter && <span style={{ fontSize: 11, color: '#D97706' }}>Live</span>}</span>
                <span style={{ fontWeight: 800, color: 'var(--ink2)' }}>x{oi.quantity}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {STATUS_FLOW[order.status] && (
              <button onClick={() => updateStatus(order)} style={{ flex: 1, background: 'var(--ink)', color: '#fff', border: 'none', borderRadius: 12, padding: '12px 8px', fontSize: 14, fontWeight: 800 }}>{STATUS_NEXT_LABEL[order.status]} →</button>
            )}
            {['pending','in_preparation'].includes(order.status) && (
              <button onClick={() => cancelOrder(order.id)} style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#DC2626', borderRadius: 12, padding: '12px 14px', fontSize: 13, fontWeight: 700 }}>Cancel</button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
`

// ─────────────────────────────────────────────────────────────
// FIX 4: FeedbackModal — delayed, professional, more fields
// ─────────────────────────────────────────────────────────────
files[BASE + '/components/guest/FeedbackModal.jsx'] = `import { useState } from 'react'
import { supabase } from '../../lib/supabase'

export default function FeedbackModal({ orderId, onClose }) {
  const [step, setStep] = useState('rating')
  const [rating, setRating] = useState(0)
  const [hover, setHover] = useState(0)
  const [food, setFood] = useState(0)
  const [hoverFood, setHoverFood] = useState(0)
  const [service, setService] = useState(0)
  const [hoverService, setHoverService] = useState(0)
  const [presentation, setPresentation] = useState(0)
  const [hoverPresentation, setHoverPresentation] = useState(0)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [mobile, setMobile] = useState('')
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [errors, setErrors] = useState({})

  function StarRow({ value, hoverVal, setVal, setHover, size = 36 }) {
    return (
      <div style={{ display:'flex', gap:6 }}>
        {[1,2,3,4,5].map(s => (
          <button key={s} onClick={() => setVal(s)} onMouseEnter={() => setHover(s)} onMouseLeave={() => setHover(0)}
            style={{ background:'none', border:'none', fontSize:size, cursor:'pointer', transition:'transform 0.15s',
              transform:(hoverVal||value)>=s?'scale(1.2)':'scale(1)',
              filter:(hoverVal||value)>=s?'none':'grayscale(1) opacity(0.3)', padding:0 }}>⭐</button>
        ))}
      </div>
    )
  }

  const MOOD = { 5:'Excellent! 🎉', 4:'Great! 😊', 3:'Good 👍', 2:'Could be better 😐', 1:'Poor 😞' }
  const MOOD_COLOR = { 5:'#16A34A', 4:'#16A34A', 3:'#D97706', 2:'#D97706', 1:'#DC2626' }

  async function submit() {
    const e = {}
    if (!name.trim()) e.name = 'Please enter your name'
    if (!email.trim()) e.email = 'Please enter your email'
    else if (!/\\S+@\\S+\\.\\S+/.test(email)) e.email = 'Invalid email address'
    if (!rating) e.rating = 'Please select an overall rating'
    if (Object.keys(e).length) { setErrors(e); return }
    setSubmitting(true)
    await supabase.from('feedback').insert({
      order_id: orderId,
      rating,
      food_rating: food || null,
      service_rating: service || null,
      presentation_rating: presentation || null,
      guest_name: name.trim(),
      guest_email: email.trim(),
      guest_mobile: mobile.trim() || null,
      comment: comment.trim() || null
    })
    setSubmitted(true)
    setTimeout(onClose, 3000)
  }

  if (submitted) return (
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',zIndex:100,display:'flex',alignItems:'center',justifyContent:'center',padding:24 }}>
      <div style={{ background:'#fff',borderRadius:24,padding:'48px 32px',textAlign:'center',maxWidth:320,width:'100%' }}>
        <div style={{ fontSize:64,marginBottom:16 }}>🎉</div>
        <div style={{ fontSize:22,fontWeight:800,marginBottom:8 }}>Thank You!</div>
        <div style={{ fontSize:14,color:'var(--ink2)' }}>Your feedback means a lot to us</div>
      </div>
    </div>
  )

  return (
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',zIndex:100,display:'flex',alignItems:'flex-end',justifyContent:'center' }}>
      <div style={{ background:'#fff',borderRadius:'24px 24px 0 0',padding:'28px 24px 48px',width:'100%',maxWidth:500,maxHeight:'90vh',overflowY:'auto' }}>
        <div style={{ width:40,height:4,background:'#E8E0F0',borderRadius:999,margin:'0 auto 20px' }}></div>

        <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4 }}>
          <h3 style={{ fontSize:20,fontWeight:800 }}>Share Your Experience</h3>
          <button onClick={onClose} style={{ background:'none',border:'none',fontSize:22,color:'#999',cursor:'pointer' }}>✕</button>
        </div>
        <p style={{ fontSize:13,color:'var(--ink2)',marginBottom:24 }}>Your feedback helps us serve you better</p>

        {/* Overall rating */}
        <div style={{ marginBottom:20 }}>
          <div style={{ fontWeight:700,fontSize:14,marginBottom:10 }}>Overall Rating *</div>
          <StarRow value={rating} hoverVal={hover} setVal={setRating} setHover={setHover} size={40} />
          {rating > 0 && <div style={{ marginTop:8,fontSize:14,fontWeight:700,color:MOOD_COLOR[rating] }}>{MOOD[rating]}</div>}
          {errors.rating && <div style={{ color:'#DC2626',fontSize:12,marginTop:4 }}>{errors.rating}</div>}
        </div>

        {/* Category ratings */}
        <div style={{ background:'var(--bg)',borderRadius:14,padding:16,marginBottom:20 }}>
          <div style={{ fontWeight:700,fontSize:14,marginBottom:12 }}>Rate by Category</div>
          {[
            { label:'Food Quality', val:food, hov:hoverFood, setVal:setFood, setHov:setHoverFood },
            { label:'Service Speed', val:service, hov:hoverService, setVal:setService, setHov:setHoverService },
            { label:'Presentation', val:presentation, hov:hoverPresentation, setVal:setPresentation, setHov:setHoverPresentation },
          ].map(c => (
            <div key={c.label} style={{ display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:'1px solid var(--line)' }}>
              <span style={{ fontSize:13,fontWeight:600,color:'var(--ink)' }}>{c.label}</span>
              <StarRow value={c.val} hoverVal={c.hov} setVal={c.setVal} setHover={c.setHov} size={22} />
            </div>
          ))}
        </div>

        {/* Personal details */}
        <div style={{ marginBottom:16 }}>
          <div style={{ fontWeight:700,fontSize:14,marginBottom:10 }}>Your Details</div>
          <input value={name} onChange={e => { setName(e.target.value); setErrors(p=>({...p,name:null})) }} placeholder="Full Name *"
            style={{ width:'100%',border:'1.5px solid '+(errors.name?'#DC2626':'var(--line)'),borderRadius:10,padding:'11px 14px',fontSize:14,fontFamily:'Manrope',outline:'none',boxSizing:'border-box',marginBottom:4 }} />
          {errors.name && <div style={{ color:'#DC2626',fontSize:12,marginBottom:8 }}>{errors.name}</div>}
          <input value={email} onChange={e => { setEmail(e.target.value); setErrors(p=>({...p,email:null})) }} placeholder="Email Address *" type="email"
            style={{ width:'100%',border:'1.5px solid '+(errors.email?'#DC2626':'var(--line)'),borderRadius:10,padding:'11px 14px',fontSize:14,fontFamily:'Manrope',outline:'none',boxSizing:'border-box',marginBottom:4,marginTop:8 }} />
          {errors.email && <div style={{ color:'#DC2626',fontSize:12,marginBottom:8 }}>{errors.email}</div>}
          <input value={mobile} onChange={e => setMobile(e.target.value)} placeholder="Mobile Number (Optional)" type="tel"
            style={{ width:'100%',border:'1.5px solid var(--line)',borderRadius:10,padding:'11px 14px',fontSize:14,fontFamily:'Manrope',outline:'none',boxSizing:'border-box',marginTop:8 }} />
        </div>

        {/* Comment */}
        <div style={{ marginBottom:24 }}>
          <div style={{ fontWeight:700,fontSize:14,marginBottom:10 }}>Comments & Suggestions</div>
          <textarea value={comment} onChange={e => setComment(e.target.value)}
            placeholder="Tell us about your experience — what did you love, what could be better?"
            style={{ width:'100%',border:'1.5px solid var(--line)',borderRadius:12,padding:'12px 16px',fontSize:14,fontFamily:'Manrope',outline:'none',resize:'none',height:90,boxSizing:'border-box' }} />
        </div>

        <div style={{ display:'flex',gap:10 }}>
          <button onClick={onClose} style={{ flex:1,background:'var(--bg)',border:'1.5px solid var(--line)',borderRadius:14,padding:'16px',fontSize:15,fontWeight:700,color:'var(--ink2)' }}>Skip</button>
          <button onClick={submit} disabled={submitting}
            style={{ flex:2,background:submitting?'#999':'var(--ink)',color:'#fff',border:'none',borderRadius:14,padding:'16px',fontSize:15,fontWeight:800,cursor:submitting?'wait':'pointer' }}>
            {submitting?'Submitting...':'Submit Feedback →'}
          </button>
        </div>
      </div>
    </div>
  )
}
`

// ─────────────────────────────────────────────────────────────
// FIX 4 continued: GuestApp — delay feedback by 90s after delivery
// ─────────────────────────────────────────────────────────────
files[BASE + '/pages/GuestApp.jsx'] = `import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getPendingOrders, clearOrder } from '../lib/offlineQueue'
import WelcomeScreen from '../components/guest/WelcomeScreen'
import MenuScreen from '../components/guest/MenuScreen'
import CartDrawer from '../components/guest/CartDrawer'
import OrderStatus from '../components/guest/OrderStatus'
import SOSPanel from '../components/guest/SOSPanel'
import OrderHistory from '../components/guest/OrderHistory'
import FeedbackModal from '../components/guest/FeedbackModal'

// localStorage key scoped to table + today's date so it resets daily
function storageKey(tableNumber) {
  return 'ss_order_' + tableNumber + '_' + new Date().toISOString().slice(0,10)
}

export default function GuestApp() {
  const { tableNumber } = useParams()
  const [screen, setScreen] = useState('welcome')
  const [cart, setCart] = useState([])
  const [currentOrderId, setCurrentOrderId] = useState(() => localStorage.getItem(storageKey(tableNumber)) || null)
  const [tableData, setTableData] = useState(null)
  const [eventData, setEventData] = useState(null)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [showSOS, setShowSOS] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)
  const feedbackTimerRef = useRef(null)
  const retryRef = useRef(null)

  // Persist currentOrderId to localStorage whenever it changes
  useEffect(() => {
    if (currentOrderId && !currentOrderId.startsWith('offline-')) {
      localStorage.setItem(storageKey(tableNumber), currentOrderId)
    }
  }, [currentOrderId, tableNumber])

  useEffect(() => {
    loadEventAndTable()
    const on = () => { setIsOnline(true); syncOfflineOrders() }
    const off = () => setIsOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
      if (retryRef.current) clearTimeout(retryRef.current)
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
    }
  }, [tableNumber])

  // Watch for order delivered — show feedback after 90 second delay
  useEffect(() => {
    if (!currentOrderId || currentOrderId.startsWith('offline-')) return
    const sub = supabase.channel('feedback-watch-' + currentOrderId)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: 'id=eq.' + currentOrderId }, payload => {
        if (payload.new.status === 'delivered') {
          // 90 second delay before showing feedback
          feedbackTimerRef.current = setTimeout(() => setShowFeedback(true), 90000)
        }
      }).subscribe()
    return () => supabase.removeChannel(sub)
  }, [currentOrderId])

  async function loadEventAndTable() {
    try {
      const { data: events } = await supabase
        .from('events').select('*')
        .eq('is_closed', false)
        .order('created_at', { ascending: false })
        .limit(1)
      if (!events?.length) return
      const event = events[0]
      setEventData(event)

      const tNum = parseInt(tableNumber)
      const { data: tables } = await supabase
        .from('tables').select('*')
        .eq('event_id', event.id)
        .eq('table_number', tNum)
        .limit(1)

      if (tables?.length) {
        setTableData(tables[0])
      } else {
        const { data: newTable } = await supabase
          .from('tables')
          .insert({ event_id: event.id, table_number: tNum, is_active: true })
          .select().single()
        if (newTable) setTableData(newTable)
      }
    } catch(e) {
      console.error('Load error:', e)
      retryRef.current = setTimeout(() => loadEventAndTable(), 2000)
    }
  }

  async function syncOfflineOrders() {
    const pending = await getPendingOrders()
    for (const order of pending) {
      try {
        const { data: newOrder } = await supabase.from('orders')
          .insert({ event_id: order.event_id, table_id: order.table_id, status: 'pending' })
          .select().single()
        if (newOrder) {
          await supabase.from('order_items').insert(
            order.items.map(i => ({ order_id: newOrder.id, menu_item_id: i.id, quantity: i.quantity }))
          )
          await clearOrder(order.id)
        }
      } catch(e) { console.error(e) }
    }
  }

  function addToCart(item) {
    setCart(prev => {
      const exists = prev.find(c => c.id === item.id)
      if (exists) return prev.map(c => c.id === item.id ? { ...c, quantity: c.quantity + 1 } : c)
      return [...prev, { ...item, quantity: 1 }]
    })
  }

  function removeFromCart(itemId) {
    setCart(prev => {
      const exists = prev.find(c => c.id === itemId)
      if (exists?.quantity === 1) return prev.filter(c => c.id !== itemId)
      return prev.map(c => c.id === itemId ? { ...c, quantity: c.quantity - 1 } : c)
    })
  }

  const cartCount = cart.reduce((s, i) => s + i.quantity, 0)

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', position:'relative' }}>
      {screen === 'welcome' && <WelcomeScreen tableNumber={tableNumber} onStart={() => setScreen('menu')} eventData={eventData} />}
      {screen === 'menu' && (
        <MenuScreen
          tableData={tableData} eventData={eventData} tableNumber={tableNumber}
          cart={cart} addToCart={addToCart} removeFromCart={removeFromCart}
          cartCount={cartCount} isOnline={isOnline}
          onShowSOS={() => setShowSOS(true)}
          onShowHistory={() => setShowHistory(true)}
          onShowStatus={() => setScreen('status')}
          currentOrderId={currentOrderId}
        />
      )}
      {screen === 'status' && (
        <OrderStatus orderId={currentOrderId} tableNumber={tableNumber} onBack={() => setScreen('menu')} />
      )}
      {cartCount > 0 && screen === 'menu' && (
        <CartDrawer
          cart={cart} tableData={tableData} eventData={eventData} isOnline={isOnline}
          onOrderPlaced={(id) => { setCurrentOrderId(id); setCart([]); setScreen('status') }}
          onRemove={removeFromCart} onAdd={addToCart}
        />
      )}
      {showSOS && <SOSPanel tableData={tableData} eventData={eventData} onClose={() => setShowSOS(false)} />}
      {showHistory && <OrderHistory tableData={tableData} eventData={eventData} onClose={() => setShowHistory(false)} />}
      {showFeedback && <FeedbackModal orderId={currentOrderId} onClose={() => { setShowFeedback(false); setScreen('menu') }} />}
    </div>
  )
}
`

// ─────────────────────────────────────────────────────────────
// FIX 5: SOSPanel — show live status of each request
// ─────────────────────────────────────────────────────────────
files[BASE + '/components/guest/SOSPanel.jsx'] = `import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

const SOS_TYPES = [
  { type:'sos',          emoji:'🆘', label:'Call Waiter',   desc:'Need immediate assistance', bg:'#FEF2F2', color:'#DC2626' },
  { type:'clean_table',  emoji:'🧹', label:'Clean Table',   desc:'Please clean our table',    bg:'#EFF6FF', color:'#2563EB' },
  { type:'extra_cutlery',emoji:'🍴', label:'Extra Cutlery', desc:'Spoons, forks, bowls, plates', bg:'#F5F3FF', color:'#7C3AED' },
  { type:'water_refill', emoji:'💧', label:'Water Refill',  desc:'Water bottle or refill',    bg:'#ECFEFF', color:'#0891B2' },
]

const STATUS_INFO = {
  open:         { label:'⏳ Sent — waiting for supervisor', color:'#D97706' },
  acknowledged: { label:'✅ Acknowledged — help is coming!', color:'#2563EB' },
  resolved:     { label:'🎉 Resolved', color:'#16A34A' },
}

export default function SOSPanel({ tableData, eventData, onClose }) {
  const [sending, setSending] = useState(null)
  const [sent, setSent] = useState([])
  const [lastSent, setLastSent] = useState(null)
  const [myRequests, setMyRequests] = useState([])

  // Poll for status updates every 5 seconds
  useEffect(() => {
    if (!tableData) return
    fetchMyRequests()
    const interval = setInterval(fetchMyRequests, 5000)
    return () => clearInterval(interval)
  }, [tableData])

  async function fetchMyRequests() {
    if (!tableData?.id) return
    const { data } = await supabase.from('sos_requests')
      .select('*')
      .eq('table_id', tableData.id)
      .order('created_at', { ascending: false })
      .limit(10)
    if (data) setMyRequests(data)
  }

  async function sendRequest(type) {
    if (sending) return
    setSending(type)
    try {
      if (tableData && eventData) {
        await supabase.from('sos_requests').insert({
          event_id: eventData.id,
          table_id: tableData.id,
          request_type: type,
          status: 'open'
        })
        await fetchMyRequests()
      }
      setSent(prev => [...prev, type])
      setLastSent(type)
      setTimeout(() => setLastSent(null), 3000)
    } catch(e) {
      console.error(e)
    } finally {
      setSending(null)
    }
  }

  const getLabel = (type) => SOS_TYPES.find(s => s.type === type)?.label || type

  // Group active requests (not resolved) by type to show status
  const activeRequests = myRequests.filter(r => r.status !== 'resolved').slice(0, 5)
  const recentResolved = myRequests.filter(r => r.status === 'resolved').slice(0, 3)

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:70, display:'flex', alignItems:'flex-end' }}>
      <div style={{ width:'100%', background:'#fff', borderRadius:'24px 24px 0 0', padding:'24px 20px 40px', maxHeight:'90vh', overflowY:'auto' }}>
        <div style={{ width:40, height:4, background:'#E8E0F0', borderRadius:999, margin:'0 auto 20px' }}></div>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
          <h3 style={{ fontSize:20, fontWeight:800 }}>Quick Requests</h3>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:22, color:'#999', cursor:'pointer' }}>✕</button>
        </div>
        <p style={{ fontSize:13, color:'var(--ink2)', marginBottom:20 }}>Tap a button — your request goes directly to the supervisor</p>

        {/* Confirmation toast */}
        {lastSent && (
          <div style={{ background:'#F0FDF4', border:'1.5px solid #BBF7D0', borderRadius:12, padding:'12px 16px', marginBottom:16, display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ fontSize:20 }}>✅</span>
            <div>
              <div style={{ fontWeight:700, fontSize:14, color:'#16A34A' }}>Request sent!</div>
              <div style={{ fontSize:12, color:'#16A34A' }}>{getLabel(lastSent)} — supervisor has been notified</div>
            </div>
          </div>
        )}

        {/* Request buttons */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:20 }}>
          {SOS_TYPES.map(s => {
            const isSent = sent.includes(s.type)
            const isSending = sending === s.type
            return (
              <button key={s.type} onClick={() => sendRequest(s.type)} disabled={isSending}
                style={{ background: isSent ? '#F0FDF4' : s.bg, border: isSent ? '2px solid #BBF7D0' : '2px solid '+s.color+'20', borderRadius:16, padding:'18px 12px', textAlign:'center', cursor: isSending ? 'wait' : 'pointer', opacity: isSending ? 0.7 : 1, position:'relative', transition:'all 0.2s' }}>
                {isSent && <div style={{ position:'absolute', top:8, right:8, background:'#16A34A', color:'#fff', borderRadius:'50%', width:18, height:18, fontSize:10, display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800 }}>✓</div>}
                <div style={{ fontSize:36, marginBottom:8 }}>{isSending ? '⏳' : s.emoji}</div>
                <div style={{ fontWeight:800, fontSize:14, color: isSent ? '#16A34A' : s.color, marginBottom:4 }}>
                  {isSent ? 'Sent!' : s.label}
                </div>
                <div style={{ fontSize:11, color:'var(--ink2)', lineHeight:1.4 }}>{isSending ? 'Sending...' : s.desc}</div>
              </button>
            )
          })}
        </div>

        {/* Live status of my requests */}
        {(activeRequests.length > 0 || recentResolved.length > 0) && (
          <div style={{ background:'var(--bg)', borderRadius:14, padding:16 }}>
            <div style={{ fontWeight:800, fontSize:14, marginBottom:12 }}>Your Request Status</div>
            {activeRequests.map(req => {
              const info = STATUS_INFO[req.status] || { label: req.status, color:'#999' }
              const typeInfo = SOS_TYPES.find(s => s.type === req.request_type)
              return (
                <div key={req.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', padding:'10px 0', borderBottom:'1px solid var(--line)', gap:8 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <span style={{ fontSize:20 }}>{typeInfo?.emoji || '📣'}</span>
                    <span style={{ fontWeight:700, fontSize:13 }}>{typeInfo?.label || req.request_type}</span>
                  </div>
                  <span style={{ fontSize:12, fontWeight:600, color:info.color, textAlign:'right', flex:1 }}>{info.label}</span>
                </div>
              )
            })}
            {recentResolved.map(req => {
              const typeInfo = SOS_TYPES.find(s => s.type === req.request_type)
              return (
                <div key={req.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 0', borderBottom:'1px solid var(--line)', opacity:0.6 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <span style={{ fontSize:20 }}>{typeInfo?.emoji || '📣'}</span>
                    <span style={{ fontWeight:600, fontSize:13 }}>{typeInfo?.label || req.request_type}</span>
                  </div>
                  <span style={{ fontSize:12, fontWeight:600, color:'#16A34A' }}>🎉 Resolved</span>
                </div>
              )
            })}
          </div>
        )}

        {sent.length > 0 && (
          <button onClick={onClose} style={{ width:'100%', marginTop:20, background:'var(--ink)', color:'#fff', border:'none', borderRadius:12, padding:'14px', fontSize:15, fontWeight:800, cursor:'pointer' }}>
            Done ({sent.length} request{sent.length>1?'s':''} sent)
          </button>
        )}
      </div>
    </div>
  )
}
`

// ─────────────────────────────────────────────────────────────
// Write all files
// ─────────────────────────────────────────────────────────────
let count = 0
for (const [filePath, content] of Object.entries(files)) {
  fs.writeFileSync(filePath, content, 'utf8')
  console.log('✅ Written: ' + filePath.replace('/Users/asayyed/SmartServe/src', ''))
  count++
}
console.log('\n✅ All ' + count + ' files written successfully.')
console.log('\nNext step: run the SQL in Supabase, then push to GitHub.')
