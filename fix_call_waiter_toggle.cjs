const fs = require('fs')
const BASE = '/Users/asayyed/SmartServe/src'

// FIX 1: MenuScreen — hide Call Waiter button when disabled for this event
const msPath = BASE + '/components/guest/MenuScreen.jsx'
let msContent = fs.readFileSync(msPath, 'utf8')

msContent = msContent.replace(
  `        <button onClick={onShowSOS} style={{ flexShrink:0, background:'#FEF3C7', color:'#92400E', border:'1.5px solid #FCD34D', borderRadius:999, padding:'6px 14px', fontSize:12, fontWeight:700, cursor:'pointer' }}>🛎️ Call Waiter</button>`,
  `        {eventData?.call_waiter_enabled !== false && (
          <button onClick={onShowSOS} style={{ flexShrink:0, background:'#FEF3C7', color:'#92400E', border:'1.5px solid #FCD34D', borderRadius:999, padding:'6px 14px', fontSize:12, fontWeight:700, cursor:'pointer' }}>🛎️ Call Waiter</button>
        )}`
)

fs.writeFileSync(msPath, msContent)
console.log('✅ 1/2 MenuScreen — Call Waiter button hidden when disabled')

// FIX 2: SOSPanel — also check before showing
const sosPath = BASE + '/components/guest/SOSPanel.jsx'
// SOSPanel is already only shown when the button is tapped, so hiding the button is enough
// But also guard in GuestApp just in case
const gaPath = BASE + '/pages/GuestApp.jsx'
let gaContent = fs.readFileSync(gaPath, 'utf8')

gaContent = gaContent.replace(
  `      {showSOS && <SOSPanel tableData={tableData} eventData={eventData} onClose={() => setShowSOS(false)} />}`,
  `      {showSOS && eventData?.call_waiter_enabled !== false && <SOSPanel tableData={tableData} eventData={eventData} onClose={() => setShowSOS(false)} />}`
)

fs.writeFileSync(gaPath, gaContent)
console.log('✅ 2/2 GuestApp — SOSPanel blocked when call_waiter_enabled is false')
console.log('\nRun: npm run dev')
