// Virtual Printers: the web page, its controls, and what the Print Hub sees.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { startHub, localDate, sendToPrinter, parseEndpoint } from '../printhub.mjs';
import { buildKot, decodeEscPos, STATUS_REQUEST } from '../escpos.mjs';
import { startVirtualPrinters, describeSlip, slipLine, parseArgs, PAGE_FILE } from '../fake-printer.mjs';
import { startMockPostgrest } from './mock-postgrest.mjs';

const FAST = {
  pollMs: 100,
  probeMs: 300,
  heartbeatMs: 5000,
  kitchensRefreshMs: 300,
  eventsRefreshMs: 1000,
  connectTimeoutMs: 1000,
  jobTimeoutMs: 3000,
  preCheckMs: 300,
  statusReplyMs: 300,
  retryDelaysMs: [50, 100],
  downRetryMs: 500,
  backoffMs: [100, 200, 300],
  requestTimeoutMs: 2000,
  stopWaitMs: 3000,
  display: 'none',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(check, what, timeoutMs = 8000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) return;
    await sleep(25);
  }
  assert.fail(`timed out waiting for: ${what}`);
}

const order = (kitchen, extra = {}) => ({
  kind: 'order',
  kitchen_name: kitchen,
  kot_no: 'IT-014',
  table_number: 8,
  chairs: [2, 3],
  captain_name: 'Rahul',
  event_name: 'Sharma Wedding',
  created_at: '2026-10-13T14:12:00Z',
  items: [{ name: 'Penne Arrabbiata', qty: 2, note: 'Jain' }],
  ...extra,
});

async function startVp(t, ports = [0, 0, 0]) {
  const vp = await startVirtualPrinters({ ports, host: '127.0.0.1', webPort: 0, webHost: '127.0.0.1' });
  t.after(() => vp.close());
  const base = `http://127.0.0.1:${vp.webPort}`;
  const api = async (method, p, body) => {
    const r = await fetch(base + p, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const type = r.headers.get('content-type') || '';
    return { status: r.status, type, body: type.includes('json') ? await r.json() : await r.text() };
  };
  return { vp, base, api, print: (i, job, o) => sendToPrinter(parseEndpoint(`127.0.0.1:${vp.printers[i].port}`), buildKot(job, o)) };
}

test('the Virtual Printers page is served and the state lists every slip, newest first', async (t) => {
  const { vp, api, print } = await startVp(t);
  assert.equal(vp.printers.length, 3);
  assert.ok(vp.url.startsWith('http://localhost:'));

  const page = await api('GET', '/');
  assert.equal(page.status, 200);
  assert.match(page.type, /text\/html/);
  assert.match(page.body, /<title>Virtual Printers<\/title>/);
  assert.equal(page.body, fs.readFileSync(PAGE_FILE, 'utf8'));
  assert.doesNotMatch(page.body, /<script[^>]+src=|<link[^>]+href="http/, 'no CDN: works with no internet');

  await print(0, { kind: 'test', kitchen_name: 'Italian', event_name: 'Demo' }, { printer: 'x' });
  await print(0, order('Italian'));
  await print(1, order('Arabic', { kot_no: 'AR-001', table_number: 12, chairs: [1] }));
  await print(1, order('Italian', { kot_no: 'IT-015' }), { backup: true }); // backup slip: another kitchen's KOT
  await waitFor(() => vp.printers[1].jobs.length === 2, 'slips arrived');

  const st = await api('GET', '/api/state');
  assert.equal(st.status, 200);
  const [p0, p1, p2] = st.body.printers;
  assert.deepEqual(
    [p0.port, p1.port, p2.port],
    vp.printers.map((p) => p.port),
  );
  assert.equal(p0.kitchen, 'ITALIAN', 'column titled with the kitchen read from the slip');
  assert.equal(p0.count, 2);
  assert.equal(p0.slips[0].kotNo, 'IT-014', 'newest first');
  assert.equal(p0.slips[0].table, '8');
  assert.equal(p0.slips[1].kind, 'test');
  assert.equal(p1.kitchen, 'ARABIC', 'a backup slip does not rename the printer');
  assert.equal(p1.slips[0].backup, true);
  assert.equal(p2.kitchen, null);
  assert.equal(p2.count, 0);
  assert.equal(p0.on, true);
  assert.equal(p0.paper, 'online');
  // slips carry styled runs for the page: big table line, reversed note
  const lines = p0.slips[0].lines;
  const table = lines.find((l) => l.runs.map((r) => r.text).join('') === 'TABLE 8');
  assert.equal(table.runs[0].w, 4);
  assert.equal(table.runs[0].bold, true);
  const note = lines.find((l) => l.runs.some((r) => r.text === '>> JAIN <<'));
  assert.deepEqual(
    note.runs.map((r) => [r.text, r.reverse]),
    [
      ['   ', false],
      ['>> JAIN <<', true],
    ],
  );

  // Clear empties every printer
  assert.equal((await api('POST', '/api/clear')).status, 200);
  const after = await api('GET', '/api/state');
  assert.ok(after.body.printers.every((p) => p.count === 0 && p.slips.length === 0 && p.kitchen === null));
  assert.equal((await api('GET', '/nope')).status, 404);
});

test('the page gets new slips and printer changes live (Server-Sent Events)', async (t) => {
  const { vp, base, print, api } = await startVp(t, [0]);
  const events = [];
  const req = http.get(`${base}/api/events`);
  t.after(() => req.destroy());
  const res = await new Promise((resolve) => req.on('response', resolve));
  assert.match(res.headers['content-type'], /text\/event-stream/);
  let buf = '';
  res.setEncoding('utf8');
  res.on('data', (c) => {
    buf += c;
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const ev = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.+)$/m.exec(block)?.[1];
      if (ev) events.push({ ev, data: JSON.parse(data) });
    }
  });
  await waitFor(() => events.some((e) => e.ev === 'snapshot'), 'snapshot on connect');
  await print(0, order('Indian', { kot_no: 'IN-007', table_number: 5 }));
  await waitFor(() => events.some((e) => e.ev === 'slip'), 'slip event');
  const slip = events.find((e) => e.ev === 'slip').data;
  assert.equal(slip.port, vp.printers[0].port);
  assert.equal(slip.slip.kotNo, 'IN-007');
  assert.equal(slip.printer.kitchen, 'INDIAN');
  assert.equal(slip.printer.count, 1);
  await api('POST', `/api/printers/${vp.printers[0].port}`, { paper: 'paper_low' });
  await waitFor(() => events.some((e) => e.ev === 'printer' && e.data.paper === 'paper_low'), 'printer event');
});

