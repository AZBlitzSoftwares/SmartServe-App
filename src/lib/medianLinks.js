/* The tablet app (the Median APK) opens every address outside the cloud
   address in its in-app browser: a bar with ✕, ⌄ and the address on top,
   where a captain could close or share the page. The laptop server is such
   an address (http://192.168.1.10:8080, a different one at every venue).

   The APK takes new link rules from the page at run time (Median's
   JavaScript Bridge: median://internalExternal/set), so no new APK is
   needed: on every start this page tells it that the cloud address and any
   local network address (the event laptop) open inside the app. The rest
   stays as in App Studio's (default) rules for the SmartServe app: non-web
   links (tel:, mailto:, whatsapp: ...) open outside the app, every other web
   address in the in-app browser. The rules last while the app runs; they
   are set again at each start. Outside the APK (Chrome, desk laptops) this
   does nothing.                                                          */
import { CLOUD_BASE } from './serverSwitch'

const escape = s => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

// 10.x, 127.x, 172.16-31.x, 192.168.x, 100.64-127.x, with any port and path
export const LAPTOP_LINK_REGEX =
  'https?://(10|127|172\\.(1[6-9]|2[0-9]|3[01])|192\\.168|100\\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7]))(\\.[0-9]{1,3}){2,3}(:[0-9]+)?([/?#].*)?'

export function inMedianApp() {
  try {
    return !!(window.JSBridge?.postMessage || window.webkit?.messageHandlers?.JSBridge?.postMessage)
  } catch { return false }
}

export function linkRules() {
  let host = 'smart-serve-app.vercel.app'
  try { host = new URL(CLOUD_BASE).host } catch { /* keep the default */ }
  return [
    { id: 1, regex: '(tel|mailto|sms|whatsapp|intent|market|geo|upi|fb|instagram|twitter|linkedin):.*', internal: false, mode: 'external' },
    { id: 2, regex: 'https?://' + escape(host) + '([/?#].*)?', internal: true, mode: 'internal' },
    { id: 3, regex: LAPTOP_LINK_REGEX, internal: true, mode: 'internal' },
    { id: 4, regex: 'https?://.*', internal: false, mode: 'appbrowser' },
  ]
}

/** Tell the APK to open the laptop server inside the app. true when sent. */
export function keepLaptopInApp() {
  if (!inMedianApp()) return false
  const msg = { medianCommand: 'median://internalExternal/set', data: { rules: linkRules() } }
  let sent = false
  try { if (window.JSBridge?.postMessage) { window.JSBridge.postMessage(JSON.stringify(msg)); sent = true } } catch { /* old app */ }
  try { if (window.webkit?.messageHandlers?.JSBridge?.postMessage) { window.webkit.messageHandlers.JSBridge.postMessage(msg); sent = true } } catch { /* old app */ }
  return sent
}
