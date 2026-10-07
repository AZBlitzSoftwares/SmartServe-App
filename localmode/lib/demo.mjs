// "demo": three demo events dated TODAY in the laptop's TEST database, so all
// three ways of working can be tried at once:
//   Demo · Guest Self-Service   guest tablets order for themselves
//   Demo · Captain Service      captains take orders, the desk assigns waiters
//   Demo · Multi-Kitchen        captain + chairs, one KOT per kitchen, Virtual Printers
// Running it again recreates them (fixed ids, so it is safe to repeat and
// cached logins on the tablets stay valid). "demo --remove" deletes them.
// Only for a test database ("prepare --dev"): never on an event download.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {
  P, UserError, qi, loadConfig, loadLocal, readJson, writeJson, isPrepared, isDevSnapshot, localDate, fmtDay, lanAddresses,
  serverRunning, plural,
} from './common.mjs'
import { refuseRoot, pgBins, withPostgres, connectLocal } from './runtime.mjs'

export const DEMO_IDS = {
  self: '00000000-0000-4000-8000-0000000de301',
  captain: '00000000-0000-4000-8000-0000000de302',
  multi: '00000000-0000-4000-8000-0000000de303',
  maestro: '00000000-0000-4000-8000-0000000de304',
}
const ALL_IDS = Object.values(DEMO_IDS)

