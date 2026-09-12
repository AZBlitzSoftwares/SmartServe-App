/* Tap feedback - a short vibration and a quiet click on every button.

   Attached once, globally, rather than to each button. There are well over
   a hundred buttons across the guest and captain screens and wiring them
   individually would guarantee some get missed and then drift.

   Vibration is the part that actually lands in a wedding hall: thirty
   tablets each chirping would be worse than silence, so the click is kept
   short and quiet and the vibration carries the feel. iPads ignore
   navigator.vibrate entirely, which is fine - they simply get the click.

   Switch it off for an event by running this once in the browser console:
     localStorage.setItem('ss_fx', 'off')                                   */

let ctx = null
let last = 0

function enabled() {
  try { return localStorage.getItem('ss_fx') !== 'off' } catch (e) { return true }
}

export function tap() {
  if (!enabled()) return

  // Two taps inside this window are one press - a click that also fires
  // pointerdown would otherwise double every sound.
  const now = Date.now()
  if (now - last < 60) return
  last = now

  try { if (navigator.vibrate) navigator.vibrate(12) } catch (e) {}

  try {
    // Created on the first real tap. An AudioContext built before any user
    // gesture starts suspended and stays silent on mobile.
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)()
    if (ctx.state === 'suspended') ctx.resume()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(1650, ctx.currentTime)
    // Deliberately quiet. This is a texture, not an alert - the KOT sound
    // is the one that is meant to be heard across a room.
    gain.gain.setValueAtTime(0.06, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.045)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.05)
  } catch (e) { /* never let feedback break a tap */ }
}

/* Call once on mount. Returns the cleanup function.

   Capture phase, so a handler that stops propagation - the cart backdrop,
   the row chips - still gets its click. */
export function installTapFx() {
  function onDown(e) {
    const el = e.target && e.target.closest
      ? e.target.closest('button, a, [role="button"], input[type="button"], input[type="submit"]')
      : null
    if (!el) return
    if (el.disabled) return
    tap()
  }
  document.addEventListener('pointerdown', onDown, true)
  return () => document.removeEventListener('pointerdown', onDown, true)
}
