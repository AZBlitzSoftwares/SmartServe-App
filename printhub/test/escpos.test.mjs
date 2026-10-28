import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WIDTH,
  buildKot,
  decodeEscPos,
  textLines,
  sanitize,
  wrap,
  leftRight,
  formatTime,
  parseItems,
  totalQty,
  parseStatusByte,
  statusByteFor,
} from '../escpos.mjs';

const orderJob = {
  id: 'k1',
  kind: 'order',
  kitchen_name: 'Italian Kitchen',
  kot_no: 'IT-014',
  table_number: 8,
  chairs: [2, 3],
  captain_name: 'Rahul',
  created_at: '2026-10-13T14:12:00.000Z',
  event_name: 'Sharma Wedding',
  items: [
    { name: 'Penne Arrabbiata', qty: 2, note: 'Jain', veg: true },
    { name: 'Tiramisu', qty: 1, note: null, veg: true },
  ],
};

const find = (lines, pred) => lines.find(pred);

test('order KOT: header, table, chairs, KOT no + time, captain, items, note, total', () => {
  const buf = buildKot(orderJob, { now: new Date('2026-10-13T14:12:30Z') });
  const d = decodeEscPos(buf);
  const lines = d.lines;
  const texts = lines.map((l) => l.text.trim());

  // starts with ESC @ and ESC t 0, ends with a partial cut GS V 66 3
  assert.deepEqual([...buf.subarray(0, 5)], [0x1b, 0x40, 0x1b, 0x74, 0]);
  assert.deepEqual([...buf.subarray(-4)], [0x1d, 0x56, 66, 3]);
  assert.equal(d.cuts, 1);
  assert.equal(d.unknown, 0, 'only known commands are used');

  const kitchen = find(lines, (l) => l.text.trim() === 'ITALIAN KITCHEN');
  assert.ok(kitchen, 'kitchen name printed in capitals');
  assert.equal(kitchen.align, 'center');
  assert.equal(kitchen.bold, true);
  assert.equal(kitchen.w, 2);
  assert.equal(kitchen.h, 2);

  const table = find(lines, (l) => l.text.trim() === 'TABLE 8');
  assert.ok(table, 'table line');
  assert.ok(table.w >= 3 && table.h >= 3, 'table number is the biggest text');
  assert.equal(table.align, 'left');

  const chairs = find(lines, (l) => l.text.trim() === 'CHAIRS 2, 3');
  assert.ok(chairs);
  assert.equal(chairs.w, 2);

  const kot = find(lines, (l) => l.text.startsWith('KOT IT-014'));
  assert.ok(kot, 'KOT number line');
  assert.equal(kot.text.length, WIDTH, 'KOT no left and time right on one 48-column line');
  assert.ok(kot.text.endsWith(formatTime(new Date(orderJob.created_at))));
  assert.match(kot.text, /\d\d:\d\d [AP]M$/);

  assert.ok(texts.includes('Captain: Rahul'));
  const item = find(lines, (l) => l.text.trim() === '2 x Penne Arrabbiata');
  assert.ok(item);
  assert.equal(item.bold, true);
  assert.equal(item.h, 2, 'items are double height');
  const note = find(lines, (l) => l.text.includes('>> JAIN <<'));
  assert.ok(note, 'note on its own line');
  assert.equal(note.text, '   >> JAIN <<');
  assert.equal(note.reverse, true);
  assert.ok(texts.includes('1 x Tiramisu'));
  assert.ok(texts.includes('Total items: 3'), 'total is the sum of quantities');
  assert.ok(texts.some((t) => t.includes('Sharma Wedding')), 'event name in the footer');
  assert.ok(texts.includes('-'.repeat(WIDTH)), 'dashed separators');
  assert.ok(!texts.some((t) => t.includes('BACKUP')));
});

