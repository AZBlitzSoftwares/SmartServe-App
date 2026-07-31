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
import ExitGate from '../components/guest/ExitGate'

const FEEDBACK_DELAY_MS = 5000

// Two back presses within this window on the Welcome screen open the exit dialog.
const EXIT_DOUBLE_PRESS_MS = 3000

// Anywhere EXCEPT Welcome, presses closer together than this are treated as one
// press. A guest jabbing back three times moves back one screen, not three.
const BACK_DEBOUNCE_MS = 1500

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
  const [showExitGate, setShowExitGate] = useState(false)
  const [exitReady, setExitReady] = useState(false)

  const appStateRef      = useRef('loading')
  const cartOpenRef      = useRef(false)
  const showSOSRef       = useRef(false)
  const showHistoryRef   = useRef(false)
  const showFeedbackRef  = useRef(false)
  const menuSheetRef     = useRef(false)
  const activeOrdersRef  = useRef([])
  const showExitGateRef  = useRef(false)
  const feedbackTimerRef = useRef(null)

  // Back-button machinery
  const allowExitRef    = useRef(false) // true only after a valid exit PIN
  const lastBackAtRef   = useRef(0)     // last back press on Welcome (exit double-press)
  const lastActionAtRef = useRef(0)     // last back press we actually acted on (debounce)
  const backHandlerRef  = useRef(() => {})

  useEffect(() => { appStateRef.current = appState },         [appState])
  useEffect(() => { cartOpenRef.current = cartOpen },         [cartOpen])
  useEffect(() => { showSOSRef.current = showSOS },           [showSOS])
  useEffect(() => { showHistoryRef.current = showHistory },   [showHistory])
  useEffect(() => { showFeedbackRef.current = showFeedback }, [showFeedback])
  useEffect(() => { menuSheetRef.current = menuSheetOpen },   [menuSheetOpen])
  useEffect(() => { activeOrdersRef.current = activeOrders }, [activeOrders])
  useEffect(() => { showExitGateRef.current = showExitGate }, [showExitGate])

  function goTo(screen) {
    appStateRef.current = screen
    setAppState(screen)
    lastBackAtRef.current = 0   // leaving a screen resets the double-press counter
  }

  // ── ONE back press = exactly ONE action, always in sequence ──────────────
  function handleBack() {
    const s = appStateRef.current
    if (s === 'setup' || s === 'loading') return

    const now = Date.now()

    // ── Welcome is the ONLY screen where a double press means something ──
    if (s === 'welcome' && !showExitGateRef.current) {
      if (lastBackAtRef.current && now - lastBackAtRef.current <= EXIT_DOUBLE_PRESS_MS) {
        lastBackAtRef.current = 0
        setShowExitGate(true)
      } else {
        lastBackAtRef.current = now   // first press — nothing visible happens
      }
      return
    }

    // ── Everywhere else: a rapid flurry counts as a single step ──
    if (now - lastActionAtRef.current < BACK_DEBOUNCE_MS) return
    lastActionAtRef.current = now

    // Exit gate is its own overlay — back closes it and stays on Welcome
    if (showExitGateRef.current) { setShowExitGate(false); return }

    // Overlays close one at a time, innermost first
    if (showFeedbackRef.current) { handleFeedbackClose(); return }
    if (menuSheetRef.current)    { setMenuSheetOpen(false); menuSheetRef.current = false; return }
    if (cartOpenRef.current)     { setCartOpen(false); return }
    if (showSOSRef.current)      { setShowSOS(false); return }
    if (showHistoryRef.current)  { setShowHistory(false); return }

    // Screen sequence: Track -> Menu -> Welcome
    if (s === 'status') { goTo('menu'); return }
    if (s === 'menu')   { setMenuSheetOpen(false); menuSheetRef.current = false; goTo('welcome'); return }
  }

  // Always keep the freshest handler — avoids stale closures
  backHandlerRef.current = handleBack

  // ── History sentinel ──────────────────────────────────────────────────────
  // Chrome and Android WebView apply the "History Manipulation Intervention":
  // history entries pushed WITHOUT user activation are marked skippable, and
  // the back button jumps straight over them without ever firing popstate.
  // The buffer must therefore be built from real user gestures, never from a
  // mount effect. Every tap tops it back up, so history can never run dry and
  // the app can never be closed by the back button.
  useEffect(() => {
    const url = window.location.href
    const GUARD_DEPTH = 5
    let depth = 0

    function pushOne() {
      try {
        // Preserve React Router's own state fields so the router is not confused
        const cur = window.history.state || {}
        window.history.pushState({ ...cur, ssGuard: true }, '', url)
        depth++
        return true
      } catch (e) { return false }
    }

    function topUp() {
      while (depth < GUARD_DEPTH) { if (!pushOne()) break }
    }

    function onGesture() {
      if (allowExitRef.current) return
      topUp()
    }

    document.addEventListener('pointerdown', onGesture, true)
    document.addEventListener('touchstart', onGesture, true)
    document.addEventListener('click', onGesture, true)
    document.addEventListener('keydown', onGesture, true)

    function onPop(e) {
      // After a valid exit PIN we stop refilling and let history drain,
      // which is what allows the native shell to close the app.
      if (allowExitRef.current) return
      depth = (e.state && e.state.ssGuard) ? Math.max(0, depth - 1) : 0
      topUp()                    // refill FIRST, synchronously
      backHandlerRef.current()   // then act
    }

    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      document.removeEventListener('pointerdown', onGesture, true)
      document.removeEventListener('touchstart', onGesture, true)
      document.removeEventListener('click', onGesture, true)
      document.removeEventListener('keydown', onGesture, true)
    }
  }, [])

  // Called only after ExitGate verifies a supervisor/admin PIN
  function performExit() {
    allowExitRef.current = true
    setShowExitGate(false)
    try { window.close() } catch (e) {}
    try { window.history.go(-(window.history.length - 1)) } catch (e) {}
    setTimeout(() => setExitReady(true), 700)
  }

  function cancelExit() {
    allowExitRef.current = false
    lastBackAtRef.current = 0
    setShowExitGate(false)
    setExitReady(false)
  }

  // Load saved setup from localStorage
  useEffect(() => {
    const ok   = localStorage.getItem('ss_setup_complete')
    const ev   = localStorage.getItem('ss_setup_event')
    const td   = localStorage.getItem('ss_setup_table')
    const tNum = localStorage.getItem('ss_setup_table_number')
    if (ok && ev && td) {
      try {
        setEventData(JSON.parse(ev))
        setTableData(JSON.parse(td))
        setTableNumber(parseInt(tNum))
        goTo('welcome')
      } catch(e) { localStorage.clear(); goTo('setup') }
    } else {
      goTo('setup')
    }
  }, [])

  // Watch active orders
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

      {showExitGate && (
        <ExitGate eventId={eventData?.id} onCancel={cancelExit} onVerified={performExit} />
      )}

      {exitReady && (
        <div style={{ position:'fixed', inset:0, background:'#1A0A0A', zIndex:400,
          display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
          padding:24, textAlign:'center' }}>
          <div style={{ fontSize:52, marginBottom:14 }}>✅</div>
          <div style={{ fontSize:21, fontWeight:800, color:'#fff', marginBottom:10 }}>PIN accepted</div>
          <div style={{ fontSize:14, color:'rgba(255,255,255,0.6)', lineHeight:1.6,
            maxWidth:300, marginBottom:26 }}>
            Press the Back button once more to close the app.
          </div>
          <button onClick={cancelExit}
            style={{ background:'#E8890C', color:'#fff', border:'none', borderRadius:14,
              padding:'16px 34px', fontSize:16, fontWeight:800, cursor:'pointer' }}>
            Stay in App
          </button>
        </div>
      )}
    </div>
  )
}
