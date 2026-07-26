import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useEffect } from 'react'
import GuestApp from './pages/GuestApp'
import SupervisorApp from './pages/SupervisorApp'
import janusLogo from './assets/janus_logo.jpg'

function RootPage() {
  useEffect(() => {
    // Always redirect to saved table — never stay on root
    const savedTable = localStorage.getItem('ss_last_table') || '1'
    window.location.replace('/tablet/' + savedTable)
  }, [])

  // Show nothing while redirecting
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', background:'#1A0A0A' }}>
      <img src={janusLogo} alt="" style={{ width:80, opacity:0.5 }} />
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
        <Route path="*" element={<RootPage />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
