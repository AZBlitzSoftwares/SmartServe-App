const fs = require('fs')
const BASE = '/Users/asayyed/SmartServe/src'

// ═══════════════════════════════════════════════════════════════════
// FIX 1: MenuScreen — Zomato-style LEFT sidebar + All tab
// ═══════════════════════════════════════════════════════════════════
fs.writeFileSync(BASE + '/components/guest/MenuScreen.jsx', `import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

export default function MenuScreen({ tableNumber, eventData, cart, addToCart, removeFromCart, cartCount, isOnline, onShowSOS, onShowHistory, onShowStatus, currentOrderId, showFeedbackBubble, onFeedbackBubbleClick }) {
  const [categories, setCategories] = useState([])
  const [items, setItems] = useState([])
  const [activeCategory, setActiveCategory] = useState('all')
  const [search, setSearch] = useState('')
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
    if (search.length > 0) return i.name.toLowerCase().includes(search.toLowerCase())
    if (activeCategory === 'all') return true
    return i.category_id === activeCategory
  })

  const getQty = (id) => cart.find(c => c.id === id)?.quantity || 0

  const sidebarCats = [
    { id: 'all', name: 'All', count: items.length },
    ...categories.map(c => ({ id: c.id, name: c.name, count: items.filter(i => i.category_id === c.id).length }))
  ]

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', paddingBottom: cartCount > 0 ? 100 : 24, display:'flex', flexDirection:'column' }}>

      <div style={{ background:'var(--ink)', padding:'12px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:40 }}>
        <div style={{ color:'#fff', fontWeight:800, fontSize:17 }}>Janu's <span style={{ color:'#E8890C' }}>Smart Serve</span></div>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          {isOnline === false && <span style={{ background:'#DC2626', color:'#fff', fontSize:10, fontWeight:700, padding:'2px 6px', borderRadius:999 }}>OFFLINE</span>}
          <div style={{ background:'rgba(255,255,255,0.15)', color:'#fff', fontSize:12, fontWeight:700, padding:'5px 12px', borderRadius:999 }}>TABLE {tableNumber}</div>
        </div>
      </div>

      <div style={{ display:'flex', gap:8, padding:'10px 14px', background:'#fff', borderBottom:'1px solid var(--line)', overflowX:'auto' }}>
        {currentOrderId && <button onClick={onShowStatus} style={{ flexShrink:0, background:'#16A34A', color:'#fff', border:'none', borderRadius:999, padding:'7px 14px', fontSize:12, fontWeight:700, cursor:'pointer' }}>📦 Track Order</button>}
        <button onClick={onShowHistory} style={{ flexShrink:0, background:'#fff', color:'var(--ink)', border:'1.5px solid var(--line)', borderRadius:999, padding:'7px 14px', fontSize:12, fontWeight:600, cursor:'pointer' }}>📋 History</button>
        <button onClick={onShowSOS} style={{ flexShrink:0, background:'#FEF3C7', color:'#92400E', border:'1.5px solid #FCD34D', borderRadius:999, padding:'7px 14px', fontSize:12, fontWeight:700, cursor:'pointer' }}>🆘 Need Help?</button>
      </div>

      <div style={{ padding:'10px 14px', background:'#fff', borderBottom:'1px solid var(--line)' }}>
        <div style={{ background:'var(--bg)', borderRadius:12, padding:'9px 14px', display:'flex', alignItems:'center', gap:8, border:'1.5px solid var(--line)' }}>
          <span style={{ fontSize:16 }}>🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search dishes..."
            style={{ border:'none', outline:'none', flex:1, fontSize:14, fontFamily:'Manrope', background:'transparent' }} />
          {search.length > 0 && <button onClick={() => setSearch('')} style={{ background:'none', border:'none', fontSize:16, color:'#999', cursor:'pointer' }}>✕</button>}
        </div>
      </div>

      <div style={{ display:'flex', flex:1, overflow:'hidden' }}>
        {search.length === 0 && (
          <div style={{ width:90, minWidth:90, background:'#F3F4F6', borderRight:'1px solid var(--line)', overflowY:'auto' }}>
            {sidebarCats.map(cat => (
              <button key={cat.id} onClick={() => setActiveCategory(cat.id)} style={{
                width:'100%', border:'none',
                background: activeCategory === cat.id ? '#fff' : 'transparent',
                borderLeft: activeCategory === cat.id ? '3px solid #E8890C' : '3px solid transparent',
                padding:'14px 6px', textAlign:'center', cursor:'pointer',
                display:'flex', flexDirection:'column', alignItems:'center', gap:3
              }}>
                <span style={{ fontSize:11, fontWeight: activeCategory === cat.id ? 800 : 600, color: activeCategory === cat.id ? '#E8890C' : '#555', lineHeight:1.3, wordBreak:'break-word', textAlign:'center' }}>{cat.name}</span>
                <span style={{ fontSize:10, color: activeCategory === cat.id ? '#E8890C' : '#aaa', fontWeight:600 }}>{cat.count}</span>
              </button>
            ))}
          </div>
        )}

        <div style={{ flex:1, overflowY:'auto', padding:'10px' }}>
          {loading ? (
            <div style={{ textAlign:'center', padding:60, color:'var(--ink2)' }}>Loading menu...</div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign:'center', padding:60 }}>
              <div style={{ fontSize:40, marginBottom:12 }}>🔍</div>
              <div style={{ fontWeight:600, color:'var(--ink2)' }}>No dishes found</div>
            </div>
          ) : (
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(140px, 1fr))', gap:10 }}>
              {filtered.map(item => {
                const qty = getQty(item.id)
                return (
                  <div key={item.id} style={{ background:'#fff', borderRadius:14, overflow:'hidden', boxShadow:'var(--shadow)' }}>
                    <div style={{ height:95, background: item.photo_url ? 'url(' + item.photo_url + ') center/cover no-repeat' : 'linear-gradient(135deg,#F7F4FB,#E8E0F0)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:34 }}>
                      {item.photo_url ? null : '🍽️'}
                    </div>
                    <div style={{ padding:'8px 8px 10px' }}>
                      <div style={{ fontWeight:700, fontSize:12, marginBottom:2, lineHeight:1.3 }}>{item.name}</div>
                      {item.description && <div style={{ fontSize:10, color:'var(--ink2)', marginBottom:6, lineHeight:1.4, display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>{item.description}</div>}
                      {item.is_live_counter && <div style={{ fontSize:9, color:'#D97706', fontWeight:600, marginBottom:4 }}>⏱ Live counter</div>}
                      {qty === 0 ? (
                        <button onClick={() => addToCart(item)} style={{ width:'100%', background:'var(--ink)', color:'#fff', border:'none', borderRadius:7, padding:'7px 0', fontSize:12, fontWeight:800, cursor:'pointer' }}>+ Add</button>
                      ) : (
                        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', background:'var(--ink)', borderRadius:7, padding:'4px 8px' }}>
                          <button onClick={() => removeFromCart(item.id)} style={{ background:'none', border:'none', color:'#fff', fontSize:16, fontWeight:800, cursor:'pointer', lineHeight:1 }}>−</button>
                          <span style={{ color:'#fff', fontWeight:800, fontSize:13 }}>{qty}</span>
                          <button onClick={() => addToCart(item)} style={{ background:'none', border:'none', color:'#fff', fontSize:16, fontWeight:800, cursor:'pointer', lineHeight:1 }}>+</button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {showFeedbackBubble && (
        <>
          <style>{\`@keyframes fbBounce{0%,100%{transform:translateY(0) scale(1)}40%{transform:translateY(-14px) scale(1.1)}70%{transform:translateY(-6px) scale(1.05)}}.fb-bubble{animation:fbBounce 2s ease-in-out infinite}\`}</style>
          <button className="fb-bubble" onClick={onFeedbackBubbleClick} style={{ position:'fixed', bottom: cartCount > 0 ? 90 : 28, right:16, zIndex:80, background:'linear-gradient(135deg,#E8890C,#c97010)', border:'none', borderRadius:50, padding:'13px 16px', display:'flex', flexDirection:'column', alignItems:'center', gap:3, cursor:'pointer', boxShadow:'0 8px 28px rgba(232,137,12,0.55)', color:'#fff', minWidth:72 }}>
            <span style={{ fontSize:26 }}>⭐</span>
            <span style={{ fontSize:10, fontWeight:800, whiteSpace:'nowrap' }}>Rate Us!</span>
          </button>
        </>
      )}
    </div>
  )
}
`)
console.log('✅ 1/6 MenuScreen.jsx — Zomato sidebar done')

