/* Big media (the welcome video) kept on the tablet itself.

   On the event laptop every tablet used to fetch the welcome video from the
   laptop each time the welcome screen opened - tens of MB per tablet, over the
   same Wi-Fi the orders use. Now it is downloaded once, kept in this tablet's
   storage (IndexedDB: it works on the laptop's plain http address, where the
   browser's Cache Storage does not), and played from there afterwards.

   Only for the laptop's own files (/media/...). Cloud addresses are left
   exactly as they were.                                                    */

const DB_NAME = 'ss_media'
const STORE = 'files'
const memory = new Map() // url -> Promise<objectURL>

export const isLaptopMedia = url => typeof url === 'string' && url.startsWith('/media/')

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = e => { e.target.result.createObjectStore(STORE) }
    req.onsuccess = e => resolve(e.target.result)
    req.onerror = () => reject(req.error)
  })
}
async function idbGet(key) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
    r.onsuccess = () => resolve(r.result || null)
    r.onerror = () => reject(r.error)
  })
}
async function idbPut(key, value) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    // one video at a time: an older event's file makes room for this one
    const st = tx.objectStore(STORE)
    st.clear()
    st.put(value, key)
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
}

// Resolves to an address the <video> can play: from this tablet when it has
// the file, else after one full download. Rejects -> use the original url.
export function localMediaUrl(url) {
  if (!isLaptopMedia(url) || typeof indexedDB === 'undefined') return Promise.reject(new Error('not cached'))
  if (memory.has(url)) return memory.get(url)
  const p = (async () => {
    let blob = null
    try { blob = await idbGet(url) } catch { /* storage off: download below */ }
    if (!(blob instanceof Blob) || !blob.size) {
      const res = await fetch(url, { cache: 'force-cache' })
      if (!res.ok) throw new Error('media ' + res.status)
      blob = await res.blob()
      try { await idbPut(url, blob) } catch { /* full storage: play it anyway */ }
    }
    return URL.createObjectURL(blob)
  })()
  memory.set(url, p)
  p.catch(() => memory.delete(url))
  return p
}