test('controls: paper and power change the printer; bad requests are refused', async (t) => {
  const { vp, api } = await startVp(t, [0]);
  const pr = vp.printers[0];
  const url = `/api/printers/${pr.port}`;
  const probeByte = () =>
    new Promise((resolve) => {
      const s = net.connect(pr.port, '127.0.0.1', () => s.write(STATUS_REQUEST));
      s.on('data', (d) => {
        resolve(d[0]);
        s.destroy();
      });
      s.on('error', () => resolve('refused'));
    });

  assert.equal((await probeByte()) & 0x6c, 0, 'paper OK: no paper bits');
  let r = await api('POST', url, { paper: 'paper_low' });
  assert.equal(r.body.paper, 'paper_low');
  assert.equal((await probeByte()) & 0x0c, 0x0c, 'paper low bits');
  r = await api('POST', url, { paper: 'paper_out' });
  assert.equal(r.body.paper, 'paper_out');
  assert.equal((await probeByte()) & 0x60, 0x60, 'paper end bits');

  r = await api('POST', url, { power: 'off' });
  assert.equal(r.status, 200);
  assert.equal(r.body.on, false);
  assert.equal(await probeByte(), 'refused', 'switched off: nothing listens');
  r = await api('POST', url, { power: 'on' });
  assert.equal(r.body.on, true);
  assert.notEqual(await probeByte(), 'refused');

  assert.equal((await api('POST', url, { paper: 'wet' })).status, 400);
  assert.equal((await api('POST', url, { power: 'maybe' })).status, 400);
  assert.equal((await api('POST', '/api/printers/1', { paper: 'online' })).status, 404);
});

test('a printer out of paper prints nothing, even if a KOT is sent without asking first', async (t) => {
  const { vp, api } = await startVp(t, [0]);
  const pr = vp.printers[0];
  pr.setStatus('paper_out');
  await new Promise((resolve, reject) => {
    const s = net.connect(pr.port, '127.0.0.1', () => s.end(buildKot(order('Italian'))));
    s.on('close', resolve);
    s.on('error', reject);
  });
  await waitFor(() => pr.refused.length === 1, 'refused');
  assert.equal(pr.jobs.length, 0);
  const st = await api('GET', '/api/state');
  assert.equal(st.body.printers[0].refused, 1);
  assert.equal(st.body.printers[0].count, 0);
});