test('every byte of text is printable ASCII', () => {
  const job = {
    ...orderJob,
    kitchen_name: 'Café – Arabic “Grill”',
    captain_name: 'José',
    event_name: 'Eid ✨ Dinner',
    items: [{ name: 'Shish Taouk × 2 – spicy 🌶️', qty: 1, note: 'No “onion”\u0007\u001b@' }],
  };
  const buf = buildKot(job);
  const d = decodeEscPos(buf);
  for (const l of d.lines) assert.match(l.text, /^[\x20-\x7e]*$/, `line "${l.text}" is ASCII`);
  const texts = d.lines.map((l) => l.text.trim());
  assert.ok(texts.includes('CAFE - ARABIC "GRILL"'));
  assert.ok(texts.includes('Captain: Jose'));
  assert.ok(texts.includes('1 x Shish Taouk x 2 - spicy ?'));
  assert.ok(texts.some((t) => t.includes('>> NO "ONION"@ <<')), 'control bytes in a note are dropped, not sent');
  assert.equal(d.unknown, 0);
});

test('sanitize replaces known symbols, drops accents and control bytes, marks the rest', () => {
  assert.equal(sanitize('2 × Crème brûlée – “nice” ‘ok’ …'), "2 x Creme brulee - \"nice\" 'ok' ...");
  assert.equal(sanitize('a—b'), 'a-b');
  assert.equal(sanitize('Paneer 🌶🌶 Tikka'), 'Paneer ? Tikka');
  assert.equal(sanitize('मसाला dosa'), '? dosa');
  assert.equal(sanitize('tab\there\nnew'), 'tab here new');
  assert.equal(sanitize('\u001b@\u0010\u0004\u0004x'), '@x');
  assert.equal(sanitize(null), '');
  assert.equal(sanitize(12), '12');
});

test('wrap keeps words, indents continuation lines and splits very long words', () => {
  assert.deepEqual(wrap('a b c', 48), ['a b c']);
  const lines = wrap('1 x Wood-fired Margherita Pizza with extra basil and buffalo mozzarella', 24, 4);
  assert.ok(lines.length > 1);
  for (const l of lines) assert.ok(l.length <= 24, `"${l}" fits`);
  assert.ok(lines.slice(1).every((l) => l.startsWith('    ') && l[4] !== ' '), 'continuations are indented');
  assert.deepEqual(wrap('x'.repeat(30), 12), ['x'.repeat(12), 'x'.repeat(12), 'x'.repeat(6)]);
  assert.deepEqual(wrap('', 10), ['']);
});

test('long dish names wrap within 48 columns on the KOT', () => {
  const job = {
    ...orderJob,
    items: [{ name: 'Slow-cooked Lamb Ouzi with Spiced Rice, Roasted Nuts and Raisins', qty: 12 }],
  };
  const lines = decodeEscPos(buildKot(job)).lines;
  const idx = lines.findIndex((l) => l.text.startsWith('12 x Slow-cooked'));
  assert.ok(idx >= 0);
  assert.ok(lines[idx].text.length <= WIDTH);
  assert.ok(lines[idx + 1].text.startsWith('     '), 'second line indented under the dish name');
  assert.ok(lines[idx + 1].text.trim().length > 0);
  assert.ok(textLines(buildKot(job)).includes('Total items: 12'));
});

test('cancel KOT: CANCELLED banner, do-not-prepare line and the original items', () => {
  const texts = textLines(buildKot({ ...orderJob, kind: 'cancel' }));
  assert.ok(texts.includes('ITALIAN KITCHEN'));
  assert.ok(texts.includes('TABLE 8'));
  assert.ok(texts.includes('CHAIRS 2, 3'));
  assert.ok(texts.some((t) => t.startsWith('KOT IT-014')));
  assert.equal(texts.filter((t) => t === '*** CANCELLED ***').length, 2, 'banner at top and bottom');
  assert.ok(texts.includes('DO NOT PREPARE / DELIVER'));
  assert.ok(texts.includes('2 x Penne Arrabbiata'));
  assert.ok(texts.includes('1 x Tiramisu'));
  const banner = decodeEscPos(buildKot({ ...orderJob, kind: 'cancel' })).lines.find((l) => l.text.includes('CANCELLED'));
  assert.equal(banner.reverse, true);
  assert.equal(banner.w, 2);
});

