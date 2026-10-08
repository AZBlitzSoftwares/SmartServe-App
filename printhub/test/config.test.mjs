import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, parseArgs } from '../printhub.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLE = path.join(HERE, '..', 'config.example.json');
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test-key';

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'printhub-cfg-'));
  fs.copyFileSync(EXAMPLE, path.join(dir, 'config.example.json'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const writeCfg = (dir, edit) => {
  const cfg = JSON.parse(fs.readFileSync(EXAMPLE, 'utf8'));
  edit(cfg);
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg, null, 2));
};

test('the example config has the agreed shape', () => {
  const cfg = JSON.parse(fs.readFileSync(EXAMPLE, 'utf8'));
  assert.deepEqual(cfg, {
    use: 'cloud',
    servers: {
      cloud: { url: 'https://kapmreqrhlifxuzjjejz.supabase.co', anonKey: 'PASTE_ANON_KEY' },
      local: { url: 'http://127.0.0.1:54321', anonKey: 'PASTE_LOCAL_ANON_KEY' },
    },
    eventId: 'auto',
    hubName: 'desk-laptop',
    pollMs: 1500,
  });
});

test('first start creates config.json from the example and asks for the key', (t) => {
  const dir = tempDir(t);
  const r = loadConfig({ dir });
  assert.equal(r.ok, false);
  assert.match(r.message, /created/);
  assert.match(r.message, /PASTE_ANON_KEY/);
  assert.ok(fs.existsSync(path.join(dir, 'config.json')));
  // second start: still the placeholder -> refuses with a clear message
  const again = loadConfig({ dir });
  assert.equal(again.ok, false);
  assert.match(again.message, /anon key for the CLOUD server is not set/);
});

test('a real key starts with the cloud server and the config values', (t) => {
  const dir = tempDir(t);
  writeCfg(dir, (c) => (c.servers.cloud.anonKey = KEY));
  const r = loadConfig({ dir });
  assert.equal(r.ok, true);
  assert.deepEqual(r.options, {
    serverName: 'cloud',
    url: 'https://kapmreqrhlifxuzjjejz.supabase.co',
    anonKey: KEY,
    eventId: 'auto',
    hubName: 'desk-laptop',
    pollMs: 1500,
    findPrinters: true,
    scanTargets: [],
  });
});

test('command-line flags override the config', (t) => {
  const dir = tempDir(t);
  writeCfg(dir, (c) => (c.servers.cloud.anonKey = KEY));
  // local server still has its placeholder key
  const r1 = loadConfig({ dir, argv: ['--server', 'local'] });
  assert.equal(r1.ok, false);
  assert.match(r1.message, /LOCAL server is not set/);

  writeCfg(dir, (c) => {
    c.servers.cloud.anonKey = KEY;
    c.servers.local.anonKey = `${KEY}-local`;
  });
  const id = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';
  const r2 = loadConfig({ dir, argv: ['--server=local', '--event', id, '--hub', 'laptop-2'] });
  assert.equal(r2.ok, true);
  assert.equal(r2.options.serverName, 'local');
  assert.equal(r2.options.url, 'http://127.0.0.1:54321');
  assert.equal(r2.options.anonKey, `${KEY}-local`);
  assert.equal(r2.options.eventId, id);
  assert.equal(r2.options.hubName, 'laptop-2');
});

test('bad settings give a clear message instead of starting', (t) => {
  const dir = tempDir(t);
  writeCfg(dir, (c) => (c.servers.cloud.anonKey = KEY));
  assert.match(loadConfig({ dir, argv: ['--event', 'tomorrow'] }).message, /not valid/);
  assert.match(loadConfig({ dir, argv: ['--server', 'office'] }).message, /no server called "office"/);
  assert.match(loadConfig({ dir, argv: ['--colour'] }).message, /Unknown option/);
  fs.writeFileSync(path.join(dir, 'config.json'), '{ "use": "cloud", }');
  assert.match(loadConfig({ dir }).message, /could not be read/);
  assert.throws(() => parseArgs(['--hub']), /needs a value/);
});

test('pollMs is kept within safe limits', (t) => {
  const dir = tempDir(t);
  writeCfg(dir, (c) => {
    c.servers.cloud.anonKey = KEY;
    c.pollMs = 10;
  });
  assert.equal(loadConfig({ dir }).options.pollMs, 500);
});
