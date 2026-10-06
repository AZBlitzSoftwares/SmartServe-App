import { BrowserRouter, Routes, Route } from 'react-router-dom'
import GuestApp from './pages/GuestApp'
import SupervisorApp from './pages/SupervisorApp'
import WaiterApp from './pages/WaiterApp'
import ErrorBoundary from './components/ErrorBoundary'

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/supervisor" element={<SupervisorApp />} />
          {/* Kitchen waiters, on their own phones. Multi-kitchen events only. */}
          <Route path="/waiter" element={<WaiterApp />} />
          <Route path="/*" element={<GuestApp />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  )
}

export default App
