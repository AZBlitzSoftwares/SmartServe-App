import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import janusLogo from '../../assets/janus_logo.jpg'

function todayStr() {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
    '-' + String(d.getDate()).padStart(2, '0')
}

const shell = {
  minHeight: '100vh',
  background: 'linear-gradient(160deg, #1A0A0A, #2D1010)',
  display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center',
  padding: '24px', fontFamily: 'Manrope, sans-serif'
}
const card = {
  background: 'rgba(255,255,255,0.06)', borderRadius: 24,
  padding: '32px 28px', width: '100%', maxWidth: 420,
  border: '1px solid rgba(255,255,255,0.1)'
}

function Brand() {
  return (
    <>
      <img src={janusLogo} alt="Janu's Smart Serve"
        style={{ width: 90, height: 90, borderRadius: 20, objectFit: 'contain',
          marginBottom: 16, border: '2px solid rgba(232,137,12,0.4)',
          background: 'rgba(232,137,12,0.1)' }} />
      <div style={{ color: '#fff', fontSize: 22, fontWeight: 900, marginBottom: 4 }}>
        Janu's <span style={{ color: '#E8890C' }}>Smart Serve</span>
      </div>
      <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, marginBottom: 32, fontStyle: 'italic' }}>
        • Jo hukum mere aaka •
      </div>
    </>
  )
}

/* Shown only when both kinds of event are running today.

   With one kind running the tablet picks by itself and nobody sees this
   screen. Asking every time would put a question in front of the common
   case for the sake of a rare one. */
export function EntryChooser({ onGuest, onCaptain }) {
  return (
    <div style={shell}>
      <Brand />
      <div style={card}>
        <div style={{ color: '#fff', fontSize: 18, fontWeight: 800, marginBottom: 6, textAlign: 'center' }}>
          How is this tablet being used?
        </div>
        <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, textAlign: 'center', marginBottom: 24 }}>
          Both kinds of event are running today
        </div>
        <button onClick={onGuest}
          style={{ width: '100%', background: 'rgba(255,255,255,0.06)',
            border: '1.5px solid rgba(255,255,255,0.15)', borderRadius: 14,
            padding: '18px', marginBottom: 12, textAlign: 'left', cursor: 'pointer' }}>
          <div style={{ color: '#fff', fontWeight: 800, fontSize: 16 }}>📱 Guest tablet</div>
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 4 }}>
            It sits on a table. Guests order for themselves.
          </div>
        </button>
        <button onClick={onCaptain}
          style={{ width: '100%', background: 'rgba(255,255,255,0.06)',
            border: '1.5px solid rgba(255,255,255,0.15)', borderRadius: 14,
            padding: '18px', textAlign: 'left', cursor: 'pointer' }}>
          <div style={{ color: '#fff', fontWeight: 800, fontSize: 16 }}>🧑‍💼 Captain</div>
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 4 }}>
            A captain carries it and takes orders at the tables.
          </div>
        </button>
      </div>
      <div style={{ color: 'rgba(255,255,255,0.2)', fontSize: 11, marginTop: 24 }}>
        Powered by Blitz Softwares
      </div>
    </div>
  )
}

/* Captain sign-in.

   Name and PIN only. The event is resolved from the captain record and
   narrowed to today, so a captain never types an event name - at 7pm with
   guests arriving, every field is a chance to get it wrong.

   Two captains with the same name at one event are blocked by the database.
   The same name at two different events running the same day is not, so if
   the PIN matches in both places the event is asked for rather than guessed. */
