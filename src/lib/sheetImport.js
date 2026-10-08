/* Reading a menu straight from a spreadsheet.

   Caterers keep menus in Excel. Asking them to "save as CSV" first loses
   people (and Excel's CSV export mangles ₹ and accented dish names), so the
   importer takes the .xlsx itself, a .csv, or rows pasted from Excel.

   An .xlsx file is a zip of XML files. Only the first sheet's cell values
   are needed, so a small reader is enough: no spreadsheet library, nothing
   added to the app's download. Unzipping uses the browser's own
   DecompressionStream. */

// ---------------------------------------------------------------- text / CSV

/* Rows from pasted or CSV text. Tab separated when the text has tabs (a paste
   from Excel), otherwise comma or semicolon. Quotes may hold commas, quotes
   ("") and line breaks. */
export function parseDelimited(text) {
  const src = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const first = src.split('\n', 1)[0] || ''
  const sep = first.includes('\t') ? '\t'
    : (first.split(';').length > first.split(',').length ? ';' : ',')
  const rows = []
  let row = [], cur = '', q = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (q) {
      if (ch === '"') { if (src[i + 1] === '"') { cur += '"'; i++ } else q = false }
      else cur += ch
    } else if (ch === '"' && cur.trim() === '') { q = true; cur = '' }
    else if (ch === sep) { row.push(cur.trim()); cur = '' }
    else if (ch === '\n') { row.push(cur.trim()); rows.push(row); row = []; cur = '' }
    else cur += ch
  }
  if (cur !== '' || row.length) { row.push(cur.trim()); rows.push(row) }
  return rows.filter(r => r.some(c => c !== ''))
}

// ---------------------------------------------------------------- xlsx

const u16 = (b, o) => b[o] | (b[o + 1] << 8)
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open .xlsx files. Save the sheet as CSV, or copy the rows and use Paste from Excel.')
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

// name -> Uint8Array for the entries asked for
async function unzip(buf, wanted) {
  const b = new Uint8Array(buf)
  let eocd = -1
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (u32(b, i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('This is not an .xlsx file. Old .xls files are not supported: open it in Excel and save as .xlsx.')
  const count = u16(b, eocd + 10)
  let p = u32(b, eocd + 16)
  const out = {}
  const dec = new TextDecoder()
  for (let n = 0; n < count && u32(b, p) === 0x02014b50; n++) {
    const method = u16(b, p + 10)
    const csize = u32(b, p + 20)
    const nlen = u16(b, p + 28), xlen = u16(b, p + 30), clen = u16(b, p + 32)
    const local = u32(b, p + 42)
    const name = dec.decode(b.subarray(p + 46, p + 46 + nlen))
    p += 46 + nlen + xlen + clen
    if (!wanted(name)) continue
    const start = local + 30 + u16(b, local + 26) + u16(b, local + 28)
    const data = b.subarray(start, start + csize)
    out[name] = method === 0 ? data : method === 8 ? await inflateRaw(data) : null
  }
  return out
}

const XML_ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
function unxml(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
      : (XML_ENT[e] ?? m))
}
const textOf = xml => [...String(xml).matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => unxml(m[1])).join('')

function colIndex(ref) {
  const letters = String(ref || '').match(/^[A-Z]+/i)?.[0]?.toUpperCase() || ''
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/* Rows of the first sheet of an .xlsx, as arrays of strings */
export async function readXlsx(buf) {
  const files = await unzip(buf, n => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(n))
  const dec = new TextDecoder()
  const str = n => files[n] ? dec.decode(files[n]) : ''

  // first sheet in the workbook's order, through its relationship
  let sheetPath = null
  const firstSheet = str('xl/workbook.xml').match(/<sheet\b[^>]*?r:id="([^"]+)"/)
  if (firstSheet) {
    const rel = [...str('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b([^>]*)\/?>/g)]
      .map(m => m[1]).find(a => a.includes('Id="' + firstSheet[1] + '"'))
    const target = rel?.match(/Target="([^"]+)"/)?.[1]
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '')
  }
  if (!sheetPath || !files[sheetPath]) sheetPath = Object.keys(files).filter(n => n.startsWith('xl/worksheets/')).sort()[0]
  if (!sheetPath) throw new Error('No sheet found in this file.')

  const shared = [...str('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => textOf(m[1]))
  const rows = []
  for (const rm of str(sheetPath).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = []
    let next = 0
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1], body = cm[2] || ''
      const ref = attrs.match(/\br="([^"]+)"/)?.[1]
      const i = ref ? colIndex(ref) : next
      next = i + 1
      const t = attrs.match(/\bt="([^"]+)"/)?.[1]
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1]
      let val = ''
      if (t === 's') val = shared[Number(v)] ?? ''
      else if (t === 'inlineStr') val = textOf(body)
      else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE'
      else if (v != null) val = unxml(v)
      row[i] = String(val).trim()
    }
    for (let i = 0; i < row.length; i++) if (row[i] == null) row[i] = ''
    if (row.some(c => c !== '')) rows.push(row)
  }
  return rows
}

