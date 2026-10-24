/* The KOT slip (80 mm paper, Epson TM-m30III), printed through a small window that
   the browser prints straight away (the desk's Chrome runs with --kiosk-printing, so
   no print dialog). Moved out of KOTDashboard so that the automatic waiter
   assignment prints the very same slip as a person assigning by hand.

   isHelp only swaps the "Order:" label for "Help:". The slip layout, width and
   margins are deliberately identical so the printer setup and the waiters' habits
   stay unchanged.

   opts.quiet: no alert when the browser blocks the print window (the automatic
   assignment runs without anyone at the screen; it shows the problem itself).
   Returns false when the window was blocked, true otherwise. */
export function printKotWindow(order, isHelp, eventName, opts = {}) {
  eventName = eventName || 'Event'
  const tableNum = order.tables?.table_number || '?'
  const waiterName = order.waiters?.name || (order.waiter_id ? 'Assigned' : 'Unassigned')
  // Empty on a self-service event, which is what keeps the slip layout
  // identical to the one the waiters already know.
  const captainName = order.captains?.name || ''
  // The slip shows the NUMBER, because that is what gets called across a
  // hall and what the supervisor matches against the waiter strip.
  // Names are stored as "Raju (07)" or bare "07"; take the bracketed part
  // when there is one, otherwise print whatever is there.
  const wRaw = order.waiters?.name || ''
  const wNum = wRaw.match(/\(([^)]+)\)\s*$/)
  const waiterLabel = wRaw ? (wNum ? wNum[1] : wRaw) : '--'
  const orderId = '#' + order.id.slice(-6).toUpperCase()
  const d = new Date(order.created_at)
  const dateStr = d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})
  const timeStr = d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true})

  // Epson TM-m30III — 58mm printable area, 4mm margins each side
  const w = window.open('','_blank','width=400,height=600')
  // A blocked popup returns null, and the next line would throw with no
  // sign to the supervisor - the waiter gets assigned and nothing prints.
  if (!w) {
    if (!opts.quiet) alert('The print window was blocked by the browser.\n\n' +
      'Allow pop-ups for this site, then use Print KOT on the order card.\n\n' +
      'Look for the blocked pop-up icon at the right of the address bar.')
    return false
  }
  w.document.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>KOT ${orderId}</title>
