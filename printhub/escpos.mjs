// ESC/POS helpers for the Print Hub.
//
//  - buildKot(job)      turns one KOT row (as returned by hub_claim_kots) into
//                       the bytes we send to an 80 mm Epson thermal printer.
//  - decodeEscPos(buf)  turns those bytes back into readable lines. Used by the
//                       fake printer (demos) and by the tests.
//  - parseStatusByte(b) reads the printer's answer to DLE EOT 4 (paper sensor).
//
// Only plain ASCII is ever sent: the printer's default code page cannot show
// Unicode, and stray control bytes inside a dish name could act as printer
// commands. sanitize() takes care of both.

export const WIDTH = 48; // characters per line, Font A on 80 mm paper
// Shown when the Print Hub starts, so anyone can see which KOT layout this copy prints
export const KOT_LAYOUT = 'Pick up, VOID, covers 1A/2A, notes in big letters on black, VIP name at the top';

// Node has Buffer; a browser (printing straight from the Control Desk, src/lib/printStation.js)
// gets the few Buffer calls used here on plain byte arrays.
const Bytes =
  typeof Buffer !== 'undefined'
    ? Buffer
    : {
        from(v) {
          if (typeof v !== 'string') return Uint8Array.from(v);
          const out = new Uint8Array(v.length);
          for (let i = 0; i < v.length; i++) out[i] = v.charCodeAt(i) & 0xff; // like Node's 'ascii' (= latin1 when encoding)
          return out;
        },
        concat(list) {
          const out = new Uint8Array(list.reduce((n, p) => n + p.length, 0));
          let at = 0;
          for (const p of list) {
            out.set(p, at);
            at += p.length;
          }
          return out;
        },
        isBuffer: (x) => x instanceof Uint8Array,
      };

const ESC = 0x1b;
const GS = 0x1d;
const DLE = 0x10;
const EOT = 0x04;
const LF = 0x0a;

/** DLE EOT 4 = "tell me the roll paper sensor status" (answered in real time). */
export const STATUS_REQUEST = Bytes.from([DLE, EOT, 4]);

// ---------------------------------------------------------------------------
// Text clean-up
// ---------------------------------------------------------------------------

const REPLACEMENTS = {
  '\u00d7': 'x', '\u2715': 'x', '\u2716': 'x', // multiplication signs
  '\u2010': '-', '\u2011': '-', '\u2012': '-', '\u2013': '-', '\u2014': '-', '\u2015': '-', '\u2212': '-',
  '\u2018': "'", '\u2019': "'", '\u201a': "'", '\u201b': "'", '\u2032': "'", '\u00b4': "'", '`': "'",
  '\u201c': '"', '\u201d': '"', '\u201e': '"', '\u201f': '"', '\u2033': '"',
  '\u2026': '...', '\u2022': '*', '\u00b7': '.',
  '\u20b9': 'Rs', '\u20ac': 'EUR', '\u00a3': 'GBP',
  '\u00bd': '1/2', '\u00bc': '1/4', '\u00be': '3/4',
  '\u00a0': ' ', '\u2002': ' ', '\u2003': ' ', '\u2009': ' ', '\u202f': ' ',
  '\u200b': '', '\u200c': '', '\u200d': '', '\ufeff': '', '\ufe0f': '',
};

/**
 * Make any text safe for the printer: printable ASCII only.
 * Known symbols are replaced (x, -, quotes), accents are dropped (e -> e),
 * anything else becomes a single '?'.
 */
export function sanitize(value) {
  const s = value == null ? '' : String(value);
  let out = '';
  let lastWasUnknown = false;
  for (const ch of s) {
    let rep;
    if (ch >= ' ' && ch <= '~' && ch !== '`') rep = ch;
    else if (ch === '\t' || ch === '\n' || ch === '\r') rep = ' ';
    else if (REPLACEMENTS[ch] !== undefined) rep = REPLACEMENTS[ch];
    else if (ch < ' ' || ch === '\x7f') rep = ''; // other control bytes: drop
    else {
      const base = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      rep = base && /^[ -~]+$/.test(base) ? base : null;
    }
    if (rep === null) {
      // unknown character (emoji, other scripts): one '?' per run, not one per char
      if (!lastWasUnknown) out += '?';
      lastWasUnknown = true;
    } else {
      out += rep;
      if (rep !== '') lastWasUnknown = false;
    }
  }
  return out;
}