test('Paper out and Switch off on the page are seen by the Print Hub; failed KOTs reprint after Paper OK / Switch on', async (t) => {
  const { vp, api } = await startVp(t, [0, 0, 0]);
  const mock = await startMockPostgrest();
  t.after(() => mock.close());
  const event = mock.addEvent({ name: 'Sharma Wedding', date: localDate() });
  const [pIt, pAr, pIn] = vp.printers;
  const kitchen = (name, prefix, p) => mock.addKitchen({ event_id: event.id, name, prefix, printer_ip: '127.0.0.1', printer_port: p.port });
  const italian = kitchen('Italian', 'IT', pIt);
  const arabic = kitchen('Arabic', 'AR', pAr);
  const indian = kitchen('Indian', 'IN', pIn);
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'printhub-vp-'));
  const stop = startHub({ ...FAST, url: mock.url, anonKey: mock.anonKey, hubName: 'vp-test', logDir });
  t.after(async () => {
    await stop();
    fs.rmSync(logDir, { recursive: true, force: true });
  });
  const reported = (k, s) => mock.callsTo('hub_printer_status').some((c) => c.args.p_printer_port === k.printer_port && c.args.p_status === s);

  await waitFor(() => [italian, arabic, indian].every((k) => k.printer_status === 'online'), 'all online');
  await waitFor(() => pIt.statusChecks > 0, 'the hub checks the virtual printers');

  // Paper out (page button)
  assert.equal((await api('POST', `/api/printers/${pAr.port}`, { paper: 'paper_out' })).status, 200);
  await waitFor(() => arabic.printer_status === 'paper_out', 'hub saw paper out');
  assert.ok(reported(arabic, 'paper_out'));
  assert.equal(italian.printer_status, 'online', 'its neighbours on the same IP are not affected');
  const ar = mock.addKot({ kitchen: arabic, kot_no: 'AR-001', table_number: 4, items: [{ name: 'Hummus', qty: 2 }] });
  await waitFor(() => mock.kot(ar.id).print_status === 'failed', 'AR-001 failed');
  assert.equal(mock.kot(ar.id).last_error, `Printer 127.0.0.1:${pAr.port} is out of paper`);
  assert.equal(pAr.jobs.length + pAr.refused.length, 0, 'the hub never sends a KOT to a printer with no paper');

  // Switch off (page button)
  assert.equal((await api('POST', `/api/printers/${pIn.port}`, { power: 'off' })).status, 200);
  const ind = mock.addKot({ kitchen: indian, kot_no: 'IN-001', table_number: 4, items: [{ name: 'Dal', qty: 1 }] });
  await waitFor(() => mock.kot(ind.id).print_status === 'failed', 'IN-001 failed');
  assert.equal(mock.kot(ind.id).last_error, `Printer 127.0.0.1:${pIn.port} not reachable`);
  await waitFor(() => indian.printer_status === 'offline', 'hub saw offline');
  assert.ok(reported(indian, 'offline'));
  assert.equal(italian.printer_status, 'online');

  // Italian keeps printing meanwhile
  const it = mock.addKot({ kitchen: italian, kot_no: 'IT-001', table_number: 4, items: [{ name: 'Pasta', qty: 1 }] });
  await waitFor(() => mock.kot(it.id).print_status === 'printed', 'IT-001 printed');

  // Paper OK -> AR-001 prints by itself
  await api('POST', `/api/printers/${pAr.port}`, { paper: 'online' });
  await waitFor(() => mock.kot(ar.id).print_status === 'printed', 'AR-001 reprinted');
  assert.equal(pAr.jobs.length, 1);
  assert.equal(describeSlip(pAr.jobs[0].decoded).kotNo, 'AR-001');

  // Switch on -> IN-001 prints by itself
  await api('POST', `/api/printers/${pIn.port}`, { power: 'on' });
  await waitFor(() => mock.kot(ind.id).print_status === 'printed', 'IN-001 reprinted');
  assert.equal(pIn.jobs.length, 1);
  assert.equal(describeSlip(pIn.jobs[0].decoded).kotNo, 'IN-001');
  await waitFor(() => [italian, arabic, indian].every((k) => k.printer_status === 'online'), 'all online again');

  const st = await api('GET', '/api/state');
  assert.deepEqual(
    st.body.printers.map((p) => [p.kitchen, p.count]),
    [
      ['ITALIAN', 1],
      ['ARABIC', 1],
      ['INDIAN', 1],
    ],
  );
  assert.equal(pIt.jobs.length, 1, 'nothing printed twice');
});

