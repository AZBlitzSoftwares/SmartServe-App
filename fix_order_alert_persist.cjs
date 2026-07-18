const fs = require('fs')
const BASE = '/Users/asayyed/SmartServe/src'

const supPath = BASE + '/pages/SupervisorApp.jsx'
let content = fs.readFileSync(supPath, 'utf8')

// Remove the auto-dismiss setTimeout from KOTDashboard order alert
const kotPath = BASE + '/components/supervisor/KOTDashboard.jsx'
let kotContent = fs.readFileSync(kotPath, 'utf8')

// Remove setTimeout auto-dismiss — keep alert until manually dismissed
kotContent = kotContent.replace(
  `      if (prevCount.current >= 0 && activeCount > prevCount.current) {
        if (onNewOrder) onNewOrder(all.find(o => o.status === 'placed'))
        // Play sound if enabled
        if (audioEnabled.current) {
          try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)()
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.connect(gain); gain.connect(ctx.destination)
            osc.frequency.setValueAtTime(880, ctx.currentTime)
            osc.frequency.setValueAtTime(660, ctx.currentTime + 0.15)
            osc.frequency.setValueAtTime(880, ctx.currentTime + 0.3)
            gain.gain.setValueAtTime(0.4, ctx.currentTime)
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5)
            osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.5)
          } catch(e) {}
        }
      }`,
  `      if (prevCount.current >= 0 && activeCount > prevCount.current) {
        const newest = all.find(o => ['pending','placed'].includes(o.status))
        if (onNewOrder) onNewOrder(newest)
        // Play sound if enabled
        if (audioEnabled.current) {
          try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)()
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.connect(gain); gain.connect(ctx.destination)
            osc.frequency.setValueAtTime(880, ctx.currentTime)
            osc.frequency.setValueAtTime(660, ctx.currentTime + 0.15)
            osc.frequency.setValueAtTime(880, ctx.currentTime + 0.3)
            gain.gain.setValueAtTime(0.4, ctx.currentTime)
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5)
            osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.5)
          } catch(e) {}
        }
      }`
)

fs.writeFileSync(kotPath, kotContent)
console.log('✅ 1/2 KOTDashboard — order alert no longer auto-dismisses')

// Fix SupervisorApp — remove the setTimeout that auto-clears newOrderAlert
// Find and remove any setTimeout(() => setNewOrderAlert(null), ...) 
content = content.replace(
  /setTimeout\(\(\) => setNewOrderAlert\(null\),\s*\d+\)/g,
  '// alert stays until dismissed manually'
)

// Also remove from the useEffect order polling if present there
content = content.replace(
  /setNewOrderAlert\(order\)\s*\n\s*setTimeout\([^)]+setNewOrderAlert[^)]+\)/g,
  'setNewOrderAlert(order)'
)

fs.writeFileSync(supPath, content)
console.log('✅ 2/2 SupervisorApp — order alert stays until View → or ✕ pressed')
console.log('\nRun: npm run dev')