// ═══════════════════════════════════════════════════════════════════
// FIX 2: SOSPanel — load past requests on mount so they survive refresh
// ═══════════════════════════════════════════════════════════════════
fs.writeFileSync(BASE + '/components/guest/SOSPanel.jsx', `import { useState, useEffect } from 'react'
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
  resolved:     { label:'🎉 Resolved',                       color:'#16A34A' },
}

export default function SOSPanel({ tableData, eventData, onClose }) {
  const [sending, setSending] = useState(null)
  const [sent, setSent] = useState([])
  const [lastSent, setLastSent] = useState(null)
  const [myRequests, setMyRequests] = useState([])

  // Load past requests immediately on open + poll every 5s
  useEffect(() => {
    if (!tableData) return
    fetchMyRequests()
    const interval = setInterval(fetchMyRequests, 5000)
    return () => clearInterval(interval)
  }, [tableData])

  async function fetchMyRequests() {
    if (!tableData?.id) return
    const { data } = await supabase.from('sos_requests')
      .select('*').eq('table_id', tableData.id)
      .order('created_at', { ascending: false }).limit(10)
    if (data) {
      setMyRequests(data)
      // Mark already-sent types so buttons show sent state
      setSent(data.filter(r => r.status !== 'resolved').map(r => r.request_type))
    }
  }

  async function sendRequest(type) {
    if (sending) return
    setSending(type)
    try {
      if (tableData && eventData) {
        await supabase.from('sos_requests').insert({ event_id:eventData.id, table_id:tableData.id, request_type:type, status:'open' })
        await fetchMyRequests()
      }
      setLastSent(type)
      setTimeout(() => setLastSent(null), 3000)
    } catch(e) { console.error(e) }
    finally { setSending(null) }
  }

  const getLabel = (type) => SOS_TYPES.find(s => s.type === type)?.label || type
  const activeRequests = myRequests.filter(r => r.status !== 'resolved')
  const resolvedRequests = myRequests.filter(r => r.status === 'resolved').slice(0,3)

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:70, display:'flex', alignItems:'flex-end' }}>
      <div style={{ width:'100%', background:'#fff', borderRadius:'24px 24px 0 0', padding:'24px 20px 40px', maxHeight:'90vh', overflowY:'auto' }}>
        <div style={{ width:40, height:4, background:'#E8E0F0', borderRadius:999, margin:'0 auto 20px' }}></div>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
          <h3 style={{ fontSize:20, fontWeight:800 }}>Quick Requests</h3>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:22, color:'#999', cursor:'pointer' }}>✕</button>
        </div>
        <p style={{ fontSize:13, color:'var(--ink2)', marginBottom:20 }}>Tap a button — your request goes directly to the supervisor</p>

        {lastSent && (
          <div style={{ background:'#F0FDF4', border:'1.5px solid #BBF7D0', borderRadius:12, padding:'12px 16px', marginBottom:16, display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ fontSize:20 }}>✅</span>
            <div>
              <div style={{ fontWeight:700, fontSize:14, color:'#16A34A' }}>Request sent!</div>
              <div style={{ fontSize:12, color:'#16A34A' }}>{getLabel(lastSent)} — supervisor has been notified</div>
            </div>
          </div>
        )}

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:20 }}>
          {SOS_TYPES.map(s => {
            const isSent = sent.includes(s.type)
            const isSending = sending === s.type
            return (
              <button key={s.type} onClick={() => sendRequest(s.type)} disabled={isSending}
                style={{ background: isSent ? '#F0FDF4' : s.bg, border: isSent ? '2px solid #BBF7D0' : '2px solid '+s.color+'20', borderRadius:16, padding:'18px 12px', textAlign:'center', cursor: isSending ? 'wait' : 'pointer', opacity: isSending ? 0.7 : 1, position:'relative', transition:'all 0.2s' }}>
                {isSent && <div style={{ position:'absolute', top:8, right:8, background:'#16A34A', color:'#fff', borderRadius:'50%', width:18, height:18, fontSize:10, display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800 }}>✓</div>}
                <div style={{ fontSize:36, marginBottom:8 }}>{isSending ? '⏳' : s.emoji}</div>
                <div style={{ fontWeight:800, fontSize:14, color: isSent ? '#16A34A' : s.color, marginBottom:4 }}>{isSent ? 'Sent!' : s.label}</div>
                <div style={{ fontSize:11, color:'var(--ink2)', lineHeight:1.4 }}>{isSending ? 'Sending...' : s.desc}</div>
              </button>
            )
          })}
        </div>

        {(activeRequests.length > 0 || resolvedRequests.length > 0) && (
          <div style={{ background:'var(--bg)', borderRadius:14, padding:16 }}>
            <div style={{ fontWeight:800, fontSize:14, marginBottom:12 }}>Your Request Status</div>
            {activeRequests.map(req => {
              const info = STATUS_INFO[req.status] || { label:req.status, color:'#999' }
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
            {resolvedRequests.map(req => {
              const typeInfo = SOS_TYPES.find(s => s.type === req.request_type)
              return (
                <div key={req.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 0', borderBottom:'1px solid var(--line)', opacity:0.5 }}>
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
            Done
          </button>
        )}
      </div>
    </div>
  )
}
`)
console.log('✅ 2/6 SOSPanel.jsx — status survives refresh')

