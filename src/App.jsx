import { BrowserRouter, Routes, Route } from 'react-router-dom'
import GuestApp from './pages/GuestApp'
import SupervisorApp from './pages/SupervisorApp'
import janusLogo from './assets/janus_logo.jpg'

function RootPage() {
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', fontFamily:'Manrope, sans-serif', flexDirection:'column', gap:0, background:'#1A0A0A' }}>
      <img src={janusLogo} alt="Janu's Smart Serve" style={{ width:120, height:120, borderRadius:24, objectFit:'contain', marginBottom:20, border:'2px solid rgba(232,137,12,0.3)' }} />
      <h1 style={{ color:'#fff', fontSize:26, fontWeight:900, margin:'0 0 4px' }}>Janu's <span style={{ color:'#E8890C' }}>Smart Serve</span></h1>
      <p style={{ color:'rgba(255,255,255,0.45)', fontSize:13, margin:'0 0 36px', fontWeight:500 }}>• Jo hukum mere aaka •</p>
      <a href="/tablet/1" style={{ color:'#E8890C', fontSize:15, fontWeight:700, textDecoration:'none', background:'rgba(232,137,12,0.1)', border:'1.5px solid rgba(232,137,12,0.4)', borderRadius:12, padding:'12px 24px', marginBottom:10 }}>📱 Guest App — Table 1 (Demo)</a>
      <a href="/supervisor" style={{ color:'rgba(255,255,255,0.7)', fontSize:14, fontWeight:600, textDecoration:'none', background:'rgba(255,255,255,0.05)', border:'1.5px solid rgba(255,255,255,0.15)', borderRadius:12, padding:'12px 24px' }}>🎫 Supervisor App</a>
      <p style={{ color:'rgba(255,255,255,0.2)', fontSize:11, marginTop:32 }}>Powered by Blitz Softwares</p>
    </div>
  )
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/tablet/:tableNumber" element={<GuestApp />} />
        <Route path="/supervisor" element={<SupervisorApp />} />
        <Route path="/" element={<RootPage />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
