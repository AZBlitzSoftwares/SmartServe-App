import { BrowserRouter, Routes, Route } from 'react-router-dom'
import GuestApp from './pages/GuestApp'
import SupervisorApp from './pages/SupervisorApp'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/supervisor" element={<SupervisorApp />} />
        <Route path="/*" element={<GuestApp />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