<style>
@page {
  size: 80mm auto;
  margin: 3mm 4mm;
}
* {
  box-sizing: border-box;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
body {
  font-family: 'Courier New', Courier, monospace;
  font-size: 11.5pt;
  font-weight: 900;
  width: 100%;
  margin: 0;
  padding: 0;
  color: #000000;
  background: #ffffff;
}
.app-name {
  font-size: 11pt;
  font-weight: 900;
  text-align: center;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 1mm;
  color: #000000;
}
.event-name {
  font-size: 10pt;
  font-weight: 900;
  text-align: center;
  margin-bottom: 2mm;
  color: #000000;
  word-break: break-word;
}
.divider {
  border: none;
  border-top: 1.5px solid #000000;
  margin: 1.5mm 0;
}
.divider-dash {
  border: none;
  border-top: 1px dashed #000000;
  margin: 1.5mm 0;
}
.row {
  display: flex;
  justify-content: space-between;
  font-size: 9.5pt;
  font-weight: bold;
  margin: 0.8mm 0;
  color: #000000;
}
.row span:first-child {
  min-width: 14mm;
}
/* One box shape for all three - table at the top, captain under it,
   waiter at the very bottom. The supervisor is handed a slip by a waiter
   and has to find two numbers on it fast, under hall lighting, on thermal
   paper. Same shape in the same place every time beats three different
   treatments, and everything is a size up from before because they were
   genuinely struggling to read it. */
.big-box {
  border: 3px solid #000000;
  text-align: center;
  padding: 2mm 1mm;
  margin: 2.5mm 0;
}
.big-label {
  font-size: 11pt;
  font-weight: 900;
  letter-spacing: 3px;
  color: #000000;
}
.big-num {
  font-size: 34pt;
  font-weight: 900;
  line-height: 1.05;
  color: #000000;
}
/* A name rather than a number, so it has to survive being long */
.big-text {
  font-size: 21pt;
  font-weight: 900;
  line-height: 1.15;
  color: #000000;
  word-break: break-word;
}
.who-row {
  display: flex;
  gap: 1.5mm;
  margin: 1.5mm 0;
}
.who-box {
  flex: 1;
  border: 1.5px solid #000000;
  text-align: center;
  padding: 1.5mm 0.5mm;
  font-size: 9pt;
  font-weight: 900;
  color: #000000;
  word-break: break-word;
}
.who-label {
  font-size: 7.5pt;
  font-weight: bold;
  letter-spacing: 1px;
}
.waiter-box {
  border: 1.5px solid #000000;
  text-align: center;
  padding: 1.5mm;
  margin: 1.5mm 0;
  font-size: 10pt;
  font-weight: 900;
  color: #000000;
}
.item-row {
  font-size: 13pt;
  font-weight: 900;
  padding: 1.4mm 0;
  display: flex;
  justify-content: space-between;
  border-bottom: 1.2px dashed #000000;
  color: #000000;
  word-break: break-word;
}
.item-name {
  flex: 1;
  padding-right: 2mm;
}
.item-qty {
  font-weight: 900;
  white-space: nowrap;
  color: #000000;
}
.item-tag {
  font-size: 8pt;
  font-weight: 900;
  background: #000000;
  color: #ffffff;
  padding: 0 1.5mm;
  margin-left: 1mm;
}
/* ss-total-59 */
.total-row {
  display: flex;
  justify-content: space-between;
  font-weight: 900;
  font-size: 13pt;
  margin-top: 1.5mm;
  padding-top: 1mm;
  border-top: 1.5px solid #000000;
  color: #000000;
}
/* The KOT number: runners and counters work by it, so it is the biggest thing on
   the slip, white on black at the top */
.kot-no-box {
  background: #000000;
  color: #ffffff;
  text-align: center;
  padding: 1.5mm 1mm 2mm;
  margin: 1mm 0 2mm;
}
.kot-no-label {
  font-size: 10pt;
  font-weight: 900;
  letter-spacing: 3px;
  color: #ffffff;
}
.kot-no-num {
  font-size: 40pt;
  font-weight: 900;
  line-height: 1.05;
  letter-spacing: 1px;
  color: #ffffff;
}
.kot-cat {
  font-size: 17pt;
  font-weight: 900;
  text-align: center;
  text-transform: uppercase;
  border: 2px solid #000000;
  padding: 1mm;
  margin: 1mm 0 2mm;
  word-break: break-word;
}
.footer {
  text-align: center;
  font-size: 9pt;
  font-weight: bold;
  color: #000000;
  margin-top: 2mm;
}
</style>
</head>
<body>
<div class="app-name">Janu's Smart Serve</div>
<div class="event-name">${eventName}</div>
${order.kotNo ? `<div class="kot-no-box"><div class="kot-no-label">KOT NO.</div><div class="kot-no-num">${order.kotNo}</div></div>` : ''}
${order.kotTitle ? `<div class="kot-cat">${order.kotTitle}</div>` : ''}
<hr class="divider"/>
<div class="row"><span>Date:</span><span>${dateStr}</span></div>
<div class="row"><span>Time:</span><span>${timeStr}</span></div>
${order.kotNo ? '' : `<div class="row"><span>${isHelp ? 'Help' : 'Order'}:</span><span>${orderId}</span></div>`}
<hr class="divider-dash"/>
<div class="big-box">
<div class="big-label">TABLE</div>
<div class="big-num">${tableNum}</div>
</div>
${captainName ? `<div class="big-box">
<div class="big-label">CAPTAIN</div>
<div class="big-text">${captainName}</div>
</div>` : ''}
<hr class="divider"/>
${(order.order_items||[]).map(i => `
<div class="item-row">
<span class="item-name">${i.menu_items?.name||'Item'}${i.menu_items?.is_live_counter ? '<span class=\"item-tag\">LIVE</span>' : ''}${i.note ? '<span class="item-tag">' + i.note + '</span>' : ''}</span>
<span class="item-qty">x${i.quantity}</span>
</div>`).join('')}
<hr class="divider"/>
<div class="total-row">
<span>Total Items</span>
<span>${(order.order_items||[]).reduce((s,i)=>s+i.quantity,0)}</span>
</div>
<div class="big-box">
<div class="big-label">WAITER</div>
<div class="big-num">${waiterLabel}</div>
</div>
<div class="footer">-- Janu's Smart Serve --</div>
</body>
</html>`)
  w.document.close()
  w.focus()
  setTimeout(() => { w.print(); w.close() }, 500)
  return true
}

/* A category KOT row (kots table) reshaped into what printKotWindow reads. */
export function kotAsOrder(k, label) {
  return {
    id: k.id, created_at: k.created_at, kotTitle: k.category_name || 'KOT', kotNo: k.kot_no,
    tables: { table_number: k.table_number }, captains: { name: k.captain_name || '' },
    waiters: { name: label || k.waiter_label || '' }, waiter_id: k.waiter_id,
    order_items: (Array.isArray(k.items) ? k.items : []).map(i => ({ quantity: i.qty || i.quantity || 1, note: i.note || '', menu_items: { name: i.name } })),
  }
}

/* A help request reshaped the same way, so both slips come off one code path
   and cannot drift apart. */
export function helpAsOrder(sos) {
  const lines = (sos.sos_request_items || []).length
    ? sos.sos_request_items
    : [{ item_name:'Help Request', quantity:1 }]
  return {
    id: sos.id,
    created_at: sos.created_at,
    tables: sos.tables,
    waiters: sos.waiters,
    captains: sos.captains,
    order_items: lines.map(li => ({
      quantity: li.quantity,
      menu_items: { name: li.item_name }
    }))
  }
}