// ═══════════════════════════════════════════════════════════════════
// FIX 3: GuestApp — persist orderId, feedback bubble
// ═══════════════════════════════════════════════════════════════════
fs.writeFileSync(BASE + '/pages/GuestApp.jsx', `import { useState, useEffect, useRef } from 'react'
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
  const [showFeedbackBubble, setShowFeedbackBubble] = useState(false)
  const feedbackTimerRef = useRef(null)
  const retryRef = useRef(null)

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

  useEffect(() => {
    if (!currentOrderId || currentOrderId.startsWith('offline-')) return
    const sub = supabase.channel('feedback-watch-' + currentOrderId)
      .on('postgres_changes', { event:'UPDATE', schema:'public', table:'orders', filter:'id=eq.' + currentOrderId }, payload => {
        if (payload.new.status === 'delivered') {
          feedbackTimerRef.current = setTimeout(() => setShowFeedbackBubble(true), 90000)
        }
      }).subscribe()
    return () => supabase.removeChannel(sub)
  }, [currentOrderId])

  async function loadEventAndTable() {
    try {
      const { data: events } = await supabase.from('events').select('*').eq('is_closed', false).order('created_at', { ascending:false }).limit(1)
      if (!events?.length) return
      const event = events[0]
      setEventData(event)
      const tNum = parseInt(tableNumber)
      const { data: tables } = await supabase.from('tables').select('*').eq('event_id', event.id).eq('table_number', tNum).limit(1)
      if (tables?.length) {
        setTableData(tables[0])
      } else {
        const { data: newTable } = await supabase.from('tables').insert({ event_id:event.id, table_number:tNum, is_active:true }).select().single()
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
        const { data: newOrder } = await supabase.from('orders').insert({ event_id:order.event_id, table_id:order.table_id, status:'pending' }).select().single()
        if (newOrder) {
          await supabase.from('order_items').insert(order.items.map(i => ({ order_id:newOrder.id, menu_item_id:i.id, quantity:i.quantity })))
          await clearOrder(order.id)
        }
      } catch(e) { console.error(e) }
    }
  }

  function addToCart(item) {
    setCart(prev => {
      const exists = prev.find(c => c.id === item.id)
      if (exists) return prev.map(c => c.id === item.id ? { ...c, quantity:c.quantity+1 } : c)
      return [...prev, { ...item, quantity:1 }]
    })
  }

  function removeFromCart(itemId) {
    setCart(prev => {
      const exists = prev.find(c => c.id === itemId)
      if (exists?.quantity === 1) return prev.filter(c => c.id !== itemId)
      return prev.map(c => c.id === itemId ? { ...c, quantity:c.quantity-1 } : c)
    })
  }

  const cartCount = cart.reduce((s,i) => s+i.quantity, 0)

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', position:'relative' }}>
      {screen === 'welcome' && <WelcomeScreen tableNumber={tableNumber} onStart={() => setScreen('menu')} eventData={eventData} />}
      {screen === 'menu' && (
        <MenuScreen tableData={tableData} eventData={eventData} tableNumber={tableNumber}
          cart={cart} addToCart={addToCart} removeFromCart={removeFromCart}
          cartCount={cartCount} isOnline={isOnline}
          onShowSOS={() => setShowSOS(true)} onShowHistory={() => setShowHistory(true)}
          onShowStatus={() => setScreen('status')} currentOrderId={currentOrderId}
          showFeedbackBubble={showFeedbackBubble}
          onFeedbackBubbleClick={() => { setShowFeedbackBubble(false); setShowFeedback(true) }} />
      )}
      {screen === 'status' && <OrderStatus orderId={currentOrderId} tableNumber={tableNumber} onBack={() => setScreen('menu')} />}
      {cartCount > 0 && screen === 'menu' && (
        <CartDrawer cart={cart} tableData={tableData} eventData={eventData} isOnline={isOnline}
          onOrderPlaced={(id) => { setCurrentOrderId(id); setCart([]); setScreen('status') }}
          onRemove={removeFromCart} onAdd={addToCart} />
      )}
      {showSOS && <SOSPanel tableData={tableData} eventData={eventData} onClose={() => setShowSOS(false)} />}
      {showHistory && <OrderHistory tableData={tableData} eventData={eventData} onClose={() => setShowHistory(false)} />}
      {showFeedback && <FeedbackModal orderId={currentOrderId} onClose={() => { setShowFeedback(false); setScreen('menu') }} />}
    </div>
  )
}
`)
console.log('✅ 3/6 GuestApp.jsx — orderId persists, feedback bubble wired')

