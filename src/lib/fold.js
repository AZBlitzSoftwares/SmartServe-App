/* Collapsible set-up sections (Control › Event set-up).

   Which sections are collapsed is remembered on this device (localStorage); a section is
   opened or closed from anywhere with setFold(id, open), and setFold('*', open) does them all.
   jumpTo(id) opens a section and scrolls to it, for the jump bar at the top of the page. */
const KEY = 'ss_fold_v1'

export function readFolds() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {} } catch { return {} }
}

export function writeFold(id, closed) {
  try {
    const m = readFolds()
    if (closed) m[id] = 1; else delete m[id]
    localStorage.setItem(KEY, JSON.stringify(m))
  } catch { /* private mode: the page still works, it just does not remember */ }
}

export function setFold(id, open) {
  window.dispatchEvent(new CustomEvent('ss-fold', { detail: { id, open } }))
}

export function jumpTo(id) {
  setFold(id, true)
  // the section is shown on the next render; scroll once it is there
  setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
}

// Styles for the section arrow and the collapsed bar (put in the page once)
export const FOLD_CSS = `
  .ssfold { position:relative; }
  .ssfold-btn { position:absolute; top:10px; right:10px; z-index:3; width:30px; height:30px; padding:0;
    border-radius:50%; border:1.5px solid var(--line); background:#fff; color:var(--ink); cursor:pointer;
    display:flex; align-items:center; justify-content:center; box-shadow:0 1px 3px rgba(0,0,0,.06); }
  .ssfold-btn:hover { border-color:var(--ink2); }
  .ssfold-btn svg { transition:transform .15s ease; }
  .ssfold.shut .ssfold-btn { top:9px; }
  .ssfold.shut .ssfold-btn svg { transform:rotate(-90deg); }
  .ssfold-bar { background:#fff; border-radius:12px; box-shadow:var(--shadow); margin-bottom:12px;
    padding:12px 52px 12px 16px; display:flex; align-items:center; gap:9px; cursor:pointer; min-height:48px; box-sizing:border-box; }
  .ssfold-bar i { width:24px; height:24px; border-radius:50%; background:var(--ink); color:#fff; font-style:normal;
    font-size:12px; font-weight:900; display:inline-flex; align-items:center; justify-content:center; flex-shrink:0; }
  .ssfold-bar b { font-size:15px; font-weight:800; color:var(--ink); }
  .ssfold-bar span { font-size:12px; font-weight:600; color:var(--ink2); margin-left:auto; }
  .ssfold-body > [id], .ssfold-body > .ms > .card { padding-right:52px !important; }
`
