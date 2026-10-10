// `node --test printhub/test` on Node 22+ runs this folder as a single file
// (through this index.js), so load every *.test.mjs from here.
// Node 18/20 find the *.test.mjs files themselves; then this file does nothing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
let runAsFolder;
try {
  runAsFolder = fs.statSync(process.argv[1]).isDirectory();
} catch {
  runAsFolder = false;
}
if (runAsFolder) {
  for (const f of fs.readdirSync(here).filter((n) => n.endsWith('.test.mjs')).sort()) {
    await import(pathToFileURL(path.join(here, f)).href);
  }
}
