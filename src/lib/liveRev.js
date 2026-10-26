/* "Has anything changed?" without downloading the lists again.

   On the event laptop the server keeps a change counter (/__ss/rev, a few
   bytes from memory) that moves when an order, a dish, a KOT or a help
   request changes in its database. A screen asks for it every 2 seconds and
   reloads its lists only when it moved, plus once every 15 s to be safe. On
   the cloud (no counter) it simply reloads every `cloudMs`, as the screens
   always did.

   onChange may return a promise: no new reload starts while one is running
   (a slow device must not pile reloads on top of each other).

   watchChanges(onChange, { cloudMs }) returns a stop function.
   everyMs may be a function (asked before each wait). A hidden tab waits
   hiddenCloudMs / hiddenEveryMs (by default longer: 10 s / 6 s).        */

const local = typeof window !== 'undefined' ? window.__SS_LOCAL__ : null

export function watchChanges(onChange, { cloudMs = 4000, everyMs = 2000, safetyMs = 15000, hiddenCloudMs = null, hiddenEveryMs = 6000 } = {}) {
  const ms = v => (typeof v === 'function' ? v() : v)
  let stopped = false
  let last = null
  let lastRun = Date.now()
  let timer = null
  let noCounter = !local
  let running = null
  let pending = false

  function run() {
    lastRun = Date.now()
    if (running) { pending = true; return }
    let p
    try { p = onChange() } catch { p = null }
    if (p && typeof p.then === 'function') {
      running = p.catch(() => {}).finally(() => {
        running = null
        if (pending && !stopped) { pending = false; run() }
      })
    }
  }

  async function tick() {
    if (stopped) return
    if (noCounter) {
      run()
    } else {
      try {
        const ctl = new AbortController()
        const to = setTimeout(() => ctl.abort(), 4000)
        const r = await fetch('/__ss/rev', { cache: 'no-store', signal: ctl.signal })
        clearTimeout(to)
        let j = null
        if (r.ok) { try { j = await r.json() } catch { j = null } }
        if (!j || typeof j.rev !== 'string') {
          // an older laptop server (no counter): plain reloads, as on the cloud
          if (r.ok || r.status === 404) { noCounter = true; run() }
          else if (Date.now() - lastRun > safetyMs) run()
        } else if (j.rev !== last) {
          const first = last === null
          last = j.rev
          if (!first) run()
        } else if (Date.now() - lastRun > safetyMs) run()
      } catch {
        // the laptop did not answer this time: fall back to a plain reload now and then
        if (Date.now() - lastRun > safetyMs) run()
      }
    }
    if (!stopped) {
      const hidden = typeof document !== 'undefined' && document.hidden
      timer = setTimeout(tick, noCounter ? (hidden ? (hiddenCloudMs ?? Math.max(cloudMs, 10000)) : cloudMs) : ms(hidden ? hiddenEveryMs : everyMs))
    }
  }
  timer = setTimeout(tick, noCounter ? cloudMs : ms(everyMs))
  return () => { stopped = true; clearTimeout(timer) }
}

export const onLaptop = !!local