/* Any menu file: .xlsx, .csv or .txt */
export async function readSheetFile(file) {
  const name = (file?.name || '').toLowerCase()
  if (name.endsWith('.xls')) throw new Error('Old .xls files are not supported. Open it in Excel and save as .xlsx (or CSV).')
  if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) return readXlsx(await file.arrayBuffer())
  return parseDelimited(await file.text())
}

// ---------------------------------------------------------------- menu rows

const HEADS = {
  name:        ['dish', 'dish name', 'name', 'item', 'item name', 'menu item'],
  description: ['description', 'desc', 'details', 'ingredients'],
  category:    ['cuisine', 'category', 'section', 'counter', 'station', 'menu category'],
  course:      ['course', 'course name', 'service course'],
  veg:         ['veg', 'veg/non-veg', 'veg / non veg', 'type', 'is_veg', 'veg or non veg', 'diet'],
  barker:      ['barker', 'side'],
  live:        ['live', 'live counter', 'is_live_counter'],
  photo:       ['image', 'image_url', 'photo', 'photo_url', 'picture', 'url', 'img'],
}
const norm = s => String(s || '').toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()

/* Which column holds what, from the header row. Exact names first, then
   names that contain the word, so "Dish Name (English)" still works. */
export function detectColumns(header) {
  const h = header.map(norm)
  const cols = {}
  const used = new Set()
  const keys = Object.entries(HEADS).map(([k, names]) => [k, names.map(norm)])
  // exact header names first, for every column; only then "contains" matches,
  // so "Course Name" is never taken as the dish when "Menu Item Name" is there
  for (const [key, ns] of keys) {
    const i = h.findIndex((x, j) => !used.has(j) && ns.includes(x))
    if (i >= 0) { cols[key] = i; used.add(i) }
  }
  for (const [key, ns] of keys) {
    if (cols[key] != null) continue
    const i = h.findIndex((x, j) => !used.has(j) && ns.some(n => n.length > 2 && x.includes(n)))
    if (i >= 0) { cols[key] = i; used.add(i) }
  }
  return cols
}

export function isVegValue(v) {
  const s = norm(v)
  if (!s) return true
  return !/^(no|n|false|0|non ?veg|nv|nonveg|non vegetarian|egg|chicken|mutton|fish|meat|seafood|prawn)/.test(s)
}

/* Match a course from the sheet to one of the event's courses:
   "Main Course" -> "Mains", "Desserts" -> "Dessert", "soup" -> "Soup",
   "Canapes" -> "Canapés", "Appetizer" -> "Appetiser" */
const fold = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
export function matchCourse(raw, courses) {
  const key = s => norm(fold(s)).replace(/\bcourse\b/g, '').replace(/\s+/g, ' ').trim().replace(/z/g, 's').replace(/(es|s)$/, '')
  const k = key(raw)
  if (!k) return null
  return courses.find(c => key(c) === k)
    || courses.find(c => key(c).startsWith(k) || k.startsWith(key(c)))
    || null
}