export default function CaptainLogin({ onLogin, onBack }) {
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [events, setEvents] = useState([])       // today's captain-mode events
  const [loading, setLoading] = useState(true)
  const [choices, setChoices] = useState(null)   // [{ captain, event }] when ambiguous

  useEffect(() => { loadEvents() }, [])

  async function loadEvents() {
    setLoading(true)
    try {
      const { data } = await supabase.from('events')
        .select('*').eq('date', todayStr()).eq('service_mode', 'captain')
      setEvents(data || [])
    } catch (e) {
      setError('Could not reach the server. Check the connection and try again.')
    }
    setLoading(false)
  }

  async function signIn() {
    const n = name.trim(), p = pin.trim()
    if (!n) { setError('Enter your captain name.'); return }
    if (!p) { setError('Enter your PIN.'); return }
    if (!events.length) { setError('No captain event is running today.'); return }

    setBusy(true); setError('')
    try {
      const ids = events.map(e => e.id)
      const { data: caps } = await supabase.from('captains')
        .select('*').in('event_id', ids).eq('is_active', true)

      // Matched here rather than in the query so the name is case and
      // space insensitive - "c1", "C1" and " C1 " are the same person to
      // everyone except a database equality check.
      const key = n.toLowerCase()
      const hits = (caps || []).filter(c =>
        String(c.name || '').trim().toLowerCase() === key && String(c.pin || '') === p)

      if (!hits.length) {
        setError('That name and PIN do not match any captain at today\u2019s event.')
        setBusy(false); return
      }

      const pairs = hits
        .map(c => ({ captain: c, event: events.find(e => e.id === c.event_id) }))
        .filter(x => x.event)

      if (pairs.length === 1) {
        onLogin(pairs[0].captain, pairs[0].event)
      } else {
        setChoices(pairs)
      }
    } catch (e) {
      setError('Could not sign in. Check the connection and try again.')
    }
    setBusy(false)
  }

  const inputStyle = {
    width: '100%', background: 'rgba(255,255,255,0.08)',
    border: '1.5px solid rgba(255,255,255,0.15)', borderRadius: 12,
    padding: '15px', fontSize: 18, color: '#fff', textAlign: 'center',
    fontWeight: 800, outline: 'none', fontFamily: 'Manrope',
    boxSizing: 'border-box', marginBottom: 12
  }

  return (
    <div style={shell}>
      <Brand />
      <div style={card}>

        {choices ? (
          <>
            <div style={{ color: '#fff', fontSize: 18, fontWeight: 800, marginBottom: 6, textAlign: 'center' }}>
              📅 Which event?
            </div>
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, textAlign: 'center', marginBottom: 20 }}>
              You are a captain at more than one event today
            </div>
            {choices.map(({ captain, event }) => (
              <button key={captain.id} onClick={() => onLogin(captain, event)}
                style={{ width: '100%', background: 'rgba(255,255,255,0.06)',
                  border: '1.5px solid rgba(255,255,255,0.15)', borderRadius: 14,
                  padding: '16px 18px', marginBottom: 10, textAlign: 'left', cursor: 'pointer' }}>
                <div style={{ color: '#fff', fontWeight: 800, fontSize: 16 }}>{event.name}</div>
                <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 3 }}>
                  {event.venue ? '📍 ' + event.venue : ''}
                  {event.catering_company ? ' · 🍽️ ' + event.catering_company : ''}
                </div>
              </button>
            ))}
            <button onClick={() => setChoices(null)}
              style={{ width: '100%', background: 'transparent',
                border: '1px solid rgba(255,255,255,0.15)', borderRadius: 12, padding: '12px',
                color: 'rgba(255,255,255,0.4)', fontSize: 14, cursor: 'pointer' }}>
              ← Back
            </button>
          </>
        ) : (
          <>
            <div style={{ color: '#fff', fontSize: 18, fontWeight: 800, marginBottom: 6, textAlign: 'center' }}>
              🧑‍💼 Captain Sign In
            </div>
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, textAlign: 'center', marginBottom: 24 }}>
              Your event is found automatically
            </div>

            {loading ? (
              <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.5)', padding: 20 }}>
                Loading…
              </div>
            ) : events.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 20 }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>📅</div>
                <div style={{ color: '#FC8181', fontWeight: 700, marginBottom: 8 }}>
                  No captain event today
                </div>
                <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, lineHeight: 1.6 }}>
                  Ask the admin to check the event date and that its Service Mode
                  is set to Captain Service.
                </div>
                <button onClick={loadEvents}
                  style={{ marginTop: 16, background: '#E8890C', color: '#fff', border: 'none',
                    borderRadius: 10, padding: '10px 20px', fontSize: 14, fontWeight: 700,
                    cursor: 'pointer' }}>
                  Retry
                </button>
              </div>
            ) : (
              <>
                {events.length === 1 && (
                  <div style={{ background: 'rgba(232,137,12,0.15)',
                    border: '1px solid rgba(232,137,12,0.3)', borderRadius: 12,
                    padding: '12px 16px', marginBottom: 20, textAlign: 'center' }}>
                    <div style={{ color: '#E8890C', fontWeight: 700, fontSize: 13, marginBottom: 2 }}>
                      Today's Event
                    </div>
                    <div style={{ color: '#fff', fontWeight: 900, fontSize: 16 }}>{events[0].name}</div>
                    {events[0].venue && (
                      <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 2 }}>
                        📍 {events[0].venue}
                      </div>
                    )}
                  </div>
                )}

                <input value={name} onChange={e => setName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && signIn()}
                  placeholder="Captain name" autoCapitalize="none" autoCorrect="off"
                  style={inputStyle} />

                <input value={pin} inputMode="numeric" maxLength={6} type="password"
                  onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  onKeyDown={e => e.key === 'Enter' && signIn()}
                  placeholder="PIN"
                  style={{ ...inputStyle, letterSpacing: 12, fontSize: 24 }} />

                {error && (
                  <div style={{ color: '#FC8181', fontSize: 13, textAlign: 'center',
                    marginBottom: 12, lineHeight: 1.5 }}>
                    {error}
                  </div>
                )}

                <button onClick={signIn} disabled={busy}
                  style={{ width: '100%', background: busy ? '#555' : '#E8890C',
                    color: '#fff', border: 'none', borderRadius: 12, padding: '16px',
                    fontSize: 16, fontWeight: 800, cursor: busy ? 'wait' : 'pointer' }}>
                  {busy ? 'Signing in…' : 'Sign In →'}
                </button>

                {onBack && (
                  <button onClick={onBack}
                    style={{ width: '100%', background: 'transparent',
                      border: '1px solid rgba(255,255,255,0.15)', borderRadius: 12,
                      padding: '12px', color: 'rgba(255,255,255,0.4)', fontSize: 14,
                      cursor: 'pointer', marginTop: 10 }}>
                    ← Back
                  </button>
                )}
              </>
            )}
          </>
        )}
      </div>

      <div style={{ color: 'rgba(255,255,255,0.2)', fontSize: 11, marginTop: 24 }}>
        Powered by Blitz Softwares
      </div>
    </div>
  )
}
