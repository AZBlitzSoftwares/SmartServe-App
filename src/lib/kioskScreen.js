/* Captain and guest tablets: no address bar, and Back never leaves the app.

   Inside the tablet app (the Median APK) the page already fills the screen.
   But a tablet can also show the app in a browser: Chrome, a home-screen
   shortcut, or the APK's in-app browser (the bar with ✕, ⌄ and the address
   on top, where the APK opens any address it does not keep inside the app).
   There the address bar stays on top, and Back can close the page and drop
   the captain out of the app.

   So outside the APK, on a touch screen, every tap asks for full screen
   (a browser allows it only during a tap, never at load). Full screen hides
   the address bar and Android's own bars, and the first Back press then
   only leaves full screen - it never leaves the app - and the next tap goes
   back in. Desk laptops and a desktop browser testing the guest page are
   left alone (no touch screen), and so is the APK itself.

   The exit gate (supervisor PIN) pauses this before it lets the app close.  */
import { inMedianApp } from './medianLinks'

let paused = false

function fsElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null
}

function inTabletApp() {
  if (inMedianApp()) return true
  try { return /median|gonative/i.test(navigator.userAgent || '') } catch { return false }
}

/** true where this module does anything: a touch screen, a browser that has
    full screen, not the APK. */
export function kioskScreenWanted() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false
  const el = document.documentElement
  if (!(el.requestFullscreen || el.webkitRequestFullscreen)) return false
  if (document.fullscreenEnabled === false) return false
  if (inTabletApp()) return false
  try { return window.matchMedia('(pointer: coarse)').matches } catch { return false }
}

/** Start it. Returns the function that stops it (for a React effect). */
export function installKioskScreen() {
  if (!kioskScreenWanted()) return () => {}
  const el = document.documentElement
  let asking = false

  function enter() {
    if (paused || asking || fsElement()) return
    asking = true
    try {
      const p = el.requestFullscreen
        ? el.requestFullscreen({ navigationUI: 'hide' })
        : el.webkitRequestFullscreen()
      if (p && typeof p.then === 'function') p.then(() => { asking = false }, () => { asking = false })
      else asking = false
    } catch { asking = false }
  }

  // pointerup and touchend are when a touch counts as a tap for the browser;
  // click covers the rest. Capture phase: before any button handler runs.
  const opts = { capture: true, passive: true }
  document.addEventListener('pointerup', enter, opts)
  document.addEventListener('touchend', enter, opts)
  document.addEventListener('click', enter, opts)
  return () => {
    document.removeEventListener('pointerup', enter, opts)
    document.removeEventListener('touchend', enter, opts)
    document.removeEventListener('click', enter, opts)
  }
}

/** Before the app is allowed to close (exit PIN given): leave full screen
    and stop asking for it. */
export function pauseKioskScreen() {
  paused = true
  try {
    if (fsElement()) {
      const p = document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen?.()
      if (p && typeof p.catch === 'function') p.catch(() => {})
    }
  } catch { /* already out */ }
}

/** The exit was cancelled: full screen again from the next tap. */
export function resumeKioskScreen() {
  paused = false
}
