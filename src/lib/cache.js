// ss-menu-cache. The last menu this device saw for an event, so a captain
// opening a table (or a guest opening the menu) sees the dishes at once
// instead of waiting on the network. The screen always fetches the current
// menu straight after, and that answer replaces this one - this only decides
// what is shown during the wait.
//
// Kept in memory (instant while the app stays open) and in localStorage
// (survives a reload). Only one event is kept, and a menu too large for the
// size cap stays in memory only, so this can never crowd out the offline
// order queue, which uses the same storage.
//
// Rows are stored exactly as the database returned them: they go into the
// cart as they are, and multi-kitchen routing reads kitchen_id and
// category_id from them, so a trimmed copy could behave differently.

const PREFIX = 'ss_menu_v1:'
const MAX_CHARS = 250000                  // about 250 KB of text
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000

const memory = new Map()                  // eventId -> { categories, items, json }

function storage() {
  try { return window.localStorage } catch { return null }
}

export function readMenu(eventId) {
  if (!eventId) return null
  const hit = memory.get(eventId)
  if (hit) return hit
  const ls = storage()
  if (!ls) return null
  try {
    const raw = ls.getItem(PREFIX + eventId)
    if (!raw) return null
    const saved = JSON.parse(raw)
    if (!saved || !Array.isArray(saved.categories) || !Array.isArray(saved.items)) return null
    if (!(Date.now() - (saved.t || 0) < MAX_AGE_MS)) { ls.removeItem(PREFIX + eventId); return null }
    const entry = { categories: saved.categories, items: saved.items,
      json: JSON.stringify([saved.categories, saved.items]) }
    memory.set(eventId, entry)
    return entry
  } catch {
    return null
  }
}

// Returns the menu's fingerprint (its JSON), so the screen can skip
// re-rendering when nothing changed. Never throws.
export function saveMenu(eventId, categories, items) {
  const json = JSON.stringify([categories, items])
  if (!eventId) return json
  const prev = memory.get(eventId)
  memory.set(eventId, { categories, items, json })
  if (prev && prev.json === json) return json      // unchanged: no storage write

  const ls = storage()
  if (!ls) return json
  try {
    // One event at a time: drop menus of other events.
    for (let i = ls.length - 1; i >= 0; i--) {
      const k = ls.key(i)
      if (k && k.startsWith(PREFIX) && k !== PREFIX + eventId) ls.removeItem(k)
    }
    const value = JSON.stringify({ t: Date.now(), categories, items })
    if (value.length > MAX_CHARS) { ls.removeItem(PREFIX + eventId); return json }
    ls.setItem(PREFIX + eventId, value)
  } catch {
    // Storage full or blocked: memory still has it. Do not leave an old copy.
    try { ls.removeItem(PREFIX + eventId) } catch { /* ignore */ }
  }
  return json
}
