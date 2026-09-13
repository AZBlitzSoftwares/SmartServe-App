import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { getPendingOrders, clearOrder } from '../lib/offlineQueue'
import SetupScreen from '../components/guest/SetupScreen'
import CaptainLogin, { EntryChooser } from '../components/guest/CaptainLogin'
import CaptainOrders from '../components/guest/CaptainOrders'
import CaptainTableGrid from '../components/guest/CaptainTableGrid'
import CaptainTableBlocked from '../components/guest/CaptainTableBlocked'
import { installTapFx } from '../lib/feedbackFx'
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
  // Set only in captain mode. Null on every self-service tablet, which is
  // what every guard below tests.
  const [captain, setCaptain] = useState(null)
  // Table number of the order just sent, shown briefly then cleared
  const [captainSent, setCaptainSent] = useState(null)
  const [showCaptainOrders, setShowCaptainOrders] = useState(false)
  // The table this captain is currently ordering for. Chosen on the grid
  // before the menu opens, so every screen below can rely on it.
  const [captainTable, setCaptainTable] = useState(null)
  // tableNumber -> cart, so a cart built for a blocked table survives a trip
  // back to the grid and can go the moment that table frees up.
  const [heldCarts, setHeldCarts] = useState({})
  const [blockedTable, setBlockedTable] = useState(null)
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
  const captainRef       = useRef(null)
  // Read inside handleBack, which runs from a listener and would otherwise
  // close over a stale value.
  const captainTableRef  = useRef(null)
  // Track and the blocked-table dialog are overlays like any other, and back
  // has to close them. Missing from the chain, a back press fell straight
  // through and appeared to do nothing at all.
  const showCaptainOrdersRef = useRef(false)
  const blockedTableRef  = useRef(null)
  const cartRef          = useRef([])

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
  useEffect(() => { captainRef.current = captain },           [captain])
  useEffect(() => { captainTableRef.current = captainTable }, [captainTable])
  useEffect(() => { cartRef.current = cart },                 [cart])
  useEffect(() => { showCaptainOrdersRef.current = showCaptainOrders }, [showCaptainOrders])
  useEffect(() => { blockedTableRef.current = blockedTable },           [blockedTable])

  // A short vibration and a quiet click on every button, guest and captain
  // alike. Installed once at the document level rather than wired into each
  // of the hundred-odd buttons, which would guarantee some got missed.
  useEffect(() => installTapFx(), [])

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
    if (showCaptainOrdersRef.current) { setShowCaptainOrders(false); return }
    if (blockedTableRef.current)      { setBlockedTable(null); return }

    // Screen sequence: Track -> Menu -> Welcome
    // A captain returning from the Genie screen has no table selected any
    // more, so the menu would show "TABLE -". The grid is where they are
    // actually going next.
    if (s === 'genie' && captainRef.current) { setCaptainSent(null); captainBackToGrid(); return }
    if (s === 'genie')  { goTo('menu'); return }
    if (s === 'status') { goTo('menu'); return }
    // A captain's menu sits behind the table grid, not a Welcome screen:
    //   cart -> menu -> table grid -> stop
    // The grid is their home, so back goes no further than that.
    if (s === 'captaintable') return
    if (s === 'menu' && captainRef.current) {
      setMenuSheetOpen(false); menuSheetRef.current = false
      captainBackToGrid()
      return
    }
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

  // Called only after ExitGate verifies a supervisor/admin PIN.
  //
  // Unwinds the history guard by popping until it is demonstrably clean,
  // rather than counting how far back to jump. The count is unreliable -
  // the initial load, hashchanges and the guard top-up all move the stack
  // independently, and being short by one leaves guard entries behind. Back
  // then moves within those entries, popstate ignores it because the exit is
  // unlocked, and to the guest nothing happens at all.
  //
  // Every guard entry carries a #gN hash, so that is the signal to stop.
  function performExit() {
    allowExitRef.current = true
    setShowExitGate(false)

    // Works only for windows opened by script, but harmless to try
    try { window.close() } catch (e) {}

    let steps = 0
    function unwind() {
      const isGuard = /^#g\d+$/.test(window.location.hash)
      // Cap the loop: some engines clamp history.go at the start of the
      // stack, which would otherwise spin here forever.
      if (!isGuard || steps >= 40) {
        setExitReady(true)
        return
      }
      steps++
      try { window.history.back() } catch (e) { setExitReady(true); return }
      setTimeout(unwind, 60)
    }
    unwind()
  }

  function cancelExit() {
    allowExitRef.current = false
    lastBackAtRef.current = 0
    setShowExitGate(false)
    setExitReady(false)
  }

  // Load saved setup from localStorage
  useEffect(() => {
    // A captain session wins over everything. That tablet has no table and
    // must not fall into the guest setup flow.
    const capRaw = localStorage.getItem('ss_captain_session')
    const capEv  = localStorage.getItem('ss_captain_event')
    if (capRaw && capEv) {
      try {
        const cap = JSON.parse(capRaw)
        const cev = JSON.parse(capEv)
        setCaptain(cap); setEventData(cev)
        goTo('captaintable'); refreshEvent(cev.id)
        return
      } catch (e) {
        localStorage.removeItem('ss_captain_session')
        localStorage.removeItem('ss_captain_event')
      }
    }
    const ok   = localStorage.getItem('ss_setup_complete')
    const ev   = localStorage.getItem('ss_setup_event')
    const td   = localStorage.getItem('ss_setup_table')
    const tNum = localStorage.getItem('ss_setup_table_number')
    if (ok && ev && td) {
      try {
        const evObj = JSON.parse(ev)

        // A guest session saved for an earlier event must not resume today.
        // This is exactly what put a Select Table screen in front of a
        // captain: the tablet restored a previous setup before it ever
        // looked at which event is actually running.
        const d0 = new Date()
        const todayISO = d0.getFullYear() + '-' + String(d0.getMonth()+1).padStart(2,'0') +
          '-' + String(d0.getDate()).padStart(2,'0')
        if (evObj.date !== todayISO || evObj.service_mode === 'captain') {
          ;['ss_setup_complete','ss_setup_event','ss_setup_table','ss_setup_table_number']
            .forEach(k => localStorage.removeItem(k))
          decideEntry()
          return
        }

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
      decideEntry()
    }
  }, [])

  /* Which door this tablet opens on.

     A tablet at a captain-only event must never be asked to claim a table,
     and one at a self-service event must never be asked for a captain PIN.
     With only one kind of event running today the tablet decides by itself;
     the chooser appears only when both kinds are live, which is rare. */
  async function decideEntry() {
    try {
      const d = new Date()
      const today = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') +
        '-' + String(d.getDate()).padStart(2,'0')
      const { data } = await supabase.from('events')
        .select('*').order('date', { ascending:false }).limit(50)
      const active = (data || []).filter(e => e.date === today)
      const capEvents  = active.filter(e => e.service_mode === 'captain')
      const selfEvents = active.filter(e => e.service_mode !== 'captain')

      // Asked once per tablet, then remembered. With both kinds of event
      // running today the tablet cannot know by itself, but a device that
      // was a captain's yesterday is almost certainly a captain's today -
      // and nobody wants to answer this on twenty tablets before service.
      const remembered = localStorage.getItem('ss_device_mode')
      if (remembered === 'captain' && capEvents.length)  { goTo('captain'); return }
      if (remembered === 'guest'   && selfEvents.length) { goTo('setup');   return }
      if (capEvents.length && !selfEvents.length) { goTo('captain'); return }
      if (capEvents.length && selfEvents.length)  { goTo('entry');   return }
      goTo('setup')
    } catch (e) {
      // Offline or the server is unreachable. Self-service is the older and
      // far commoner case, so that is the safer place to land.
      goTo('setup')
    }
  }

  function handleCaptainLogin(cap, ev) {
    // Kept apart from the ss_setup_* keys on purpose. A tablet that ended up
    // holding half a guest session and half a captain session would be very
    // hard to reason about at a live event.
    localStorage.setItem('ss_captain_session', JSON.stringify(cap))
    localStorage.setItem('ss_captain_event', JSON.stringify(ev))
    setCaptain(cap); setEventData(ev)
    setTableData(null); setTableNumber(null)
    setCart([]); setActiveOrders([]); setCaptainTable(null); setHeldCarts({})
    goTo('captaintable')
  }

  // Handing the tablet to another captain mid-shift. Without this the
  // orders would keep being recorded against whoever logged in first.
  //
  // Held carts are NOT cleared. They belong to the tables, not to whoever
  // happens to be holding the tablet - that is the entire point of keeping
  // them in the database. The incoming captain sees what every other captain
  // sees, with the name of whoever took it down.
  function switchCaptain() {
    localStorage.removeItem('ss_captain_session')
    localStorage.removeItem('ss_captain_event')
    setCaptain(null); setCart([]); setCaptainTable(null)
    goTo('captain')
  }

  /* Picking a table is now the captain's first act, not their last.

     The old flow built a cart and asked for the table at the end, which put
     "this table is blocked" after the guest had already given their order.
     The captain then had to go back and explain. Asking first moves that
     refusal to before anyone has spoken.

     Carts are held PER TABLE. Building for table 5, going back and picking
     table 7 gives an empty cart for 7, with table 5's still waiting. Merging
     them would eventually send table 5's biryani to table 7. */
  // Refreshed while the grid is up, so a cart another captain adds appears
  // here without anyone reloading.
  useEffect(() => {
    if (appState !== 'captaintable' || !captain || !eventData?.id) return
    loadHeldCarts()
    const t = setInterval(loadHeldCarts, 5000)
    return () => clearInterval(t)
  }, [appState, captain?.id, eventData?.id])

  function captainPickTable(n, state, live) {
    if (state === 'red') {
      setBlockedTable({ n, live, limit: eventData?.max_orders_per_table || 1 })
      return
    }
    openTableMenu(n)
  }

  async function openTableMenu(n) {
    setBlockedTable(null)
    setCaptainTable(n)
    setCartOpen(false)

    // Read the table's held cart fresh rather than trusting the grid's last
    // poll - another captain may have added to it thirty seconds ago.
    let items = heldCarts[n]?.items || []
    try {
      const { data } = await supabase.from('table_carts')
        .select('items').eq('event_id', eventData.id).eq('table_number', n).maybeSingle()
      if (data && Array.isArray(data.items)) items = data.items
    } catch (e) { /* fall back to what the grid had */ }

    setCart(items)
    goTo('menu')
  }

  /* Held carts live in the database, not on this tablet.

     A guest whose table is blocked gives their order to whichever captain is
     standing there. Ten minutes later the table frees up and a DIFFERENT
     captain walks past. If the cart only existed on the first tablet, that
     second captain has to take the whole order again - which is precisely the
     irritation this feature was meant to remove.

     So the cart belongs to the table. One row per table per event, deleted
     the moment the order goes. Last write wins if two captains type at once;
     the row records who touched it last so the other one can see whose it is
     rather than presenting it as their own. */
  async function loadHeldCarts() {
    if (!eventData?.id) return
    try {
      const { data } = await supabase.from('table_carts')
        .select('table_number, items, captains(name)')
        .eq('event_id', eventData.id)
      const m = {}
      ;(data || []).forEach(r => {
        const items = Array.isArray(r.items) ? r.items : []
        const count = items.reduce((n, i) => n + (i.quantity || 0), 0)
        if (count > 0) {
          m[r.table_number] = { count, captain: r.captains?.name || '', items }
        }
      })
      setHeldCarts(m)
    } catch (e) { /* the next poll covers it */ }
  }

  // Written on a delay rather than per keystroke: a captain adding six items
  // would otherwise fire six writes, and the last one is the only one that
  // matters.
  const cartSaveRef = useRef(null)
  useEffect(() => {
    if (!captain || captainTable == null || !eventData?.id) return
    if (cartSaveRef.current) clearTimeout(cartSaveRef.current)
    const snapshot = cart
    const t = captainTable
    cartSaveRef.current = setTimeout(async () => {
      try {
        if (!snapshot.length) {
          await supabase.from('table_carts').delete()
            .eq('event_id', eventData.id).eq('table_number', t)
        } else {
          await supabase.from('table_carts').upsert({
            event_id: eventData.id,
            table_number: t,
            items: snapshot,
            captain_id: captain.id,
            updated_at: new Date().toISOString()
          }, { onConflict: 'event_id,table_number' })
        }
      } catch (e) { /* a lost save is recoverable; the captain still has it */ }
    }, 700)
    return () => { if (cartSaveRef.current) clearTimeout(cartSaveRef.current) }
  }, [cart, captainTable, captain?.id, eventData?.id])

  async function clearHeldCart(tableNum) {
    if (!eventData?.id || tableNum == null) return
    try {
      await supabase.from('table_carts').delete()
        .eq('event_id', eventData.id).eq('table_number', tableNum)
    } catch (e) {}
    setHeldCarts(prev => { const next = { ...prev }; delete next[tableNum]; return next })
  }


  // Whatever is in the cart belongs to the table it was built for, and has
  // to survive going back to the grid - that is the whole point of holding
  // it while a table is blocked.
  function captainBackToGrid() {
    // Nothing to stash - the debounced save above has it in the database
    // already, and that is where every other captain will look for it.
    setCart([]); setCartOpen(false); setCaptainTable(null)
    goTo('captaintable')
    loadHeldCarts()
  }



  // Keep event branding in sync with the supervisor's edits
  async function refreshEvent(eventId) {
    if (!eventId) return
    try {
      const { data } = await supabase.from('events')
        .select('*').eq('id', eventId).single()
      if (!data) return
      setEventData(data)

      // A captain tablet keeps its own key and must never write the guest
      // ones. Doing so left half a guest session on every captain device,
      // which is what later resumed as a Select Table screen.
      if (captainRef.current) {
        localStorage.setItem('ss_captain_event', JSON.stringify(data))
        return
      }

      // The admin switched this event to Captain Service while the tablet
      // was sitting on it. Stop being a guest tablet rather than holding a
      // table number nobody will ever place a tablet on.
      if (data.service_mode === 'captain') {
        ;['ss_setup_complete','ss_setup_event','ss_setup_table','ss_setup_table_number']
          .forEach(k => localStorage.removeItem(k))
        setTableData(null); setTableNumber(null)
        goTo('captain')
        return
      }

      localStorage.setItem('ss_setup_event', JSON.stringify(data))
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
        // Deliberately nothing on 'delivered'. The feedback form used to be
        // pushed onto the screen five seconds after delivery, which caught
        // guests mid-meal. It now opens only from the Feedback button.
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
        // A captain is working, not idling. Throwing them back to a Welcome
        // screen they do not have would strand the tablet.
        if (appStateRef.current === 'menu' && !captainRef.current) goTo('welcome')
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
  function handleOrderPlaced(newOrderId, forTable) {
    // cartOpen must not survive the cart being emptied, or CartDrawer
    // reads it as true the next time it mounts and opens on its own.
    setCart([]); setCartOpen(false)

    // A captain gets the Genie screen too - the caterer asked for it, and
    // it reads as a real confirmation rather than a toast that vanishes.
    // It differs only in what it shows: the table it went to, no feedback
    // faces, and eight seconds instead of thirty.
    if (captainRef.current) {
      // That table's held cart has just gone out. It has to leave the
      // database too, or the next captain past that table is shown an order
      // that was already sent.
      if (forTable != null) clearHeldCart(forTable)
      setCaptainSent(forTable != null ? String(forTable) : '')
      setLastOrderId(newOrderId || null)
      goTo('genie')
      return
    }

    loadActiveOrders(); setLastOrderId(newOrderId || null); goTo('genie')
  }

  function handleFeedbackClose() {
    setShowFeedback(false); setFeedbackOrderId(null)
    // Back to the Menu, not Welcome. This modal is only ever opened from
    // the menu header, by a guest who is still eating and wants to carry
    // on browsing. The smiley on the genie screen still goes to Welcome,
    // because that guest has just finished ordering.
    goTo('menu')
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

  if (appState === 'entry') return (
    <EntryChooser
      onGuest={() => { localStorage.setItem('ss_device_mode', 'guest'); goTo('setup') }}
      onCaptain={() => { localStorage.setItem('ss_device_mode', 'captain'); goTo('captain') }} />
  )

  if (appState === 'captain') return (
    <CaptainLogin onLogin={handleCaptainLogin} onBack={() => decideEntry()} />
  )

  if (appState === 'setup') return (
    <SetupScreen onSetupComplete={handleSetupComplete}
      currentTableNumber={tableNumber} currentEventId={eventData?.id} />
  )

  if (appState === 'captaintable' && captain) return (
    <>
      <CaptainTableGrid eventData={eventData} captain={captain}
        heldCarts={heldCarts}
        onPick={captainPickTable}
        onSwitchCaptain={switchCaptain}
        onTrack={() => setShowCaptainOrders(true)} />

      {blockedTable && (
        <CaptainTableBlocked tableNum={blockedTable.n} live={blockedTable.live}
          limit={blockedTable.limit}
          hasHeld={heldCarts[blockedTable.n]?.count || 0}
          onBrowse={() => openTableMenu(blockedTable.n)}
          onBack={() => setBlockedTable(null)} />
      )}

      {showCaptainOrders && (
        <CaptainOrders eventData={eventData} captain={captain}
          onClose={() => setShowCaptainOrders(false)} />
      )}
    </>
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
          captain={captain} onSwitchCaptain={switchCaptain}
          captainTable={captainTable} onCaptainBack={captainBackToGrid}
          cart={cart} addToCart={addToCart} removeFromCart={removeFromCart}
          cartCount={cartCount} isOnline={isOnline}
          onShowSOS={() => setShowSOS(true)}
          onShowHistory={() => setShowHistory(true)}
          onShowStatus={() => captain ? setShowCaptainOrders(true) : goTo('status')}
          onBack={() => goTo('welcome')}
          hasActiveOrders={hasActiveOrders}
          menuSheetOpen={menuSheetOpen} setMenuSheetOpen={setMenuSheetOpen}
          showFeedbackBubble={false} onFeedbackBubbleClick={() => {}}
          onShowFeedback={() => setShowFeedback(true)} />
      )}
      {appState === 'genie' && (
        <GenieScreen tableData={tableData} eventData={eventData} orderId={lastOrderId}
          captain={captain} forTable={captainSent}
          onOrderAgain={() => { setCaptainSent(null); captain ? captainBackToGrid() : goTo('menu') }}
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
          cartOpen={cartOpen} onCartOpenChange={setCartOpen}
          captain={captain} captainTable={captainTable}
          onShowStatus={() => captain ? setShowCaptainOrders(true) : goTo('status')}
          onOpenMenu={() => setMenuSheetOpen(true)}
          showTrack={hasActiveOrders || !!captain} />
      )}
      {/* ss-toast-removed-48 - the Genie screen replaced this in batch 48 */}
      {showCaptainOrders && captain && (
        <CaptainOrders eventData={eventData} captain={captain}
          onClose={() => setShowCaptainOrders(false)} />
      )}

      {showSOS && <SOSPanel tableData={tableData} eventData={eventData} captain={captain}
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
