/* Smart Serve Maestro - the two big screens (view-only users, signed in at /supervisor):
     Control Desk screen  (role screen_desk)      the Control Desk, every action removed
     Kitchens screen      (role screen_kitchens)  every kitchen side by side
   Anyone around the screen may look; nobody can change anything from it. Signing out
   needs the screen's own PIN, and the screen is kept awake while it is shown. */
import { useEffect, useState } from 'react'
import ControlDesk from './ControlDesk'
import KitchensScreen from './KitchensScreen'
import './maestro.css'

export const SCREEN_ROLES = ['screen_desk', 'screen_kitchens']
export const SCREEN_LABEL = { screen_desk: 'Control Desk screen', screen_kitchens: 'Kitchens screen' }

export default function BigScreen({ user, event, onSignOut }) {
  const [ask, setAsk] = useState(false)
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')

  // keep the TV / monitor from going to sleep (where the browser allows it)
  useEffect(() => {
    let lock = null, alive = true
    const take = async () => { try { if (alive && document.visibilityState === 'visible' && navigator.wakeLock) lock = await navigator.wakeLock.request('screen') } catch { /* not allowed here */ } }
    take()
    document.addEventListener('visibilitychange', take)
    return () => { alive = false; document.removeEventListener('visibilitychange', take); try { lock?.release() } catch { /* gone */ } }
  }, [])

  if (!event) {
    return (
      <div className="ms" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <div className="card" style={{ maxWidth: 420, textAlign: 'center' }}>
          <h3>{SCREEN_LABEL[user?.role] || 'Screen'}</h3>
          <p className="sub">The event for this screen could not be found. Ask the admin to check this screen's sign-in.</p>
          <button className="btn btn-navy" onClick={onSignOut}>Sign out</button>
        </div>
      </div>
    )
  }

  function tryExit() {
    if (String(pin).trim() && String(pin).trim() === String(user?.pin || '').trim()) { setAsk(false); onSignOut() }
    else { setErr('Wrong PIN'); setPin('') }
  }

  return (
    <>
      {user.role === 'screen_kitchens'
        ? <KitchensScreen eventData={event} />
        : <div className="ss-screen"><ControlDesk eventData={event} readOnly /></div>}
      <button className="ss-exit" title="Sign out (needs this screen's PIN)" onClick={() => { setAsk(true); setPin(''); setErr('') }}>⏻</button>
      {ask && (
        <div className="ms">
          <div className="sheet-bg" onClick={() => setAsk(false)}>
            <div className="sheet" onClick={e => e.stopPropagation()}>
              <h3>Sign out this screen?</h3>
              <p>Enter the PIN of {SCREEN_LABEL[user.role]} “{user.name}”.</p>
              <input className="fld" type="password" inputMode="numeric" autoFocus value={pin} onChange={e => { setPin(e.target.value); setErr('') }}
                onKeyDown={e => { if (e.key === 'Enter') tryExit() }} style={{ width: '100%', height: 42, fontSize: 18, marginBottom: 10 }} />
              {err && <p style={{ color: 'var(--red)', fontWeight: 700 }}>{err}</p>}
              <div className="row">
                <button className="btn btn-navy" onClick={tryExit}>Sign out</button>
                <button className="btn btn-ghost" onClick={() => setAsk(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
