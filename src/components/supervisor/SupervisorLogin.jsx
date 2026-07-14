import { useState } from 'react'
import { supabase } from '../../lib/supabase'

export default function SupervisorLogin({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPass, setShowPass] = useState(false)

  async function handleLogin() {
    if (!username.trim() || !password.trim()) { setError('Please enter username and password'); return }
    setLoading(true); setError('')
    try {
      // Check admins table first
      const { data: admins } = await supabase.from('admins').select('*').eq('username', username.trim()).eq('pin', password.trim()).eq('is_active', true).limit(1)
      if (admins?.length) { onLogin({ ...admins[0], role:'admin' }); return }

      // Check supervisors table
      const { data: sups } = await supabase.from('supervisors').select('*').eq('name', username.trim()).eq('pin', password.trim()).eq('is_active', true).limit(1)
      if (sups?.length) { onLogin({ ...sups[0], role:'supervisor' }); return }

      // Demo fallback: admin / 1234
      if (username.trim() === 'admin' && password.trim() === '1234') {
        onLogin({ name:'Admin', role:'admin', id:'demo' }); return
      }
      // Supervisor demo fallback: supervisor / 1234
      if (username.trim() === 'supervisor' && password.trim() === '1234') {
        onLogin({ name:'Supervisor', role:'supervisor', id:'demo-sup' }); return
      }

      setError('Incorrect username or password. Please try again.')
    } catch(e) {
      if (username.trim()==='admin' && password.trim()==='1234') { onLogin({ name:'Admin', role:'admin', id:'demo' }); return }
      setError('Connection error. Try again.')
    } finally { setLoading(false) }
  }

  function onKey(e) { if (e.key === 'Enter') handleLogin() }

  return (
    <div style={{ minHeight:'100vh', background:'linear-gradient(160deg,#2A1B2E 0%,#4A2340 50%,#8E2A5C 100%)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ fontSize:48, marginBottom:12 }}>👨‍💼</div>
      <h1 style={{ color:'#fff', fontSize:26, fontWeight:800, marginBottom:4 }}>Janu's <span style={{ color:'#E8890C' }}>Smart Serve</span></h1>
      <p style={{ color:'rgba(255,255,255,0.6)', fontSize:14, marginBottom:40 }}>Supervisor & Admin Access</p>

      <div style={{ background:'rgba(255,255,255,0.08)', borderRadius:24, padding:'32px 24px', width:'100%', maxWidth:360 }}>
        <div style={{ marginBottom:16 }}>
          <label style={{ color:'rgba(255,255,255,0.7)', fontSize:13, fontWeight:600, display:'block', marginBottom:6 }}>Username</label>
          <input value={username} onChange={e => { setUsername(e.target.value); setError('') }} onKeyDown={onKey}
            placeholder="Enter your username"
            style={{ width:'100%', background:'rgba(255,255,255,0.1)', border:'1px solid rgba(255,255,255,0.2)', borderRadius:12, padding:'12px 16px', fontSize:15, color:'#fff', outline:'none', boxSizing:'border-box', fontFamily:'Manrope' }} />
        </div>
        <div style={{ marginBottom:24, position:'relative' }}>
          <label style={{ color:'rgba(255,255,255,0.7)', fontSize:13, fontWeight:600, display:'block', marginBottom:6 }}>Password / PIN</label>
          <input value={password} onChange={e => { setPassword(e.target.value); setError('') }} onKeyDown={onKey}
            type={showPass ? 'text' : 'password'} placeholder="Enter your password or PIN"
            style={{ width:'100%', background:'rgba(255,255,255,0.1)', border:'1px solid rgba(255,255,255,0.2)', borderRadius:12, padding:'12px 48px 12px 16px', fontSize:15, color:'#fff', outline:'none', boxSizing:'border-box', fontFamily:'Manrope' }} />
          <button onClick={() => setShowPass(p => !p)} style={{ position:'absolute', right:12, top:34, background:'none', border:'none', color:'rgba(255,255,255,0.5)', cursor:'pointer', fontSize:18 }}>
            {showPass ? '🙈' : '👁️'}
          </button>
        </div>

        {error && <div style={{ background:'rgba(220,38,38,0.2)', border:'1px solid rgba(220,38,38,0.4)', borderRadius:10, padding:'10px 14px', color:'#FCA5A5', fontSize:13, textAlign:'center', marginBottom:16 }}>{error}</div>}

        <button onClick={handleLogin} disabled={loading} style={{ width:'100%', background: loading?'#888':'#E8890C', color:'#fff', border:'none', borderRadius:14, padding:'16px', fontSize:16, fontWeight:800, cursor:loading?'wait':'pointer' }}>
          {loading ? 'Signing in...' : 'Sign In →'}
        </button>

        <div style={{ marginTop:20, padding:'14px', background:'rgba(255,255,255,0.05)', borderRadius:12, fontSize:12, color:'rgba(255,255,255,0.5)', textAlign:'center', lineHeight:1.8 }}>
          <strong style={{ color:'rgba(255,255,255,0.8)' }}>Demo credentials</strong><br/>
          Admin: <code>admin</code> / <code>1234</code><br/>
          Supervisor: <code>supervisor</code> / <code>1234</code>
        </div>
      </div>
    </div>
  )
}
