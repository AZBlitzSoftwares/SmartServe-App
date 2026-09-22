/* The captain-message chime.

   Deliberately nothing like the new-order beep, which is a two tone warble
   around 880Hz. This is four short high pulses - a pager, not a doorbell -
   so a supervisor with their back to the laptop knows which of the two
   just happened without looking.

   Browsers refuse to play audio until the page has had a real user
   gesture, and a supervisor who never happens to click before the first
   message would otherwise get silence all night. unlockChime() therefore
   arms the context on the FIRST interaction of any kind - a click on a
   tab, a key, a scroll - and then removes itself. Logging in is a click,
   so in practice it is armed before the board has even loaded.           */

let ctx = null
let armed = false

function context() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    if (!ctx) ctx = new AC()
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume()
    return ctx
  } catch (e) { return null }
}

export function unlockChime() {
  if (armed) return () => {}
  const arm = () => {
    armed = true
    context()
    document.removeEventListener('pointerdown', arm, true)
    document.removeEventListener('keydown', arm, true)
    document.removeEventListener('click', arm, true)
  }
  document.addEventListener('pointerdown', arm, true)
  document.addEventListener('keydown', arm, true)
  document.addEventListener('click', arm, true)
  return () => {
    document.removeEventListener('pointerdown', arm, true)
    document.removeEventListener('keydown', arm, true)
    document.removeEventListener('click', arm, true)
  }
}

/* Four pulses alternating between two high tones, about 0.7s in all.
   Loud enough to carry across a service area, short enough that three
   messages in a row do not turn into one continuous noise. */
export function playChatChime() {
  const c = context()
  if (!c) return
  try {
    const TONES = [1175, 1568, 1175, 1568]
    const STEP = 0.17
    const LEN = 0.12
    TONES.forEach((hz, i) => {
      const t0 = c.currentTime + i * STEP
      const osc = c.createOscillator()
      const gain = c.createGain()
      osc.type = 'square'          // squarer than the order beep, so it cuts through
      osc.frequency.setValueAtTime(hz, t0)
      gain.gain.setValueAtTime(0.0001, t0)
      gain.gain.exponentialRampToValueAtTime(0.32, t0 + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + LEN)
      osc.connect(gain); gain.connect(c.destination)
      osc.start(t0); osc.stop(t0 + LEN + 0.02)
    })
  } catch (e) { /* a missed chime must never break the board */ }
}
