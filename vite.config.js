import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

// ss-perf. Every build gets its own stamp. It goes into dist/sw.js, so each
// deploy ships a byte-different service worker and tablets pick it up.
const BUILD_ID = new Date().toISOString().replace(/[-:TZ]/g, '').replace('.', '-')

// Writes the build stamp and this build's file list into dist/sw.js.
//  entry: what the first screen needs (main JS, vendor JS, CSS, logo). The
//         service worker stores these when it installs, so the app opens
//         even with no internet.
//  all:   every hashed file of this build. Older builds' files are removed
//         from the tablet's cache when the new worker takes over.
// public/sw.js itself is untouched; in dev it runs with its built-in defaults.
function swBuildManifest() {
  let outDir = 'dist'
  return {
    name: 'ss-sw-build-manifest',
    apply: 'build',
    configResolved(c) { outDir = path.resolve(c.root, c.build.outDir) },
    writeBundle(_, bundle) {
      const all = new Set()
      const entry = new Set()
      for (const f of Object.values(bundle)) {
        if (f.fileName.startsWith('assets/')) all.add('/' + f.fileName)
      }
      const visit = name => {
        const c = bundle[name]
        if (!c || entry.has('/' + name)) return
        entry.add('/' + name)
        if (c.type !== 'chunk') return
        ;(c.imports || []).forEach(visit)
        c.viteMetadata?.importedCss?.forEach(f => entry.add('/' + f))
        c.viteMetadata?.importedAssets?.forEach(f => entry.add('/' + f))
      }
      Object.values(bundle).filter(c => c.type === 'chunk' && c.isEntry).forEach(c => visit(c.fileName))

      const file = path.join(outDir, 'sw.js')
      if (!fs.existsSync(file)) return
      const src = fs.readFileSync(file, 'utf8')
      const manifest = JSON.stringify({ build: BUILD_ID, entry: [...entry].sort(), all: [...all].sort() })
      const out = src.replace(/\/\*SS_MANIFEST\*\/[\s\S]*?\/\*END_SS_MANIFEST\*\//,
        '/*SS_MANIFEST*/' + manifest + '/*END_SS_MANIFEST*/')
      if (out === src) throw new Error('sw.js: SS_MANIFEST marker not found')
      fs.writeFileSync(file, out)
    },
  }
}

// src/index.css loads Manrope with an @import of Google Fonts. An @import
// holds back the first paint until fonts.googleapis.com answers, which on a
// slow venue network is the one thing left on the critical path. This moves
// that same URL into a <link> in index.html that loads without blocking:
// the screen paints at once in the fallback font and switches to Manrope
// when it arrives (the URL already asks for display=swap). Build only.
function nonBlockingGoogleFonts() {
  const RE = /@import\s+(?:url\(\s*)?['"]?(https:\/\/fonts\.googleapis\.com\/[^'")\s]+)['"]?\s*\)?\s*;/g
  const urls = new Set()
  return {
    name: 'ss-nonblocking-google-fonts',
    apply: 'build',
    enforce: 'pre',
    transform(code, id) {
      if (!/\.css($|\?)/.test(id) || !code.includes('fonts.googleapis.com')) return null
      const out = code.replace(RE, (_, url) => { urls.add(url); return '' })
      return out === code ? null : { code: out, map: null }
    },
    transformIndexHtml() {
      return [...urls].map(href => ({
        tag: 'link',
        attrs: { rel: 'stylesheet', href, media: 'print', onload: "this.media='all'" },
        injectTo: 'head',
      }))
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), nonBlockingGoogleFonts(), swBuildManifest()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            // Libraries change far less often than the app. In their own file
            // they keep the same name across deploys, so a tablet that already
            // has them only downloads the app part again.
            { name: 'vendor', test: /[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom|cookie|set-cookie-parser|@supabase|tslib)[\\/]/ },
          ],
        },
      },
    },
  },
})