test('test print: kitchen, printer address, time and the reassurance line', () => {
  const job = { id: 't1', kind: 'test', kitchen_name: 'Arabic', items: [], event_name: 'Demo' };
  const texts = textLines(buildKot(job, { printer: '192.168.1.102:9100', now: new Date(2026, 9, 13, 19, 42) }));
  assert.ok(texts.includes('TEST PRINT'));
  assert.ok(texts.includes('ARABIC'));
  assert.ok(texts.includes('Printer: 192.168.1.102:9100'));
  assert.ok(texts.includes('Time:    13 Oct 2026, 07:42 PM'));
  assert.ok(texts.join(' ').includes('If you can read this, KOTs for Arabic will print here.'));
});

test('backup printer line', () => {
  const texts = textLines(buildKot(orderJob, { backup: true }));
  assert.ok(texts.includes('PRINTED ON BACKUP PRINTER (main printer down)'));
});

test('missing pieces do not break a KOT', () => {
  const texts = textLines(buildKot({ kind: 'order', items: '[{"name":"Hummus","qty":"3"}]', chairs: [5] }));
  assert.ok(texts.includes('KITCHEN'));
  assert.ok(texts.includes('CHAIR 5'));
  assert.ok(texts.includes('3 x Hummus'));
  assert.ok(texts.includes('Total items: 3'));
  assert.ok(!texts.some((t) => t.startsWith('TABLE')));
  assert.ok(!texts.some((t) => t.startsWith('Captain')));
  assert.deepEqual(parseItems('not json'), []);
  assert.equal(totalQty([{ name: 'a', qty: 2 }, { name: 'b' }, { name: 'c', qty: 0 }]), 4);
});

test('leftRight and formatTime', () => {
  assert.equal(leftRight('KOT IT-014', '07:42 PM').length, WIDTH);
  assert.equal(formatTime(new Date(2026, 9, 13, 0, 5)), '12:05 AM');
  assert.equal(formatTime(new Date(2026, 9, 13, 12, 0)), '12:00 PM');
  assert.equal(formatTime(new Date(2026, 9, 13, 19, 42)), '07:42 PM');
});

test('printer status byte (DLE EOT 4)', () => {
  assert.equal(parseStatusByte(0x12), 'online');
  assert.equal(parseStatusByte(0x12 | 0x0c), 'paper_low');
  assert.equal(parseStatusByte(0x12 | 0x60), 'paper_out');
  assert.equal(parseStatusByte(0x12 | 0x60 | 0x0c), 'paper_out');
  assert.equal(parseStatusByte(0x41), null, 'not a status byte');
  assert.equal(parseStatusByte(undefined), null);
  for (const s of ['online', 'paper_low', 'paper_out']) assert.equal(parseStatusByte(statusByteFor(s)), s);
});

// ---------------------------------------------------------------------------
// Smart Serve Maestro: cover-wise KOT
// ---------------------------------------------------------------------------

const maestroJob = {
  id: 'm1',
  kind: 'order',
  kitchen_name: 'Asian',
  kot_no: 'AS-A 014',
  table_number: 7,
  chairs: [3],
  cover_no: 3,
  barker: 'A',
  barker_name: 'Rohit',
  course: 'Starters',
  firing_no: 2,
  fired_at: '2026-10-13T15:13:00.000Z',
  captain_name: 'Neha',
  event_name: 'Demo',
  items: [
    { name: 'Crystal Veg Dim Sum', qty: 1, note: '' },
    { name: 'Szechuan Eggplant', qty: 1, note: 'Jain' },
  ],
};