// ═══════════════════════════════════════════════════════════════════
// FIX 4: FeedbackModal — professional with name/email/mobile/ratings
// ═══════════════════════════════════════════════════════════════════
fs.writeFileSync(BASE + '/components/guest/FeedbackModal.jsx', `import { useState } from 'react'
import { supabase } from '../../lib/supabase'

export default function FeedbackModal({ orderId, onClose }) {
  const [rating, setRating] = useState(0)
  const [hoverRating, setHoverRating] = useState(0)
  const [food, setFood] = useState(0)
  const [service, setService] = useState(0)
  const [presentation, setPresentation] = useState(0)
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
            style={{ background:'none', border:'none', fontSize:size, cursor:'pointer', transition:'transform 0.15s',
              transform:(hover||value)>=s?'scale(1.2)':'scale(1)', filter:(hover||value)>=s?'none':'grayscale(1) opacity(0.3)', padding:0 }}>⭐</button>
        ))}
      </div>
    )
  }

  async function submit() {
    const e = {}
    if (!name.trim()) e.name = 'Please enter your name'
    if (!email.trim()) e.email = 'Please enter your email'
    else if (!/\\S+@\\S+\\.\\S+/.test(email)) e.email = 'Invalid email'
    if (!rating) e.rating = 'Please select a rating'
    if (Object.keys(e).length) { setErrors(e); return }
    setSubmitting(true)
    await supabase.from('feedback').insert({
      order_id: orderId, rating,
      food_rating: food||null, service_rating: service||null, presentation_rating: presentation||null,
      guest_name: name.trim(), guest_email: email.trim(), guest_mobile: mobile.trim()||null,
      comment: comment.trim()||null
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

        <div style={{ marginBottom:20 }}>
          <div style={{ fontWeight:700,fontSize:14,marginBottom:10 }}>Overall Rating *</div>
          <Stars value={rating} hover={hoverRating} onSet={setRating} onHover={setHoverRating} size={40} />
          {rating > 0 && <div style={{ marginTop:8,fontSize:14,fontWeight:700,color:MOOD_COLOR[rating] }}>{MOOD[rating]}</div>}
          {errors.rating && <div style={{ color:'#DC2626',fontSize:12,marginTop:4 }}>{errors.rating}</div>}
        </div>

        <div style={{ background:'var(--bg)',borderRadius:14,padding:16,marginBottom:20 }}>
          <div style={{ fontWeight:700,fontSize:14,marginBottom:12 }}>Rate by Category</div>
          {[['Food Quality',food,setFood],['Service Speed',service,setService],['Presentation',presentation,setPresentation]].map(([label,val,setVal]) => {
            const [h,setH] = useState(0)
            return (
              <div key={label} style={{ display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:'1px solid var(--line)' }}>
                <span style={{ fontSize:13,fontWeight:600 }}>{label}</span>
                <Stars value={val} hover={h} onSet={setVal} onHover={setH} size={22} />
              </div>
            )
          })}
        </div>

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

        <div style={{ marginBottom:24 }}>
          <div style={{ fontWeight:700,fontSize:14,marginBottom:10 }}>Comments & Suggestions</div>
          <textarea value={comment} onChange={e => setComment(e.target.value)}
            placeholder="Tell us about your experience..."
            style={{ width:'100%',border:'1.5px solid var(--line)',borderRadius:12,padding:'12px 16px',fontSize:14,fontFamily:'Manrope',outline:'none',resize:'none',height:90,boxSizing:'border-box' }} />
        </div>

        <div style={{ display:'flex',gap:10 }}>
          <button onClick={onClose} style={{ flex:1,background:'var(--bg)',border:'1.5px solid var(--line)',borderRadius:14,padding:'16px',fontSize:15,fontWeight:700,color:'var(--ink2)' }}>Skip</button>
          <button onClick={submit} disabled={submitting} style={{ flex:2,background:submitting?'#999':'var(--ink)',color:'#fff',border:'none',borderRadius:14,padding:'16px',fontSize:15,fontWeight:800,cursor:submitting?'wait':'pointer' }}>
            {submitting?'Submitting...':'Submit Feedback →'}
          </button>
        </div>
      </div>
    </div>
  )
}
`)
console.log('✅ 4/6 FeedbackModal.jsx — professional form done')

