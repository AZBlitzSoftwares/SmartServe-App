import { isLaptopOrigin, isLocalBase, moveToLaptop, switchToCloud, DEFAULT_LAPTOP_PORT } from './serverSwitch'
import { askLaptop, cloudLaptopsFor, netOf, searchWifi } from './laptopFinder'

/* Pages served by the event laptop (tablets, phones, kitchen screens, the
   desk) follow the laptop when its address changes.

   The address comes from the router: a router restart, the laptop waking
   up or rejoining the Wi-Fi can give it a new one in the middle of the
   event. Then every device still points at the old address. This watch
   asks the laptop every 5 seconds; after about a minute without an answer it
   looks for the laptop carrying the same events:
     1. through the cloud, when the venue has any internet (the laptop tells
        the cloud its address every minute);
     2. on this Wi-Fi: the addresses of this page's own network (x.x.x.1-254),
        a few at a time.
   Found: it moves there, keeping the device's sign-in, table and choices
   (moveToLaptop). The laptop answering again at its old address (server
   restarted) moves nothing. Not found: it tries again after 30 s, then
   1, 2 and 5 minutes, and offers "Use cloud server". Nothing is searched
   while the screen is hidden. Plain DOM, outside React.                 */

const POLL_MS = 5000
// A busy laptop is not a lost laptop: wait 8 s for each answer, and only
// after 6 misses in a row (over a minute) start looking elsewhere. Looking
// means asking up to 254 addresses, which only adds load to a busy Wi-Fi.
const ASK_TIMEOUT_MS = 8000
const MISSES_BEFORE_SEARCH = 6
const BACKOFF_MS = [30000, 60000, 120000, 300000]

export function startLaptopWatch() {
  if (typeof window === 'undefined' || !isLaptopOrigin() || window.__ssLaptopWatch) return
  window.__ssLaptopWatch = true
  const own = window.location.origin
  const port = window.location.port || DEFAULT_LAPTOP_PORT
  let events = null
  let misses = 0
  let searching = false
  let rounds = 0
  let nextSearchAt = 0
  let bar = null
  let barText = null

  function show(text, withCloud = false) {
    if (!bar) {
      bar = document.createElement('div')
      bar.setAttribute('data-testid', 'laptop-lost')
      bar.setAttribute('role', 'status')
      Object.assign(bar.style, {
        position: 'fixed', top: '0', left: '0', right: '0', zIndex: '99999', background: '#B45309', color: '#fff',
        font: '700 13px/1.4 Manrope, -apple-system, Roboto, sans-serif', padding: '8px 14px', textAlign: 'center',
        boxShadow: '0 2px 10px rgba(0,0,0,0.3)', display: 'flex', gap: '12px', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap',
      })
      barText = document.createElement('span')
      bar.appendChild(barText)
      const btn = document.createElement('button')
      btn.textContent = 'Use cloud server'
      btn.setAttribute('data-testid', 'laptop-lost-cloud')
      Object.assign(btn.style, {
        background: '#fff', color: '#B45309', border: 'none', borderRadius: '8px', padding: '5px 10px',
        font: '800 12px Manrope, -apple-system, Roboto, sans-serif', cursor: 'pointer', display: 'none',
      })
      btn.onclick = () => switchToCloud()
      bar.appendChild(btn)
      document.body.appendChild(bar)
    }
    barText.textContent = text
    bar.lastChild.style.display = withCloud ? 'inline-block' : 'none'
  }
  function hide() {
    if (bar) { bar.remove(); bar = null; barText = null }
  }

  async function search() {
    searching = true
    let back = false
    // keep asking the old address while searching: a restarted server comes back there
    const recheck = setInterval(async () => { if (await askLaptop(own, 3000)) back = true }, POLL_MS)
    show('The laptop server is not answering. Looking for it…')
    let elsewhere = null
    try {
      // 1. the cloud knows where the laptop of these events is now (any internet at all)
      for (const l of await cloudLaptopsFor(events)) {
        if (back || l.base === own || !isLocalBase(l.base)) continue
        const j = await askLaptop(l.base, 3000)
        if (j && Array.isArray(j.events) && j.events.some(e => e && events.includes(e.id))) { elsewhere = l.base; break }
      }
      // 2. this page's own network, a few addresses at a time
      const net = netOf(own, { loopback: true })
      if (!elsewhere && !back && net) {
        const r = await searchWifi({
          nets: [net], port, wantEvents: events, isStopped: () => back, concurrency: 6, jitterMs: 400,
          onProgress: ({ checked }) => show(`The laptop server is not answering. Looking for it on ${net}.x (${checked} of 254)…`),
        })
        if ((r.found || []).some(f => f.base === own)) back = true
        else elsewhere = (r.found || []).map(f => f.base).find(b => b !== own) || null
      }
    } catch { /* keep the page as it is */ }
    clearInterval(recheck)
    searching = false
    if (back) { misses = 0; rounds = 0; hide(); return }
    if (elsewhere) {
      show(`Laptop server found at ${elsewhere.replace(/^http:\/\//, '')}. Opening it…`)
      moveToLaptop(elsewhere)
      return
    }
    const wait = BACKOFF_MS[Math.min(rounds, BACKOFF_MS.length - 1)]
    rounds++
    nextSearchAt = Date.now() + wait
    const when = wait < 60000 ? `${Math.round(wait / 1000)} s` : `${Math.round(wait / 60000)} min`
    show(`Laptop server not found on this Wi-Fi. Is its window open, and this device on the event Wi-Fi? Trying again in ${when}.`, true)
  }

  async function tick() {
    if (searching) return
    const j = await askLaptop(own, ASK_TIMEOUT_MS)
    if (j) {
      misses = 0; rounds = 0; nextSearchAt = 0
      if (Array.isArray(j.events)) events = j.events.map(e => e && e.id).filter(Boolean)
      hide()
      return
    }
    misses++
    if (misses < MISSES_BEFORE_SEARCH) return
    // never knew which events this laptop carries: nothing safe to look for
    if (!events || !events.length) { show('The laptop server is not answering.', true); return }
    if (document.hidden || Date.now() < nextSearchAt) return
    search()
  }

  // the next check is planned after this one answered: checks never overlap
  async function loop() {
    try { await tick() } catch { /* next round */ }
    setTimeout(loop, POLL_MS)
  }
  loop()
}
