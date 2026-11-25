/* Captain and guest tablets: no address bar, and Back never leaves the app.

   Inside the tablet app (the Median APK) the page already fills the screen
   and the APK handles Back itself. But a tablet can also show the app in a
   browser: Chrome, a home-screen shortcut, or the APK's in-app browser (the
   bar with ✕, ⌄ and the address on top, where the APK opens any address it
   does not keep inside the app). There the address bar stays on top, and
   Back can close the page and drop the captain out of the app.

   Outside the APK, on a touch screen, two things:

   1. Full screen. Every tap asks for it (a browser allows it only during a
      tap, never at load). It hides the address bar and Android's own bars.
      Back then first only leaves full screen; the next tap goes back in.

   2. Back is caught as a "close request" (CloseWatcher, Chrome 120+), the
      browser's own way for a page to hear Android's Back. One is armed at
      load, so even a Back before the first tap stays in the app, and it is
      armed again after every Back and every tap. Each Back is handed to the
      app's own back handling (overlay -> screen -> table grid), the same as
      before. The history guard in GuestApp stays as the fallback for older
      browsers.

   Desk laptops and a desktop browser testing the guest page are left alone
   (no touch screen; there Esc would count as Back), and so is the APK.
   The exit gate (supervisor PIN) pauses all of this before the app closes. */
import { inMedianApp } from './medianLinks'

let paused = false
let watcher = null            // the armed CloseWatcher, if any
let arm = () => {}            // set by installKioskScreen

function fsElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null
}

function inTabletApp() {
  if (inMedianApp()) return true
  try { return /median|gonative/i.test(navigator.userAgent || '') } catch { return false }
}

/** A touch screen in a browser, not the APK: where this module acts. */
export function kioskScreenWanted() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false
  if (inTabletApp()) return false
  try { return window.matchMedia('(pointer: coarse)').matches } catch { return false }
}

function fullscreenPossible() {
  const el = document.documentElement
  return !!(el.requestFullscreen || el.webkitRequestFullscreen) && document.fullscreenEnabled !== false
}

/** Start it. onBack is called for every Back press the browser hands over.
    Returns the function that stops it (for a React effect). */
export function installKioskScreen({ onBack } = {}) {
  if (!kioskScreenWanted()) return () => {}
  const el = document.documentElement
  const canFull = fullscreenPossible()
  const canWatch = typeof window.CloseWatcher === 'function' && typeof onBack === 'function'
  let asking = false
  let stopped = false

  arm = function armWatcher() {
    if (!canWatch || stopped || paused || watcher) return
    try {
      const w = new window.CloseWatcher()
      w.onclose = () => {
        if (watcher === w) watcher = null
        if (stopped || paused) return
        try { onBack() } catch { /* the app's handler logs its own trouble */ }
        setTimeout(() => arm(), 0)       // ready for the next Back
      }
      watcher = w
    } catch { watcher = null }
  }

  function enterFull() {
    if (!canFull || paused || asking || fsElement()) return
    asking = true
    try {
      const p = el.requestFullscreen
        ? el.requestFullscreen({ navigationUI: 'hide' })
        : el.webkitRequestFullscreen()
      if (p && typeof p.then === 'function') p.then(() => { asking = false }, () => { asking = false })
      else asking = false
    } catch { asking = false }
  }

  function onTap() {
    enterFull()
    arm()
  }

  arm()   // armed at load: a Back before the first tap is caught too

  // pointerup and touchend are when a touch counts as a tap for the browser;
  // click covers the rest. Capture phase: before any button handler runs.
  const opts = { capture: true, passive: true }
  document.addEventListener('pointerup', onTap, opts)
  document.addEventListener('touchend', onTap, opts)
  document.addEventListener('click', onTap, opts)
  return () => {
    stopped = true
    document.removeEventListener('pointerup', onTap, opts)
    document.removeEventListener('touchend', onTap, opts)
    document.removeEventListener('click', onTap, opts)
    try { watcher?.destroy() } catch { /* gone */ }
    watcher = null
    arm = () => {}
  }
}

/** Before the app is allowed to close (exit PIN given): leave full screen,
    let Back through, and stop asking for full screen. */
export function pauseKioskScreen() {
  paused = true
  try { watcher?.destroy() } catch { /* gone */ }
  watcher = null
  try {
    if (fsElement()) {
      const p = document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen?.()
      if (p && typeof p.catch === 'function') p.catch(() => {})
    }
  } catch { /* already out */ }
}

/** The exit was cancelled: Back is caught again, full screen from the next tap. */
export function resumeKioskScreen() {
  paused = false
  arm()
}