// ═══════════════════════════════════════════════════════════════════
// FIX 5: KOTDashboard — KOT print with event name + date + time
// ═══════════════════════════════════════════════════════════════════
fs.writeFileSync(BASE + '/components/supervisor/KOTDashboard.jsx', `import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

const STATUS_FLOW = { pending:'in_preparation', in_preparation:'ready', ready:'delivered' }
const STATUS_LABELS = { pending:'Placed', in_preparation:'In Preparation', ready:'Ready', delivered:'Delivered', cancelled:'Cancelled' }
const STATUS_COLORS = { pending:'#D97706', in_preparation:'#2563EB', ready:'#7C3AED', delivered:'#16A34A', cancelled:'#DC2626' }
const STATUS_NEXT_LABEL = { pending:'Mark In Preparation', in_preparation:'Mark Ready', ready:'Mark Delivered' }

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

  async function loadOrders(showSpinner=false) {
    if (!eventData) return
    if (showSpinner) setLoading(true)
    const { data } = await supabase.from('orders').select('*, tables(table_number), order_items(quantity, menu_items(name, is_live_counter))').eq('event_id', eventData.id).order('created_at', { ascending:false })
    const all = data || []
    setOrders(all)
    onOrderCountChange(all.filter(o => !['delivered','cancelled'].includes(o.status)).length)
    if (showSpinner) setLoading(false)
  }

  async function updateStatus(order) {
    const next = STATUS_FLOW[order.status]
    if (!next) return
    const { error } = await supabase.from('orders').update({ status:next }).eq('id', order.id)
    if (error) { alert('Update failed: ' + error.message); return }
    loadOrders(false)
  }

  async function cancelOrder(id) {
    if (!confirm('Cancel this order?')) return
    await supabase.from('orders').update({ status:'cancelled', cancelled_at:new Date().toISOString() }).eq('id', id)
    loadOrders()
  }

  function printKOT(order) {
    const eventName = eventData?.name || 'Event'
    const tableNum = order.tables?.table_number || '?'
    const orderId = '#' + order.id.slice(-6).toUpperCase()
    const now = new Date(order.created_at)
    const dateStr = now.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })
    const timeStr = now.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', hour12:true })
    const w = window.open('', '_blank', 'width=320,height=500')
    w.document.write(\`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>KOT \${orderId}</title>
<style>body{font-family:'Courier New',monospace;font-size:13px;padding:16px;width:280px;margin:0 auto;color:#000}.center{text-align:center}.app{font-size:15px;font-weight:bold;text-align:center;text-transform:uppercase;letter-spacing:1px}.event{font-size:12px;text-align:center;margin-bottom:6px;font-weight:bold}.divider{border-top:1px dashed #000;margin:8px 0}.row{display:flex;justify-content:space-between;font-size:12px;margin:2px 0}.table-num{font-size:26px;font-weight:900;text-align:center;border:2px solid #000;padding:6px;margin:8px 0;letter-spacing:3px}.item{font-size:13px;padding:3px 0}.status{text-align:center;border:1px solid #000;padding:5px;font-weight:bold;text-transform:uppercase;font-size:12px;margin-top:8px;letter-spacing:1px}.footer{text-align:center;font-size:10px;color:#666;margin-top:10px}</style>
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
\${(order.order_items||[]).map(i => \`<div class="item">• \${i.menu_items?.name} x\${i.quantity}\${i.menu_items?.is_live_counter?' <em>[Live]</em>':''}</div>\`).join('')}
<div class="divider"></div>
<div class="status">Status: \${STATUS_LABELS[order.status]||order.status}</div>
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
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <h2 style={{ fontSize:20, fontWeight:800 }}>Live Orders</h2>
        <button onClick={loadOrders} style={{ background:'var(--ink)', color:'#fff', border:'none', borderRadius:10, padding:'8px 16px', fontSize:13, fontWeight:700 }}>Refresh</button>
      </div>
      <div style={{ display:'flex', gap:8, marginBottom:16 }}>
        {[['active','Active'],['delivered','Delivered'],['all','All']].map(([val,label]) => (
          <button key={val} onClick={() => setFilter(val)} style={{ flex:1, padding:'8px 4px', background:filter===val?'var(--ink)':'#fff', color:filter===val?'#fff':'var(--ink)', border:'1.5px solid', borderColor:filter===val?'var(--ink)':'var(--line)', borderRadius:10, fontSize:13, fontWeight:700 }}>{label}</button>
        ))}
      </div>
      {loading ? <div style={{ textAlign:'center', padding:60, color:'var(--ink2)' }}>Loading orders...</div>
      : filtered.length === 0 ? (
        <div style={{ textAlign:'center', padding:60 }}>
          <div style={{ fontSize:48, marginBottom:12 }}>📭</div>
          <div style={{ color:'var(--ink2)', fontWeight:600 }}>No orders yet</div>
          <div style={{ color:'var(--ink2)', fontSize:13, marginTop:4 }}>Orders from guests will appear here instantly</div>
        </div>
      ) : filtered.map(order => (
        <div key={order.id} style={{ background:'#fff', borderRadius:18, padding:18, marginBottom:14, boxShadow:'var(--shadow)', borderLeft:'4px solid '+(STATUS_COLORS[order.status]||'#999') }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:12 }}>
            <div>
              <div style={{ fontSize:22, fontWeight:800 }}>Table {order.tables?.table_number}</div>
              <div style={{ fontSize:12, color:'var(--ink2)', marginTop:2 }}>{new Date(order.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} · #{order.id.slice(-6).toUpperCase()}</div>
            </div>
            <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:6 }}>
              <div style={{ background:(STATUS_COLORS[order.status]||'#999')+'20', color:STATUS_COLORS[order.status]||'#999', fontSize:12, fontWeight:700, padding:'4px 12px', borderRadius:999 }}>{STATUS_LABELS[order.status]}</div>
              <button onClick={() => printKOT(order)} style={{ background:'var(--bg)', border:'1px solid var(--line)', borderRadius:8, padding:'4px 10px', fontSize:12, fontWeight:600, color:'var(--ink2)' }}>🖨 Print KOT</button>
            </div>
          </div>
          <div style={{ borderTop:'1px solid var(--line)', paddingTop:12, marginBottom:12 }}>
            {order.order_items?.map((oi,i) => (
              <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'5px 0', fontSize:14 }}>
                <span style={{ fontWeight:600 }}>{oi.menu_items?.name} {oi.menu_items?.is_live_counter && <span style={{ fontSize:11, color:'#D97706' }}>Live</span>}</span>
                <span style={{ fontWeight:800, color:'var(--ink2)' }}>x{oi.quantity}</span>
              </div>
            ))}
          </div>
          <div style={{ display:'flex', gap:8 }}>
            {STATUS_FLOW[order.status] && <button onClick={() => updateStatus(order)} style={{ flex:1, background:'var(--ink)', color:'#fff', border:'none', borderRadius:12, padding:'12px 8px', fontSize:14, fontWeight:800 }}>{STATUS_NEXT_LABEL[order.status]} →</button>}
            {['pending','in_preparation'].includes(order.status) && <button onClick={() => cancelOrder(order.id)} style={{ background:'#FEF2F2', border:'1px solid #FECACA', color:'#DC2626', borderRadius:12, padding:'12px 14px', fontSize:13, fontWeight:700 }}>Cancel</button>}
          </div>
        </div>
      ))}
    </div>
  )
}
`)
console.log('✅ 5/6 KOTDashboard.jsx — KOT print with event name + date + time')

