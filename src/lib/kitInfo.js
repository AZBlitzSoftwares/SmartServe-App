import { useEffect, useState } from 'react'
import { isLaptopOrigin } from './serverSwitch'

/* What this build carries for download (tools/offline-kit.mjs writes
   /downloads/offline-kit.json): the Offline Kit and the Print Hub, each for
   Windows and Mac. Read once per page load and shared.
   null = still checking, false = not in this build (or on the laptop server). */
let pending = null
function loadKitInfo() {
  if (!pending) {
    pending = fetch('/downloads/offline-kit.json', { cache: 'no-store' })
      .then(r => (r.ok && (r.headers.get('content-type') || '').includes('json') ? r.json() : false))
      .then(j => (j && Array.isArray(j.kits) ? j : false))
      .catch(() => false)
  }
  return pending
}

export function useKitInfo() {
  const onLaptop = isLaptopOrigin()
  const [info, setInfo] = useState(onLaptop ? false : null)
  useEffect(() => {
    if (onLaptop) return
    let alive = true
    loadKitInfo().then(j => { if (alive) setInfo(j) })
    return () => { alive = false }
  }, [onLaptop])
  return info
}

export const mb = b => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)