// The same key always gives the same id (a uuid built from an md5).
export function demoId(key) {
  const h = crypto.createHash('md5').update('smartserve-demo/' + key).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${(8 | (parseInt(h[16], 16) & 3)).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`
}

const SUPERVISOR = { name: 'Demo Supervisor', pin: '9090' }
const ADMIN = { username: 'admin', name: 'Admin', pin: '9999' }
const CATERER = "Janu's Caterers (Demo)"
const HELP = [['Drinking water', true], ['Extra plates', true], ['Napkins / tissues', false], ['Please clean the table', false]]

// [name, description, veg]
const V = true
const N = false

const MENU_SELF = [
  ['Veg Starters', null, [
    ['Paneer Tikka', 'Clay-oven cottage cheese, mint chutney', V],
    ['Hara Bhara Kebab', 'Spinach and green pea patties', V],
    ['Crispy Corn', 'Golden fried corn, pepper and spring onion', V],
    ['Veg Spring Roll', 'Crunchy rolls, sweet chilli dip', V],
  ]],
  ['Non-Veg Starters', null, [
    ['Chicken Tikka', 'Smoky tandoori chicken chunks', N],
    ['Fish Amritsari', 'Gram-flour battered fried fish', N],
    ['Mutton Seekh Kebab', 'Minced lamb skewers, onion rings', N],
  ]],
  ['Main Course', null, [
    ['Paneer Butter Masala', 'Cottage cheese in creamy tomato gravy', V],
    ['Dal Makhani', 'Slow-cooked black lentils, butter', V],
    ['Veg Kolhapuri', 'Spicy mixed vegetables, Kolhapuri masala', V],
    ['Butter Chicken', 'Tandoori chicken in makhani gravy', N],
    ['Mutton Rogan Josh', 'Kashmiri-style lamb curry', N],
  ]],
  ['Rice & Biryani', null, [
    ['Jeera Rice', 'Basmati tempered with cumin', V],
    ['Veg Dum Biryani', 'Layered basmati, vegetables, saffron', V],
    ['Chicken Dum Biryani', 'Hyderabadi-style, raita on the side', N],
  ]],
  ['Breads', null, [
    ['Butter Naan', 'Soft tandoor bread with butter', V],
    ['Garlic Naan', 'Naan with garlic and coriander', V],
    ['Tandoori Roti', 'Whole-wheat tandoor bread', V],
  ]],
  ['Desserts', null, [
    ['Gulab Jamun', 'Warm milk dumplings in syrup', V],
    ['Rasmalai', 'Cottage cheese discs in saffron milk', V],
    ['Gajar Halwa', 'Slow-cooked carrot pudding', V],
  ]],
  ['Beverages', null, [
    ['Masala Chaas', 'Spiced buttermilk', V],
    ['Sweet Lassi', 'Chilled yoghurt drink', V],
    ['Fresh Lime Soda', 'Sweet or salted', V],
    ['Masala Chai', 'Hot spiced tea', V],
  ]],
]

const MENU_CAPTAIN = [
  ['Soups', null, [
    ['Tomato Basil Soup', 'Roasted tomato, fresh basil', V],
    ['Sweet Corn Veg Soup', 'Corn, vegetables, light stock', V],
    ['Chicken Manchow Soup', 'Spicy soup, crispy noodles', N],
  ]],
  ['Starters', null, [
    ['Paneer Malai Tikka', 'Creamy marinated cottage cheese', V],
    ['Veg Seekh Kebab', 'Vegetable and cashew skewers', V],
    ['Chicken Malai Tikka', 'Cream and cheese marinated chicken', N],
    ['Prawns Koliwada', 'Mumbai-style crispy prawns', N],
  ]],
  ['Main Course - Veg', null, [
    ['Kadai Paneer', 'Paneer, peppers, kadai masala', V],
    ['Malai Kofta', 'Paneer dumplings in cashew gravy', V],
    ['Dal Tadka', 'Yellow lentils, garlic tempering', V],
    ['Veg Jalfrezi', 'Stir-fried vegetables, tangy masala', V],
  ]],
  ['Main Course - Non-Veg', null, [
    ['Chicken Lababdar', 'Rich tomato and onion gravy', N],
    ['Mutton Bhuna', 'Dry-roasted lamb, whole spices', N],
    ['Goan Fish Curry', 'Coconut and kokum curry', N],
  ]],
  ['Rice & Breads', null, [
    ['Steamed Rice', 'Plain basmati', V],
    ['Veg Pulao', 'Basmati with vegetables', V],
    ['Butter Naan', 'Soft tandoor bread with butter', V],
    ['Missi Roti', 'Gram-flour and spice flatbread', V],
  ]],
  ['Desserts', null, [
    ['Moong Dal Halwa', 'Rich lentil pudding, ghee', V],
    ['Shahi Tukda', 'Fried bread, rabri, nuts', V],
    ['Phirni', 'Chilled rice pudding in clay pots', V],
  ]],
  ['Beverages', null, [
    ['Fresh Lime Water', 'Sweet or salted', V],
    ['Jaljeera', 'Tangy cumin cooler', V],
    ['Cold Coffee', 'With a scoop of ice cream', V],
  ]],
]

const KITCHENS = [
  { key: 'IN', name: 'Indian', port: 9101, isDefault: true },
  { key: 'AR', name: 'Arabic', port: 9102 },
  { key: 'CH', name: 'Chinese', port: 9103 },
  { key: 'IT', name: 'Italian', port: 9104 },
  { key: 'MX', name: 'Mexican', port: 9105 },
  { key: 'TR', name: 'Turkish', port: 9106 },
]
const PRINTER_IP = '127.0.0.1' // the Virtual Printers run on this same laptop

// The second item is the kitchen; Desserts and Beverages have none on purpose:
// they go to the default kitchen (Indian).
const MENU_MULTI = [
  ['Indian', 'IN', [
    ['Paneer Tikka Masala', 'Grilled paneer in spiced gravy', V],
    ['Dal Makhani', 'Slow-cooked black lentils, butter', V],
    ['Butter Chicken', 'Tandoori chicken in makhani gravy', N],
    ['Garlic Naan', 'Naan with garlic and coriander', V],
  ]],
  ['Arabic', 'AR', [
    ['Hummus with Pita', 'Chickpea, tahini, olive oil', V],
    ['Falafel Platter', 'Chickpea fritters, tahini, pickles', V],
    ['Chicken Shawarma', 'Garlic toum, pickled turnip', N],
    ['Lamb Mandi', 'Smoked rice, slow-cooked lamb', N],
  ]],
  ['Chinese', 'CH', [
    ['Veg Hakka Noodles', 'Wok-tossed noodles, vegetables', V],
    ['Chilli Paneer', 'Paneer, peppers, chilli sauce', V],
    ['Veg Manchurian', 'Vegetable balls, Manchurian gravy', V],
    ['Kung Pao Chicken', 'Chicken, peanuts, dried chilli', N],
  ]],
  ['Italian', 'IT', [
    ['Margherita Pizza', 'Tomato, mozzarella, basil', V],
    ['Penne Arrabbiata', 'Spicy tomato, garlic', V],
    ['Mushroom Risotto', 'Arborio rice, parmesan', V],
    ['Chicken Alfredo Pasta', 'Creamy parmesan sauce', N],
  ]],
  ['Mexican', 'MX', [
    ['Nachos with Salsa', 'Corn chips, cheese, pico de gallo', V],
    ['Bean Burrito Bowl', 'Rice, beans, salsa, sour cream', V],
    ['Chicken Quesadilla', 'Grilled tortilla, cheese, chicken', N],
    ['Chicken Tacos', 'Soft tacos, lime crema', N],
  ]],
  ['Turkish', 'TR', [
    ['Mercimek Soup', 'Red lentil soup, lemon', V],
    ['Cheese Pide', 'Boat-shaped flatbread, cheese', V],
    ['Lahmacun', 'Thin flatbread, spiced minced lamb', N],
    ['Adana Kebab', 'Spicy minced lamb skewer', N],
  ]],
  ['Desserts', null, [
    ['Gulab Jamun', 'Warm milk dumplings in syrup', V],
    ['Tiramisu', 'Coffee, mascarpone', V],
    ['Baklava', 'Filo, pistachio, syrup', V],
    ['Churros', 'With chocolate dip', V],
  ]],
  ['Beverages', null, [
    ['Fresh Lime Soda', 'Sweet or salted', V],
    ['Mint Lemonade', 'Fresh mint, lemon', V],
    ['Turkish Tea', 'Black tea, tulip glass', V],
    ['Cold Coffee', 'With a scoop of ice cream', V],
  ]],
]

// Smart Serve Maestro: kitchens by cuisine and by course, two barkers each.
// [key, name, port, courses (course rule), barkers, default]
const KITCHENS_MAESTRO = [
  { key: 'FC', name: 'First Course', port: 9101, courses: ['First Course'], barkers: 1 },
  { key: 'IT', name: 'Italian', port: 9102 },
  { key: 'AS', name: 'Asian', port: 9103, isDefault: true },
  { key: 'MI', name: 'Modern Indian', port: 9104 },
  { key: 'DS', name: 'Desserts', port: 9105, courses: ['Dessert'] },
]
// [category (cuisine), kitchen, dishes: [name, description, veg, course, barker]]
// Desserts of every cuisine go to the Desserts kitchen by the course rule.
const MENU_MAESTRO = [
  ["Chef's Welcome", 'FC', [
    ['Amuse trio', 'Three bites to begin, served to every guest', V, 'First Course', 'A'],
  ]],
  ['Italian', 'IT', [
    ['Minestrone', 'Vegetable and bean soup, basil oil', V, 'Soup', 'A'],
    ['Burrata', 'Heirloom tomato, pesto, sourdough', V, 'Starters', 'A'],
    ['Bruschetta', 'Tomato, garlic, olive oil', V, 'Starters', 'B'],
    ['Truffle Risotto', 'Arborio rice, parmesan, truffle', V, 'Mains', 'A'],
    ['Penne Arrabbiata', 'Spicy tomato, garlic', V, 'Mains', 'B'],
    ['Wild Mushroom Ravioli', 'Sage butter, parmesan', V, 'Mains', 'B'],
    ['Tiramisu', 'Coffee, mascarpone', V, 'Dessert', 'A'],
    ['Panna Cotta', 'Vanilla, berry compote', V, 'Dessert', 'B'],
  ]],
  ['Asian', 'AS', [
    ['Hot & Sour Soup', 'Tofu, mushroom, pepper', V, 'Soup', 'A'],
    ['Crystal Veg Dim Sum', 'Water chestnut, greens, chilli oil', V, 'Starters', 'A'],
    ['Szechuan Eggplant', 'Crisp aubergine, Szechuan pepper glaze', V, 'Starters', 'A'],
    ['Thai Green Curry', 'Coconut, basil, jasmine rice', V, 'Mains', 'A'],
    ['Kimchi Bao', 'Steamed bao, house kimchi, sesame', V, 'Starters', 'B'],
    ['Tofu Satay', 'Charred tofu, peanut sauce', V, 'Starters', 'B'],
    ['Burnt Garlic Fried Rice', 'Wok-tossed, spring onion', V, 'Mains', 'B'],
    ['Hakka Noodles', 'Wok-tossed noodles, vegetables', V, 'Mains', 'B'],
  ]],
  ['Modern Indian', 'MI', [
    ['Tomato Shorba', 'Spiced tomato broth', V, 'Soup', 'A'],
    ['Paneer Tikka', 'Clay-oven cottage cheese, mint chutney', V, 'Starters', 'A'],
    ['Galouti Kebab', 'Melt-in-the-mouth lamb, saffron', N, 'Starters', 'B'],
    ['Dal Makhani', 'Slow-cooked black lentils, butter', V, 'Mains', 'A'],
    ['Veg Dum Biryani', 'Layered basmati, vegetables, saffron', V, 'Mains', 'B'],
    ['Butter Chicken', 'Tandoori chicken in makhani gravy', N, 'Mains', 'B'],
    ['Rasmalai', 'Cottage cheese discs in saffron milk', V, 'Dessert', 'A'],
  ]],
  ['Desserts', 'DS', [
    ['Baked Cheesecake', 'New York style, berry coulis', V, 'Dessert', 'A'],
    ['Chocolate Fondant', 'Warm centre, vanilla ice cream', V, 'Dessert', 'B'],
  ]],
]

const EVENTS = [
  {
    key: 'self', id: DEMO_IDS.self, name: 'Demo · Guest Self-Service', service_mode: 'self', multi: false, tables: 6, venue: 'Demo Hall A',
    welcome: 'Welcome! A demo event on the local test server - order whatever you like.',
    menu: MENU_SELF, captains: [], waiters: [['11', 'Anil'], ['12', 'Deepak'], ['13', 'Faisal']],
  },
  {
    key: 'captain', id: DEMO_IDS.captain, name: 'Demo · Captain Service', service_mode: 'captain', multi: false, tables: 6, venue: 'Demo Hall B',
    welcome: 'Demo event: captain service on the local test server.',
    menu: MENU_CAPTAIN, captains: [['Vikram', '1212'], ['Neha', '3434']], waiters: [['21', 'Ganesh'], ['22', 'Harish'], ['23', 'Javed']],
  },
  {
    key: 'multi', id: DEMO_IDS.multi, name: 'Demo · Multi-Kitchen', service_mode: 'captain', multi: true, tables: 10, chairs: 10, venue: 'Demo Lawn',
    welcome: 'Demo event: captain multi-kitchen service on the local test server.',
    menu: MENU_MULTI,
    // [name, pin, table]
    captains: [['Rahul', '1111', 1], ['Imran', '2222', 1], ['Sameer', '3333', 2], ['Ayesha', '4444', 3]],
    // [number, name, kitchen, pin]: waiter 0N works for kitchen N, printer 910N, PIN 510N
    waiters: [['01', 'Arjun', 'IN', '5101'], ['02', 'Salim', 'AR', '5102'], ['03', 'Kiran', 'CH', '5103'],
      ['04', 'Ravi', 'IT', '5104'], ['05', 'Manoj', 'MX', '5105'], ['06', 'Tariq', 'TR', '5106']],
  },
  {
    key: 'maestro', id: DEMO_IDS.maestro, name: 'Demo · Smart Serve Maestro', service_mode: 'captain', multi: true, maestro: true,
    tables: 15, chairs: 10, venue: 'Demo Banquet Hall',
    welcome: 'Demo event: Smart Serve Maestro, course-paced multi-kitchen service.',
    menu: MENU_MAESTRO, kitchens: KITCHENS_MAESTRO,
    // [name, pin, table]
    captains: [['Neha', '7071', 7], ['Arjun', '7072', 7], ['Rahul', '1111', 1], ['Imran', '2222', 1],
      ['Sameer', '3333', 2], ['Ayesha', '4444', 2], ['Faiz', '8081', 8], ['Priya', '3131', 3]],
    waiters: [],
    // [name, kitchen, side, pin]
    barkers: [['Sanjay', 'FC', 'A', '6100'], ['Ajay', 'IT', 'A', '6201'], ['Vijay', 'IT', 'B', '6202'],
      ['Rohit', 'AS', 'A', '6301'], ['Kunal', 'AS', 'B', '6302'], ['Farhan', 'MI', 'A', '6401'], ['Sunil', 'MI', 'B', '6402'],
      ['Pooja', 'DS', 'A', '6501'], ['Meena', 'DS', 'B', '6502']],
  },
]

// ---------------------------------------------------------------- database helpers

// Base tables of public and their columns (name -> data type).
async function columnsOf(db) {
  const { rows } = await db.query(`
    select c.relname as t, a.attname as c, format_type(a.atttypid, a.atttypmod) as type
      from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped`)
  const m = new Map()
  for (const r of rows) { if (!m.has(r.t)) m.set(r.t, new Map()); m.get(r.t).set(r.c, r.type) }
  return m
}

// Insert one row with only the columns this database has. Returns the id.
async function insert(db, cols, table, row, st) {
  const tc = cols.get(table)
  if (!tc) { st.missingTables.add(table); return null }
  const r = { ...row }
  if ('id' in r && tc.get('id') !== 'uuid') delete r.id // ids of another type: let the database make one
  for (const k of Object.keys(r)) if (!tc.has(k)) st.missingCols.add(`${table}.${k}`)
  const keys = Object.keys(r).filter((k) => tc.has(k) && r[k] !== undefined)
  const sql = `insert into public.${qi(table)} (${keys.map(qi).join(', ')}) values (${keys.map((_, i) => '$' + (i + 1)).join(', ')})` +
    (tc.has('id') ? ' returning id::text as id' : '')
  const { rows } = await db.query(sql, keys.map((k) => r[k]))
  st.rows[table] = (st.rows[table] || 0) + 1
  return rows[0]?.id ?? null
}

// Delete the demo events and everything that belongs to them, children
// first. A delete that fails (a link this program does not know about) is
// tried again after the others.
async function deleteDemo(db, cols) {
  const has = (t, c) => cols.has(t) && (!c || cols.get(t).has(c))
  const EVW = 'event_id::text = any($1::text[])'
  const steps = []
  const add = (t, where, needs = [[t, 'event_id']]) => { if (has(t) && needs.every(([a, b]) => has(a, b))) steps.push({ t, where }) }
  add('kots', EVW)
  add('order_items', `order_id in (select id from public.orders where ${EVW})`, [['order_items', 'order_id'], ['orders', 'event_id']])
  add('sos_request_items', `sos_request_id in (select id from public.sos_requests where ${EVW})`, [['sos_request_items', 'sos_request_id'], ['sos_requests', 'event_id']])
  for (const t of ['sos_requests', 'chat_messages', 'feedback', 'table_carts', 'orders', 'tables']) add(t, EVW)
  add('menu_items', `category_id in (select id from public.menu_categories where ${EVW})${has('menu_items', 'event_id') ? ` or ${EVW}` : ''}`,
    [['menu_items', 'category_id'], ['menu_categories', 'event_id']])
  for (const t of ['menu_categories', 'waiters', 'captains', 'kitchens', 'supervisors', 'help_items']) add(t, EVW)
  for (const [t, c] of cols) if (t !== 'events' && c.has('event_id') && !steps.some((s) => s.t === t)) steps.push({ t, where: EVW })
  if (has('events')) steps.push({ t: 'events', where: 'id::text = any($1::text[])' })

  const deleted = {}
  let pending = steps
  for (;;) {
    const failed = []
    for (const s of pending) {
      await db.query('savepoint demo_del')
      try {
        const r = await db.query(`delete from public.${qi(s.t)} where ${s.where}`, [ALL_IDS])
        await db.query('release savepoint demo_del')
        if (r.rowCount) deleted[s.t] = (deleted[s.t] || 0) + r.rowCount
      } catch (e) {
        await db.query('rollback to savepoint demo_del')
        s.error = e.message
        failed.push(s)
      }
    }
    if (!failed.length) return deleted
    if (failed.length === pending.length) {
      throw new UserError('The demo events could not be removed:\n' + failed.map((s) => `  - ${s.t}: ${s.error}`).join('\n'))
    }
    pending = failed
  }
}

async function createDemo(db, cols, today) {
  const st = { rows: {}, missingTables: new Set(), missingCols: new Set(), admin: null }
  const has = (t, c) => cols.has(t) && (!c || cols.get(t).has(c))

  // An admin login for local testing (the stand-in database has none).
  if (has('admins', 'username')) {
    const { rows } = await db.query('select pin from public.admins where username = $1 limit 1', [ADMIN.username])
    if (!rows.length) {
      await insert(db, cols, 'admins', { username: ADMIN.username, name: ADMIN.name, pin: ADMIN.pin, is_active: true }, st)
      st.admin = { pin: ADMIN.pin, created: true }
    } else {
      st.admin = { pin: String(rows[0].pin) === ADMIN.pin ? ADMIN.pin : null, created: false }
    }
  }

  for (const ev of EVENTS) {
    const evId = await insert(db, cols, 'events', {
      id: ev.id, name: ev.name, date: today, venue: ev.venue, catering_company: CATERER, number_of_tables: ev.tables,
      max_orders_per_table: 5, call_waiter_enabled: true, service_mode: ev.service_mode, welcome_note: ev.welcome,
      is_closed: false, ai_enabled: false, multi_kitchen: ev.multi, ...(ev.chairs ? { chairs_per_table: ev.chairs } : {}),
      ...(ev.maestro ? { maestro: true } : {}),
    }, st)
    const k = (s) => demoId(`${ev.key}/${s}`)

    await insert(db, cols, 'supervisors', { id: k('supervisor'), event_id: evId, name: SUPERVISOR.name, pin: SUPERVISOR.pin, is_active: true }, st)
    for (let t = 1; t <= ev.tables; t++) await insert(db, cols, 'tables', { id: k(`table/${t}`), event_id: evId, table_number: t, is_active: true }, st)
    for (const [i, [name, hasQty]] of HELP.entries()) {
      await insert(db, cols, 'help_items', { id: k(`help/${i}`), event_id: evId, name, has_quantity: hasQty, is_active: true, sort_order: i + 1 }, st)
    }

    const kitchenIds = {}
    if (ev.multi) {
      for (const [i, kt] of (ev.kitchens || KITCHENS).entries()) {
        kitchenIds[kt.key] = await insert(db, cols, 'kitchens', {
          id: k(`kitchen/${kt.key}`), event_id: evId, name: kt.name, prefix: kt.key, printer_ip: PRINTER_IP, printer_port: kt.port,
          kot_seq: 0, sort_order: i + 1, is_default: !!kt.isDefault, is_active: true,
          ...(kt.courses ? { courses: kt.courses } : {}), ...(kt.barkers ? { barkers: kt.barkers } : {}),
        }, st)
      }
    }

    for (const [ci, [cat, kitchen, dishes]] of ev.menu.entries()) {
      const catId = await insert(db, cols, 'menu_categories', {
        id: k(`cat/${ci}`), event_id: evId, name: cat, sort_order: ci + 1, is_visible: true,
        ...(kitchen && kitchenIds[kitchen] ? { kitchen_id: kitchenIds[kitchen] } : {}),
      }, st)
      for (const [di, [name, description, veg, course, barker]] of dishes.entries()) {
        await insert(db, cols, 'menu_items', {
          id: k(`dish/${ci}/${di}`), category_id: catId, event_id: evId, name, description, is_veg: veg,
          is_available: true, is_live_counter: false, sort_order: di + 1,
          ...(course ? { course } : {}), ...(barker ? { barker } : {}),
        }, st)
      }
    }

    for (const [name, pin, table] of ev.captains) {
      await insert(db, cols, 'captains', { id: k(`captain/${name}`), event_id: evId, name, pin, is_active: true, ...(table ? { table_number: table } : {}) }, st)
    }
    for (const [name, kitchen, side, pin] of ev.barkers || []) {
      await insert(db, cols, 'barkers', { id: k(`barker/${name}`), event_id: evId, kitchen_id: kitchenIds[kitchen], side, name, pin, is_active: true }, st)
    }
    for (const [num, name, kitchen, pin] of ev.waiters) {
      await insert(db, cols, 'waiters', {
        id: k(`waiter/${num}`), event_id: evId, waiter_number: num, name: `${name} (${num})`, is_active: true,
        ...(pin ? { pin } : {}), ...(kitchen ? { kitchen_id: kitchenIds[kitchen] } : {}),
      }, st)
    }
  }
  return st
}

// The demo events are listed in data/snapshot.json like downloaded events,
// so the server's status panel and /ss-local.json show them.
function updateSnapshot(snap, today, remove) {
  const others = (snap.events || []).filter((e) => !ALL_IDS.includes(e.id))
  snap.events = remove ? others : [...others, ...EVENTS.map((e) => ({ id: e.id, name: e.name, date: today, service_mode: e.service_mode, multi_kitchen: e.multi, maestro: !!e.maestro }))]
  writeJson(P.snapshot, snap)
}

// ---------------------------------------------------------------- summary

function summary({ today, port, st, running }) {
  const ip = lanAddresses()[0]?.ip
  const base = `http://${ip || '<this-Mac-IP>'}${port === 80 ? '' : `:${port}`}`
  const L = []
  const pad = (s, n) => String(s).padEnd(n)
  L.push(`DEMO EVENTS READY - dated today (${fmtDay(today)}), in this laptop's TEST database only`)
  L.push('')
  L.push('LINKS (phones and tablets on the same Wi-Fi as this laptop)')
  L.push(`  Tablets (guest + captain)   ${base}/`)
  L.push(`  Waiter phones               ${base}/waiter`)
  L.push(`  Desk                        ${base}/supervisor`)
  L.push(`  QR codes to scan            http://localhost:${port}/qr   (open it on this laptop's screen)`)
  if (!ip) L.push('  (no network address found - connect to Wi-Fi; the server window shows the address)')
  if (!running) L.push('  The local server is not running yet: node ss-local.mjs start')
  L.push('')
  L.push('DESK (/supervisor)')
  const a = st.admin
  if (a) L.push(`  admin / ${a.pin || 'your usual admin PIN (copied from the cloud)'}${a.created ? '   (admin login created for local testing)' : ''}`)
  L.push(`  ${SUPERVISOR.name} / ${SUPERVISOR.pin}   then pick the event`)
  L.push('  The first screen of a tablet asks "How is this tablet being used?" (guest and captain events both run today).')
  L.push('')
  const [self, cap, multi, maestro] = EVENTS
  L.push(`1) ${self.name}   ${self.tables} tables`)
  L.push(`   Tablet link -> "Guest tablet" -> set-up PIN ${SUPERVISOR.pin} (or the admin PIN) -> "${self.name}" -> a table`)
  L.push(`   Waiters (assigned at the desk): ${self.waiters.map(([n, w]) => `${w} (${n})`).join(', ')}`)
  L.push('')
  L.push(`2) ${cap.name}   ${cap.tables} tables`)
  L.push(`   Tablet link -> "Captain" -> ${cap.captains.map(([n, p]) => `${n} ${p}`).join('  or  ')}`)
  L.push(`   Waiters (assigned at the desk): ${cap.waiters.map(([n, w]) => `${w} (${n})`).join(', ')}`)
  L.push('')
  L.push(`3) ${multi.name}   ${multi.tables} tables x ${multi.chairs} chairs`)
  L.push(`   Tablet link -> "Captain" -> ${multi.captains.map(([n, p, t]) => `${n} ${p} (table ${t})`).join(', ')}`)
  L.push(`   ${pad('KITCHEN', 11)}${pad('KOT', 5)}${pad('PRINTER', 17)}${pad('WAITER PHONE (/waiter)', 24)}PIN`)
  for (const kt of KITCHENS) {
    const w = multi.waiters.find((x) => x[2] === kt.key)
    L.push(`   ${pad(kt.name + (kt.isDefault ? ' *' : ''), 11)}${pad(kt.key, 5)}${pad(`${PRINTER_IP}:${kt.port}`, 17)}${pad(w ? `${w[1]} (${w[0]})` : '-', 24)}${w ? w[3] : ''}`)
  }
  L.push('   * default kitchen: Desserts and Beverages have no kitchen, so their KOTs print here.')
  L.push('   Waiters sign in with the name ("Ravi") or the number ("04") and the PIN.')
  L.push(`   Printers: the Virtual Printers on this laptop, ports ${KITCHENS[0].port}-${KITCHENS[KITCHENS.length - 1].port}.`)
  L.push('')
  L.push(`4) ${maestro.name}   ${maestro.tables} tables x ${maestro.chairs} covers`)
  L.push(`   Tablet link -> "Captain" -> ${maestro.captains.map(([n, p, t]) => `${n} ${p} (table ${t})`).join(', ')}`)
  L.push(`   Kitchen Display ${base}/kitchen  (barker name + PIN):`)
  for (const kt of maestro.kitchens) {
    const bs = maestro.barkers.filter((b) => b[1] === kt.key).map(([n, , side, pin]) => `Barker ${side} ${n} ${pin}`).join(', ')
    L.push(`   ${pad(kt.name + (kt.isDefault ? ' *' : ''), 15)}${pad(kt.key, 5)}${pad(`${PRINTER_IP}:${kt.port}`, 17)}${bs}`)
  }
  L.push('   Stewards need no device: the KOT tells them the table and cover.')
  L.push('')
  L.push('Reset the test data: node ss-local.mjs demo      Remove: node ss-local.mjs demo --remove')
  return L.join('\n')
}

// ---------------------------------------------------------------- command

export async function demoCommand({ remove = false } = {}) {
  refuseRoot()
  const local = loadLocal()
  const snap = readJson(P.snapshot, null)
  if (!isPrepared() || !local || !snap) {
    throw new UserError('There is no test database on this laptop yet. First run:\n' +
      '  node ss-local.mjs prepare --dev            (real cloud structure, read only)\n' +
      '  node ss-local.mjs prepare --dev --standin  (no cloud connection needed)')
  }
  if (!isDevSnapshot(snap)) {
    throw new UserError('This laptop holds a real event download, not a test database, so no demo events are made here\n' +
      '(they could end up in the cloud with the event\'s orders). For testing run "node ss-local.mjs prepare --dev" first.')
  }
  let cfg = null
  try { cfg = loadConfig({ create: false }) } catch { /* defaults */ }
  const running = await serverRunning(cfg)
  const port = running?.port || cfg?.port || 8080
  const today = localDate()
  const pgb = await pgBins()

  const result = await withPostgres(pgb, local, async () => {
    const db = await connectLocal(local)
    try {
      const cols = await columnsOf(db)
      if (!cols.has('events')) throw new UserError('The test database has no "events" table. Run "node ss-local.mjs prepare --dev" again.')
      await db.query('begin')
      try {
        const deleted = await deleteDemo(db, cols)
        const st = remove ? null : await createDemo(db, cols, today)
        await db.query('commit')
        return { deleted, st }
      } catch (e) {
        await db.query('rollback').catch(() => {})
        throw e
      }
    } finally {
      await db.end().catch(() => {})
    }
  })
  updateSnapshot(snap, today, remove)

  if (remove) {
    const n = result.deleted.events || 0
    console.log(n ? `\nRemoved the ${plural(n, 'demo event')} and everything in them (orders, KOTs, menu, logins).` : '\nThere were no demo events to remove.')
    if (n) console.log(`  Rows deleted: ${Object.entries(result.deleted).map(([t, c]) => `${t} ${c}`).join(', ')}`)
    console.log('  (An admin login made by "demo" stays. Make them again with: node ss-local.mjs demo)\n')
    fs.rmSync(path.join(P.data, 'demo-logins.txt'), { force: true })
    return
  }

  const { st } = result
  const text = summary({ today, port, st, running })
  fs.writeFileSync(path.join(P.data, 'demo-logins.txt'), text + '\n')
  const removedNote = result.deleted.events ? ' (the previous demo events and their orders were replaced)' : ''
  console.log(`\nDemo events created${removedNote}: ${Object.entries(st.rows).map(([t, c]) => `${t} ${c}`).join(', ')}.`)
  if (st.missingTables.size) {
    console.log(`!! Not in this database, so left out: ${[...st.missingTables].join(', ')}.`)
    if (st.missingTables.has('kitchens')) console.log('!! The multi-kitchen tables are missing: run "node ss-local.mjs prepare --dev" (it applies ../db/*.sql).')
  }
  if (st.missingCols.size) console.log(`   Columns this database does not have (left out): ${[...st.missingCols].join(', ')}`)
  if (running) console.log('The server is running: the tablets see the demo events within a few seconds.')
  console.log('\n' + text + `\n\n(Saved in ${path.join(P.data, 'demo-logins.txt')})\n`)
}