// ═══════════════════════════════════════════════════════════════════
// FIX 6: MenuManager — add category creation + CSV import
// ═══════════════════════════════════════════════════════════════════
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
  const [newItem, setNewItem] = useState({ name:'', description:'', is_live_counter:false })
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
    if (!newItem.name.trim() || !activeCategory) return
    setSaving(true)
    await supabase.from('menu_items').insert({ category_id:activeCategory, name:newItem.name, description:newItem.description, is_live_counter:newItem.is_live_counter, is_available:true })
    setNewItem({ name:'', description:'', is_live_counter:false }); setShowAdd(false); setSaving(false)
    loadMenu()
  }

  async function handleCSVImport(e) {
    const file = e.target.files[0]
    if (!file) return
    setImporting(true); setImportResult(null)
    const text = await file.text()
    const lines = text.split('\\n').map(l => l.trim()).filter(Boolean)
    if (lines.length < 2) { setImportResult({ error:'CSV must have a header row and at least one item.' }); setImporting(false); return }

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[^a-z_]/g,''))
    const nameIdx = headers.findIndex(h => h.includes('name'))
    const descIdx = headers.findIndex(h => h.includes('desc'))
    const catIdx  = headers.findIndex(h => h.includes('cat'))
    const liveIdx = headers.findIndex(h => h.includes('live'))

    if (nameIdx === -1) { setImportResult({ error:'CSV must have a "name" column.' }); setImporting(false); return }

    let added = 0; let skipped = 0
    const catCache = {}
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g,''))
      const itemName = cols[nameIdx]
      if (!itemName) { skipped++; continue }
      const desc = descIdx >= 0 ? cols[descIdx]||'' : ''
      const catName = catIdx >= 0 ? cols[catIdx]||'General' : 'General'
      const isLive = liveIdx >= 0 ? ['yes','true','1'].includes((cols[liveIdx]||'').toLowerCase()) : false

      if (!catCache[catName]) {
        let cat = categories.find(c => c.name.toLowerCase() === catName.toLowerCase())
        if (!cat) {
          const { data } = await supabase.from('menu_categories').insert({ event_id:eventData.id, name:catName, sort_order:Object.keys(catCache).length+categories.length+1, is_visible:true }).select().single()
          cat = data
        }
        catCache[catName] = cat?.id
      }
      if (!catCache[catName]) { skipped++; continue }

      const existing = items.find(it => it.name.toLowerCase() === itemName.toLowerCase())
      if (existing) { skipped++; continue }

      await supabase.from('menu_items').insert({ category_id:catCache[catName], name:itemName, description:desc, is_live_counter:isLive, is_available:true })
      added++
    }

    setImportResult({ added, skipped })
    setImporting(false)
    loadMenu()
    e.target.value = ''
  }

  const filtered = items.filter(i => i.category_id === activeCategory)

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
        <h2 style={{ fontSize:20, fontWeight:800 }}>Menu Manager</h2>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={() => fileRef.current?.click()} disabled={importing} style={{ background:'#F0FDF4', border:'1px solid #BBF7D0', color:'#16A34A', borderRadius:10, padding:'8px 14px', fontSize:13, fontWeight:700, cursor:'pointer' }}>
            {importing ? 'Importing...' : '📥 Import CSV'}
          </button>
          <button onClick={() => setShowAdd(true)} style={{ background:'var(--ink)', color:'#fff', border:'none', borderRadius:10, padding:'8px 16px', fontSize:13, fontWeight:700 }}>+ Add Dish</button>
        </div>
        <input ref={fileRef} type="file" accept=".csv,.txt" onChange={handleCSVImport} style={{ display:'none' }} />
      </div>

      {importResult && (
        <div style={{ background: importResult.error?'#FEF2F2':'#F0FDF4', border:'1px solid', borderColor:importResult.error?'#FECACA':'#BBF7D0', borderRadius:12, padding:'12px 16px', marginBottom:16, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontSize:13, fontWeight:600, color:importResult.error?'#DC2626':'#16A34A' }}>
            {importResult.error || \`✅ Imported \${importResult.added} dishes, skipped \${importResult.skipped}\`}
          </span>
          <button onClick={() => setImportResult(null)} style={{ background:'none', border:'none', fontSize:16, cursor:'pointer', color:'#999' }}>✕</button>
        </div>
      )}

      <div style={{ background:'#EFF6FF', borderRadius:12, padding:'10px 14px', marginBottom:16, fontSize:12, color:'#2563EB' }}>
        📋 CSV format: <strong>name, description, category, is_live_counter</strong> — description/category/is_live_counter are optional
      </div>

      <div style={{ display:'flex', gap:8, marginBottom:12, overflowX:'auto', flexWrap:'nowrap' }}>
        {categories.map(cat => (
          <button key={cat.id} onClick={() => setActiveCategory(cat.id)} style={{ flexShrink:0, background:activeCategory===cat.id?'var(--ink)':'#fff', color:activeCategory===cat.id?'#fff':'var(--ink)', border:'1.5px solid', borderColor:activeCategory===cat.id?'var(--ink)':'var(--line)', borderRadius:999, padding:'8px 18px', fontSize:13, fontWeight:700 }}>
            {cat.name} ({items.filter(i=>i.category_id===cat.id).length})
          </button>
        ))}
        <button onClick={() => setShowAddCat(true)} style={{ flexShrink:0, background:'#FEF3C7', border:'1.5px solid #FCD34D', color:'#92400E', borderRadius:999, padding:'8px 16px', fontSize:13, fontWeight:700 }}>+ Category</button>
      </div>

      {showAddCat && (
        <div style={{ background:'#fff', borderRadius:14, padding:16, marginBottom:14, boxShadow:'var(--shadow)', border:'2px solid #E8890C' }}>
          <div style={{ fontWeight:800, fontSize:14, marginBottom:10 }}>New Category</div>
          <input value={newCatName} onChange={e => setNewCatName(e.target.value)} placeholder="Category name (e.g. Starters, Main Course)"
            style={{ width:'100%', border:'1.5px solid var(--line)', borderRadius:10, padding:'10px 14px', fontSize:14, marginBottom:10, fontFamily:'Manrope', outline:'none', boxSizing:'border-box' }} />
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={addCategory} disabled={saving} style={{ flex:1, background:'#E8890C', color:'#fff', border:'none', borderRadius:10, padding:'10px', fontSize:14, fontWeight:800 }}>{saving?'Saving...':'Save Category'}</button>
            <button onClick={() => { setShowAddCat(false); setNewCatName('') }} style={{ flex:1, background:'var(--bg)', border:'1.5px solid var(--line)', borderRadius:10, padding:'10px', fontSize:14, fontWeight:700 }}>Cancel</button>
          </div>
        </div>
      )}

      {showAdd && (
        <div style={{ background:'#fff', borderRadius:16, padding:20, marginBottom:16, boxShadow:'var(--shadow)', border:'2px solid var(--ink)' }}>
          <h3 style={{ fontSize:16, fontWeight:800, marginBottom:16 }}>Add New Dish</h3>
          <input value={newItem.name} onChange={e => setNewItem(p=>({...p,name:e.target.value}))} placeholder="Dish name *"
            style={{ width:'100%', border:'1.5px solid var(--line)', borderRadius:10, padding:'10px 14px', fontSize:14, marginBottom:10, fontFamily:'Manrope', outline:'none', boxSizing:'border-box' }} />
          <textarea value={newItem.description} onChange={e => setNewItem(p=>({...p,description:e.target.value}))} placeholder="Description (optional)"
            style={{ width:'100%', border:'1.5px solid var(--line)', borderRadius:10, padding:'10px 14px', fontSize:14, marginBottom:10, fontFamily:'Manrope', outline:'none', resize:'none', height:72, boxSizing:'border-box' }} />
          <label style={{ display:'flex', alignItems:'center', gap:10, marginBottom:16, cursor:'pointer' }}>
            <input type="checkbox" checked={newItem.is_live_counter} onChange={e => setNewItem(p=>({...p,is_live_counter:e.target.checked}))} />
            <span style={{ fontSize:14, fontWeight:600 }}>Live counter item</span>
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
          <div style={{ fontWeight:700, fontSize:16, marginBottom:8 }}>No categories yet</div>
          <div style={{ color:'var(--ink2)', fontSize:14 }}>Click "+ Category" to create your first category, then add dishes or import from CSV</div>
        </div>
      ) : filtered.length === 0 ? <div style={{ textAlign:'center', padding:40, color:'var(--ink2)' }}>No dishes in this category. Click "+ Add Dish" to add one.</div>
      : filtered.map(item => (
        <div key={item.id} style={{ background:'#fff', borderRadius:14, padding:'14px 16px', marginBottom:10, boxShadow:'var(--shadow)', display:'flex', alignItems:'center', justifyContent:'space-between', opacity:item.is_available?1:0.5 }}>
          <div style={{ flex:1 }}>
            <div style={{ fontWeight:700, fontSize:15 }}>{item.name}</div>
            {item.description && <div style={{ fontSize:12, color:'var(--ink2)', marginTop:2 }}>{item.description}</div>}
            <div style={{ display:'flex', gap:6, marginTop:6 }}>
              {item.is_live_counter && <span style={{ fontSize:11, color:'#D97706', fontWeight:600, background:'#FEF3C7', padding:'2px 8px', borderRadius:999 }}>Live</span>}
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
console.log('✅ 6/6 MenuManager.jsx — category creation + CSV import done')

console.log('\n🎉 All 6 fixes written successfully!')
console.log('Now run the SQL in Supabase, then: npm run dev')