test('maestro KOT: kitchen, KOT number, barker, cover, course, firing, plates', () => {
  const lines = textLines(buildKot(maestroJob)).map((l) => l.trim());
  const all = lines.join('\n');
  assert.ok(lines.includes('ASIAN'));
  assert.ok(lines.includes('KOT No.') && lines[lines.indexOf('KOT No.') + 1] === 'AS-A 014', 'serial number on its own line under KOT No.');
  assert.ok(lines.includes('Barker A - Rohit'));
  assert.ok(lines.includes('T7 - C3'));
  assert.ok(lines.includes('COURSE: STARTERS'));
  assert.match(all, /Picked up .*Pick-up #2/);
  assert.match(all, /Table captain\s+Neha/);
  assert.match(all, /1 x Crystal Veg Dim Sum/);
  assert.match(all, /NOTE: JAIN/);
  assert.match(all, /Plates: 2\s+Cover: T7-C3/);
  assert.doesNotMatch(all, /REMAKE|REPRINT|CHAIR/);
});

test('maestro KOT: serial number printed as big as fits', () => {
  const d = decodeEscPos(buildKot(maestroJob));
  const serial = d.lines.find((l) => l.text.trim() === 'AS-A 014');
  assert.ok(serial && serial.w === 4 && serial.h === 4 && serial.bold, 'AS-A 014 at 4x, bold');
  const long = decodeEscPos(buildKot({ ...maestroJob, kot_no: 'DESSERT-B 1014' })).lines.find((l) => l.text.trim() === 'DESSERT-B 1014');
  assert.ok(long && long.w === 3, 'a longer number at 3x');
});

test('maestro KOT: dish note and allergy big, bold and white on black', () => {
  const d = decodeEscPos(buildKot({ ...maestroJob, items: [{ name: 'Funghi Tea Soup', qty: 1, note: 'Less spicy, sauce on side', allergy: 'Peanuts' }] }));
  const note = d.lines.find((l) => l.text.includes('NOTE: LESS SPICY,'));
  const alg = d.lines.find((l) => l.text.includes('ALLERGY: PEANUTS'));
  assert.ok(note && note.bold && note.w === 2 && note.h === 2 && note.reverse, 'note line at double size');
  assert.ok(alg && alg.bold && alg.w === 2 && alg.h === 2 && alg.reverse, 'allergy line at double size');
  assert.ok(note.text.length === 24 && alg.text.length === 24, 'the black band runs the full width of the slip');
  const dish = d.lines.find((l) => l.text.includes('1 x Funghi Tea Soup'));
  assert.ok(dish && !dish.reverse, 'the dish itself is not reversed');
  // a long note wraps and every line stays inside the slip, still on black
  const long = decodeEscPos(buildKot({ ...maestroJob, items: [{ name: 'Soup', qty: 1, note: 'No onion no garlic less oil less salt sauce on the side extra hot please' }] }));
  const nl = long.lines.filter((l) => l.reverse && !/KOT|VIP/.test(l.text));
  assert.ok(nl.length >= 3 && nl.every((l) => l.text.length <= 24 && l.w === 2), 'note wraps within 24 double-width columns');
});

test('maestro KOT: VIP guest, whole-order allergy and guest note', () => {
  const plain = textLines(buildKot(maestroJob)).join('\n');
  assert.doesNotMatch(plain, /VIP|ALLERGY|GUEST NOTE/);
  const d = decodeEscPos(buildKot({ ...maestroJob, vip_name: 'VVIP - Mr. Vikram Sethi', guest_allergy: 'Shellfish', guest_note: 'Less spicy | Dislikes: Mushroom' }));
  const all = d.lines.map((l) => l.text.trim()).join('\n');
  // the VIP first of all, above the kitchen and the KOT number, with the star (asterisks)
  assert.match(all, /^\*\*\* VIP \*\*\*\nVVIP - MR\. VIKRAM SETHI\n\*{48}\n/);
  assert.ok(all.indexOf('VIP') < all.indexOf('KOT No.'), 'VIP above the KOT number');
  const top = d.lines.find((l) => l.text.trim() === '*** VIP ***');
  assert.ok(top && top.reverse && top.w === 2 && top.bold, 'VIP band white on black, double size');
  const nm = d.lines.find((l) => l.text.includes('VVIP - MR. VIKRAM SETHI'));
  assert.ok(nm && nm.w === 2 && nm.bold && !nm.reverse, 'the name big and bold');
  assert.match(all, /ALLERGY \(ALL DISHES\): SHELLFISH/);
  assert.match(all, /GUEST NOTE: LESS SPICY \| DISLIKES: MUSHROOM/);
  for (const t of ['ALLERGY (ALL DISHES): SHELLFISH', 'GUEST NOTE: LESS SPICY']) {
    const l = d.lines.find((x) => x.text.includes(t));
    assert.ok(l && l.reverse && l.bold && l.h === 2 && l.text.length <= 48, `${t} on a black band`);
  }
  assert.ok(all.indexOf('ALLERGY (ALL DISHES)') < all.indexOf('1 x Crystal Veg Dim Sum'), 'guest details before the dishes');
  assert.equal((all.match(/VIKRAM/g) || []).length, 1, 'the VIP printed once, at the top');
  // a VOID slip of a VIP's dish says whose it is too
  const v = textLines(buildKot({ ...maestroJob, kind: 'cancel', vip_name: 'NMA - Mrs Nita Ambani' })).join('\n');
  assert.match(v, /^\s*\*\*\* VIP \*\*\*/);
  assert.match(v, /NMA - MRS NITA AMBANI/);
});

test('maestro KOT: remake and reprint banners', () => {
  const all = textLines(buildKot({ ...maestroJob, is_remake: true, priority: true, is_reprint: true })).join('\n');
  assert.match(all, /REMAKE - PRIORITY/);
  assert.match(all, /REPRINT/);
});

test('maestro void slip keeps the cover and says do not dispatch', () => {
  const all = textLines(buildKot({ ...maestroJob, kind: 'cancel', items: [{ name: 'Szechuan Eggplant', qty: 1 }] })).join('\n');
  assert.match(all, /\*\*\* VOID \*\*\*/);
  assert.doesNotMatch(all, /CANCELLED/);
  assert.match(all, /DO NOT PREPARE \/ DISPATCH/);
  assert.match(all, /T7 - C3/);
  assert.match(all, /Plates voided: 1/);
});

test('maestro KOT for an extra chair prints 1A, not C101', () => {
  const all = textLines(buildKot({ ...maestroJob, cover_no: 101 })).map((l) => l.trim()).join('\n');
  assert.match(all, /^T7 - 1A$/m);
  assert.match(all, /Cover: T7-1A/);
  assert.doesNotMatch(all, /C101|101/);
  const second = textLines(buildKot({ ...maestroJob, kind: 'cancel', cover_no: 102 })).join('\n');
  assert.match(second, /T7 - 2A/);
});

test('a KOT without a cover still prints the multi-kitchen layout', () => {
  const all = textLines(buildKot(orderJob)).join('\n');
  assert.match(all, /CHAIRS 2, 3/);
  assert.doesNotMatch(all, /Barker/);
});

test('order and cancel KOTs start with the KOT number, big, white on black (same as the desk slip)', () => {
  for (const kind of ['order', 'cancel']) {
    const lines = decodeEscPos(buildKot({ ...orderJob, kind, kot_no: 'K-022' })).lines.filter((l) => l.text.trim());
    assert.equal(lines[0].text.trim(), 'KOT NO.', kind + ': label first');
    assert.equal(lines[0].reverse, true);
    assert.equal(lines[0].text.length, WIDTH, kind + ': black bar across the paper');
    assert.equal(lines[1].text.trim(), 'K-022');
    assert.equal(lines[1].reverse, true);
    assert.equal(lines[1].w, 4, kind + ': the biggest text on the slip');
    assert.equal(lines[1].text.length * 4, WIDTH);
    assert.equal(lines[2].text.trim(), 'ITALIAN KITCHEN', kind + ': then the counter name');
  }
  // no KOT number: no box
  const plain = decodeEscPos(buildKot({ ...orderJob, kot_no: null })).lines.filter((l) => l.text.trim());
  assert.equal(plain[0].text.trim(), 'ITALIAN KITCHEN');
  // a long number still fits
  const long = decodeEscPos(buildKot({ ...orderJob, kot_no: 'COUNTER1-0123' })).lines;
  for (const l of long) assert.ok(l.text.length * l.w <= WIDTH, 'fits the paper: ' + l.text);
});
