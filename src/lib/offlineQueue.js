// Orders a tablet could not send (no network, or the server too slow to
// answer). Kept in IndexedDB under the order's own id, so the same order can
// only be stored once, and sent later with that same id - the database keeps
// it once however many times it arrives (see lib/placeOrder.js).
//
// A copy of the list is also kept in localStorage ("ss_order_outbox"), so it
// travels with the device when it moves to another address (the laptop's new
// address, or the cloud: lib/serverSwitch carries every ss_ key) and is sent
// from there. Sending it twice is harmless.
import { sendOrder } from './placeOrder'

const DB_NAME = 'smartserve_offline'
const STORE = 'pending_orders'
const MIRROR = 'ss_order_outbox'
// An order nobody could send for this long is no longer wanted at the table
const MAX_AGE_MS = 2 * 60 * 60 * 1000
// Answers that mean "this order can never go": anything else is tried again later
const FINAL = new Set(['EMPTY', 'NO_TABLE', 'BAD_REQUEST'])

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = e => resolve(e.target.result)
    req.onerror = () => reject(req.error)
  })
}

async function put(order) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(order)
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
}

async function mirror() {
  try {
    const list = await getPendingOrders()
    if (list.length) localStorage.setItem(MIRROR, JSON.stringify(list))
    else localStorage.removeItem(MIRROR)
  } catch { /* storage blocked: the IndexedDB copy still holds them */ }
}

// Orders that came with the device from another address: into this address's queue
async function adoptCarried() {
  let list = null
  try { list = JSON.parse(localStorage.getItem(MIRROR) || 'null') } catch { list = null }
  if (!Array.isArray(list) || !list.length) return
  let have = []
  try { have = await getPendingOrders() } catch { return }
  const known = new Set(have.map(o => o.id))
  for (const o of list) if (o && o.id && !known.has(o.id)) { try { await put(o) } catch { /* next time */ } }
}

// order = { id (the order id), event_id, table_id, items, captain_id? }
export async function queueOrder(order) {
  if (!order?.id) throw new Error('queueOrder: the order needs its id')
  await put({ ...order, queuedAt: order.queuedAt || Date.now(), tries: order.tries || 0 })
  await mirror()
}

export async function getPendingOrders() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function clearOrder(id) {
  const db = await openDB()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
  await mirror()
}

/* Send what is waiting, one order after the other. Only ONE run at a time on
   this tablet: a second call while one is running just waits for it (several
   "back online" events used to start several runs, each sending the same
   orders). An order leaves the queue only when the database has it, or says
   it can never take it; a busy or silent server means "later". Entries from
   before ids existed (old app), or older than two hours, are dropped. */
let running = null
export function flushOrderQueue() {
  if (running) return running
  running = (async () => {
    let sent = 0
    await adoptCarried()
    let pending = []
    try { pending = await getPendingOrders() } catch { return 0 }
    for (const o of pending.sort((a, b) => (a.queuedAt || 0) - (b.queuedAt || 0))) {
      const valid = o.event_id && o.table_id && Array.isArray(o.items) && /^[0-9a-f-]{36}$/i.test(String(o.id))
      if (!valid || Date.now() - (o.queuedAt || 0) > MAX_AGE_MS) {
        await clearOrder(o.id).catch(() => {})
        continue
      }
      let r
      try { r = await sendOrder(o) } catch { break } // still no answer: try again later
      if (r?.ok) { sent++; await clearOrder(o.id).catch(() => {}); continue }
      if (FINAL.has(r?.reason)) { await clearOrder(o.id).catch(() => {}); continue }
      // LIMIT (waits for the table's earlier orders) or a server error: keep it, try later
      try { await put({ ...o, tries: (o.tries || 0) + 1, lastReason: r?.reason || 'ERROR' }) } catch { /* keep as is */ }
    }
    await mirror()
    return sent
  })().finally(() => { running = null })
  return running
}

export async function pendingOrderCount() {
  try { return (await getPendingOrders()).length } catch { return 0 }
}