test('reading a slip back, and the one-line terminal summary', () => {
  const at = new Date(2026, 9, 13, 19, 42, 5);
  const read = (job, o) => describeSlip(decodeEscPos(buildKot(job, o)));
  assert.deepEqual(read(order('Italian Kitchen')), {
    kind: 'order',
    kitchen: 'ITALIAN KITCHEN',
    kotNo: 'IT-014',
    table: '8',
    chairs: '2, 3',
    cover: null,
    backup: false,
  });
  const long = read(order('Slow Food Live Counter and Grill Station'));
  assert.equal(long.kitchen, 'SLOW FOOD LIVE COUNTER AND GRILL STATION', 'a wrapped kitchen name is joined again');
  assert.equal(read(order('Arabic', { kind: 'cancel' })).kind, 'cancel');
  assert.equal(read(order('Arabic', { kind: 'cancel' })).kitchen, 'ARABIC');
  assert.equal(read(order('Arabic'), { backup: true }).backup, true);
  assert.equal(read(order('Arabic'), { backup: true }).kitchen, 'ARABIC');
  const tst = read({ kind: 'test', kitchen_name: 'Indian' }, { printer: '127.0.0.1:9103' });
  assert.equal(tst.kind, 'test');
  assert.equal(tst.kitchen, 'INDIAN');
  assert.equal(tst.kotNo, null);
  const bare = read({ kind: 'order', items: [{ name: 'Tea', qty: 1 }] });
  assert.equal(bare.table, null);
  assert.equal(bare.kotNo, null);
  assert.equal(describeSlip({ lines: [] }).kitchen, null);

  const job = { at, decoded: decodeEscPos(buildKot(order('Italian'))) };
  assert.equal(slipLine(9101, job), '07:42:05 PM  :9101  ITALIAN           KOT IT-014      T8  chairs 2, 3');
  const cancel = { at, decoded: decodeEscPos(buildKot(order('Arabic', { kind: 'cancel', kot_no: 'AR-002' }), { backup: true })) };
  assert.match(slipLine(9102, cancel), /:9102 {2}ARABIC +CANCEL AR-002 +T8 {2}chairs 2, 3 {2}\(BACKUP PRINTER\)$/);

  // Smart Serve Maestro: one cover per KOT, "KOT AS-A 014" on its own line
  const ms = { kind: 'order', kitchen_name: 'Asian', kot_no: 'AS-A 014', table_number: 7, chairs: [3], cover_no: 3,
    barker: 'A', barker_name: 'Rohit', course: 'Starters', firing_no: 2, items: [{ name: 'Dim Sum', qty: 1 }] };
  const mr = read(ms);
  assert.equal(mr.kitchen, 'ASIAN');
  assert.equal(mr.kotNo, 'AS-A 014');
  assert.equal(mr.table, '7');
  assert.equal(mr.cover, '3');
  assert.match(slipLine(9103, { at, decoded: decodeEscPos(buildKot(ms)) }), /:9103 {2}ASIAN +KOT AS-A 014 +T7 {2}C3$/);
});

test('command line: --kitchens, --ports, old positional ports, --web', () => {
  assert.deepEqual(parseArgs(['--kitchens', '6']).ports, [9101, 9102, 9103, 9104, 9105, 9106]);
  assert.equal(parseArgs(['--kitchens', '6']).web, 9180);
  assert.deepEqual(parseArgs(['--ports', '9101,9105']).ports, [9101, 9105]);
  assert.deepEqual(parseArgs(['--ports=9101, 9102']).ports, [9101, 9102]);
  assert.deepEqual(parseArgs(['9101', '9102', '9103']).ports, [9101, 9102, 9103]);
  assert.deepEqual(parseArgs([]).ports, [9101]);
  assert.deepEqual(parseArgs(['--kitchens', '2', '--base', '9201', '--web', '9280']), {
    ports: [9201, 9202],
    web: 9280,
    open: false,
    status: 'online',
    quiet: false,
    full: false,
    help: false,
    kitchens: 2,
    base: 9201,
  });
  assert.equal(parseArgs(['--no-web']).web, null);
  assert.equal(parseArgs(['--kitchens', '6', '--open']).open, true);
  assert.equal(parseArgs(['9101', '--paper-out']).status, 'paper_out');
  assert.equal(parseArgs(['--no-status']).status, 'silent');
  assert.throws(() => parseArgs(['--kitchens', 'six']), /1 to 40/);
  assert.throws(() => parseArgs(['--ports', '99999']), /not a port/);
  assert.throws(() => parseArgs(['--web']), /needs a value/);
  assert.throws(() => parseArgs(['--colour']), /Unknown option/);
});
