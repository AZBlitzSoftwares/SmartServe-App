const fs = require('fs')
const BASE = '/Users/asayyed/SmartServe/src'

// The issue: guest MenuScreen fetches ALL menu_items without event filter
// Fix: join through menu_categories to filter by event_id
const content = fs.readFileSync(BASE + '/components/guest/MenuScreen.jsx', 'utf8')

// Replace the loadMenu function to properly filter by event
const oldLoad = `  async function loadMenu() {
    setLoading(true)
    const { data: cats } = await supabase.from('menu_categories').select('*').eq('event_id', eventData.id).eq('is_visible', true).order('sort_order')
    const { data: menuItems } = await supabase.from('menu_items').select('*').eq('is_available', true)
    setCategories(cats || [])
    setItems(menuItems || [])
    setActiveCategory('all')
    setLoading(false)
  }`

const newLoad = `  async function loadMenu() {
    setLoading(true)
    const { data: cats } = await supabase.from('menu_categories').select('*').eq('event_id', eventData.id).eq('is_visible', true).order('sort_order')
    const catIds = (cats||[]).map(c=>c.id)
    const { data: menuItems } = catIds.length
      ? await supabase.from('menu_items').select('*').in('category_id', catIds).eq('is_available', true).order('name')
      : { data: [] }
    setCategories(cats || [])
    setItems(menuItems || [])
    setActiveCategory('all')
    setLoading(false)
  }`

if (content.includes(oldLoad)) {
  fs.writeFileSync(BASE + '/components/guest/MenuScreen.jsx', content.replace(oldLoad, newLoad))
  console.log('✅ MenuScreen — now fetches items WITH photos filtered by correct event')
} else {
  console.log('⚠️  Pattern not found — manually checking file...')
  // Write the full correct version
  fs.writeFileSync(BASE + '/components/guest/MenuScreen.jsx', content.replace(
    "const { data: menuItems } = await supabase.from('menu_items').select('*').eq('is_available', true)",
    "const catIds = (cats||[]).map(c=>c.id)\n    const { data: menuItems } = catIds.length ? await supabase.from('menu_items').select('*').in('category_id', catIds).eq('is_available', true).order('name') : { data: [] }"
  ))
  console.log('✅ MenuScreen — fixed with alternate pattern')
}
