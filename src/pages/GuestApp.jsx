import { useState, useEffect, useRef, useCallback, Suspense } from 'react'
import { supabase } from '../lib/supabase'
import { getPendingOrders, clearOrder } from '../lib/offlineQueue'
import SetupScreen from '../components/guest/SetupScreen'
import CaptainLogin, { EntryChooser } from '../components/guest/CaptainLogin'
import CaptainOrders from '../components/guest/CaptainOrders'
import CaptainTableGrid from '../components/guest/CaptainTableGrid'
import CaptainTableBlocked from '../components/guest/CaptainTableBlocked'
import CaptainChat from '../components/guest/CaptainChat'
import ChairPicker from '../components/guest/ChairPicker'
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
import NoEventScreen from '../components/guest/NoEventScreen'
import { lazyPage } from '../lib/lazyPage'
import { setUnsavedCheck, setSignOutReason, hideUpdatePill } from '../lib/appUpdate'
import {
  entryFor, loadTodaysEvents, sessionStillCurrent, isCaptainEvent,
  clearGuestKeys, clearCaptainKeys, rememberMode, rememberedMode,
} from '../components/guest/deviceEntry'


// Smart Serve Maestro (course-paced multi-kitchen events): the captain's
// own screens. Loaded only when a captain signs in to a Maestro event, so
// guest tablets and other captain events never download it.
const MaestroCaptain = lazyPage(() => import('../maestro/MaestroCaptain'), 'mscaptain')

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
  // Supervisor chat. Open is the panel; minimised is the pill it shrinks
  // back to. There is deliberately no third "closed" state - the pill is
  // how the chat is opened, so hiding it would leave no way back in.
  const [chatOpen, setChatOpen] = useState(false)
  const [chatUnread, setChatUnread] = useState(0)
  // Newest unread supervisor message, shown as a toast while the captain is
  // anywhere but the grid. The panel is not rendered on the menu screen -
  // that bottom strip belongs to the order bar.
  const [chatToast, setChatToast] = useState(null)
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
  // What decideEntry() last found for today: feeds the chooser and the
  // No-event screen. offline = the server could not be read at all.
  const [entryInfo, setEntryInfo] = useState({ captainEvents: [], selfEvents: [], offline: false })

  // ── ss-multi-kitchen ─────────────────────────────────────────────────────
  // Everything below is read only when eventData.multi_kitchen is true. At a
  // guest event or an ordinary captain event these stay at their defaults
  // and nothing looks at them.
  //   chairPickerOpen  the chair sheet that Place Order opens
  //   mkSent           what the Genie screen shows: table, chairs, KOTs
  //   mkLand*          land a linked captain on their table's menu once,
  //                    after sign-in or restore, when both the event and
  //                    the captain row have been read fresh
  const [chairPickerOpen, setChairPickerOpen] = useState(false)
  const [mkSent, setMkSent] = useState(null)
  const [mkLand, setMkLand] = useState(false)
  const [mkCapSynced, setMkCapSynced] = useState(false)
  const [mkEvChecked, setMkEvChecked] = useState(false)

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
  const chatOpenRef      = useRef(false)
  const cartRef          = useRef([])
  const chairPickerRef   = useRef(false)

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
  useEffect(() => { chatOpenRef.current = chatOpen },                   [chatOpen])
  useEffect(() => { chairPickerRef.current = chairPickerOpen },         [chairPickerOpen])

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
    // ss-multi-kitchen: the chair sheet sits over the menu like the cart
    if (chairPickerRef.current)   { setChairPickerOpen(false); return }
    if (menuSheetRef.current)    { setMenuSheetOpen(false); menuSheetRef.current = false; return }
    if (cartOpenRef.current)     { setCartOpen(false); return }
    if (showSOSRef.current)      { setShowSOS(false); return }
    if (showHistoryRef.current)  { setShowHistory(false); return }
    if (showCaptainOrdersRef.current) { setShowCaptainOrders(false); return }
    // The chat panel is an overlay like any other: back shrinks it to the
    // pill rather than falling through to the screen behind it.
    if (chatOpenRef.current)          { setChatOpen(false); return }
    if (blockedTableRef.current)      { setBlockedTable(null); return }

    // Screen sequence: Track -> Menu -> Welcome
    // A captain returning from the Genie screen has no table selected any
    // more, so the menu would show "TABLE -". The grid is where they are
    // actually going next.
    // ss-multi-kitchen: a captain linked to a table carries on at that table
    if (s === 'genie' && captainRef.current && eventData?.multi_kitchen && mkSent?.table != null) {
      mkOrderAgain(); return
    }
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

  /* ── Where this tablet starts ─────────────────────────────────────────

     1. A saved captain session resumes, if its event is still today.
     2. Otherwise a saved guest table resumes, if its event is still today
        and still self-service.
     3. Otherwise decideEntry() - the one rule, written out above entryFor()
        in components/guest/deviceEntry.js.

     A saved session is then checked against the server. If its event has
     been deleted or moved to another day, the session is cleared and the
     rule runs. Nothing ever needs clearing by hand.                       */
  useEffect(() => {
    const cap = readSaved('ss_captain_session')
    const cev = readSaved('ss_captain_event')
    if (cap && cev && sessionStillCurrent(cev.date)) {
      setCaptain(cap); setEventData(cev)
      goTo('captaintable')
      // ss-multi-kitchen: landing waits for the fresh event, so a cached
      // copy cannot send the captain to a table by mistake.
      setMkLand(true)
      refreshEvent(cev.id).then(r => {
        if (r.status === 'gone' || (r.status === 'ok' && !sessionStillCurrent(r.data.date))) {
          dropCaptainSession()
          decideEntry()
          return
        }
        setMkEvChecked(true)
      })
      return
    }
    // Yesterday's session, or half of one: neither may steer this tablet.
    clearCaptainKeys()

    const ok   = localStorage.getItem('ss_setup_complete')
    const evObj = readSaved('ss_setup_event')
    const td   = readSaved('ss_setup_table')
    const tNum = localStorage.getItem('ss_setup_table_number')
    if (ok && evObj && td) {
      // A guest session saved for an earlier event must not resume today.
      if (!sessionStillCurrent(evObj.date)) {
        clearGuestKeys()
        decideEntry()
        return
      }
      // Its event is Captain Service now: this is a captain's tablet.
      if (isCaptainEvent(evObj)) {
        clearGuestKeys()
        goTo('captain')
        return
      }
      setEventData(evObj)
      setTableData(td)
      setTableNumber(parseInt(tNum) || td.table_number)
      goTo('welcome')
      // localStorage holds a snapshot taken at setup time. Pull the live
      // record so branding changes (catering name, logo, welcome note,
      // video) reach the tablet without a re-setup - and so a deleted or
      // re-dated event ends this table's session.
      refreshEvent(evObj.id).then(r => {
        if (r.status === 'gone' || (r.status === 'ok' && !sessionStillCurrent(r.data.date))) {
          clearGuestKeys()
          setEventData(null); setTableData(null); setTableNumber(null)
          setCart([]); setActiveOrders([])
          decideEntry()
        }
      })
      return
    }
    clearGuestKeys()
    decideEntry()
  }, [])

  function readSaved(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') } catch (e) { return null }
  }

  /* Which door a fresh tablet opens on - see entryFor() for the rule.
     A remembered choice (ss_device_mode) is only highlighted on the
     chooser; it never skips it.
     silent: the No-event screen's own 30-second re-check - no Loading
     flash, and ignored if the tablet has moved on meanwhile. */
  async function decideEntry(silent) {
    if (!silent) goTo('loading')
    const r = await loadTodaysEvents()
    if (silent && appStateRef.current !== 'noevent') return
    setEntryInfo({ captainEvents: r.captainEvents, selfEvents: r.selfEvents, offline: !r.ok })
    goTo(r.ok ? entryFor(r.captainEvents, r.selfEvents) : 'noevent')
  }
  const decideEntryRef = useRef(decideEntry)
  decideEntryRef.current = decideEntry
  const retryEntry = useCallback(silent => decideEntryRef.current(silent), [])

  // The two ways across. Each clears only the OTHER mode's saved keys.
  function toGuestSetup() {
    clearCaptainKeys()
    rememberMode('guest')
    goTo('setup')
  }
  function toCaptainSignIn() {
    clearGuestKeys()
    rememberMode('captain')
    setTableData(null); setTableNumber(null)
    goTo('captain')
  }

  // A saved captain session whose event is gone. Everything switchCaptain
  // clears, plus the event itself.
  function dropCaptainSession() {
    clearCaptainKeys()
    captainRef.current = null
    setCaptain(null); setEventData(null)
    setCart([]); setCaptainTable(null); setHeldCarts({})
    setMkLand(false); setMkCapSynced(false); setMkEvChecked(false)
    setChairPickerOpen(false); setMkSent(null)
  }

  function handleCaptainLogin(cap, ev) {
    // Kept apart from the ss_setup_* keys on purpose, and those are cleared
    // here. A tablet that ended up holding half a guest session and half a
    // captain session would be very hard to reason about at a live event.
    clearGuestKeys()
    localStorage.setItem('ss_captain_session', JSON.stringify(cap))
    localStorage.setItem('ss_captain_event', JSON.stringify(ev))
    setCaptain(cap); setEventData(ev)
    setTableData(null); setTableNumber(null)
    setCart([]); setActiveOrders([]); setCaptainTable(null); setHeldCarts({})
    // ss-multi-kitchen: both rows were read moments ago by the sign-in
    // screen, so a linked captain can go straight to their table.
    setMkLand(true); setMkEvChecked(true); setMkCapSynced(true)
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
    captainRef.current = null
    localStorage.removeItem('ss_captain_session')
    localStorage.removeItem('ss_captain_event')
    setCaptain(null); setCart([]); setCaptainTable(null)
    setMkLand(false); setMkCapSynced(false); setChairPickerOpen(false); setMkSent(null)
    goTo('captain')
  }

  /* ss-multi-kitchen: the captain row, read fresh.

     The admin links a captain to a table under Control. A tablet that
     signed in before that - or restored a session cached yesterday - holds
     a captain object without the link. Read on arrival, again every time
     the grid comes up, and every 15 seconds while it is up, so an unlinked
     captain is picked up the moment the admin links them. The cached
     session is kept in step. Multi-kitchen events only. */
  const onGrid = appState === 'captaintable'
  useEffect(() => {
    if (!captain?.id || !eventData?.multi_kitchen) return
    let stop = false
    const id = captain.id
    async function sync() {
      try {
        const { data } = await supabase.from('captains').select('*').eq('id', id).maybeSingle()
        if (stop) return
        if (data) {
          setCaptain(prev => {
            if (!prev || prev.id !== data.id) return prev
            // The PIN is left as signed in with, so the guard below notices a new one
            const { pin: _newPin, ...rest } = data
            const next = { ...prev, ...rest }
            return JSON.stringify(next) === JSON.stringify(prev) ? prev : next
          })
          try {
            const raw = localStorage.getItem('ss_captain_session')
            const cur = raw ? JSON.parse(raw) : null
            if (cur && cur.id === data.id) {
              const { pin: _p, ...fresh } = data
              localStorage.setItem('ss_captain_session', JSON.stringify({ ...cur, ...fresh }))
            }
          } catch (e) { /* storage full or blocked - the in-memory copy is current */ }
        }
      } catch (e) { /* offline: carry on with the cached captain */ }
      if (!stop) setMkCapSynced(true)
    }
    sync()
    const t = onGrid ? setInterval(sync, 15000) : null
    return () => { stop = true; if (t) clearInterval(t) }
  }, [captain?.id, eventData?.id, eventData?.multi_kitchen, onGrid])

  /* A saved sign-in the desk has since ended - the captain was removed, or
     given a new PIN - must not carry on from the tablet's memory. Checked
     at start, every minute, and whenever the screen wakes. Offline: the
     tablet carries on as it is. */
  useEffect(() => {
    if (!captain?.id) return
    let stop = false
    const id = captain.id
    const pin = String(captain.pin ?? '')
    async function check() {
      try {
        const { data, error } = await supabase.from('captains').select('id, is_active, pin').eq('id', id).maybeSingle()
        if (stop || error) return
        const reason = !data || data.is_active === false ? 'You were signed out: this captain was removed at the desk.'
          : pin && data.pin != null && String(data.pin) !== pin ? 'Your PIN was changed at the desk. Sign in with the new PIN.'
          : null
        if (!reason) return
        setSignOutReason(reason)
        dropCaptainSession()
        goTo('captain')
      } catch (e) { /* offline */ }
    }
    check()
    const t = setInterval(check, 60000)
    const vis = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', vis)
    return () => { stop = true; clearInterval(t); document.removeEventListener('visibilitychange', vis) }
  }, [captain?.id])

  // The Update button is for staff: guest screens update quietly at a safe moment
  useEffect(() => { hideUpdatePill(!captain && ['welcome', 'menu', 'status', 'genie', 'setup', 'entry', 'noevent', 'loading'].includes(appState)) }, [captain, appState])

  // A guest's cart lives only in memory: no automatic update while it has dishes
  useEffect(() => { setUnsavedCheck(() => (cartRef.current?.length || 0) > 0) ; return () => setUnsavedCheck(null) }, [])

  // ss-multi-kitchen: a linked captain lands straight on their table's menu
  // after sign-in or restore. Once only - back from the menu goes to the
  // grid and stays there.
  useEffect(() => {
    if (!mkLand || !mkCapSynced || !mkEvChecked) return
    if (appState !== 'captaintable' || !captain || !eventData?.multi_kitchen) return
    const n = captain.table_number
    if (n == null || n === '') return
    setMkLand(false)
    openTableMenu(Number(n))
  }, [mkLand, mkCapSynced, mkEvChecked, appState, captain?.table_number, eventData?.multi_kitchen])

  // The chair sheet never outlives the menu or the cart it was opened for
  useEffect(() => {
    if (chairPickerOpen && (appState !== 'menu' || cart.length === 0)) setChairPickerOpen(false)
  }, [chairPickerOpen, appState, cart.length])

  // ss-multi-kitchen: after an order the captain carries on at the SAME
  // table - Place another order, the Genie timeout and Back all come here.
  function mkOrderAgain() {
    const t = mkSent?.table
    setCaptainSent(null); setMkSent(null)
    if (t != null) openTableMenu(Number(t)); else captainBackToGrid()
  }

  function setCartNote(itemId, note) {
    setCart(prev => prev.map(c => c.id === itemId ? { ...c, note } : c))
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
    // ss-multi-kitchen: no "table busy" there - a table takes many orders
    if (eventData?.multi_kitchen) { openTableMenu(n); return }
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
    setMkLand(false)
    // The held cart is read from the server first. If the captain is signed
    // out meanwhile (the desk changed the PIN or removed them, or the tablet
    // was handed over), the menu must not open behind the sign-in screen.
    const who = captainRef.current?.id
    const stillSignedIn = () => !!captainRef.current && captainRef.current.id === who

    // ss-multi-kitchen: two captains can share a table there, each ordering
    // for their own chairs. A held cart is picked up only by the captain who
    // wrote it - otherwise one captain's dishes would go out a second time
    // on the other's order, to the wrong chairs.
    const mk = !!eventData?.multi_kitchen
    if (mk) {
      let mine = []
      try {
        const { data } = await supabase.from('table_carts')
          .select('items, captain_id').eq('event_id', eventData.id).eq('table_number', n).maybeSingle()
        if (data && Array.isArray(data.items) && data.captain_id === captain?.id) mine = data.items
      } catch (e) { /* start empty rather than guess */ }
      if (!stillSignedIn()) return
      setCart(mine)
      goTo('menu')
      return
    }

    // Read the table's held cart fresh rather than trusting the grid's last
    // poll - another captain may have added to it thirty seconds ago.
    let items = heldCarts[n]?.items || []
    try {
      const { data } = await supabase.from('table_carts')
        .select('items').eq('event_id', eventData.id).eq('table_number', n).maybeSingle()
      if (data && Array.isArray(data.items)) items = data.items
    } catch (e) { /* fall back to what the grid had */ }
    if (!stillSignedIn()) return

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
          // ss-multi-kitchen: only ever clear this captain's own held cart
          if (eventData?.multi_kitchen) {
            await supabase.from('table_carts').delete()
              .eq('event_id', eventData.id).eq('table_number', t).eq('captain_id', captain.id)
          } else {
            await supabase.from('table_carts').delete()
              .eq('event_id', eventData.id).eq('table_number', t)
          }
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
      // ss-multi-kitchen: only this captain's own held cart
      if (eventData?.multi_kitchen && captainRef.current) {
        await supabase.from('table_carts').delete()
          .eq('event_id', eventData.id).eq('table_number', tableNum).eq('captain_id', captainRef.current.id)
      } else {
        await supabase.from('table_carts').delete()
          .eq('event_id', eventData.id).eq('table_number', tableNum)
      }
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



  /* Unread messages from the supervisor.

     Polled here rather than inside the panel, because the badge and the
     toast have to work while the panel is shut - which is most of the
     time. When the panel IS open it marks those messages read, so this
     query comes back empty and the badge clears itself.                */
  const chatSeenRef = useRef(null)
  useEffect(() => {
    if (!captain?.id || !eventData?.id) return
    let stop = false
    let primed = false
    async function pollChatUnread() {
      try {
        const { data } = await supabase.from('chat_messages')
          .select('id, body, sender_name, created_at')
          .eq('event_id', eventData.id)
          .eq('captain_id', captain.id)
          .eq('sender', 'supervisor')
          .eq('read_by_captain', false)
          .order('created_at', { ascending: false })
        if (stop) return
        const list = data || []
        setChatUnread(list.length)
        const newest = list[0] || null
        // The first poll only records where we are. Without it, opening the
        // app to a message from twenty minutes ago throws a toast for it.
        if (!primed) { primed = true; chatSeenRef.current = newest ? newest.id : null; return }
        if (newest && newest.id !== chatSeenRef.current) {
          chatSeenRef.current = newest.id
          if (!chatOpenRef.current) setChatToast({ id:newest.id, body:newest.body })
        }
        if (!newest) chatSeenRef.current = null
      } catch (e) { /* the next poll covers it */ }
    }
    pollChatUnread()
    const t = setInterval(pollChatUnread, 4000)
    return () => { stop = true; clearInterval(t) }
  }, [captain?.id, eventData?.id])

  // Toasts clear themselves. A captain with a guest in front of them should
  // not have to dismiss anything to carry on.
  useEffect(() => {
    if (!chatToast) return
    const t = setTimeout(() => setChatToast(null), 9000)
    return () => clearTimeout(t)
  }, [chatToast])

  // Keep event branding in sync with the supervisor's edits.
  // Returns { status: 'ok', data } | { status: 'gone' } | { status: 'error' }.
  // 'gone' (the event no longer exists) is acted on only at start-up, by the
  // restore effect; a poll during service never throws a tablet out.
  async function refreshEvent(eventId) {
    if (!eventId) return { status: 'error' }
    try {
      const { data, error } = await supabase.from('events')
        .select('*').eq('id', eventId).maybeSingle()
      if (error) return { status: 'error' }
      if (!data) return { status: 'gone' }
      setEventData(data)

      // A captain tablet keeps its own key and must never write the guest
      // ones. Doing so left half a guest session on every captain device,
      // which is what later resumed as a Select Table screen.
      if (captainRef.current) {
        localStorage.setItem('ss_captain_event', JSON.stringify(data))
        return { status: 'ok', data }
      }

      // The admin switched this event to Captain Service while the tablet
      // was sitting on it. Stop being a guest tablet rather than holding a
      // table number nobody will ever place a tablet on.
      if (isCaptainEvent(data)) {
        clearGuestKeys()
        setTableData(null); setTableNumber(null)
        goTo('captain')
        return { status: 'ok', data }
      }

      localStorage.setItem('ss_setup_event', JSON.stringify(data))
      return { status: 'ok', data }
    } catch (e) { return { status: 'error' } }
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
    clearCaptainKeys()
    setEventData(ev); setTableData(td); setTableNumber(td.table_number)
    setCart([]); goTo('welcome')
  }

  function triggerReSetup() {
    clearGuestKeys()
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
  // mk is passed only by the multi-kitchen chair picker: { kots, chairs, sentAt }
  function handleOrderPlaced(newOrderId, forTable, mk) {
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
      setMkSent(mk ? { ...mk, orderId: newOrderId, table: forTable } : null)
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

  // Both kinds of event today: ask, every time. The last choice is only
  // highlighted.
  if (appState === 'entry') return (
    <EntryChooser remembered={rememberedMode()}
      captainEvents={entryInfo.captainEvents} selfEvents={entryInfo.selfEvents}
      onGuest={toGuestSetup} onCaptain={toCaptainSignIn} />
  )

  if (appState === 'noevent') return (
    <NoEventScreen offline={entryInfo.offline} onRetry={retryEntry} />
  )

  // "Guest tablet? Set up a table ->" appears there when a self-service
  // event is running today.
  if (appState === 'captain') return (
    <CaptainLogin onLogin={handleCaptainLogin} onGuest={toGuestSetup} />
  )

  // Lists self-service events only. "Captain? Sign in here ->" appears
  // there when a Captain Service event is running today.
  if (appState === 'setup') return (
    <SetupScreen onSetupComplete={handleSetupComplete}
      currentTableNumber={tableNumber} currentEventId={eventData?.id}
      onSwitchToCaptain={toCaptainSignIn} />
  )

  // ss-maestro: a captain at a Maestro event works only on the Maestro
  // screens (Take order + Course board); the grid, menu and Genie of the
  // other captain modes are never shown.
  if (captain && eventData?.maestro && ['captaintable', 'menu', 'genie', 'status'].includes(appState)) return (
    <>
      <Suspense fallback={<div style={{ minHeight:'100vh', background:'#F6F4EF' }} />}>
        <MaestroCaptain eventData={eventData} captain={captain} onSwitchCaptain={switchCaptain}
          onChat={() => setChatOpen(true)} chatUnread={chatUnread} />
      </Suspense>
      {/* The same chat with the control desk as every captain event. The
          launcher is the Desk button in the top bar, so nothing floats over
          the Fire bar at the bottom. */}
      <CaptainChat eventData={eventData} captain={captain}
        minimized={!chatOpen} unread={chatUnread} hidePill bottomOffset={16} title="Control Desk"
        onToggle={() => setChatOpen(o => !o)} />
      {chatToast && (
        <div onClick={() => { setChatToast(null); setChatOpen(true) }}
          style={{ position:'fixed', top:0, left:0, right:0, zIndex:300,
            background:'#1A0A0A', borderBottom:'3px solid #E8890C',
            padding:'12px 16px', display:'flex', alignItems:'center', gap:12,
            cursor:'pointer', boxShadow:'0 6px 24px rgba(0,0,0,0.5)' }}>
          <span style={{ fontSize:26 }}>💬</span>
          <span style={{ flex:1, minWidth:0 }}>
            <span style={{ display:'block', color:'#E8890C', fontSize:11,
              fontWeight:900, letterSpacing:'0.5px' }}>CONTROL DESK</span>
            <span style={{ display:'block', color:'#fff', fontSize:14, fontWeight:700,
              overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {chatToast.body}
            </span>
          </span>
          <span style={{ flexShrink:0, color:'rgba(255,255,255,0.55)', fontSize:11, fontWeight:700 }}>Tap to reply</span>
        </div>
      )}
    </>
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

      {/* Docked bottom-right over the grid. The pill is both the minimised
          state and the way in, so there is always a route back to it. */}
      <CaptainChat eventData={eventData} captain={captain}
        minimized={!chatOpen} unread={chatUnread}
        onToggle={() => setChatOpen(o => !o)} />
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
          onChat={() => setChatOpen(true)} chatUnread={chatUnread}
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
          mk={captain && eventData?.multi_kitchen ? mkSent : null}
          onOrderAgain={() => {
            if (captain && eventData?.multi_kitchen && mkSent?.table != null) { mkOrderAgain(); return }
            setCaptainSent(null); captain ? captainBackToGrid() : goTo('menu') }}
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
          showTrack={hasActiveOrders || !!captain}
          onOpenChairs={captain && eventData?.multi_kitchen ? () => setChairPickerOpen(true) : undefined}
          onNote={captain && eventData?.multi_kitchen ? setCartNote : undefined} />
      )}
      {/* ss-multi-kitchen: Place Order -> chairs -> one call sends the order
          and a KOT to every kitchen it touches. */}
      {chairPickerOpen && captain && eventData?.multi_kitchen && appState === 'menu' && cartCount > 0 && (
        <ChairPicker eventData={eventData} captain={captain} tableNumber={captainTable}
          cart={cart} isOnline={isOnline}
          onClose={() => setChairPickerOpen(false)}
          onNote={setCartNote}
          onSent={r => { setChairPickerOpen(false); handleOrderPlaced(r.orderId, captainTable, r) }} />
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

      {/* ss-chat-on-menu - the same panel as on the grid, lifted clear of
          the order bar. No pill here: the bar carries the launcher, so
          nothing floats over the buttons. */}
      {captain && appState === 'menu' && (
        <CaptainChat eventData={eventData} captain={captain}
          minimized={!chatOpen} unread={chatUnread} hidePill
          bottomOffset={cartCount > 0 ? 96 : 78}
          onToggle={() => setChatOpen(o => !o)} />
      )}

      {/* ss-chat-toast - a supervisor message arriving while the captain is
          away from the grid. Top of the screen on purpose: the bottom belongs
          to the order bar, and a chat landing on Place Order would be the
          worst place on the screen to put it. */}
      {chatToast && captain && (
        <div onClick={() => setChatToast(null)}
          style={{ position:'fixed', top:0, left:0, right:0, zIndex:300,
            background:'#1A0A0A', borderBottom:'3px solid #E8890C',
            padding:'12px 16px', display:'flex', alignItems:'center', gap:12,
            cursor:'pointer', boxShadow:'0 6px 24px rgba(0,0,0,0.5)' }}>
          <span style={{ fontSize:26 }}>💬</span>
          <span style={{ flex:1, minWidth:0 }}>
            <span style={{ display:'block', color:'#E8890C', fontSize:11,
              fontWeight:900, letterSpacing:'0.5px' }}>OPERATOR</span>
            <span style={{ display:'block', color:'#fff', fontSize:14, fontWeight:700,
              overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {chatToast.body}
            </span>
          </span>
          <span style={{ flexShrink:0, color:'rgba(255,255,255,0.55)', fontSize:11,
            fontWeight:700, textAlign:'right', lineHeight:1.4 }}>
            Reply from<br />the table screen
          </span>
        </div>
      )}

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
