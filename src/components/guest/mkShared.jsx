/* Captain + Multi-Kitchen service: small pieces shared by the chair picker,
   the cart, the Genie confirmation and Track.

   Everything in here is used ONLY when eventData.multi_kitchen is true.
   Guest tablets and ordinary captain events never reach this file. */

// Quick notes a captain can attach to a dish. One tap each, no keyboard -
// a captain at a table with a guest talking does not type.
export const NOTE_CHIPS = ['Jain', 'No onion-garlic', 'Less spicy', 'Allergy']

function noteParts(note) {
  return String(note || '').split(',').map(s => s.trim()).filter(Boolean)
}

// Toggles one chip in a note, keeping the chips in a fixed order so the
// kitchen always reads them the same way round.
export function toggleNote(note, chip) {
  const set = new Set(noteParts(note))
  if (set.has(chip)) set.delete(chip); else set.add(chip)
  const known = NOTE_CHIPS.filter(c => set.has(c))
  const other = [...set].filter(c => !NOTE_CHIPS.includes(c))
  return [...known, ...other].join(', ')
}

export function NoteChips({ note, onChange, disabled }) {
  const on = new Set(noteParts(note))
  return (
    <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
      {NOTE_CHIPS.map(chip => {
        const active = on.has(chip)
        return (
          <button key={chip} type="button" disabled={disabled}
            onClick={e => { e.stopPropagation(); onChange(toggleNote(note, chip)) }}
            style={{ minHeight:34, padding:'5px 12px', borderRadius:999, fontSize:12.5,
              fontWeight:800, fontFamily:'Manrope', cursor: disabled ? 'default' : 'pointer',
              border:'1.5px solid ' + (active ? '#F5B640' : '#E5E7EB'),
              background: active ? '#FEF3C7' : '#fff',
              color: active ? '#92400E' : '#6B7280',
              whiteSpace:'nowrap' }}>
            {active ? '✓ ' : ''}{chip}
          </button>
        )
      })}
    </div>
  )
}

export function NoteBadge({ note }) {
  if (!note) return null
  return (
    <span style={{ fontSize:11, color:'#92400E', fontWeight:800, background:'#FEF3C7',
      border:'1px solid #FCD34D', padding:'2px 8px', borderRadius:999,
      whiteSpace:'nowrap', maxWidth:220, overflow:'hidden', textOverflow:'ellipsis' }}>
      {note}
    </span>
  )
}

// "Chair 2", "Chairs 2, 3", or "All chairs" when every chair at the table
// is on the order.
export function chairsLabel(chairs, total) {
  const list = [...new Set((chairs || []).map(Number))].filter(n => n > 0).sort((a, b) => a - b)
  if (!list.length) return ''
  if (total && list.length === total && list[0] === 1 && list[list.length - 1] === total && total > 1) {
    return 'All chairs'
  }
  return (list.length === 1 ? 'Chair ' : 'Chairs ') + list.join(', ')
}

/* Which kitchen a cart line goes to. Mirrors mk_place_order exactly:
   the dish's own kitchen, else its category's, else the default kitchen
   (is_default first, then sort_order). Inactive kitchens are skipped,
   the same as the database does. */
export function kitchenResolver(kitchens, categories) {
  const active = (kitchens || []).filter(k => k.is_active !== false)
  const byId = new Map(active.map(k => [k.id, k]))
  const catKitchen = new Map((categories || []).map(c => [c.id, c.kitchen_id]))
  const def = [...active].sort((a, b) =>
    (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0) ||
    (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
    String(a.created_at || '').localeCompare(String(b.created_at || '')))[0] || null
  return item => byId.get(item?.kitchen_id) || byId.get(catKitchen.get(item?.category_id)) || def
}

// One KOT's state as the captain should read it. Delivery wins over
// printing: once the food is at the table, how the slip printed is history.
export function kotState(k) {
  if (k?.status === 'cancelled') return { key:'cancelled', label:'Cancelled', short:'Cancelled', fg:'#6B7280', bg:'#F3F4F6' }
  if (k?.status === 'delivered') return { key:'delivered', label:'Delivered ✓', short:'Delivered', fg:'#fff', bg:'#16A34A' }
  if (k?.print_status === 'printed') return { key:'printed', label:'Printed ✓', short:'Printed', fg:'#15803D', bg:'#DCFCE7' }
  if (k?.print_status === 'failed') return { key:'failed', label:'Failed — operator alerted', short:'Failed', fg:'#B91C1C', bg:'#FEE2E2' }
  return { key:'printing', label:'Printing…', short:'Printing…', fg:'#B45309', bg:'#FEF3C7' }
}

/* mk_place_order raises errors whose message starts with a code. The
   captain gets plain words instead, and is always told the cart is safe
   because it is - nothing is cleared until the order has really gone. */
export function friendlySendError(err) {
  const m = String(err?.message || err || '')
  if (/NO_CHAIRS/.test(m)) return 'Pick at least one chair, then send.'
  if (/EMPTY_ORDER/.test(m)) return 'The cart is empty. Add a dish first.'
  if (/NO_KITCHENS/.test(m)) return 'No kitchens are set up for this event yet. Ask the operator. Your cart is safe.'
  if (/PGRST202|could not find the function|mk_place_order/i.test(m)) {
    return 'Kitchen ordering is not switched on at the server yet. Tell the operator. Your cart is safe.'
  }
  if (/fetch|network|timeout|load failed/i.test(m)) {
    return 'Connection problem. Open Track to check whether this order went before sending again. Your cart is safe.'
  }
  return 'Could not send the order. Your cart is safe - please try again.'
}

/* The 2-minute cancel window is measured against the database clock, not
   the tablet's. A tablet whose clock runs three minutes fast would
   otherwise never show Cancel at all. The offset is learned for free when
   the Genie screen reads back the KOTs of an order this tablet just sent. */
const SKEW_KEY = 'ss_mk_clock_skew'
let skewMs = (() => {
  try { const v = Number(localStorage.getItem(SKEW_KEY)); return Number.isFinite(v) ? v : 0 } catch (e) { return 0 }
})()

export function learnServerTime(localMs, serverIso) {
  const s = Date.parse(serverIso || '')
  if (!localMs || !Number.isFinite(s)) return
  const d = localMs - s
  // Ignore nonsense (a day out is a bad row, not a bad clock)
  if (Math.abs(d) > 24 * 3600 * 1000) return
  skewMs = Math.abs(d) < 3000 ? 0 : d
  try { localStorage.setItem(SKEW_KEY, String(skewMs)) } catch (e) {}
}

export function serverNow() { return Date.now() - skewMs }

export const CANCEL_WINDOW_MS = 2 * 60 * 1000