/**
 * Word-wrap text to `width` columns. Continuation lines are indented by
 * `indent` spaces (so "2 x Long dish name" wraps under the dish name).
 * Words longer than a line are split.
 */
export function wrap(text, width, indent = 0) {
  if (indent >= width / 2) indent = 0;
  const pad = ' '.repeat(indent);
  const words = sanitize(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  const room = () => width - (lines.length > 0 ? indent : 0);
  const push = () => {
    lines.push((lines.length > 0 ? pad : '') + cur);
    cur = '';
  };
  for (let w of words) {
    if (cur && cur.length + 1 + w.length <= room()) {
      cur += ' ' + w;
      continue;
    }
    if (cur) push();
    while (w.length > room()) {
      cur = w.slice(0, room());
      w = w.slice(room());
      push();
    }
    cur = w;
  }
  if (cur || lines.length === 0) push();
  return lines;
}

/** "KOT IT-014 ........ 07:42 PM" on one line. */
export function leftRight(left, right, width = WIDTH) {
  left = sanitize(left);
  right = sanitize(right);
  const space = width - right.length - 1;
  if (left.length > space) left = left.slice(0, Math.max(0, space));
  return left + ' '.repeat(Math.max(1, width - left.length - right.length)) + right;
}

// ---------------------------------------------------------------------------
// Dates (always the laptop's local time)
// ---------------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n) => String(n).padStart(2, '0');

function toDate(value, fallback) {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

/** 07:42 PM */
export function formatTime(date) {
  const h = date.getHours();
  return `${two(h % 12 === 0 ? 12 : h % 12)}:${two(date.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
}

/** 13 Oct 2026, 07:42 PM */
export function formatDateTime(date) {
  return `${two(date.getDate())} ${MONTHS[date.getMonth()]} ${date.getFullYear()}, ${formatTime(date)}`;
}

// ---------------------------------------------------------------------------
// Receipt builder: a tiny wrapper that collects ESC/POS bytes
// ---------------------------------------------------------------------------

class Receipt {
  constructor() {
    this.parts = [];
  }
  raw(...bytes) {
    this.parts.push(Bytes.from(bytes));
    return this;
  }
  init() {
    return this.raw(ESC, 0x40).raw(ESC, 0x74, 0); // ESC @ reset, ESC t 0 = code page PC437
  }
  align(where) {
    return this.raw(ESC, 0x61, { left: 0, center: 1, right: 2 }[where] ?? 0); // ESC a n
  }
  bold(on) {
    return this.raw(ESC, 0x45, on ? 1 : 0); // ESC E n
  }
  /** w and h are multipliers 1..8 (GS ! n: high nibble = width, low nibble = height). */
  size(w, h = w) {
    return this.raw(GS, 0x21, ((w - 1) << 4) | (h - 1));
  }
  reverse(on) {
    return this.raw(GS, 0x42, on ? 1 : 0); // GS B n: white text on black
  }
  smallFont(on) {
    return this.raw(ESC, 0x4d, on ? 1 : 0); // ESC M n: Font B (64 columns)
  }
  text(s) {
    this.parts.push(Bytes.from(sanitize(s), 'ascii'));
    return this;
  }
  line(s = '') {
    return this.text(s).raw(LF);
  }
  dashes() {
    return this.line('-'.repeat(WIDTH));
  }
  feed(n) {
    return this.raw(ESC, 0x64, n); // ESC d n
  }
  cut() {
    return this.raw(GS, 0x56, 66, 3); // GS V 66 3: feed to the cutter, partial cut
  }
  toBuffer() {
    return Bytes.concat(this.parts);
  }
}

// ---------------------------------------------------------------------------
// KOT layouts
// ---------------------------------------------------------------------------

/** items may arrive as an array or as a JSON string; always return clean rows. */
export function parseItems(items) {
  let list = items;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch {
      list = [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list
    .filter((it) => it && typeof it === 'object')
    .map((it) => ({
      name: String(it.name ?? 'Item'),
      qty: Math.max(1, Math.round(Number(it.qty ?? it.quantity ?? 1)) || 1),
      note: it.note == null ? '' : String(it.note).trim(),
      allergy: it.allergy == null ? '' : String(it.allergy).trim(),
    }));
}

export function totalQty(items) {
  return parseItems(items).reduce((sum, it) => sum + it.qty, 0);
}

function chairsText(chairs) {
  const list = Array.isArray(chairs) ? chairs.filter((c) => c !== null && c !== '') : [];
  if (list.length === 0) return '';
  return `${list.length === 1 ? 'CHAIR' : 'CHAIRS'} ${list.join(', ')}`;
}

// Kitchen name big and centred, then optional backup warning, then a dashed line.
function kitchenHeader(r, job, backup) {
  r.init();
  r.align('center').bold(true).size(2);
  for (const l of wrap(String(job.kitchen_name || 'KITCHEN').toUpperCase(), WIDTH / 2)) r.line(l);
  r.size(1).bold(false);
  if (backup) {
    r.bold(true).reverse(true).line('PRINTED ON BACKUP PRINTER (main printer down)').reverse(false).bold(false);
  }
  r.align('left').dashes();
}

// TABLE / CHAIRS / KOT no + time / Captain, then a dashed line.
function tableBlock(r, job, when) {
  if (job.table_number != null && job.table_number !== '') {
    const t = `TABLE ${job.table_number}`;
    // as big as fits: 4x (12 columns) or 3x (16 columns), else 2x
    const mult = t.length <= WIDTH / 4 ? 4 : t.length <= WIDTH / 3 ? 3 : 2;
    r.bold(true).size(mult).line(t).size(1).bold(false);
  }
  const chairs = chairsText(job.chairs);
  if (chairs) {
    r.bold(true).size(2);
    for (const l of wrap(chairs, WIDTH / 2)) r.line(l);
    r.size(1).bold(false);
  }
  r.line(leftRight(job.kot_no ? `KOT ${job.kot_no}` : 'KOT', formatTime(when)));
  if (job.captain_name) r.line(`Captain: ${job.captain_name}`);
  r.dashes();
}

// "2 x Penne Arrabbiata" (tall, bold) and its note ">> JAIN <<" (reversed).
function itemLines(r, items, { big }) {
  for (const it of items) {
    const prefix = `${it.qty} x `;
    r.bold(true).size(1, big ? 2 : 1);
    for (const l of wrap(prefix + it.name, WIDTH, prefix.length)) r.line(l);
    if (it.note) {
      const noteLines = wrap(it.note.toUpperCase(), WIDTH - 10);
      noteLines.forEach((l, i) => {
        const text = `${i === 0 ? '>> ' : '   '}${l}${i === noteLines.length - 1 ? ' <<' : ''}`;
        r.text('   ').reverse(true).text(text).reverse(false).line();
      });
    }
    r.size(1).bold(false);
  }
}

function footer(r, job, now) {
  r.align('center').smallFont(true);
  const event = job.event_name ? sanitize(job.event_name) : "Janu's Smart Serve";
  for (const l of wrap(`${event} - printed ${formatTime(now)}`, 64)) r.line(l);
  r.smallFont(false).align('left');
  r.feed(2).cut();
}

function buildOrder(job, { backup, now }) {
  const r = new Receipt();
  const items = parseItems(job.items);
  kitchenHeader(r, job, backup);
  tableBlock(r, job, toDate(job.created_at, now));
  itemLines(r, items, { big: true });
  r.dashes();
  r.bold(true).size(1, 2).line(`Total items: ${totalQty(items)}`).size(1).bold(false);
  footer(r, job, now);
  return r.toBuffer();
}

function buildCancel(job, { backup, now }) {
  const r = new Receipt();
  const items = parseItems(job.items);
  const banner = () => r.align('center').bold(true).size(2).reverse(true).line('*** CANCELLED ***').reverse(false);
  kitchenHeader(r, job, backup);
  tableBlock(r, job, toDate(job.created_at, now));
  banner();
  r.line('DO NOT PREPARE / DELIVER').size(1).bold(false).align('left');
  r.dashes();
  itemLines(r, items, { big: false });
  r.dashes();
  r.line(`Total items: ${totalQty(items)}`);
  banner();
  r.size(1).bold(false).align('left');
  footer(r, job, now);
  return r.toBuffer();
}

function buildTest(job, { printer, now }) {
  const r = new Receipt();
  if (job.kot_no === 'IDENTIFY') {
    // "Print a slip" from the desk's printer search: which physical printer is this?
    const where = printer || job.target_ip || '-';
    r.init();
    r.align('center').bold(true).size(2).line('THIS PRINTER');
    r.size(1).line(where);
    r.bold(false).align('left').dashes();
    r.line(`Time:    ${formatDateTime(now)}`);
    r.line();
    for (const l of wrap('Found by the Print Hub. At the desk, choose it for a kitchen under Control > Kitchens & printers.', WIDTH)) r.line(l);
    r.dashes();
    footer(r, job, now);
    return r.toBuffer();
  }
  const kitchen = String(job.kitchen_name || 'this kitchen');
  r.init();
  r.align('center').bold(true).size(2).line('TEST PRINT');
  for (const l of wrap(kitchen.toUpperCase(), WIDTH / 2)) r.line(l);
  r.size(1).bold(false).align('left').dashes();
  r.line(`Printer: ${printer || job.target_ip || '-'}`);
  r.line(`Time:    ${formatDateTime(now)}`);
  r.line();
  for (const l of wrap(`If you can read this, KOTs for ${kitchen} will print here.`, WIDTH)) r.line(l);
  r.dashes();
  footer(r, job, now);
  return r.toBuffer();
}

// ---------------------------------------------------------------------------
// Smart Serve Maestro: one KOT per cover, per kitchen, per barker
// ---------------------------------------------------------------------------

const isMaestro = (job) => job && job.cover_no != null && job.cover_no !== '';

// "C3" for a standard cover, "1A" for an extra chair added during service (kept as cover 101)
const coverText = (c) => (Number(c) > 100 ? `${Number(c) - 100}A` : `C${c}`);

// White text on a black band across the slip: an instruction the kitchen cannot miss
function band(r, lines) {
  for (const l of lines) r.reverse(true).text(' ' + l.padEnd(WIDTH - 3) + ' ').reverse(false).line();
}

// A VIP guest's KOT starts with the VIP: "*** VIP ***" white on black and the guest's name, big,
// above everything else, so the kitchen sees at once whose plate it is (the printer has no star
// symbol: the star is printed as asterisks).
function vipTop(r, job) {
  const vip = String(job.vip_name || '').trim();
  if (!vip) return;
  r.align('center').bold(true).size(2).reverse(true).line(' *** VIP *** ').reverse(false);
  for (const l of wrap(vip.toUpperCase(), WIDTH / 2)) r.line(l);
  r.size(1).line('*'.repeat(WIDTH)).bold(false);
}

// *** VIP *** name (a VIP guest's KOT only), then KITCHEN / KOT No. IT-A 014 (as big as fits) /
// Barker A - Rohit, then T7 - C3 big, course, firing, then the guest's allergy and note (for
// every dish of this cover).
function maestroHead(r, job, backup, now) {
  r.init();
  vipTop(r, job);
  r.align('center').bold(true).size(2);
  const kname = String(job.kitchen_name || 'KITCHEN').toUpperCase();
  for (const l of wrap(kname, WIDTH / 2)) r.line(l);
  r.size(1).bold(false);
  if (backup) r.bold(true).reverse(true).line('PRINTED ON BACKUP PRINTER (main printer down)').reverse(false).bold(false);
  if (job.is_reprint) r.bold(true).reverse(true).line('  REPRINT - CHECK BEFORE COOKING  ').reverse(false).bold(false);
  if (job.is_remake || job.priority) r.bold(true).size(2).reverse(true).line(' REMAKE - PRIORITY ').reverse(false).size(1).bold(false);
  // The KOT serial number is what the kitchen calls out and searches for: as big as the line allows
  const serial = sanitize(job.kot_no || '');
  if (serial) {
    r.line('KOT No.');
    const mult = serial.length <= WIDTH / 4 ? 4 : serial.length <= WIDTH / 3 ? 3 : 2;
    r.bold(true).size(mult);
    for (const l of wrap(serial, Math.floor(WIDTH / mult))) r.line(l);
    r.size(1).bold(false);
  } else r.bold(true).size(2).line('KOT').size(1).bold(false);
  if (job.barker) r.line(`Barker ${String(job.barker).toUpperCase()}${job.barker_name ? ' - ' + job.barker_name : ''}`);
  r.align('left').dashes();
  const tc = `T${job.table_number ?? '?'} - ${coverText(job.cover_no)}`;
  r.align('center').bold(true).size(tc.length <= WIDTH / 4 ? 4 : 3).line(tc).size(1);
  if (job.course) r.size(2).line(`COURSE: ${String(job.course).toUpperCase()}`).size(1);
  r.bold(false).align('left');
  r.line(leftRight(`Picked up ${formatTime(toDate(job.fired_at || job.created_at, now))}`, job.firing_no ? `Pick-up #${job.firing_no}` : ''));
  if (job.captain_name) r.line(leftRight('Table captain', String(job.captain_name)));
  r.dashes();
  guestBlock(r, job);
}

// The allergy and note that hold for everything this guest orders (the VIP is at the top):
// bold and tall, white on a black band, so the kitchen sees them at once.
function guestBlock(r, job) {
  const allergy = String(job.guest_allergy || '').trim();
  const note = String(job.guest_note || '').trim();
  if (!allergy && !note) return;
  r.align('left');
  if (allergy) {
    r.bold(true).size(1, 2);
    band(r, wrap(`ALLERGY (ALL DISHES): ${allergy.toUpperCase()}`, WIDTH - 4, 2));
    r.size(1).bold(false);
  }
  if (note) {
    if (allergy) r.line();
    r.bold(true).size(1, 2);
    band(r, wrap(`GUEST NOTE: ${note.toUpperCase()}`, WIDTH - 4, 2));
    r.size(1).bold(false);
  }
  r.dashes();
}

// "1 x Funghi Tea Soup" (tall, bold), then its note and allergy in big letters (the size of
// VOID) on a solid black band as wide as the slip, so the instruction cannot be missed
function bandBig(r, lines) {
  for (const l of lines) r.reverse(true).text(' ' + l.padEnd(WIDTH / 2 - 2) + ' ').reverse(false).line();
}
function maestroItemLines(r, items) {
  for (const it of items) {
    const prefix = `${it.qty} x `;
    r.bold(true).size(1, 2);
    for (const l of wrap(prefix + it.name, WIDTH, prefix.length)) r.line(l);
    if (it.note || it.allergy) {
      r.size(2);
      if (it.note) bandBig(r, wrap(`NOTE: ${it.note.toUpperCase()}`, WIDTH / 2 - 2));
      if (it.note && it.allergy) r.size(1).line().size(2);
      if (it.allergy) bandBig(r, wrap(`ALLERGY: ${it.allergy.toUpperCase()}`, WIDTH / 2 - 2));
    }
    r.size(1).bold(false);
  }
}

function buildMaestro(job, { backup, now }) {
  const r = new Receipt();
  const items = parseItems(job.items);
  maestroHead(r, job, backup, now);
  maestroItemLines(r, items);
  r.dashes();
  r.bold(true).size(1, 2).line(leftRight(`Plates: ${totalQty(items)}`, `Cover: T${job.table_number ?? '?'}-${coverText(job.cover_no)}`)).size(1).bold(false);
  footer(r, job, now);
  return r.toBuffer();
}

// A fired dish taken back by the captain or the Control Desk: a VOID slip
function buildMaestroCancel(job, { backup, now }) {
  const r = new Receipt();
  const items = parseItems(job.items);
  const banner = () => r.align('center').bold(true).size(2).reverse(true).line('*** VOID ***').reverse(false);
  maestroHead(r, { ...job, is_remake: false, priority: false }, backup, now);
  banner();
  r.size(1, 2).line('DO NOT PREPARE / DISPATCH').size(1).bold(false).align('left');
  r.dashes();
  maestroItemLines(r, items);
  r.dashes();
  r.line(leftRight(`Plates voided: ${totalQty(items)}`, `Cover: T${job.table_number ?? '?'}-${coverText(job.cover_no)}`));
  banner();
  r.size(1).bold(false).align('left');
  footer(r, job, now);
  return r.toBuffer();
}

/**
 * Build the printer bytes for one KOT.
 * @param job      a row from hub_claim_kots (kind: order | cancel | test)
 * @param printer  "192.168.1.104:9100" - shown on test prints
 * @param backup   true when this goes to the backup printer
 */
export function buildKot(job, { printer = '', backup = false, now = new Date() } = {}) {
  const kind = job?.kind || 'order';
  if (kind === 'test') return buildTest(job, { printer, now });
  if (kind === 'cancel') return isMaestro(job) ? buildMaestroCancel(job, { backup, now }) : buildCancel(job, { backup, now });
  return isMaestro(job) ? buildMaestro(job, { backup, now }) : buildOrder(job, { backup, now });
}

// ---------------------------------------------------------------------------
// Printer status
// ---------------------------------------------------------------------------

/**
 * Read the answer to DLE EOT 4. A real status byte looks like 0xx1xx10.
 * bits 0x60 = roll paper end, bits 0x0C = roll paper near end.
 * Returns 'online' | 'paper_low' | 'paper_out', or null if it is not a status byte.
 */
export function parseStatusByte(b) {
  if (typeof b !== 'number' || (b & 0x93) !== 0x12) return null;
  if (b & 0x60) return 'paper_out';
  if (b & 0x0c) return 'paper_low';
  return 'online';
}

/** The byte a printer answers to DLE EOT 4 (used by the fake printer). */
export function statusByteFor(status) {
  if (status === 'paper_out') return 0x12 | 0x0c | 0x60;
  if (status === 'paper_low') return 0x12 | 0x0c;
  return 0x12;
}

// ---------------------------------------------------------------------------
// Decoder: bytes back to readable lines (fake printer + tests)
// ---------------------------------------------------------------------------

/**
 * Decode the ESC/POS subset we use. Returns
 *   { lines: [{ text, align, bold, w, h, reverse, small, runs }], cuts, statusRequests, unknown }
 * `bold` / `reverse` are true if any part of the line used them; w/h are the
 * largest size used on the line. `runs` splits the line into pieces of one
 * style each ({ text, bold, reverse, w, h, small }), for exact rendering
 * (Virtual Printers page).
 */
export function decodeEscPos(input) {
  const buf = Bytes.isBuffer(input) ? input : Bytes.from(input);
  const lines = [];
  const st = { align: 'left', bold: false, w: 1, h: 1, reverse: false, small: false };
  let cur = null;
  let cuts = 0;
  let statusRequests = 0;
  let unknown = 0;

  const blank = () => ({ text: '', align: 'left', bold: false, w: 1, h: 1, reverse: false, small: false, runs: [] });
  const startLine = () =>
    (cur = cur || { text: '', align: st.align, bold: false, w: 1, h: 1, reverse: false, small: st.small, runs: [] });
  const endLine = () => {
    lines.push(startLine());
    cur = null;
  };
  const resetStyle = () => Object.assign(st, { align: 'left', bold: false, w: 1, h: 1, reverse: false, small: false });

  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b === LF) {
      endLine();
    } else if (b === 0x0d) {
      // CR: ignored
    } else if (b === ESC) {
      const c = buf[++i];
      const n = buf[i + 1];
      if (c === 0x40) resetStyle(); // ESC @
      else if (c === 0x74) i++; // ESC t n (code page)
      else if (c === 0x61) { st.align = ['left', 'center', 'right'][n % 48] || 'left'; i++; } // ESC a n
      else if (c === 0x45) { st.bold = (n & 1) === 1; i++; } // ESC E n
      else if (c === 0x4d) { st.small = (n & 1) === 1; i++; } // ESC M n
      else if (c === 0x64) { // ESC d n: print and feed n lines
        if (cur) endLine();
        for (let k = 0; k < n; k++) lines.push(blank());
        i++;
      } else if (c === 0x2d || c === 0x21 || c === 0x32 || c === 0x33 || c === 0x4a) {
        if (c !== 0x32) i++; // ESC - n, ESC ! n, ESC 3 n, ESC J n take one byte; ESC 2 none
      } else unknown++;
    } else if (b === GS) {
      const c = buf[++i];
      const n = buf[i + 1];
      if (c === 0x21) { st.w = (n >> 4) + 1; st.h = (n & 0x0f) + 1; i++; } // GS ! n
      else if (c === 0x42) { st.reverse = (n & 1) === 1; i++; } // GS B n
      else if (c === 0x56) { // GS V m [n]
        if (cur) endLine();
        cuts++;
        i += n === 65 || n === 66 || n === 97 || n === 98 ? 2 : 1;
      } else unknown++;
    } else if (b === DLE) {
      if (buf[i + 1] === EOT) { statusRequests++; i += 2; } // DLE EOT n
      else unknown++;
    } else if (b >= 0x20 && b <= 0x7e) {
      const l = startLine();
      const ch = String.fromCharCode(b);
      if (l.text === '') l.align = st.align; // alignment is taken at the start of a line
      l.text += ch;
      const run = l.runs[l.runs.length - 1];
      if (run && run.bold === st.bold && run.reverse === st.reverse && run.w === st.w && run.h === st.h && run.small === st.small) {
        run.text += ch;
      } else {
        l.runs.push({ text: ch, bold: st.bold, reverse: st.reverse, w: st.w, h: st.h, small: st.small });
      }
      if (ch !== ' ') {
        l.bold = l.bold || st.bold;
        l.reverse = l.reverse || st.reverse;
        l.w = Math.max(l.w, st.w);
        l.h = Math.max(l.h, st.h);
        l.small = st.small;
      }
    } else {
      unknown++;
    }
  }
  if (cur) endLine();
  return { lines, cuts, statusRequests, unknown };
}

