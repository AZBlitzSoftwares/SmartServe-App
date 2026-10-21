/* The new-order beep on the admin desk (the two-tone 880/660 Hz warble, unlike the
   chat chime's pager pulses).

   Browsers only play sound after the page has had a real user gesture. armOrderBeep()
   starts the sound on the first click, tap or key anywhere and keeps it going, so the
   operator never has to press an "enable sound" button. The 🔔 Sound switch on the
   Live Orders board turns it on or off and is remembered on this computer. */

let ctx = null
let armed = false

function audio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    if (!ctx) ctx = new AC()
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume()
    return ctx
  } catch { return null }
}

export function armOrderBeep() {
  if (armed) return
  armed = true
  const wake = () => { audio() }
  for (const e of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(e, wake, { passive: true })
}

export function orderSoundOn() {
  try { return localStorage.getItem('ss_order_sound') !== 'off' } catch { return true }
}

export function setOrderSound(on) {
  try { localStorage.setItem('ss_order_sound', on ? 'on' : 'off') } catch { /* private mode */ }
  if (on) audio()
}

/** true once the browser lets this page play sound */
export function orderBeepReady() {
  return !!ctx && ctx.state === 'running'
}

export function playOrderBeep() {
  if (!orderSoundOn()) return
  const c = audio()
  if (!c || c.state !== 'running') return
  try {
    const osc = c.createOscillator(), gain = c.createGain()
    osc.connect(gain); gain.connect(c.destination)
    const t = c.currentTime
    osc.frequency.setValueAtTime(880, t); osc.frequency.setValueAtTime(660, t + 0.15); osc.frequency.setValueAtTime(880, t + 0.3)
    gain.gain.setValueAtTime(0.4, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5)
    osc.start(t); osc.stop(t + 0.5)
  } catch { /* no sound here */ }
}
