import { useState, useEffect, useRef, useCallback } from 'react'
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

  // ── App state machine ────────────────────────────────────────────
  // States: loading → setup → welcome → menu → status
  // welcome is the PERMANENT HOME — back button always returns here
  // setup is LOCKED — back button does nothing on setup
  const [appState, setAppState] = useState('loading')
  const [eventData, setEventData] = useState(null)
  const [tableData, setTableData] = useState(null)
  const [tableNumber, setTableNumber] = useState(null)
  const [cart, setCart] = useState([])
  const [activeOrders, setActiveOrders] = useState([]) // all active orders for table
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [showSOS, setShowSOS] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)
  const [feedbackOrderId, setFeedbackOrderId] = useState(null)
  const [cartOpen, setCartOpen] = useState(false)
  const [menuSheetOpen, setMenuSheetOpen] = useState(false)
  const menuSheetRef = useRef(false)

  // ── Refs for back button (always read current value, never stale) ─
  const appStateRef    = useRef('loading')
  const cartOpenRef    = useRef(false)
  const showSOSRef     = useRef(false)
  const showHistoryRef = useRef(false)
  const showFeedbackRef= useRef(false)
  const backHandlerRef = useRef(null)
  const feedbackTimerRef = useRef(null)

  useEffect(() => { appStateRef.current = appState },       [appState])
  useEffect(() => { menuSheetRef.current = menuSheetOpen }, [menuSheetOpen])
  useEffect(() => { cartOpenRef.current = cartOpen },       [cartOpen])
  useEffect(() => { showSOSRef.current = showSOS },         [showSOS])
  useEffect(() => { showHistoryRef.current = showHistory }, [showHistory])
  useEffect(() => { showFeedbackRef.current = showFeedback },[showFeedback])

  // ── BACK BUTTON ──────────────────────────────────────────────────
  // Approved sequence (confirmed by client):
  //   Feedback        → Welcome
  //   SOS panel       → Menu
  //   Order History   → Menu
  //   Cart            → Menu
  //   Track/Status    → Menu
  //   Menu            → Welcome
  //   Welcome         → STOP (never exits)
  //   Setup           → STOP (never exits)

  const handleBack = useCallback(() => {
    const state = appStateRef.current

    // Setup/loading — never go back
    if (state === 'setup' || state === 'loading') return

    // Feedback open → close → welcome
    if (showFeedbackRef.current) {
      setShowFeedback(false)
      setAppState('welcome')
      appStateRef.current = 'welcome'
      return
    }

    // Browse Menu sheet open → close sheet → stay on menu
    if (menuSheetRef.current) {
      setMenuSheetOpen(false)
      menuSheetRef.current = false
      return
    }

    // Cart open → close → stay on menu
    if (cartOpenRef.current) {
      setCartOpen(false)
      return
    }

    // SOS open → close → menu
    if (showSOSRef.current) {
      setShowSOS(false)
      setAppState('menu')
      appStateRef.current = 'menu'
      return
    }

    // History open → close → menu
    if (showHistoryRef.current) {
      setShowHistory(false)
      setAppState('menu')
      appStateRef.current = 'menu'
      return
    }

    // Track/Status → menu
    if (state === 'status') {
      setAppState('menu')
      appStateRef.current = 'menu'
      return
    }

    // Menu → welcome (always — regardless of active orders)
    if (state === 'menu') {
      setMenuSheetOpen(false)
      menuSheetRef.current = false
      appStateRef.current = 'welcome'
      setAppState('welcome')
      return
    }

    // Welcome → STOP
    if (state === 'welcome') return

  }, [])

  // Keep ref always pointing to latest handleBack
  useEffect(() => { backHandlerRef.current = handleBack }, [handleBack])

  // ── BACK BUTTON INTERCEPT — bulletproof approach ──────────────
  useEffect(() => {
    let isProgrammaticPush = false

    function fillBuffer() {
      try {
        isProgrammaticPush = true
        for (let i = 0; i < 8; i++) {
          window.history.pushState({ kiosk: true, idx: i, ts: Date.now() }, '', '/')
        }
        // Reset flag after all pushes complete
        setTimeout(() => { isProgrammaticPush = false }, 50)
      } catch(e) { isProgrammaticPush = false }
    }

    fillBuffer()

    // Only handle popstate if it's a REAL back press (not our programmatic push)
    function onPop(e) {
      if (isProgrammaticPush) return // ignore our own pushes
      backHandlerRef.current?.()
      // Immediately refill so next back press is also caught
      setTimeout(fillBuffer, 0)
    }
    window.addEventListener('popstate', onPop)

    // Android hardware back — keyCode 4
    function onKeyDown(e) {
      if (e.key === 'GoBack' || e.keyCode === 4) {
        e.preventDefault()
        e.stopPropagation()
        backHandlerRef.current?.()
        setTimeout(fillBuffer, 0)
        return false
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keydown', onKeyDown, true)

    // Prevent page exit
    function onBeforeUnload(e) {
      e.preventDefault()
      e.returnValue = ''
      return ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)

    // Keep buffer topped up every 2 seconds
    const keepAlive = setInterval(fillBuffer, 2000)

    return () => {
      window.removeEventListener('popstate', onPop)
      document.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('beforeunload', onBeforeUnload)
      clearInterval(keepAlive)
    }
  }, []) // runs once — always uses latest handler via ref

  // ── LOAD SAVED SETUP ─────────────────────────────────────────────
  useEffect(() => {
    const setupComplete = localStorage.getItem('ss_setup_complete')
    const savedEvent    = localStorage.getItem('ss_setup_event')
    const savedTable    = localStorage.getItem('ss_setup_table')
    const savedTableNum = localStorage.getItem('ss_setup_table_number')

    if (setupComplete && savedEvent && savedTable) {
      try {
        const ev   = JSON.parse(savedEvent)
        const td   = JSON.parse(savedTable)
        const tNum = parseInt(savedTableNum)
        setEventData(ev); setTableData(td); setTableNumber(tNum)
        setAppState('welcome')
      } catch(e) { localStorage.clear(); setAppState('setup') }
    } else {
      setAppState('setup')
    }
  }, [])

  // ── WATCH ACTIVE ORDERS for this table ───────────────────────────
  // Used for: Track button visibility, auto-redirect after delivery,
  //           feedback trigger, multiple order display
  useEffect(() => {
    if (!tableData?.id || !eventData?.id) return

    loadActiveOrders()

    const sub = supabase.channel('orders-table-' + tableData.id)
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'orders' }, payload => {
        if (payload.new.table_id === tableData.id) loadActiveOrders()
      })
      .on('postgres_changes', { event:'UPDATE', schema:'public', table:'orders' }, payload => {
        if (payload.new.table_id !== tableData.id) return
        loadActiveOrders()
        // Trigger feedback on delivery
        if (payload.new.status === 'delivered') {
          if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
          feedbackTimerRef.current = setTimeout(() => {
            setFeedbackOrderId(payload.new.id)
            setShowFeedback(true)
          }, FEEDBACK_DELAY_MS)
        }
      })
      .subscribe()

    const poll = setInterval(loadActiveOrders, 8000)

    return () => {
      supabase.removeChannel(sub)
      clearInterval(poll)
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
    }
  }, [tableData?.id, eventData?.id])

  async function loadActiveOrders() {
    if (!tableData?.id) return
    const { data } = await supabase.from('orders')
      .select('*, order_items(quantity, menu_items(name, is_veg))')
      .eq('table_id', tableData.id)
      .eq('event_id', eventData.id)
      .in('status', ['pending','placed','in_progress'])
      .order('created_at', { ascending: true })
    setActiveOrders(data || [])
  }

  // ── NO AUTO-REDIRECT from Track screen ───────────────────────────
  // Auto-redirect was causing wrong redirects when one order delivered
  // but another still active. Guest must use back button to navigate.
  // The only auto-redirect is after feedback is submitted (handleFeedbackClose)

  // ── SETUP ─────────────────────────────────────────────────────────
  function handleSetupComplete(ev, td) {
    setEventData(ev); setTableData(td); setTableNumber(td.table_number)
    setCart([])
    setAppState('welcome')
  }

  function triggerReSetup() {
    localStorage.removeItem('ss_setup_complete')
    localStorage.removeItem('ss_setup_event')
    localStorage.removeItem('ss_setup_table')
    localStorage.removeItem('ss_setup_table_number')
    setEventData(null); setTableData(null); setTableNumber(null)
    setCart([]); setActiveOrders([])
    setAppState('setup')
  }

  // ── ONLINE/OFFLINE ────────────────────────────────────────────────
  useEffect(() => {
    const on  = () => { setIsOnline(true);  syncOfflineOrders() }
    const off = () => setIsOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  // ── CART ──────────────────────────────────────────────────────────
  function addToCart(item) {
    setCart(prev => {
      const e = prev.find(c => c.id === item.id)
      if (e) return prev.map(c => c.id === item.id ? {...c, quantity: c.quantity+1} : c)
      return [...prev, {...item, quantity: 1}]
    })
  }
  function removeFromCart(itemId) {
    setCart(prev => {
      const e = prev.find(c => c.id === itemId)
      if (e?.quantity === 1) return prev.filter(c => c.id !== itemId)
      return prev.map(c => c.id === itemId ? {...c, quantity: c.quantity-1} : c)
    })
  }
  const cartCount = cart.reduce((s,i) => s + i.quantity, 0)

  // Point 3: order placed → directly to status (no popup)
  function handleOrderPlaced(id) {
    setCart([])
    loadActiveOrders()
    appStateRef.current = 'status'
    setAppState('status')
  }

  // After feedback: if active orders remain → stay on menu so guest can track
  // If no active orders → go to welcome (the true home)
  function handleFeedbackClose() {
    setShowFeedback(false)
    setFeedbackOrderId(null)
    if (activeOrders.length > 0) {
      appStateRef.current = 'menu'
      setAppState('menu')
    } else {
      appStateRef.current = 'welcome'
      setAppState('welcome')
    }
  }

  async function syncOfflineOrders() {
    const pending = await getPendingOrders()
    for (const order of pending) {
      try {
        const { data: newOrder } = await supabase.from('orders')
          .insert({ event_id: order.event_id, table_id: order.table_id, status: 'pending' }).select().single()
        if (newOrder) {
          await supabase.from('order_items').insert(order.items.map(i => ({
            order_id: newOrder.id, menu_item_id: i.id, quantity: i.quantity
          })))
          await clearOrder(order.id)
        }
      } catch(e) { console.error(e) }
    }
  }

  // ── RENDER ────────────────────────────────────────────────────────
  if (appState === 'loading') return (
    <div style={{ minHeight:'100vh', background:'#1A0A0A', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ color:'rgba(255,255,255,0.4)', fontSize:14 }}>Loading...</div>
    </div>
  )

  if (appState === 'setup') return (
    <SetupScreen
      onSetupComplete={handleSetupComplete}
      currentTableNumber={tableNumber}
      currentEventId={eventData?.id}
    />
  )

  // Track button visible only when active orders exist (Point 5)
  const hasActiveOrders = activeOrders.length > 0

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', position:'relative' }}>

      {appState === 'welcome' && (
        <WelcomeScreen
          tableNumber={tableNumber}
          onStart={() => setAppState('menu')}
          eventData={eventData}
          onEventSelect={() => {}}
          activeEventCount={1}
          onLongPressTable={triggerReSetup}
        />
      )}

      {appState === 'menu' && (
        <MenuScreen
          tableData={tableData}
          eventData={eventData}
          tableNumber={tableNumber}
          cart={cart}
          addToCart={addToCart}
          removeFromCart={removeFromCart}
          cartCount={cartCount}
          isOnline={isOnline}
          onShowSOS={() => setShowSOS(true)}
          onShowHistory={() => setShowHistory(true)}
          onShowStatus={() => {
            appStateRef.current = 'status'
            setAppState('status')
          }}
          hasActiveOrders={hasActiveOrders}
          showFeedbackBubble={false}
          onFeedbackBubbleClick={() => {}}
          onShowFeedback={() => setShowFeedback(true)}
          menuSheetOpen={menuSheetOpen}
          setMenuSheetOpen={setMenuSheetOpen}
        />
      )}

      {appState === 'status' && (
        <OrderStatus
          tableData={tableData}
          eventData={eventData}
          tableNumber={tableNumber}
          activeOrders={activeOrders}
          onBack={() => setAppState('menu')}
        />
      )}

      {cartCount > 0 && appState === 'menu' && (
        <CartDrawer
          cart={cart}
          tableData={tableData}
          eventData={eventData}
          isOnline={isOnline}
          onOrderPlaced={handleOrderPlaced}
          onRemove={removeFromCart}
          onAdd={addToCart}
          cartOpen={cartOpen}
          onCartOpenChange={setCartOpen}
        />
      )}

      {showSOS     && <SOSPanel     tableData={tableData} eventData={eventData} onClose={() => { setShowSOS(false); setAppState('menu') }} />}
      {showHistory && <OrderHistory tableData={tableData} eventData={eventData} onClose={() => { setShowHistory(false); setAppState('menu') }} />}
      {showFeedback && (
        <FeedbackModal
          orderId={feedbackOrderId}
          tableData={tableData}
          eventData={eventData}
          onClose={handleFeedbackClose}
        />
      )}

    </div>
  )
}
