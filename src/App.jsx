import { Suspense, useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import GuestApp from './pages/GuestApp'
import ErrorBoundary from './components/ErrorBoundary'
import { lazyPage } from './lib/lazyPage'
import { watchForUpdates, safeToReload } from './lib/appUpdate'

// ss-split-routes. Guest and captain tablets never open the supervisor or the
// waiter screens, so those two are downloaded only when their own address is
// opened. GuestApp stays in the main file: it is what every tablet shows.
// lazyPage reloads once if a deploy removed the file meanwhile.
const SupervisorApp = lazyPage(() => import('./pages/SupervisorApp'), 'supervisor')
const WaiterApp = lazyPage(() => import('./pages/WaiterApp'), 'waiter')
// Smart Serve Maestro: the kitchen barker's big screen.
const KitchenDisplay = lazyPage(() => import('./maestro/KitchenDisplay'), 'kitchen')

function PageLoading() {
  return (
    <div style={{ minHeight:'100vh', background:'#1A0A0A', display:'flex',
      alignItems:'center', justifyContent:'center', color:'rgba(255,255,255,0.4)',
      fontSize:15, fontWeight:700, letterSpacing:'0.5px' }}>
      Loading…
    </div>
  )
}

/* A newer version is ready: it loads by itself at a quiet moment (see
   lib/appUpdate.js); this small button lets staff take it at once. */
function UpdatePill() {
  const [ready, setReady] = useState(false)
  useEffect(() => watchForUpdates(setReady), [])
  if (!ready) return null
  return (
    <button onClick={() => { if (safeToReload() || window.confirm('Update now? Anything typed and not yet sent on this screen will be lost.')) window.location.reload() }}
      data-testid="update-pill"
      style={{ position:'fixed', left:12, bottom:12, zIndex:900, border:'none', borderRadius:999, padding:'9px 14px',
        background:'#0F766E', color:'#fff', fontWeight:800, fontSize:12.5, fontFamily:'Manrope, sans-serif',
        boxShadow:'0 6px 18px rgba(0,0,0,0.25)', cursor:'pointer' }}>
      ⟳ New version ready · Update
    </button>
  )
}

function App() {
  return (
    <ErrorBoundary>
      <UpdatePill />
      <BrowserRouter>
        <Suspense fallback={<PageLoading />}>
          <Routes>
            <Route path="/supervisor" element={<SupervisorApp />} />
            {/* Kitchen waiters, on their own phones. Multi-kitchen events only. */}
            <Route path="/waiter" element={<WaiterApp />} />
            {/* Kitchen barkers, on the big screen at the pass. Maestro events only. */}
            <Route path="/kitchen" element={<KitchenDisplay />} />
            <Route path="/*" element={<GuestApp />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  )
}

export default App
