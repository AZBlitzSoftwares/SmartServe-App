import { useEffect } from 'react'
import janusLogo from '../../assets/janus_logo.jpg'
import { useDeviceTools } from './useDeviceTools'
import { prettyToday } from './deviceEntry'

/* Shown on a fresh tablet when no event of either kind is dated today, or
   when the server cannot be reached at all. Never a blank set-up screen:
   staff see the date the tablet thinks it is, and a Retry. It also retries
   by itself every 30 seconds, so tablets laid out before the admin has
   created the event pick it up without anyone touching them. */
export default function NoEventScreen({ offline, onRetry }) {
  const dev = useDeviceTools()

  useEffect(() => {
    const t = setInterval(() => onRetry(true), 30000)
    return () => clearInterval(t)
  }, [onRetry])

  return (
    <div data-testid="no-event"
      style={{ minHeight: '100vh', background: 'linear-gradient(160deg, #1A0A0A, #2D1010)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '24px', fontFamily: 'Manrope, sans-serif', boxSizing: 'border-box' }}>
      <img src={janusLogo} alt="Janu's Smart Serve" {...dev.logoProps}
        style={{ width: 90, height: 90, borderRadius: 20, objectFit: 'contain',
          marginBottom: 16, border: '2px solid rgba(232,137,12,0.4)',
          background: 'rgba(232,137,12,0.1)', ...dev.logoHoldStyle }} />
      <div style={{ color: '#fff', fontSize: 22, fontWeight: 900, marginBottom: 32 }}>
        Janu's <span style={{ color: '#E8890C' }}>Smart Serve</span>
      </div>

      <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 24, padding: '32px 28px',
        width: '100%', maxWidth: 420, border: '1px solid rgba(255,255,255,0.1)',
        textAlign: 'center', boxSizing: 'border-box' }}>
        {offline ? <div style={{ fontSize: 40, marginBottom: 12 }}>📡</div> : <TodayTile />}
        <div style={{ color: '#fff', fontSize: 20, fontWeight: 900, marginBottom: 8 }}>
          {offline ? "Can't reach the server" : 'No event today'}
        </div>
        <div style={{ color: '#E8890C', fontSize: 14, fontWeight: 800, marginBottom: 14 }}>
          {prettyToday()}
        </div>
        <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, lineHeight: 1.6, marginBottom: 22 }}>
          {offline
            ? 'Check the Wi-Fi or internet, then tap Retry. If the event is running on the laptop server, tap Use laptop server.'
            : "No event is dated today. Ask the admin to check the event's date. This screen checks again by itself every 30 seconds."}
        </div>
        <button onClick={() => onRetry(false)}
          style={{ background: '#E8890C', color: '#fff', border: 'none', borderRadius: 12,
            padding: '14px 34px', fontSize: 16, fontWeight: 800, cursor: 'pointer',
            fontFamily: 'inherit' }}>
          Retry
        </button>
        {offline && (
          <button data-testid="no-event-laptop" onClick={() => dev.openTools('laptop')}
            style={{ display: 'block', margin: '12px auto 0', background: '#0F766E', color: '#fff', border: 'none',
              borderRadius: 12, padding: '14px 24px', fontSize: 15, fontWeight: 800, cursor: 'pointer',
              fontFamily: 'inherit' }}>
            💻 Use laptop server
          </button>
        )}
      </div>

      <div style={{ color: 'rgba(255,255,255,0.2)', fontSize: 11, marginTop: 24 }}>
        Powered by Blitz Softwares
      </div>
      {dev.element}
    </div>
  )
}

// Today's real date as a calendar leaf. (The calendar emoji draws a fixed
// "July 17", which next to the real date only confuses.)
function TodayTile() {
  const d = new Date()
  let month = ''
  try { month = d.toLocaleDateString('en-IN', { month: 'short' }).toUpperCase() } catch { month = '' }
  return (
    <div style={{ width: 64, margin: '0 auto 14px', borderRadius: 12, overflow: 'hidden',
      background: '#fff', boxShadow: '0 4px 14px rgba(0,0,0,0.35)' }}>
      <div style={{ background: '#E8890C', color: '#fff', fontSize: 11, fontWeight: 900,
        letterSpacing: '1px', padding: '3px 0' }}>{month}</div>
      <div style={{ color: '#1A0A0A', fontSize: 28, fontWeight: 900, lineHeight: '40px' }}>{d.getDate()}</div>
    </div>
  )
}
