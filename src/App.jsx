import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import GuestApp from './pages/GuestApp'
import ErrorBoundary from './components/ErrorBoundary'

// ss-split-routes. Guest and captain tablets never open the supervisor or the
// waiter screens, so those two are downloaded only when their own address is
// opened. GuestApp stays in the main file: it is what every tablet shows.
//
// If a deploy lands between loading the page and loading one of these files,
// the old file name no longer exists on the server and the import fails.
// Reload once to pick up the new version instead of showing the crash
// screen; the timestamp stops a reload loop if the failure is something else.
function lazyPage(load, name) {
  return lazy(() => load().catch(err => {
    try {
      const key = 'ss_chunk_reload_' + name
      const last = Number(sessionStorage.getItem(key)) || 0
      if (Date.now() - last > 60000) {
        sessionStorage.setItem(key, String(Date.now()))
        window.location.reload()
        return new Promise(() => {})
      }
    } catch { /* storage blocked: fall through to the error screen */ }
    throw err
  }))
}

const SupervisorApp = lazyPage(() => import('./pages/SupervisorApp'), 'supervisor')
const WaiterApp = lazyPage(() => import('./pages/WaiterApp'), 'waiter')

function PageLoading() {
  return (
    <div style={{ minHeight:'100vh', background:'#1A0A0A', display:'flex',
      alignItems:'center', justifyContent:'center', color:'rgba(255,255,255,0.4)',
      fontSize:15, fontWeight:700, letterSpacing:'0.5px' }}>
      Loading…
    </div>
  )
}

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={<PageLoading />}>
          <Routes>
            <Route path="/supervisor" element={<SupervisorApp />} />
            {/* Kitchen waiters, on their own phones. Multi-kitchen events only. */}
            <Route path="/waiter" element={<WaiterApp />} />
            <Route path="/*" element={<GuestApp />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  )
}

export default App
