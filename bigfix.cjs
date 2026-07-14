const fs = require('fs')
const BASE = '/Users/asayyed/SmartServe/src'

// ═══════════════════════════════════════════
// FIX 1: MenuScreen — horizontal category tabs on top, then list below
// ═══════════════════════════════════════════
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
    if (search.length > 0) return i.name.toLowerCase().includes(search.toLowerCase())
    const catMatch = activeCategory === 'all' || i.category_id === activeCategory
    const vegMatch = vegMode === 'all' || (vegMode === 'veg' ? i.is_veg !== false : i.is_veg === false)
    return catMatch && vegMatch
  })

  const getQty = (id) => cart.find(c => c.id === id)?.quantity || 0

  return (
    <div style={{ minHeight:'100vh', background:'#f5f5f5', display:'flex', flexDirection:'column', paddingBottom: cartCount > 0 ? 100 : 24 }}>

      {/* HEADER */}
      <div style={{ background:'#1a0a0a', padding:'12px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:40 }}>
        <div style={{ color:'#fff', fontWeight:800, fontSize:17 }}>Janu's <span style={{ color:'#E8890C' }}>Smart Serve</span></div>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          {isOnline === false && <span style={{ background:'#DC2626', color:'#fff', fontSize:10, fontWeight:700, padding:'2px 6px', borderRadius:999 }}>OFFLINE</span>}
          <div style={{ background:'rgba(255,255,255,0.15)', color:'#fff', fontSize:12, fontWeight:700, padding:'5px 12px', borderRadius:999 }}>TABLE {tableNumber}</div>
        </div>
      </div>

      {/* ACTION BAR */}
      <div style={{ display:'flex', gap:8, padding:'8px 14px', background:'#fff', borderBottom:'1px solid #eee', overflowX:'auto', alignItems:'center' }}>
        {currentOrderId && <button onClick={onShowStatus} style={{ flexShrink:0, background:'#16A34A', color:'#fff', border:'none', borderRadius:999, padding:'6px 14px', fontSize:12, fontWeight:700, cursor:'pointer' }}>📦 Track Order</button>}
        <button onClick={onShowHistory} style={{ flexShrink:0, background:'#fff', color:'#333', border:'1.5px solid #ddd', borderRadius:999, padding:'6px 14px', fontSize:12, fontWeight:600, cursor:'pointer' }}>📋 History</button>
        <button onClick={onShowSOS} style={{ flexShrink:0, background:'#FEF3C7', color:'#92400E', border:'1.5px solid #FCD34D', borderRadius:999, padding:'6px 14px', fontSize:12, fontWeight:700, cursor:'pointer' }}>🆘 Need Help?</button>
        <button onClick={onShowFeedback} style={{ flexShrink:0, background:'#FFF7ED', color:'#C2410C', border:'1.5px solid #FED7AA', borderRadius:999, padding:'6px 14px', fontSize:12, fontWeight:700, cursor:'pointer' }}>⭐ Feedback</button>
      </div>

      {/* SEARCH */}
      <div style={{ padding:'10px 14px', background:'#fff', borderBottom:'1px solid #eee' }}>
        <div style={{ background:'#f5f5f5', borderRadius:12, padding:'9px 14px', display:'flex', alignItems:'center', gap:8, border:'1.5px solid #eee' }}>
          <span>🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search dishes..."
            style={{ border:'none', outline:'none', flex:1, fontSize:14, fontFamily:'Manrope', background:'transparent' }} />
          {search.length > 0 && <button onClick={() => setSearch('')} style={{ background:'none', border:'none', fontSize:16, color:'#999', cursor:'pointer' }}>✕</button>}
        </div>
      </div>

      {/* VEG/NON-VEG FILTER */}
      <div style={{ display:'flex', gap:8, padding:'10px 14px', background:'#fff', borderBottom:'1px solid #eee', overflowX:'auto' }}>
        {[['all','🍽️ All'],['veg','🟢 Veg Only'],['nonveg','🔴 Non-Veg Only']].map(([val,label]) => (
          <button key={val} onClick={() => setVegMode(val)} style={{
            flexShrink:0, padding:'6px 16px', borderRadius:999, fontSize:12, fontWeight:700, border:'1.5px solid',
            background: vegMode===val ? (val==='veg'?'#16A34A':val==='nonveg'?'#DC2626':'#1a0a0a') : '#fff',
            color: vegMode===val ? '#fff' : '#555', borderColor: vegMode===val ? 'transparent' : '#ddd', cursor:'pointer'
          }}>{label}</button>
        ))}
      </div>

      {/* CATEGORY TABS — horizontal scrollable */}
      {search.length === 0 && (
        <div style={{ display:'flex', gap:0, background:'#fff', borderBottom:'2px solid #eee', overflowX:'auto', scrollbarWidth:'none' }}>
          {[{ id:'all', name:'All', count: items.length }, ...categories.map(c => ({ id:c.id, name:c.name, count: items.filter(i=>i.category_id===c.id).length }))].map(cat => (
            <button key={cat.id} onClick={() => setActiveCategory(cat.id)} style={{
              flexShrink:0, padding:'12px 18px', border:'none', background:'transparent', cursor:'pointer',
              borderBottom: activeCategory===cat.id ? '3px solid #E8890C' : '3px solid transparent',
              color: activeCategory===cat.id ? '#E8890C' : '#555',
              fontWeight: activeCategory===cat.id ? 800 : 600, fontSize:13, whiteSpace:'nowrap',
              marginBottom:'-2px'
            }}>
              {cat.name} <span style={{ fontSize:11, opacity:0.7 }}>({cat.count})</span>
            </button>
          ))}
        </div>
      )}

      {/* MENU LIST — Zomato style 1 per row */}
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
            <div key={item.id} style={{ background:'#fff', borderBottom:'1px solid #f0f0f0', padding:'16px 14px', display:'flex', gap:12, alignItems:'flex-start' }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ marginBottom:5 }}>
                  <span style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:16, height:16, borderRadius:3, border:'1.5px solid '+(isVeg?'#16A34A':'#DC2626') }}>
                    <span style={{ width:8, height:8, borderRadius:'50%', background:isVeg?'#16A34A':'#DC2626', display:'block' }}></span>
                  </span>
                  {item.is_live_counter && <span style={{ marginLeft:8, fontSize:10, color:'#D97706', fontWeight:700, background:'#FEF3C7', padding:'2px 7px', borderRadius:999 }}>⏱ Live counter</span>}
                </div>
                <div style={{ fontWeight:700, fontSize:15, color:'#1a1a1a', marginBottom:4, lineHeight:1.3 }}>{item.name}</div>
                {item.description && <div style={{ fontSize:12, color:'#888', lineHeight:1.5, marginBottom:10, display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>{item.description}</div>}
                {qty === 0 ? (
                  <button onClick={() => addToCart(item)} style={{ background:'#fff', color:'#E8890C', border:'1.5px solid #E8890C', borderRadius:8, padding:'7px 24px', fontSize:13, fontWeight:800, cursor:'pointer' }}>ADD +</button>
                ) : (
                  <div style={{ display:'inline-flex', alignItems:'center', background:'#E8890C', borderRadius:8, overflow:'hidden' }}>
                    <button onClick={() => removeFromCart(item.id)} style={{ background:'none', border:'none', color:'#fff', fontSize:18, fontWeight:800, cursor:'pointer', padding:'6px 14px', lineHeight:1 }}>−</button>
                    <span style={{ color:'#fff', fontWeight:800, fontSize:14, minWidth:20, textAlign:'center' }}>{qty}</span>
                    <button onClick={() => addToCart(item)} style={{ background:'none', border:'none', color:'#fff', fontSize:18, fontWeight:800, cursor:'pointer', padding:'6px 14px', lineHeight:1 }}>+</button>
                  </div>
                )}
              </div>
              <div style={{ flexShrink:0, width:110, height:90, borderRadius:12, overflow:'hidden' }}>
                {item.photo_url ? (
                  <img src={item.photo_url} alt={item.name} style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                ) : (
                  <div style={{ width:'100%', height:'100%', background:'linear-gradient(135deg,#F7F4FB,#E8E0F0)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:36 }}>🍽️</div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* FLOATING FEEDBACK BUBBLE */}
      {showFeedbackBubble && (
        <>
          <style>{\`@keyframes fbBounce{0%,100%{transform:translateY(0)}40%{transform:translateY(-12px)}70%{transform:translateY(-5px)}}.fb-bubble{animation:fbBounce 2s ease-in-out infinite}\`}</style>
          <button className="fb-bubble" onClick={onFeedbackBubbleClick} style={{ position:'fixed', bottom: cartCount>0?90:28, right:16, zIndex:80, background:'#E8890C', border:'none', borderRadius:50, padding:'13px 16px', display:'flex', flexDirection:'column', alignItems:'center', gap:3, cursor:'pointer', boxShadow:'0 8px 28px rgba(232,137,12,0.55)', color:'#fff', minWidth:72 }}>
            <span style={{ fontSize:26 }}>⭐</span>
            <span style={{ fontSize:10, fontWeight:800 }}>Rate Us!</span>
          </button>
        </>
      )}
    </div>
  )
}
`)
console.log('✅ 1/6 MenuScreen — horizontal tabs on top, feedback button always visible')

// ═══════════════════════════════════════════
// FIX 2: GuestApp — wire onShowFeedback
// ═══════════════════════════════════════════
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
      .on('postgres_changes', { event:'UPDATE', schema:'public', table:'orders', filter:'id=eq.'+currentOrderId }, payload => {
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
      if (tables?.length) { setTableData(tables[0]) }
      else {
        const { data: newTable } = await supabase.from('tables').insert({ event_id:event.id, table_number:tNum, is_active:true }).select().single()
        if (newTable) setTableData(newTable)
      }
    } catch(e) {
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
      if (exists) return prev.map(c => c.id===item.id ? { ...c, quantity:c.quantity+1 } : c)
      return [...prev, { ...item, quantity:1 }]
    })
  }
  function removeFromCart(itemId) {
    setCart(prev => {
      const exists = prev.find(c => c.id === itemId)
      if (exists?.quantity===1) return prev.filter(c => c.id !== itemId)
      return prev.map(c => c.id===itemId ? { ...c, quantity:c.quantity-1 } : c)
    })
  }
  const cartCount = cart.reduce((s,i) => s+i.quantity, 0)

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', position:'relative' }}>
      {screen==='welcome' && <WelcomeScreen tableNumber={tableNumber} onStart={() => setScreen('menu')} eventData={eventData} />}
      {screen==='menu' && (
        <MenuScreen tableData={tableData} eventData={eventData} tableNumber={tableNumber}
          cart={cart} addToCart={addToCart} removeFromCart={removeFromCart}
          cartCount={cartCount} isOnline={isOnline}
          onShowSOS={() => setShowSOS(true)} onShowHistory={() => setShowHistory(true)}
          onShowStatus={() => setScreen('status')} currentOrderId={currentOrderId}
          showFeedbackBubble={showFeedbackBubble}
          onFeedbackBubbleClick={() => { setShowFeedbackBubble(false); setShowFeedback(true) }}
          onShowFeedback={() => setShowFeedback(true)} />
      )}
      {screen==='status' && <OrderStatus orderId={currentOrderId} tableNumber={tableNumber} onBack={() => setScreen('menu')} />}
      {cartCount>0 && screen==='menu' && (
        <CartDrawer cart={cart} tableData={tableData} eventData={eventData} isOnline={isOnline}
          onOrderPlaced={(id) => { setCurrentOrderId(id); setCart([]); setScreen('status') }}
          onRemove={removeFromCart} onAdd={addToCart} />
      )}
      {showSOS && <SOSPanel tableData={tableData} eventData={eventData} onClose={() => setShowSOS(false)} />}
      {showHistory && <OrderHistory tableData={tableData} eventData={eventData} onClose={() => setShowHistory(false)} />}
      {showFeedback && <FeedbackModal orderId={currentOrderId} tableData={tableData} eventData={eventData} onClose={() => { setShowFeedback(false); setScreen('menu') }} />}
    </div>
  )
}
`)
console.log('✅ 2/6 GuestApp — feedback always accessible via button')

// ═══════════════════════════════════════════
// FIX 3: SupervisorLogin — username + password
// ═══════════════════════════════════════════
fs.writeFileSync(BASE + '/components/supervisor/SupervisorLogin.jsx', `import { useState } from 'react'
import { supabase } from '../../lib/supabase'

export default function SupervisorLogin({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPass, setShowPass] = useState(false)

  async function handleLogin() {
    if (!username.trim() || !password.trim()) { setError('Please enter username and password'); return }
    setLoading(true); setError('')
    try {
      // Check admins table first
      const { data: admins } = await supabase.from('admins').select('*').eq('username', username.trim()).eq('pin', password.trim()).eq('is_active', true).limit(1)
      if (admins?.length) { onLogin({ ...admins[0], role:'admin' }); return }

      // Check supervisors table
      const { data: sups } = await supabase.from('supervisors').select('*').eq('name', username.trim()).eq('pin', password.trim()).eq('is_active', true).limit(1)
      if (sups?.length) { onLogin({ ...sups[0], role:'supervisor' }); return }

      // Demo fallback: admin / 1234
      if (username.trim() === 'admin' && password.trim() === '1234') {
        onLogin({ name:'Admin', role:'admin', id:'demo' }); return
      }
      // Supervisor demo fallback: supervisor / 1234
      if (username.trim() === 'supervisor' && password.trim() === '1234') {
        onLogin({ name:'Supervisor', role:'supervisor', id:'demo-sup' }); return
      }

      setError('Incorrect username or password. Please try again.')
    } catch(e) {
      if (username.trim()==='admin' && password.trim()==='1234') { onLogin({ name:'Admin', role:'admin', id:'demo' }); return }
      setError('Connection error. Try again.')
    } finally { setLoading(false) }
  }

  function onKey(e) { if (e.key === 'Enter') handleLogin() }

  return (
    <div style={{ minHeight:'100vh', background:'linear-gradient(160deg,#2A1B2E 0%,#4A2340 50%,#8E2A5C 100%)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ fontSize:48, marginBottom:12 }}>👨‍💼</div>
      <h1 style={{ color:'#fff', fontSize:26, fontWeight:800, marginBottom:4 }}>Janu's <span style={{ color:'#E8890C' }}>Smart Serve</span></h1>
      <p style={{ color:'rgba(255,255,255,0.6)', fontSize:14, marginBottom:40 }}>Supervisor & Admin Access</p>

      <div style={{ background:'rgba(255,255,255,0.08)', borderRadius:24, padding:'32px 24px', width:'100%', maxWidth:360 }}>
        <div style={{ marginBottom:16 }}>
          <label style={{ color:'rgba(255,255,255,0.7)', fontSize:13, fontWeight:600, display:'block', marginBottom:6 }}>Username</label>
          <input value={username} onChange={e => { setUsername(e.target.value); setError('') }} onKeyDown={onKey}
            placeholder="Enter your username"
            style={{ width:'100%', background:'rgba(255,255,255,0.1)', border:'1px solid rgba(255,255,255,0.2)', borderRadius:12, padding:'12px 16px', fontSize:15, color:'#fff', outline:'none', boxSizing:'border-box', fontFamily:'Manrope' }} />
        </div>
        <div style={{ marginBottom:24, position:'relative' }}>
          <label style={{ color:'rgba(255,255,255,0.7)', fontSize:13, fontWeight:600, display:'block', marginBottom:6 }}>Password / PIN</label>
          <input value={password} onChange={e => { setPassword(e.target.value); setError('') }} onKeyDown={onKey}
            type={showPass ? 'text' : 'password'} placeholder="Enter your password or PIN"
            style={{ width:'100%', background:'rgba(255,255,255,0.1)', border:'1px solid rgba(255,255,255,0.2)', borderRadius:12, padding:'12px 48px 12px 16px', fontSize:15, color:'#fff', outline:'none', boxSizing:'border-box', fontFamily:'Manrope' }} />
          <button onClick={() => setShowPass(p => !p)} style={{ position:'absolute', right:12, top:34, background:'none', border:'none', color:'rgba(255,255,255,0.5)', cursor:'pointer', fontSize:18 }}>
            {showPass ? '🙈' : '👁️'}
          </button>
        </div>

        {error && <div style={{ background:'rgba(220,38,38,0.2)', border:'1px solid rgba(220,38,38,0.4)', borderRadius:10, padding:'10px 14px', color:'#FCA5A5', fontSize:13, textAlign:'center', marginBottom:16 }}>{error}</div>}

        <button onClick={handleLogin} disabled={loading} style={{ width:'100%', background: loading?'#888':'#E8890C', color:'#fff', border:'none', borderRadius:14, padding:'16px', fontSize:16, fontWeight:800, cursor:loading?'wait':'pointer' }}>
          {loading ? 'Signing in...' : 'Sign In →'}
        </button>

        <div style={{ marginTop:20, padding:'14px', background:'rgba(255,255,255,0.05)', borderRadius:12, fontSize:12, color:'rgba(255,255,255,0.5)', textAlign:'center', lineHeight:1.8 }}>
          <strong style={{ color:'rgba(255,255,255,0.8)' }}>Demo credentials</strong><br/>
          Admin: <code>admin</code> / <code>1234</code><br/>
          Supervisor: <code>supervisor</code> / <code>1234</code>
        </div>
      </div>
    </div>
  )
}
`)
console.log('✅ 3/6 SupervisorLogin — username + password, admin vs supervisor clearly separated')

// ═══════════════════════════════════════════
// FIX 4: MenuManager — add category, veg toggle, image URL field
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
      category_id: catId,
      name: newItem.name.trim(),
      description: newItem.description.trim(),
      is_live_counter: newItem.is_live_counter,
      is_veg: newItem.is_veg,
      photo_url: newItem.photo_url.trim() || null,
      is_available: true
    })
    setNewItem({ name:'', description:'', is_live_counter:false, is_veg:true, photo_url:'', category_id:'' })
    setShowAdd(false); setSaving(false)
    loadMenu()
  }

  async function handleCSVImport(e) {
    const file = e.target.files[0]
    if (!file) return
    setImporting(true); setImportResult(null)
    const text = await file.text()
    const lines = text.split('\\n').map(l=>l.trim()).filter(Boolean)
    if (lines.length < 2) { setImportResult({ error:'CSV needs header + at least 1 item.' }); setImporting(false); return }
    const headers = lines[0].split(',').map(h=>h.trim().toLowerCase().replace(/[^a-z_]/g,''))
    const nameIdx = headers.findIndex(h=>h.includes('name'))
    const descIdx = headers.findIndex(h=>h.includes('desc'))
    const catIdx  = headers.findIndex(h=>h.includes('cat'))
    const liveIdx = headers.findIndex(h=>h.includes('live'))
    const vegIdx  = headers.findIndex(h=>h.includes('veg'))
    const imgIdx  = headers.findIndex(h=>h.includes('image')||h.includes('photo')||h.includes('url'))
    if (nameIdx === -1) { setImportResult({ error:'CSV needs a "name" column.' }); setImporting(false); return }
    let added=0, skipped=0
    const catCache = {}
    for (let i=1; i<lines.length; i++) {
      const cols = lines[i].split(',').map(c=>c.trim().replace(/^"|"$/g,''))
      const itemName = cols[nameIdx]
      if (!itemName) { skipped++; continue }
      const desc    = descIdx>=0 ? cols[descIdx]||'' : ''
      const catName = catIdx>=0  ? cols[catIdx]||'General' : 'General'
      const isLive  = liveIdx>=0 ? ['yes','true','1'].includes((cols[liveIdx]||'').toLowerCase()) : false
      const isVeg   = vegIdx>=0  ? !['no','false','0','nonveg','non-veg'].includes((cols[vegIdx]||'').toLowerCase()) : true
      const imgUrl  = imgIdx>=0  ? cols[imgIdx]||'' : ''
      if (!catCache[catName]) {
        let cat = categories.find(c=>c.name.toLowerCase()===catName.toLowerCase())
        if (!cat) {
          const { data } = await supabase.from('menu_categories').insert({ event_id:eventData.id, name:catName, sort_order:Object.keys(catCache).length+categories.length+1, is_visible:true }).select().single()
          cat = data
        }
        catCache[catName] = cat?.id
      }
      if (!catCache[catName]) { skipped++; continue }
      const existing = items.find(it=>it.name.toLowerCase()===itemName.toLowerCase())
      if (existing) { skipped++; continue }
      await supabase.from('menu_items').insert({ category_id:catCache[catName], name:itemName, description:desc, is_live_counter:isLive, is_veg:isVeg, photo_url:imgUrl||null, is_available:true })
      added++
    }
    setImportResult({ added, skipped })
    setImporting(false)
    loadMenu()
    e.target.value = ''
  }

  const filtered = items.filter(i => i.category_id === activeCategory)

  const INP = { width:'100%', border:'1.5px solid var(--line)', borderRadius:10, padding:'10px 14px', fontSize:14, marginBottom:10, fontFamily:'Manrope', outline:'none', boxSizing:'border-box' }

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
        <div style={{ background:importResult.error?'#FEF2F2':'#F0FDF4', border:'1px solid', borderColor:importResult.error?'#FECACA':'#BBF7D0', borderRadius:12, padding:'12px 16px', marginBottom:16, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontSize:13, fontWeight:600, color:importResult.error?'#DC2626':'#16A34A' }}>
            {importResult.error || '✅ Imported '+importResult.added+' dishes, skipped '+importResult.skipped+' duplicates'}
          </span>
          <button onClick={() => setImportResult(null)} style={{ background:'none', border:'none', fontSize:16, cursor:'pointer', color:'#999' }}>✕</button>
        </div>
      )}

      <div style={{ background:'#EFF6FF', borderRadius:12, padding:'10px 14px', marginBottom:16, fontSize:12, color:'#2563EB' }}>
        📋 CSV columns: <strong>name, description, category, is_live_counter, is_veg, image_url</strong> — only name is required
      </div>

      {/* Category tabs */}
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
          <input value={newCatName} onChange={e => setNewCatName(e.target.value)} placeholder="e.g. Starters, Main Course, Desserts" style={INP} />
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

          {/* Category selector */}
          <select value={newItem.category_id||activeCategory||''} onChange={e => setNewItem(p=>({...p,category_id:e.target.value}))}
            style={{ ...INP, background:'#fff' }}>
            <option value="">Select category *</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

          {/* Image URL */}
          <input value={newItem.photo_url} onChange={e => setNewItem(p=>({...p,photo_url:e.target.value}))} placeholder="Image URL (optional) — paste any image link" style={INP} />

          {/* Veg / Non-veg */}
          <div style={{ display:'flex', gap:10, marginBottom:12 }}>
            <button onClick={() => setNewItem(p=>({...p,is_veg:true}))} style={{ flex:1, background:newItem.is_veg?'#16A34A':'#fff', color:newItem.is_veg?'#fff':'#333', border:'1.5px solid', borderColor:newItem.is_veg?'#16A34A':'#ddd', borderRadius:10, padding:'10px', fontSize:13, fontWeight:700, cursor:'pointer' }}>🟢 Veg</button>
            <button onClick={() => setNewItem(p=>({...p,is_veg:false}))} style={{ flex:1, background:!newItem.is_veg?'#DC2626':'#fff', color:!newItem.is_veg?'#fff':'#333', border:'1.5px solid', borderColor:!newItem.is_veg?'#DC2626':'#ddd', borderRadius:10, padding:'10px', fontSize:13, fontWeight:700, cursor:'pointer' }}>🔴 Non-Veg</button>
          </div>

          {/* Live counter */}
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
          <div style={{ fontWeight:700, fontSize:16, marginBottom:8 }}>No categories yet</div>
          <div style={{ color:'var(--ink2)', fontSize:14 }}>Click "+ Category" to create your first, then add dishes</div>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign:'center', padding:40, color:'var(--ink2)' }}>No dishes here. Click "+ Add Dish".</div>
      ) : filtered.map(item => (
        <div key={item.id} style={{ background:'#fff', borderRadius:14, padding:'14px 16px', marginBottom:10, boxShadow:'var(--shadow)', display:'flex', alignItems:'center', justifyContent:'space-between', opacity:item.is_available?1:0.5 }}>
          {item.photo_url && <img src={item.photo_url} alt={item.name} style={{ width:48, height:48, objectFit:'cover', borderRadius:8, marginRight:12, flexShrink:0 }} />}
          <div style={{ flex:1 }}>
            <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:2 }}>
              <span style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:14, height:14, borderRadius:2, border:'1.5px solid '+(item.is_veg!==false?'#16A34A':'#DC2626') }}>
                <span style={{ width:6, height:6, borderRadius:'50%', background:item.is_veg!==false?'#16A34A':'#DC2626', display:'block' }}></span>
              </span>
              <span style={{ fontWeight:700, fontSize:15 }}>{item.name}</span>
            </div>
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
console.log('✅ 4/6 MenuManager — category selector, veg/non-veg, image URL, CSV import')

// ═══════════════════════════════════════════
// FIX 5: ReportsDashboard — full event report
// ═══════════════════════════════════════════
fs.writeFileSync(BASE + '/components/supervisor/ReportsDashboard.jsx', `import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

export default function ReportsDashboard({ eventData }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (eventData) loadReport() }, [eventData])

  async function loadReport() {
    setLoading(true)
    const [ordersRes, sosRes, fbRes] = await Promise.all([
      supabase.from('orders').select('*, tables(table_number), order_items(quantity, menu_items(name))').eq('event_id', eventData.id),
      supabase.from('sos_requests').select('*').eq('event_id', eventData.id),
      supabase.from('feedback').select('*').eq('event_id', eventData.id)
    ])
    const orders = ordersRes.data || []
    const sos    = sosRes.data   || []
    const fb     = fbRes.data    || []

    // Table stats
    const tableMap = {}
    orders.forEach(o => {
      const t = o.tables?.table_number || '?'
      if (!tableMap[t]) tableMap[t] = { table:t, orders:0, items:0, delivered:0, cancelled:0 }
      tableMap[t].orders++
      if (o.status==='delivered') tableMap[t].delivered++
      if (o.status==='cancelled') tableMap[t].cancelled++
      o.order_items?.forEach(oi => { tableMap[t].items += oi.quantity })
    })

    // Item stats
    const itemMap = {}
    orders.forEach(o => o.order_items?.forEach(oi => {
      const n = oi.menu_items?.name||'?'
      if (!itemMap[n]) itemMap[n] = { name:n, qty:0 }
      itemMap[n].qty += oi.quantity
    }))

    const delivered = orders.filter(o=>o.status==='delivered').length
    const cancelled = orders.filter(o=>o.status==='cancelled').length
    const active    = orders.filter(o=>!['delivered','cancelled'].includes(o.status)).length
    const avgRating = fb.length ? (fb.reduce((s,f)=>s+(f.rating||0),0)/fb.length).toFixed(1) : null

    setData({
      orders, sos, fb,
      stats: { total:orders.length, delivered, cancelled, active },
      tableStats: Object.values(tableMap).sort((a,b)=>b.orders-a.orders),
      itemStats: Object.values(itemMap).sort((a,b)=>b.qty-a.qty),
      avgRating
    })
    setLoading(false)
  }

  function printReport() {
    if (!data) return
    const ev = eventData
    const dateStr = new Date(ev.date||Date.now()).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})
    const now = new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true})
    const w = window.open('', '_blank')
    w.document.write(\`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Event Report — \${ev.name}</title>
<style>
  body{font-family:Arial,sans-serif;font-size:13px;padding:24px;color:#111;max-width:800px;margin:0 auto}
  h1{font-size:22px;margin:0 0 4px}
  h2{font-size:15px;margin:20px 0 8px;border-bottom:1px solid #ddd;padding-bottom:4px}
  .meta{color:#666;font-size:12px;margin-bottom:20px}
  .stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px}
  .stat{background:#f5f5f5;border-radius:8px;padding:12px;text-align:center}
  .stat-num{font-size:24px;font-weight:bold;color:#E8890C}
  .stat-label{font-size:11px;color:#666;margin-top:4px}
  table{width:100%;border-collapse:collapse;margin-bottom:20px}
  th{background:#f0f0f0;text-align:left;padding:8px 10px;font-size:12px}
  td{padding:8px 10px;border-bottom:1px solid #eee;font-size:12px}
  .badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:bold}
  .g{background:#dcfce7;color:#16a34a}.r{background:#fee2e2;color:#dc2626}.y{background:#fef9c3;color:#ca8a04}
  @media print{body{padding:8px}}
</style></head><body>
<h1>Janu's Smart Serve — Event Report</h1>
<div class="meta">
  <strong>\${ev.name}</strong> &nbsp;|&nbsp; 📍 \${ev.venue||'—'} &nbsp;|&nbsp; 📅 \${dateStr} &nbsp;|&nbsp; Generated: \${now}
</div>
<div class="stat-grid">
  <div class="stat"><div class="stat-num">\${data.stats.total}</div><div class="stat-label">Total Orders</div></div>
  <div class="stat"><div class="stat-num" style="color:#16a34a">\${data.stats.delivered}</div><div class="stat-label">Delivered</div></div>
  <div class="stat"><div class="stat-num" style="color:#d97706">\${data.stats.active}</div><div class="stat-label">Active</div></div>
  <div class="stat"><div class="stat-num" style="color:#dc2626">\${data.stats.cancelled}</div><div class="stat-label">Cancelled</div></div>
</div>
\${data.avgRating ? \`<div style="margin-bottom:16px;font-size:13px">⭐ Average Guest Rating: <strong>\${data.avgRating}/5</strong> from \${data.fb.length} responses</div>\` : ''}

<h2>Table-wise Summary</h2>
<table>
  <tr><th>Table</th><th>Orders</th><th>Items Ordered</th><th>Delivered</th><th>Cancelled</th></tr>
  \${data.tableStats.map(t=>\`<tr><td><strong>Table \${t.table}</strong></td><td>\${t.orders}</td><td>\${t.items}</td><td><span class="badge g">\${t.delivered}</span></td><td><span class="badge r">\${t.cancelled}</span></td></tr>\`).join('')}
</table>

<h2>Most Ordered Dishes</h2>
<table>
  <tr><th>#</th><th>Dish Name</th><th>Qty Ordered</th></tr>
  \${data.itemStats.slice(0,15).map((item,i)=>\`<tr><td>\${i+1}</td><td>\${item.name}</td><td><strong>\${item.qty}</strong></td></tr>\`).join('')}
</table>

<h2>SOS / Service Requests (\${data.sos.length} total)</h2>
\${data.sos.length===0 ? '<p style="color:#888">No service requests during this event.</p>' : \`
<table>
  <tr><th>Request Type</th><th>Table</th><th>Time</th><th>Status</th></tr>
  \${data.sos.map(s=>\`<tr><td>\${s.request_type?.replace(/_/g,' ')}</td><td>Table \${s.tables?.table_number||'?'}</td><td>\${new Date(s.created_at).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true})}</td><td><span class="badge \${s.status==='resolved'?'g':s.status==='acknowledged'?'y':'r'}">\${s.status}</span></td></tr>\`).join('')}
</table>\`}

\${data.fb.length > 0 ? \`
<h2>Guest Feedback (\${data.fb.length} responses)</h2>
<table>
  <tr><th>Name</th><th>Rating</th><th>Comment</th></tr>
  \${data.fb.map(f=>\`<tr><td>\${f.guest_name||'Anonymous'}</td><td>\${'⭐'.repeat(f.rating||0)}</td><td>\${f.comment||'—'}</td></tr>\`).join('')}
</table>\` : ''}

<div style="margin-top:32px;text-align:center;font-size:11px;color:#aaa">Generated by Janu's Smart Serve · \${new Date().toLocaleString('en-IN')}</div>
</body></html>\`)
    w.document.close(); w.focus(); setTimeout(()=>{ w.print(); w.close() }, 400)
  }

  function exportCSV() {
    if (!data) return
    const rows = [['Table','Orders','Items','Delivered','Cancelled']]
    data.tableStats.forEach(t => rows.push([t.table, t.orders, t.items, t.delivered, t.cancelled]))
    const blob = new Blob([rows.map(r=>r.join(',')).join('\\n')], { type:'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href=url; a.download=(eventData.name||'report')+'.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) return <div style={{ textAlign:'center', padding:60, color:'var(--ink2)' }}>Loading report...</div>
  if (!data) return null

  const CARDS = [
    { label:'Total Orders', value:data.stats.total, color:'#2563EB', bg:'#EFF6FF' },
    { label:'Delivered',    value:data.stats.delivered, color:'#16A34A', bg:'#F0FDF4' },
    { label:'Active',       value:data.stats.active, color:'#D97706', bg:'#FEF3C7' },
    { label:'Cancelled',    value:data.stats.cancelled, color:'#DC2626', bg:'#FEF2F2' },
    { label:'SOS Requests', value:data.sos.length, color:'#0891B2', bg:'#ECFEFF' },
    { label:'Avg Rating',   value:data.avgRating ? data.avgRating+'★' : 'N/A', color:'#7C3AED', bg:'#F5F3FF' },
  ]

  return (
    <div>
      {/* Header */}
      <div style={{ background:'#fff', borderRadius:16, padding:'16px 18px', marginBottom:16, boxShadow:'var(--shadow)' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:12 }}>
          <div>
            <h2 style={{ fontSize:20, fontWeight:800, margin:'0 0 4px' }}>Event Report</h2>
            <div style={{ fontSize:14, color:'var(--ink2)' }}>{eventData.name}</div>
            {eventData.venue && <div style={{ fontSize:13, color:'var(--ink2)' }}>📍 {eventData.venue}</div>}
            {eventData.date && <div style={{ fontSize:13, color:'var(--ink2)' }}>📅 {new Date(eventData.date).toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'})}</div>}
          </div>
          <div style={{ display:'flex', gap:8, flexDirection:'column', alignItems:'flex-end' }}>
            <button onClick={printReport} style={{ background:'var(--ink)', color:'#fff', border:'none', borderRadius:10, padding:'8px 14px', fontSize:13, fontWeight:700 }}>🖨 Print PDF</button>
            <button onClick={exportCSV} style={{ background:'#F0FDF4', border:'1px solid #BBF7D0', color:'#16A34A', borderRadius:10, padding:'8px 14px', fontSize:13, fontWeight:700 }}>📊 Export CSV</button>
            <button onClick={loadReport} style={{ background:'var(--bg)', border:'1px solid var(--line)', borderRadius:10, padding:'8px 14px', fontSize:13, fontWeight:600 }}>↻ Refresh</button>
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:16 }}>
        {CARDS.map(c => (
          <div key={c.label} style={{ background:c.bg, borderRadius:14, padding:'14px 16px' }}>
            <div style={{ fontSize:26, fontWeight:800, color:c.color }}>{c.value}</div>
            <div style={{ fontSize:11, color:'var(--ink2)', fontWeight:600, marginTop:2 }}>{c.label}</div>
          </div>
        ))}
      </div>

      {/* Table-wise */}
      <div style={{ background:'#fff', borderRadius:16, padding:16, marginBottom:16, boxShadow:'var(--shadow)' }}>
        <div style={{ fontWeight:800, fontSize:16, marginBottom:12 }}>Table-wise Summary</div>
        {data.tableStats.length === 0 ? <div style={{ color:'var(--ink2)', fontSize:13 }}>No orders yet</div>
        : data.tableStats.map(t => (
          <div key={t.table} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 0', borderBottom:'1px solid var(--line)' }}>
            <div style={{ fontWeight:700, fontSize:15 }}>Table {t.table}</div>
            <div style={{ display:'flex', gap:10, fontSize:13 }}>
              <span><strong style={{ color:'var(--ink)' }}>{t.orders}</strong> orders</span>
              <span><strong style={{ color:'var(--ink)' }}>{t.items}</strong> items</span>
              <span style={{ color:'#16A34A', fontWeight:700 }}>✓ {t.delivered}</span>
              {t.cancelled > 0 && <span style={{ color:'#DC2626', fontWeight:700 }}>✗ {t.cancelled}</span>}
            </div>
          </div>
        ))}
      </div>

      {/* Top dishes */}
      <div style={{ background:'#fff', borderRadius:16, padding:16, marginBottom:16, boxShadow:'var(--shadow)' }}>
        <div style={{ fontWeight:800, fontSize:16, marginBottom:12 }}>Most Ordered Dishes</div>
        {data.itemStats.length === 0 ? <div style={{ color:'var(--ink2)', fontSize:13 }}>No data yet</div>
        : data.itemStats.map((item,i) => (
          <div key={item.name} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 0', borderBottom:'1px solid var(--line)' }}>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <div style={{ width:24, height:24, borderRadius:'50%', background:i<3?'#E8890C':'var(--bg)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:800, color:i<3?'#fff':'var(--ink2)' }}>{i+1}</div>
              <span style={{ fontWeight:600, fontSize:14 }}>{item.name}</span>
            </div>
            <div style={{ fontWeight:800, fontSize:16, color:'#E8890C' }}>{item.qty}x</div>
          </div>
        ))}
      </div>

      {/* SOS summary */}
      <div style={{ background:'#fff', borderRadius:16, padding:16, marginBottom:16, boxShadow:'var(--shadow)' }}>
        <div style={{ fontWeight:800, fontSize:16, marginBottom:12 }}>Service Requests (SOS)</div>
        {data.sos.length === 0 ? <div style={{ color:'var(--ink2)', fontSize:13 }}>No SOS requests</div>
        : data.sos.map((s,i) => (
          <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid var(--line)', fontSize:13 }}>
            <span style={{ fontWeight:600, textTransform:'capitalize' }}>{s.request_type?.replace(/_/g,' ')}</span>
            <span style={{ color:'var(--ink2)' }}>Table {s.tables?.table_number} · {new Date(s.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span>
            <span style={{ fontWeight:700, color:s.status==='resolved'?'#16A34A':s.status==='acknowledged'?'#D97706':'#DC2626' }}>{s.status}</span>
          </div>
        ))}
      </div>

      {/* Feedback */}
      {data.fb.length > 0 && (
        <div style={{ background:'#fff', borderRadius:16, padding:16, marginBottom:16, boxShadow:'var(--shadow)' }}>
          <div style={{ fontWeight:800, fontSize:16, marginBottom:12 }}>Guest Feedback ({data.fb.length})</div>
          {data.fb.map((f,i) => (
            <div key={i} style={{ padding:'10px 0', borderBottom:'1px solid var(--line)' }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                <span style={{ fontWeight:700, fontSize:14 }}>{f.guest_name||'Anonymous'}</span>
                <span style={{ color:'#E8890C', fontWeight:700 }}>{'⭐'.repeat(f.rating||0)}</span>
              </div>
              {f.comment && <div style={{ fontSize:13, color:'var(--ink2)' }}>{f.comment}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
`)
console.log('✅ 5/6 ReportsDashboard — full event report with print PDF + SOS + feedback')

// ═══════════════════════════════════════════
// FIX 6: SOSRequests — notification banner
// ═══════════════════════════════════════════
fs.writeFileSync(BASE + '/components/supervisor/SOSRequests.jsx', `import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

const TYPE_LABELS = { sos:'Call Waiter', clean_table:'Clean Table', extra_cutlery:'Extra Cutlery', water_refill:'Water Refill' }
const TYPE_EMOJI  = { sos:'🆘', clean_table:'🧹', extra_cutlery:'🍴', water_refill:'💧' }
const TYPE_COLOR  = { sos:'#DC2626', clean_table:'#2563EB', extra_cutlery:'#7C3AED', water_refill:'#0891B2' }

export default function SOSRequests({ eventData, onSosCountChange }) {
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [urgentAlert, setUrgentAlert] = useState(null)
  const prevOpenCount = useState(0)

  useEffect(() => {
    if (!eventData) return
    loadRequests(true)
    const interval = setInterval(() => loadRequests(false), 4000)
    return () => clearInterval(interval)
  }, [eventData])

  async function loadRequests(showSpinner=false) {
    if (!eventData) return
    if (showSpinner) setLoading(true)
    const { data } = await supabase.from('sos_requests').select('*, tables(table_number)').eq('event_id', eventData.id).order('created_at', { ascending:false })
    const reqs = data || []
    const openCount = reqs.filter(r=>r.status==='open').length

    // Show alert banner if new open request came in
    if (openCount > prevOpenCount[0] && !showSpinner) {
      const newest = reqs.find(r=>r.status==='open')
      if (newest) {
        setUrgentAlert(newest)
        setTimeout(() => setUrgentAlert(null), 8000)
        // Try browser notification
        if (Notification.permission === 'granted') {
          new Notification('🆘 New Service Request!', { body: (TYPE_LABELS[newest.request_type]||newest.request_type) + ' — Table ' + newest.tables?.table_number, icon:'/favicon.ico' })
        }
      }
    }
    prevOpenCount[0] = openCount

    setRequests(reqs)
    onSosCountChange(openCount)
    if (showSpinner) setLoading(false)
  }

  async function requestNotificationPermission() {
    if (Notification.permission === 'default') await Notification.requestPermission()
  }

  async function acknowledge(id) {
    await supabase.from('sos_requests').update({ status:'acknowledged', acknowledged_at:new Date().toISOString() }).eq('id', id)
    loadRequests(false)
  }
  async function resolve(id) {
    await supabase.from('sos_requests').update({ status:'resolved', resolved_at:new Date().toISOString() }).eq('id', id)
    loadRequests(false)
  }

  const open = requests.filter(r=>r.status==='open')
  const acknowledged = requests.filter(r=>r.status==='acknowledged')
  const resolved = requests.filter(r=>r.status==='resolved')

  function Card({ req }) {
    return (
      <div style={{ background:'#fff', borderRadius:16, padding:16, marginBottom:10, boxShadow:'var(--shadow)', borderLeft:'4px solid '+(TYPE_COLOR[req.request_type]||'#999') }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:10 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ fontSize:28 }}>{TYPE_EMOJI[req.request_type]}</span>
            <div>
              <div style={{ fontWeight:800, fontSize:15, color:TYPE_COLOR[req.request_type] }}>{TYPE_LABELS[req.request_type]}</div>
              <div style={{ fontSize:13, color:'var(--ink2)', marginTop:2 }}>Table {req.tables?.table_number} · {new Date(req.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</div>
            </div>
          </div>
          <div style={{ fontSize:12, fontWeight:700, padding:'3px 10px', borderRadius:999, background:req.status==='open'?'#FEF2F2':req.status==='acknowledged'?'#FEF3C7':'#F0FDF4', color:req.status==='open'?'#DC2626':req.status==='acknowledged'?'#D97706':'#16A34A' }}>
            {req.status==='open'?'Open':req.status==='acknowledged'?'Acknowledged':'Resolved'}
          </div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          {req.status==='open' && <button onClick={() => acknowledge(req.id)} style={{ flex:1, background:'#FEF3C7', border:'1px solid #FCD34D', color:'#92400E', borderRadius:10, padding:'10px', fontSize:13, fontWeight:700 }}>Acknowledge</button>}
          {req.status!=='resolved' && <button onClick={() => resolve(req.id)} style={{ flex:1, background:'#F0FDF4', border:'1px solid #BBF7D0', color:'#16A34A', borderRadius:10, padding:'10px', fontSize:13, fontWeight:700 }}>Mark Resolved</button>}
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Urgent alert banner */}
      {urgentAlert && (
        <div style={{ background:'#DC2626', borderRadius:14, padding:'14px 18px', marginBottom:16, display:'flex', alignItems:'center', gap:12, animation:'pulse 1s ease-in-out 3' }}>
          <span style={{ fontSize:28 }}>🚨</span>
          <div style={{ flex:1 }}>
            <div style={{ color:'#fff', fontWeight:800, fontSize:15 }}>New Request: {TYPE_LABELS[urgentAlert.request_type]}</div>
            <div style={{ color:'rgba(255,255,255,0.85)', fontSize:13 }}>Table {urgentAlert.tables?.table_number} needs attention!</div>
          </div>
          <button onClick={() => setUrgentAlert(null)} style={{ background:'rgba(255,255,255,0.2)', border:'none', borderRadius:8, padding:'6px 12px', color:'#fff', fontWeight:700, cursor:'pointer' }}>Dismiss</button>
        </div>
      )}

      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <h2 style={{ fontSize:20, fontWeight:800 }}>Service Requests</h2>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={requestNotificationPermission} style={{ background:'#EFF6FF', border:'1px solid #BFDBFE', color:'#2563EB', borderRadius:10, padding:'8px 14px', fontSize:12, fontWeight:700 }}>🔔 Enable Alerts</button>
          <button onClick={loadRequests} style={{ background:'var(--ink)', color:'#fff', border:'none', borderRadius:10, padding:'8px 16px', fontSize:13, fontWeight:700 }}>Refresh</button>
        </div>
      </div>

      {loading ? <div style={{ textAlign:'center', padding:60, color:'var(--ink2)' }}>Loading...</div>
      : requests.length === 0 ? (
        <div style={{ textAlign:'center', padding:60 }}>
          <div style={{ fontSize:48, marginBottom:12 }}>✅</div>
          <div style={{ color:'var(--ink2)', fontWeight:600 }}>No requests yet</div>
        </div>
      ) : (
        <>
          {open.length > 0 && <><div style={{ fontWeight:700, fontSize:13, color:'#DC2626', marginBottom:8, textTransform:'uppercase' }}>🔴 Open ({open.length})</div>{open.map(r => <Card key={r.id} req={r} />)}</>}
          {acknowledged.length > 0 && <><div style={{ fontWeight:700, fontSize:13, color:'#D97706', marginBottom:8, marginTop:16, textTransform:'uppercase' }}>🟡 Acknowledged ({acknowledged.length})</div>{acknowledged.map(r => <Card key={r.id} req={r} />)}</>}
          {resolved.length > 0 && <><div style={{ fontWeight:700, fontSize:13, color:'#16A34A', marginBottom:8, marginTop:16, textTransform:'uppercase' }}>🟢 Resolved ({resolved.length})</div>{resolved.map(r => <Card key={r.id} req={r} />)}</>}
        </>
      )}
    </div>
  )
}
`)
console.log('✅ 6/6 SOSRequests — urgent banner + browser notification on new request')

console.log('\n🎉 All 6 fixes done! Run: npm run dev')
