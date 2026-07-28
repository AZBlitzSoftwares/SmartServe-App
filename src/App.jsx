import { BrowserRouter, Routes, Route } from 'react-router-dom'
import GuestApp from './pages/GuestApp'
import SupervisorApp from './pages/SupervisorApp'
import ErrorBoundary from './components/ErrorBoundary'

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/supervisor" element={<SupervisorApp />} />
          <Route path="/*" element={<GuestApp />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  )
}

export default App
