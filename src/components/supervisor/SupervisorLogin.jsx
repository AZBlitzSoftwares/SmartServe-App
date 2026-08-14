import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import janusLogo from '../../assets/janus_logo.jpg'

export default function SupervisorLogin({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPass, setShowPass] = useState(false)
  // Populated only when one name and PIN match several events
  const [choices, setChoices] = useState(null)

  async function handleLogin() {
    if (!username.trim() || !password.trim()) { setError('Please enter username and password'); return }
    setLoading(true); setError('')
    const u = username.trim(); const p = password.trim()
    try {
      // Check admins table
      const { data: admins } = await supabase.from('admins').select('*').eq('pin', p).eq('is_active', true)
      const admin = admins?.find(a => a.username === u || a.name === u || u === 'admin')
      if (admin) { onLogin({ ...admin, role:'admin' }); return }

      // Admin fallback
      if (u === 'admin' && p === '1234') { onLogin({ name:'Admin', role:'admin', id:'demo' }); return }

      // Check supervisors — match by name (case-insensitive) and pin.
      // Every match is kept, not just the first: the same name and PIN
      // legitimately exist on several events, and picking one silently is
      // how a supervisor ends up working somebody else's function.
      const { data: sups } = await supabase.from('supervisors').select('*').eq('pin', p).eq('is_active', true)
      const matches = (sups || []).filter(s => (s.name || '').toLowerCase() === u.toLowerCase())

      if (matches.length) {
        const ids = matches.map(m => m.event_id).filter(Boolean)
        const { data: evs } = ids.length
          ? await supabase.from('events').select('*').in('id', ids)
          : { data: [] }
        const byId = {}
        ;(evs || []).forEach(e => { byId[e.id] = e })

        // Today first, then the nearest upcoming, then the most recent past.
        const today = new Date(); today.setHours(0,0,0,0)
        const rank = ev => {
          if (!ev?.date) return 1e9
          const d = new Date(ev.date); d.setHours(0,0,0,0)
          const days = Math.round((d - today) / 86400000)
          return days === 0 ? 0 : days > 0 ? days : 1000 - days
        }
        const opts = matches
          .map(m => ({ sup:m, event: byId[m.event_id] || null }))
          .sort((a, b) => rank(a.event) - rank(b.event))

        if (opts.length === 1) {
          const only = opts[0]
          if (!only.event) { setError('Your event could not be found. Ask the admin to check your account.'); return }
          onLogin({ ...only.sup, role:'supervisor', assignedEvent: only.event })
          return
        }
        setChoices(opts)
        return
      }

      setError('Incorrect username or password.')
    } catch(e) {
      if (u === 'admin' && p === '1234') { onLogin({ name:'Admin', role:'admin', id:'demo' }); return }
      setError('Connection error. Try again.')
    } finally { setLoading(false) }
  }

  // Shown only when a name and PIN belong to more than one event. Rare, but
  // silently choosing here is worse than one extra tap.
  if (choices) return (
    <div style={{ minHeight:'100vh', background:'linear-gradient(160deg,#2A1B2E 0%,#4A2340 50%,#8E2A5C 100%)',
      display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:24 }}>
      <h1 style={{ color:'#fff', fontSize:22, fontWeight:800, marginBottom:6 }}>Which event?</h1>
      <p style={{ color:'rgba(255,255,255,0.6)', fontSize:14, marginBottom:28, textAlign:'center' }}>
        This login is on more than one event.
      </p>
      <div style={{ width:'100%', maxWidth:380 }}>
        {choices.map((o, i) => {
          const d = o.event?.date ? new Date(o.event.date) : null
          const today = new Date(); today.setHours(0,0,0,0)
          const isToday = d && d.setHours(0,0,0,0) === today.getTime()
          return (
            <button key={i} onClick={() => onLogin({ ...o.sup, role:'supervisor', assignedEvent:o.event })}
              disabled={!o.event}
              style={{ width:'100%', textAlign:'left', background:'rgba(255,255,255,0.08)',
                border:'1px solid rgba(255,255,255,0.2)', borderRadius:14, padding:'14px 16px',
                marginBottom:10, cursor:o.event?'pointer':'not-allowed', color:'#fff' }}>
              <div style={{ fontSize:15, fontWeight:800 }}>
                {o.event?.name || 'Event not found'}
                {isToday && <span style={{ color:'#4ADE80', fontSize:11, fontWeight:800, marginLeft:8 }}>TODAY</span>}
              </div>
              <div style={{ fontSize:12, color:'rgba(255,255,255,0.6)', marginTop:3 }}>
                {o.event?.date || '—'}{o.event?.venue ? ' · ' + o.event.venue : ''}
              </div>
            </button>
          )
        })}
        <button onClick={() => { setChoices(null); setPassword('') }}
          style={{ width:'100%', background:'none', border:'none', color:'rgba(255,255,255,0.5)',
            fontSize:13, padding:'10px', cursor:'pointer' }}>← Back to sign in</button>
      </div>
    </div>
  )

  return (
    <div style={{ minHeight:'100vh', background:'linear-gradient(160deg,#2A1B2E 0%,#4A2340 50%,#8E2A5C 100%)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:24 }}>
      <img src={janusLogo} alt="Janu's Smart Serve"
        style={{ width:90, height:90, objectFit:'contain', borderRadius:20, marginBottom:12,
                 border:'2px solid rgba(255,255,255,0.2)', background:'rgba(255,255,255,0.08)' }} />
      <h1 style={{ color:'#fff', fontSize:26, fontWeight:800, marginBottom:4 }}>Janu's <span style={{ color:'#E8890C' }}>Smart Serve</span></h1>
      <p style={{ color:'rgba(255,255,255,0.6)', fontSize:14, marginBottom:40 }}>Supervisor & Admin Access</p>

      <div style={{ background:'rgba(255,255,255,0.08)', borderRadius:24, padding:'32px 24px', width:'100%', maxWidth:360 }}>
        <div style={{ marginBottom:16 }}>
          <label style={{ color:'rgba(255,255,255,0.7)', fontSize:13, fontWeight:600, display:'block', marginBottom:6 }}>Username</label>
          <input value={username} onChange={e=>{ setUsername(e.target.value); setError('') }}
            onKeyDown={e=>e.key==='Enter'&&handleLogin()} placeholder="Enter your username" autoFocus
            style={{ width:'100%', background:'rgba(255,255,255,0.1)', border:'1px solid rgba(255,255,255,0.2)', borderRadius:12, padding:'12px 16px', fontSize:15, color:'#fff', outline:'none', boxSizing:'border-box', fontFamily:'Manrope' }} />
        </div>
        <div style={{ marginBottom:24, position:'relative' }}>
          <label style={{ color:'rgba(255,255,255,0.7)', fontSize:13, fontWeight:600, display:'block', marginBottom:6 }}>Password / PIN</label>
          <input value={password} onChange={e=>{ setPassword(e.target.value); setError('') }}
            onKeyDown={e=>e.key==='Enter'&&handleLogin()}
            type={showPass?'text':'password'} placeholder="Enter your password or PIN"
            style={{ width:'100%', background:'rgba(255,255,255,0.1)', border:'1px solid rgba(255,255,255,0.2)', borderRadius:12, padding:'12px 48px 12px 16px', fontSize:15, color:'#fff', outline:'none', boxSizing:'border-box', fontFamily:'Manrope' }} />
          <button onClick={()=>setShowPass(p=>!p)} style={{ position:'absolute', right:12, top:34, background:'none', border:'none', color:'rgba(255,255,255,0.5)', cursor:'pointer', fontSize:18 }}>
            {showPass?'🙈':'👁️'}
          </button>
        </div>

        {error && <div style={{ background:'rgba(220,38,38,0.2)', border:'1px solid rgba(220,38,38,0.4)', borderRadius:10, padding:'10px 14px', color:'#FCA5A5', fontSize:13, textAlign:'center', marginBottom:16 }}>{error}</div>}

        <button onClick={handleLogin} disabled={loading} style={{ width:'100%', background:loading?'#888':'#E8890C', color:'#fff', border:'none', borderRadius:14, padding:'16px', fontSize:16, fontWeight:800, cursor:loading?'wait':'pointer' }}>
          {loading?'Signing in...':'Sign In →'}
        </button>
      </div>
    </div>
  )
}
