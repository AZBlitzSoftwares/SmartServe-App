import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { getPendingOrders, clearOrder } from '../lib/offlineQueue'
import SetupScreen from '../components/guest/SetupScreen'
import WelcomeScreen from '../components/guest/WelcomeScreen'
import MenuScreen from '../components/guest/MenuScreen'
import CartDrawer from '../components/guest/CartDrawer'
import OrderStatus from '../components/guest/OrderStatus'
import SOSPanel from '../components/guest/SOSPanel'
import OrderHistory from '../components/guest/OrderHistory'
import FeedbackModal from '../components/guest/FeedbackModal'

const FEEDBACK_DELAY_MS = 5000

export default function GuestApp() {
  const [appState, setAppState] = useState('loading')
  const [eventData, setEventData] = useState(null)
  const [tableData, setTableData] = useState(null)
  const [tableNumber, setTableNumber] = useState(null)
  const [cart, setCart] = useState([])
  const [activeOrders, setActiveOrders] = useState([])
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [showSOS, setShowSOS] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)
  const [feedbackOrderId, setFeedbackOrderId] = useState(null)
  const [cartOpen, setCartOpen] = useState(false)
  const [menuSheetOpen, setMenuSheetOpen] = useState(false)

  const appStateRef     = useRef('loading')
  const cartOpenRef     = useRef(false)
  const showSOSRef      = useRef(false)
  const showHistoryRef  = useRef(false)
  const showFeedbackRef = useRef(false)
  const menuSheetRef    = useRef(false)
  const activeOrdersRef = useRef([])
  const feedbackTimerRef = useRef(null)
  const backLock = useRef(false)

  useEffect(() => { appStateRef.current = appState },         [appState])
  useEffect(() => { cartOpenRef.current = cartOpen },         [cartOpen])
  useEffect(() => { showSOSRef.current = showSOS },           [showSOS])
  useEffect(() => { showHistoryRef.current = showHistory },   [showHistory])
  useEffect(() => { showFeedbackRef.current = showFeedback }, [showFeedback])
  useEffect(() => { menuSheetRef.current = menuSheetOpen },   [menuSheetOpen])
  useEffect(() => { activeOrdersRef.current = activeOrders }, [activeOrders])

  function goTo(screen) {
    appStateRef.current = screen
    setAppState(screen)
  }

  function handleBack() {
    if (backLock.current) return
    backLock.current = true
    setTimeout(() => { backLock.current = false }, 300)

    const s = appStateRef.current
    if (s === 'setup' || s === 'loading') return
    if (showFeedbackRef.current) { setShowFeedback(false); goTo('welcome'); return }
    if (menuSheetRef.current)    { setMenuSheetOpen(false); menuSheetRef.current = false; return }
    if (cartOpenRef.current)     { setCartOpen(false); return }
    if (showSOSRef.current)      { setShowSOS(false); goTo('menu'); return }
    if (showHistoryRef.current)  { setShowHistory(false); goTo('menu'); return }
    if (s === 'status')          { goTo('menu'); return }
    if (s === 'menu')            { setMenuSheetOpen(false); menuSheetRef.current = false; goTo('welcome'); return }
  }

  // BACK BUTTON - using backLock to prevent infinite loops
  // Only uses addEventListener (NOT window.onpopstate) to avoid override conflicts
  useEffect(() => {
    let pushing = false

    function safePush() {
      if (pushing) return
      pushing = true
      try {
        window.history.pushState({ k: Date.now() }, '', '/')
      } catch(e) {}
      setTimeout(() => { pushing = false }, 50)
    }

    // Seed 3 entries safely with delays
    safePush()
    setTimeout(safePush, 60)
    setTimeout(safePush, 120)

    function onPop() {
      handleBack()
      // Re-seed after handling - with delay to avoid triggering onpopstate again
      setTimeout(safePush, 150)
      setTimeout(safePush, 250)
    }

    function onKey(e) {
      if (e.key === 'GoBack' || e.keyCode === 4) {
        e.preventDefault()
        e.stopPropagation()
        handleBack()
        setTimeout(safePush, 150)
        return false
      }
    }

    function onUnload(e) { e.preventDefault(); e.returnValue = ''; return '' }

    window.addEventListener('popstate', onPop)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('beforeunload', onUnload)
    const t = setInterval(() => { safePush() }, 4000)

    return () => {
      window.removeEventListener('popstate', onPop)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('beforeunload', onUnload)
      clearInterval(t)
    }
  }, [])

  useEffect(() => {
    const ok  = localStorage.getItem('ss_setup_complete')
    const ev  = localStorage.getItem('ss_setup_event')
    const td  = localStorage.getItem('ss_setup_table')
    const tNum= localStorage.getItem('ss_setup_table_number')
    if (ok && ev && td) {
      try {
        setEventData(JSON.parse(ev)); setTableData(JSON.parse(td))
        setTableNumber(parseInt(tNum)); goTo('welcome')
      } catch(e) { localStorage.clear(); goTo('setup') }
    } else { goTo('setup') }
  }, [])

  useEffect(() => {
    if (!tableData?.id || !eventData?.id) return
    loadActiveOrders()
    const sub = supabase.channel('orders-' + tableData.id)
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'orders' }, p => {
        if (p.new.table_id === tableData.id) loadActiveOrders()
      })
      .on('postgres_changes', { event:'UPDATE', schema:'public', table:'orders' }, p => {
        if (p.new.table_id !== tableData.id) return
        loadActiveOrders()
        if (p.new.status === 'delivered') {
          if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
          feedbackTimerRef.current = setTimeout(() => {
            setFeedbackOrderId(p.new.id); setShowFeedback(true)
          }, FEEDBACK_DELAY_MS)
        }
      }).subscribe()
    const poll = setInterval(loadActiveOrders, 8000)
    return () => { supabase.removeChannel(sub); clearInterval(poll) }
  }, [tableData?.id, eventData?.id])

  async function loadActiveOrders() {
    if (!tableData?.id) return
    const { data } = await supabase.from('orders')
      .select('*, order_items(quantity, menu_items(name, is_veg))')
      .eq('table_id', tableData.id).eq('event_id', eventData.id)
      .in('status', ['pending','placed','in_progress'])
      .order('created_at', { ascending: true })
    setActiveOrders(data || [])
  }

  function handleSetupComplete(ev, td) {
    setEventData(ev); setTableData(td); setTableNumber(td.table_number)
    setCart([]); goTo('welcome')
  }

  function triggerReSetup() {
    ['ss_setup_complete','ss_setup_event','ss_setup_table','ss_setup_table_number']
      .forEach(k => localStorage.removeItem(k))
    setEventData(null); setTableData(null); setTableNumber(null)
    setCart([]); setActiveOrders([]); goTo('setup')
  }

  useEffect(() => {
    const on = () => { setIsOnline(true); syncOfflineOrders() }
    const off = () => setIsOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  function addToCart(item) {
    setCart(prev => {
      const e = prev.find(c => c.id === item.id)
      if (e) return prev.map(c => c.id === item.id ? {...c,quantity:c.quantity+1} : c)
      return [...prev, {...item, quantity:1}]
    })
  }
  function removeFromCart(itemId) {
    setCart(prev => {
      const e = prev.find(c => c.id === itemId)
      if (e?.quantity === 1) return prev.filter(c => c.id !== itemId)
      return prev.map(c => c.id === itemId ? {...c,quantity:c.quantity-1} : c)
    })
  }
  const cartCount = cart.reduce((s,i) => s+i.quantity, 0)

  function handleOrderPlaced() { setCart([]); loadActiveOrders(); goTo('status') }

  function handleFeedbackClose() {
    setShowFeedback(false); setFeedbackOrderId(null)
    if (activeOrdersRef.current.length > 0) goTo('menu')
    else goTo('welcome')
  }

  async function syncOfflineOrders() {
    const pending = await getPendingOrders()
    for (const order of pending) {
      try {
        const { data: o } = await supabase.from('orders')
          .insert({ event_id:order.event_id, table_id:order.table_id, status:'pending' }).select().single()
        if (o) {
          await supabase.from('order_items').insert(
            order.items.map(i => ({ order_id:o.id, menu_item_id:i.id, quantity:i.quantity }))
          )
          await clearOrder(order.id)
        }
      } catch(e) { console.error(e) }
    }
  }

  if (appState === 'loading') return (
    <div style={{minHeight:'100vh',background:'#1A0A0A',display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{color:'rgba(255,255,255,0.4)',fontSize:14}}>Loading...</div>
    </div>
  )
  if (appState === 'setup') return (
    <SetupScreen onSetupComplete={handleSetupComplete}
      currentTableNumber={tableNumber} currentEventId={eventData?.id} />
  )

  const hasActiveOrders = activeOrders.length > 0

  return (
    <div style={{minHeight:'100vh',background:'var(--bg)',position:'relative'}}>
      {appState === 'welcome' && (
        <WelcomeScreen tableNumber={tableNumber} onStart={() => goTo('menu')}
          eventData={eventData} onEventSelect={() => {}} activeEventCount={1}
          onLongPressTable={triggerReSetup} />
      )}
      {appState === 'menu' && (
        <MenuScreen tableData={tableData} eventData={eventData} tableNumber={tableNumber}
          cart={cart} addToCart={addToCart} removeFromCart={removeFromCart}
          cartCount={cartCount} isOnline={isOnline}
          onShowSOS={() => setShowSOS(true)}
          onShowHistory={() => setShowHistory(true)}
          onShowStatus={() => goTo('status')}
          hasActiveOrders={hasActiveOrders}
          menuSheetOpen={menuSheetOpen} setMenuSheetOpen={setMenuSheetOpen}
          showFeedbackBubble={false} onFeedbackBubbleClick={() => {}}
          onShowFeedback={() => setShowFeedback(true)} />
      )}
      {appState === 'status' && (
        <OrderStatus tableData={tableData} eventData={eventData}
          tableNumber={tableNumber} activeOrders={activeOrders}
          onBack={() => goTo('menu')} />
      )}
      {cartCount > 0 && appState === 'menu' && (
        <CartDrawer cart={cart} tableData={tableData} eventData={eventData}
          isOnline={isOnline} onOrderPlaced={handleOrderPlaced}
          onRemove={removeFromCart} onAdd={addToCart}
          cartOpen={cartOpen} onCartOpenChange={setCartOpen} />
      )}
      {showSOS && <SOSPanel tableData={tableData} eventData={eventData}
        onClose={() => { setShowSOS(false); goTo('menu') }} />}
      {showHistory && <OrderHistory tableData={tableData} eventData={eventData}
        onClose={() => { setShowHistory(false); goTo('menu') }} />}
      {showFeedback && <FeedbackModal orderId={feedbackOrderId} tableData={tableData}
        eventData={eventData} onClose={handleFeedbackClose} />}
    </div>
  )
}
