import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import LaptopServerAsk from './components/guest/LaptopServerAsk.jsx'
import { startupServerCheck } from './lib/serverSwitch'
import { keepLaptopInApp } from './lib/medianLinks'

// Tablets: the on-screen keyboard must never cover the field being typed in.
// index.html asks the browser to shrink the page above the keyboard
// (interactive-widget=resizes-content); where a browser or app wrapper only
// lays the keyboard over the page, --kb carries its height so full-screen
// views (captain tablet) end above it. Either way the field is brought into
// view once the keyboard is up.
;(function keepTypingVisible() {
  const vv = window.visualViewport
  const html = document.documentElement
  const reveal = () => {
    const el = document.activeElement
    if (!el || !/^(INPUT|TEXTAREA)$/.test(el.tagName) || /^(checkbox|radio|button|submit)$/.test(el.type)) return
    const r = el.getBoundingClientRect()
    const h = vv ? vv.height : window.innerHeight
    if (r.top < 0 || r.bottom > h - 8) { try { el.scrollIntoView({ block: 'center' }) } catch { /* old browser */ } }
  }
  const update = () => {
    const kb = vv ? Math.max(0, Math.round(window.innerHeight - vv.height)) : 0
    html.style.setProperty('--kb', kb > 120 ? kb + 'px' : '0px')
    setTimeout(reveal, 60)
  }
  if (vv) vv.addEventListener('resize', update)
  window.addEventListener('focusin', () => { setTimeout(reveal, 350); setTimeout(reveal, 800) })
  update()
})()

// The tablet app (APK) must open the event laptop inside the app, not in its
// in-app browser: set its link rules first (src/lib/medianLinks.js).
if (keepLaptopInApp()) window.__ssLinkRulesAt = Date.now()

// Before anything is drawn: a device set to the event laptop goes there now
// (the APK always opens the cloud address). See src/lib/serverSwitch.js.
const server = startupServerCheck()

if (server !== 'redirect') {
  const root = createRoot(document.getElementById('root'))
  const renderApp = () => root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
  if (server === 'ask') root.render(<LaptopServerAsk onUseCloud={renderApp} />)
  else renderApp()
}
