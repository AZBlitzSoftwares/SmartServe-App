import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import LaptopServerAsk from './components/guest/LaptopServerAsk.jsx'
import { startupServerCheck } from './lib/serverSwitch'

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