/* Header row + data rows -> dishes. Returns { dishes, cols, problems, headings } */
export function menuRows(rows) {
  if (!rows?.length) return { dishes: [], cols: {}, problems: ['The sheet is empty.'], headings: [] }
  // The header is the row (among the first ten) that names the most known columns,
  // and a dish column: sheets often start with a title or an event line.
  let hi = -1, best = 0
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const c = detectColumns(rows[r])
    const n = Object.keys(c).length
    if (c.name != null && n > best) { hi = r; best = n }
  }
  if (hi < 0) return { dishes: [], cols: {}, problems: ['No dish name column found. Put a header row with Dish (or Name), and optionally Cuisine, Course, Description, Veg.'], headings: [] }
  const cols = detectColumns(rows[hi])
  const dishes = []
  const problems = []
  const headings = []
  const cell = (row, k) => cols[k] != null ? String(row[cols[k]] ?? '').trim() : ''
  const body = rows.slice(hi + 1)
  // A line in capitals with nothing else filled in is a heading ("SOUPS"), unless
  // the sheet writes most dish names in capitals anyway.
  const names = body.map(r => cell(r, 'name')).filter(Boolean)
  const caps = n => n === n.toUpperCase() && /[A-Z]/.test(n)
  const capsSheet = names.length > 0 && names.filter(caps).length / names.length > 0.5
  let section = null
  let lastCat = '', lastCourse = ''   // merged / blank cells repeat the row above
  for (let i = 0; i < body.length; i++) {
    const row = body[i]
    const name = cell(row, 'name')
    if (!name) {
      // a row with only a cuisine or course filled in starts a group
      if (cell(row, 'category')) lastCat = cell(row, 'category')
      if (cell(row, 'course')) lastCourse = cell(row, 'course')
      continue
    }
    const others = Object.keys(cols).filter(k => k !== 'name').some(k => cell(row, k))
    if (!capsSheet && !others && caps(name) && name.length < 40) { section = name; headings.push(name); lastCat = ''; lastCourse = ''; continue }
    if (cell(row, 'category')) lastCat = cell(row, 'category')
    if (cell(row, 'course')) lastCourse = cell(row, 'course')
    dishes.push({
      row: hi + i + 2,
      name,
      description: cell(row, 'description'),
      category: cols.category != null ? lastCat : '',
      course: cols.course != null ? lastCourse : '',
      section,
      is_veg: isVegValue(cell(row, 'veg')),
      barker: /^b$/i.test(cell(row, 'barker')) ? 'B' : /^a$/i.test(cell(row, 'barker')) ? 'A' : null,
      is_live_counter: /^(y|yes|true|1)$/i.test(cell(row, 'live')),
      photo_url: cell(row, 'photo') || null,
    })
  }
  if (!dishes.length) problems.push('No dishes found under the header row.')
  return { dishes, cols, problems, headings }
}

/* A template people can fill in, as CSV text */
export function menuTemplateCsv(courses) {
  const c = courses.length ? courses : ['Soup', 'Starters', 'Mains', 'Dessert']
  const pick = i => c[Math.min(i, c.length - 1)]
  const lines = [
    ['Cuisine', 'Course', 'Dish', 'Description', 'Veg', 'Barker'],
    ['Continental', pick(1), 'Cream of Tomato', 'Basil, croutons', 'Veg', ''],
    ['Asian', pick(1), 'Tom Yum', 'Lemongrass, galangal', 'Non-Veg', ''],
    ['Modern Indian', pick(2), 'Paneer Tikka', 'Mint chutney', 'Veg', 'A'],
    ['Asian', pick(3), 'Thai Green Curry', 'Jasmine rice', 'Veg', 'B'],
    ['Italian', pick(4), 'Tiramisu', '', 'Veg', ''],
  ]
  return lines.map(l => l.map(v => /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v).join(',')).join('\r\n') + '\r\n'
}
