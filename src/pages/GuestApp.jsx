import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { getPendingOrders, clearOrder } from '../lib/offlineQueue'
import SetupScreen from '../components/guest/SetupScreen'
import WelcomeScreen from '../components/guest/WelcomeScreen'
import MenuScreen from '../components/guest/MenuScreen'
import CartDrawer from '../components/guest/CartDrawer'
import GenieScreen from '../components/guest/GenieScreen'
import { getDeviceId } from '../lib/deviceId'
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
  const [activeHelp, setActiveHelp] = useState([])
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [showSOS, setShowSOS] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)
  const [feedbackOrderId, setFeedbackOrderId] = useState(null)
  const [lastOrderId, setLastOrderId] = useState(null)
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
    if (s === 'genie')  { goTo('menu'); return }
    if (s === 'status') { goTo('menu'); return }
    if (s === 'menu')   { setMenuSheetOpen(false); menuSheetRef.current = false; goTo('welcome'); return }
  }

  // Always keep the freshest handler — avoids stale closures
  backHandlerRef.current = handleBack

  // ── History sentinel ──────────────────────────────────────────────────────
  // Chromium's History Manipulation Intervention: a history entry created
  // WITHOUT a fresh user activation is marked skippable, and ALL same-document
  // entries share one skippable state. So a single un-activated push poisons
  // every guard we ever created, and the back button then skips the lot — on
  // Android that closes the app outright.
  //
  // Therefore: entries are created ONLY inside real user gestures. Never in
  // popstate, never in pageshow, never in a mount effect. Guests tap
  // constantly, so the buffer refills naturally as the app is used.
  useEffect(() => {
    const GUARD_DEPTH = 10
    const base = window.location.pathname + window.location.search

    // Never resume part-way up a stale guard chain after a reload
    if (/^#g\d+$/.test(window.location.hash)) {
      try { window.history.replaceState({}, '', base) } catch (e) {}
    }

    function currentDepth() {
      const m = /^#g(\d+)$/.exec(window.location.hash)
      return m ? parseInt(m[1], 10) : 0
    }

    // Only true while the browser considers a user gesture active
    function activationLive() {
      try {
        const ua = navigator.userActivation
        if (ua && typeof ua.isActive === 'boolean') return ua.isActive
      } catch (e) {}
      return true   // older engines: assume the gesture handler is trustworthy
    }

    function topUp() {
      if (allowExitRef.current) return
      if (!activationLive()) return          // pushing now would poison the buffer
      let d = currentDepth()
      let added = 0
      while (d < GUARD_DEPTH && added < GUARD_DEPTH) {
        d++
        try {
          window.history.pushState({ ssGuard: true, d }, '', base + '#g' + d)
          added++
        } catch (e) { break }
      }
    }

    // The ONLY places a history entry is ever created
    document.addEventListener('pointerdown', topUp, true)
    document.addEventListener('touchstart', topUp, true)
    document.addEventListener('mousedown', topUp, true)
    document.addEventListener('click', topUp, true)
    document.addEventListener('keydown', topUp, true)

    // Handles the back press. Deliberately does NOT push — the buffer is deep
    // and the guest's next tap tops it back up.
    function onNav() {
      if (allowExitRef.current) return
      backHandlerRef.current()
    }

    window.addEventListener('popstate', onNav)
    window.addEventListener('hashchange', onNav)

    return () => {
      window.removeEventListener('popstate', onNav)
      window.removeEventListener('hashchange', onNav)
      document.removeEventListener('pointerdown', topUp, true)
      document.removeEventListener('touchstart', topUp, true)
      document.removeEventListener('mousedown', topUp, true)
      document.removeEventListener('click', topUp, true)
      document.removeEventListener('keydown', topUp, true)
    }
  }, [])

  // Called only after ExitGate verifies a supervisor/admin PIN
  function performExit() {
    allowExitRef.current = true
    setShowExitGate(false)
    try { window.close() } catch (e) {}
    try {
      const m = /^#g(\d+)$/.exec(window.location.hash)
      const d = m ? parseInt(m[1], 10) : 0
      window.history.go(-(d + 1))
    } catch (e) {}
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
        const evObj = JSON.parse(ev)
        setEventData(evObj)
        setTableData(JSON.parse(td))
        setTableNumber(parseInt(tNum))
        goTo('welcome')
        // localStorage holds a snapshot taken at setup time. Pull the live
        // record so branding changes (catering name, logo, welcome note,
        // video) reach the tablet without a re-setup.
        refreshEvent(evObj.id)
      } catch(e) { localStorage.clear(); goTo('setup') }
    } else {
      goTo('setup')
    }
  }, [])

  // Keep event branding in sync with the supervisor's edits
  async function refreshEvent(eventId) {
    if (!eventId) return
    try {
      const { data } = await supabase.from('events')
        .select('*').eq('id', eventId).single()
      if (data) {
        setEventData(data)
        localStorage.setItem('ss_setup_event', JSON.stringify(data))
      }
    } catch (e) {}
  }

  // Live branding updates while the event is running
  useEffect(() => {
    if (!eventData?.id) return
    const id = eventData.id
    const sub = supabase.channel('event-' + id)
      .on('postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'events', filter: 'id=eq.' + id },
          () => refreshEvent(id))
      .subscribe()
    const poll = setInterval(() => refreshEvent(id), 60000)
    return () => { supabase.removeChannel(sub); clearInterval(poll) }
  }, [eventData?.id])

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


  // ── Idle timeout: 5 minutes on the Menu screen only ──────────────────────
  // Deliberately not applied to Cart, Track, the genie screen or any overlay.
  // A guest watching their order status or typing feedback must never be
  // thrown back to Welcome mid-task.

  // Live help requests for this table. Track is about anything the guest
  // is waiting on, not only food.
  useEffect(() => {
    if (!tableData?.id) return
    let stop = false
    async function loadHelp() {
      const { data } = await supabase.from('sos_requests')
        .select('*, sos_request_items(item_name, quantity)')
        .eq('table_id', tableData.id)
        .in('status', ['open', 'acknowledged', 'in_progress'])
        .order('created_at', { ascending: false })
      if (!stop) setActiveHelp(data || [])
    }
    loadHelp()
    const t = setInterval(loadHelp, 8000)
    return () => { stop = true; clearInterval(t) }
  }, [tableData?.id])


  // An empty cart cannot be open. This holds the invariant no matter how
  // the cart got emptied - ordering, removing the last item, or a reset -
  // so a stale flag can never make the drawer appear by itself.
  useEffect(() => {
    if (cart.length === 0 && cartOpen) setCartOpen(false)
  }, [cart.length, cartOpen])


  // Heartbeat. Keeps this tablet's table claim alive while it is in use,
  // which is what lets a dead or swapped tablet's claim expire by itself
  // instead of locking that table number out for the rest of the event.
  useEffect(() => {
    if (!tableData?.id) return
    const deviceId = getDeviceId()
    async function beat() {
      try {
        await supabase.from('tables')
          .update({ last_seen_at: new Date().toISOString() })
          .eq('id', tableData.id)
          .eq('claimed_by_device', deviceId)
      } catch (e) { /* a missed beat is harmless, the next one covers it */ }
    }
    beat()
    const t = setInterval(beat, 2 * 60 * 1000)
    return () => clearInterval(t)
  }, [tableData?.id])

  const IDLE_MS = 5 * 60 * 1000
  const idleTimerRef = useRef(null)

  useEffect(() => {
    const overlayOpen = showSOS || showHistory || showFeedback || showExitGate ||
                        cartOpen || menuSheetOpen
    const shouldRun = appState === 'menu' && !overlayOpen

    function clear() {
      if (idleTimerRef.current) { clearTimeout(idleTimerRef.current); idleTimerRef.current = null }
    }
    function arm() {
      clear()
      idleTimerRef.current = setTimeout(() => {
        if (appStateRef.current === 'menu') goTo('welcome')
      }, IDLE_MS)
    }

    if (!shouldRun) { clear(); return }

    arm()
    const events = ['touchstart', 'pointerdown', 'keydown', 'scroll', 'wheel']
    events.forEach(e => window.addEventListener(e, arm, { passive: true }))
    return () => {
      clear()
      events.forEach(e => window.removeEventListener(e, arm))
    }
  }, [appState, showSOS, showHistory, showFeedback, showExitGate, cartOpen, menuSheetOpen])

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

  // After ordering the guest sees the genie screen, not the Track page.
  function handleOrderPlaced(newOrderId) {
    // cartOpen must not survive the cart being emptied, or CartDrawer
    // reads it as true the next time it mounts and opens on its own.
    setCart([]); setCartOpen(false)
    loadActiveOrders(); setLastOrderId(newOrderId || null); goTo('genie')
  }

  function handleFeedbackClose() {
    setShowFeedback(false); setFeedbackOrderId(null)
    // Submit and Skip both land on Welcome
    goTo('welcome')
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

  // Track turns on for a live order OR a live help request
  const hasActiveOrders = activeOrders.length > 0 || activeHelp.length > 0

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
          onBack={() => goTo('welcome')}
          hasActiveOrders={hasActiveOrders}
          menuSheetOpen={menuSheetOpen} setMenuSheetOpen={setMenuSheetOpen}
          showFeedbackBubble={false} onFeedbackBubbleClick={() => {}}
          onShowFeedback={() => setShowFeedback(true)} />
      )}
      {appState === 'genie' && (
        <GenieScreen tableData={tableData} eventData={eventData} orderId={lastOrderId}
          onOrderAgain={() => goTo('menu')}
          onDone={() => goTo('welcome')} />
      )}
      {appState === 'status' && (
        <OrderStatus tableData={tableData} eventData={eventData}
          tableNumber={tableNumber} activeOrders={activeOrders} activeHelp={activeHelp}
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
        addToCart={addToCart}
        onReordered={() => { setShowHistory(false); goTo('menu'); setCartOpen(true) }}
        onClose={() => { setShowHistory(false); goTo('menu') }} />}
      {showFeedback && <FeedbackModal orderId={feedbackOrderId} tableData={tableData}
        eventData={eventData} onClose={handleFeedbackClose} mode="detailed" />}

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
