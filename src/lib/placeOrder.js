import { supabase } from './supabase'

/* Sending an order exactly once.

   The tablet makes the order's id ONCE, when Place Order is tapped, and every
   send of that order carries the same id: a second tap, a retry after a slow
   network, the offline queue sending it later. The database keeps the first
   and answers "repeat" to the rest (ss_place_order, db/2026-10-26_place_order.sql),
   so one order can never arrive twice. The order limit is checked there too,
   in the same step that saves the order.

   Before that SQL is run (an older database) the same id still protects the
   order itself: a second insert of the same id is refused by the database.  */

const SEND_TIMEOUT_MS = 10000

export function newOrderId() {
  try { if (crypto?.randomUUID) return crypto.randomUUID() } catch { /* older webview */ }
  const b = new Uint8Array(16)
  try { crypto.getRandomValues(b) } catch { for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256) }
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

function timeoutSignal(ms) {
  try { if (AbortSignal.timeout) return AbortSignal.timeout(ms) } catch { /* older browser */ }
  const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal
}

const itemsOf = list => (list || []).map(i => ({
  menu_item_id: i.menu_item_id || i.id,
  quantity: Math.max(1, Number(i.quantity) || 1),
  ...(i.note ? { note: String(i.note) } : {}),
}))

const missingRpc = e => e && (e.code === 'PGRST202' || /ss_place_order/.test(e.message || '') && /not find|does not exist/i.test(e.message || ''))
// No code = no answer. These codes mean the server was busy or restarting, not that the order is wrong.
const BUSY = /^(SS503|PGRST00\d|57014|53300|53400|40001|40P01|08\d{3}|5\d\d)$/
const isNetwork = e => !e || !e.code || BUSY.test(String(e.code)) || e.name === 'AbortError' || /fetch|network|abort|timeout|load failed/i.test(`${e.message} ${e.details} ${e.hint}`)

/* o = { id, event_id, table_id, items: [{ id | menu_item_id, quantity, note? }], captain_id? }
   Resolves { ok: true, order_id, repeat? } | { ok: false, reason: 'LIMIT' | 'EMPTY' | 'NO_TABLE' | ..., limit? }
   Rejects only when the network did not answer (safe to send again later). */
export async function sendOrder(o) {
  const { data, error } = await supabase.rpc('ss_place_order', {
    p_order_id: o.id, p_event_id: o.event_id, p_table_id: o.table_id, p_items: itemsOf(o.items), p_captain_id: o.captain_id || null,
  }).abortSignal(timeoutSignal(SEND_TIMEOUT_MS))
  if (!error) return data && typeof data === 'object' ? data : { ok: false, reason: 'NO_ANSWER' }
  if (missingRpc(error)) return sendOrderOld(o)
  if (isNetwork(error)) throw Object.assign(new Error(error.message || 'network'), { network: true })
  return { ok: false, reason: 'ERROR', message: error.message }
}

// Older database (SQL not run yet): insert with the tablet's id, so a repeat is refused.
async function sendOrderOld(o) {
  const sig = () => timeoutSignal(SEND_TIMEOUT_MS)
  // every check must have answered: a missed check is "try again", never "carry on"
  const must = r => { if (r.error) throw Object.assign(new Error(r.error.message || 'check'), { network: true }); return r.data }
  const ev = must(await supabase.from('events').select('max_orders_per_table').eq('id', o.event_id).maybeSingle().abortSignal(sig()))
  const limit = ev?.max_orders_per_table ?? 1
  const same = must(await supabase.from('orders').select('id').eq('id', o.id).maybeSingle().abortSignal(sig()))
  if (!same && limit > 0) {
    const live = must(await supabase.from('orders').select('id').eq('table_id', o.table_id)
      .in('status', ['pending', 'placed', 'in_progress']).abortSignal(sig()))
    if ((live?.length || 0) >= limit) return { ok: false, reason: 'LIMIT', limit }
  }
  let repeat = !!same
  if (!same) {
    const { error } = await supabase.from('orders')
      .insert({ id: o.id, event_id: o.event_id, table_id: o.table_id, status: 'pending', ...(o.captain_id ? { captain_id: o.captain_id } : {}) })
      .abortSignal(sig())
    if (error && error.code !== '23505') {
      if (isNetwork(error)) throw Object.assign(new Error(error.message || 'network'), { network: true })
      return { ok: false, reason: 'ERROR', message: error.message }
    }
    repeat = !!error
  }
  // the dishes, unless an earlier send already saved them
  const have = must(await supabase.from('order_items').select('id').eq('order_id', o.id).limit(1).abortSignal(sig()))
  if (!have?.length) {
    const { error } = await supabase.from('order_items')
      .insert(itemsOf(o.items).map(i => ({ order_id: o.id, menu_item_id: i.menu_item_id, quantity: i.quantity }))).abortSignal(sig())
    if (error) throw Object.assign(new Error(error.message || 'items'), { network: isNetwork(error) })
  }
  return { ok: true, order_id: o.id, repeat }
}

/* Try a few times quickly (same id every time). onSlow is called once the
   first try has taken a while, so the screen can say "still sending". */
export async function sendOrderWithRetry(o, { tries = 3, onSlow } = {}) {
  let last
  for (let n = 0; n < tries; n++) {
    const slow = onSlow ? setTimeout(() => onSlow(n + 1), 2500) : null
    try {
      return await sendOrder(o)
    } catch (e) {
      last = e
      if (!e?.network) throw e
      await new Promise(r => setTimeout(r, 800 * (n + 1)))
    } finally {
      if (slow) clearTimeout(slow)
    }
  }
  throw last
}