/** Just the text of each line, trimmed (handy in tests). */
export function textLines(buf) {
  return decodeEscPos(buf).lines.map((l) => l.text.trim());
}

/**
 * A readable picture of the receipt for a terminal. Size and style are shown
 * as tags on the right (big / tall / bold / reverse), alignment is applied.
 */
export function renderPreview(decoded, { ansi = false } = {}) {
  const inner = WIDTH;
  const out = [];
  const edge = '+' + '-'.repeat(inner + 2) + '+';
  out.push(edge);
  let blankRun = 0;
  for (const l of decoded.lines) {
    if (l.text.trim() === '') {
      if (++blankRun > 1) continue; // squeeze feeds
    } else blankRun = 0;
    const cols = l.small ? 64 : Math.floor(WIDTH / l.w);
    let t = l.text.length > cols ? l.text.slice(0, cols) : l.text;
    if (t.length > inner) t = t.slice(0, inner);
    if (l.align === 'center') t = ' '.repeat(Math.floor((inner - t.trim().length) / 2)) + t.trim();
    else if (l.align === 'right') t = t.trim().padStart(inner);
    t = t.padEnd(inner);
    if (ansi) {
      if (l.reverse) t = `\x1b[7m${t}\x1b[27m`;
      if (l.bold) t = `\x1b[1m${t}\x1b[22m`;
    }
    const tags = [];
    if (l.w >= 3 || l.h >= 3) tags.push('BIG');
    else if (l.w === 2) tags.push('2x');
    else if (l.h === 2) tags.push('tall');
    if (l.small) tags.push('small');
    if (l.reverse) tags.push('reverse');
    out.push(`| ${t} |${tags.length && l.text.trim() ? '  ' + tags.join(' ') : ''}`);
  }
  out.push(edge);
  for (let k = 0; k < decoded.cuts; k++) out.push('  - - - - - - - - - - - cut - - - - - - - - - - -');
  return out.join('\n');
}
