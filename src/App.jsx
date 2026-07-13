import { BrowserRouter, Routes, Route } from 'react-router-dom'
import GuestApp from './pages/GuestApp'
import SupervisorApp from './pages/SupervisorApp'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/tablet/:tableNumber" element={<GuestApp />} />
        <Route path="/supervisor" element={<SupervisorApp />} />
        <Route path="/" element={
          <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',fontFamily:'sans-serif',flexDirection:'column',gap:16}}>
            <h2>SmartServe</h2>
            <a href="/tablet/1">Guest App — Table 1 (Demo)</a>
            <a href="/supervisor">Supervisor App</a>
          </div>
        } />
      </Routes>
    </BrowserRouter>
  )
}

export default App
