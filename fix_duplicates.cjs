const fs = require('fs')
const BASE = '/Users/asayyed/SmartServe/src'

// Read MenuManager
const mmPath = BASE + '/components/supervisor/MenuManager.jsx'
let content = fs.readFileSync(mmPath, 'utf8')

// FIX 1: CSV import — check against ALL items in this event before inserting
content = content.replace(
  `    let added=0, skipped=0, errors=[]
    function splitLine(line) { const r=[]; let cur=''; let q=false; for(let i=0;i<line.length;i++){if(line[i]==='"'){q=!q}else if(line[i]===','&&!q){r.push(cur.trim());cur=''}else{cur+=line[i]}} r.push(cur.trim()); return r }

    for (let i=1; i<lines.length; i++) {
      try {
        const cols = splitLine(lines[i])
        const itemName = cols[nameIdx]?.replace(/^"|"$/g,'').trim(); if (!itemName) { skipped++; continue }
        const desc    = descIdx>=0 ? cols[descIdx]?.replace(/^"|"$/g,'').trim()||'' : ''
        const catName = catIdx>=0  ? cols[catIdx]?.replace(/^"|"$/g,'').trim()||'General' : 'General'
        const isLive  = liveIdx>=0 ? ['yes','true','1','y'].includes((cols[liveIdx]?.replace(/^"|"$/g,'')||'').toLowerCase().trim()) : false
        const vegVal  = vegIdx>=0  ? (cols[vegIdx]?.replace(/^"|"$/g,'')||'yes').toLowerCase().trim() : 'yes'
        const isVeg   = !['no','false','0','nonveg','non-veg','n'].includes(vegVal)
        const imgUrl  = imgIdx>=0  ? cols[imgIdx]?.replace(/^"|"$/g,'').trim()||'' : ''

        const catKey = catName.toLowerCase()
        if (!catCache[catKey]) {
          const { data: nc, error: ce } = await supabase.from('menu_categories').insert({ event_id:eventData.id, name:catName, sort_order:Object.keys(catCache).length+1, is_visible:true }).select().single()
          if (ce) { errors.push('Category "'+catName+'": '+ce.message); skipped++; continue }
          catCache[catKey] = nc.id
        }
        const { error: ie } = await supabase.from('menu_items').insert({ category_id:catCache[catKey], name:itemName, description:desc, is_live_counter:isLive, is_veg:isVeg, photo_url:imgUrl||null, is_available:true })
        if (ie) { errors.push(itemName+': '+ie.message); skipped++ } else added++
      } catch(err) { errors.push('Row '+(i+1)+': '+err.message); skipped++ }
    }`,
  `    // Load ALL existing item names for this event upfront for fast dedup check
    const { data: freshCatsFull } = await supabase.from('menu_categories').select('id').eq('event_id', eventData.id)
    const allCatIds = (freshCatsFull||[]).map(c=>c.id)
    const { data: existingItemsFull } = allCatIds.length
      ? await supabase.from('menu_items').select('name').in('category_id', allCatIds)
      : { data: [] }
    const existingNames = new Set((existingItemsFull||[]).map(i=>i.name.toLowerCase().trim()))

    let added=0, skipped=0, errors=[]
    function splitLine(line) { const r=[]; let cur=''; let q=false; for(let i=0;i<line.length;i++){if(line[i]==='"'){q=!q}else if(line[i]===','&&!q){r.push(cur.trim());cur=''}else{cur+=line[i]}} r.push(cur.trim()); return r }

    for (let i=1; i<lines.length; i++) {
      try {
        const cols = splitLine(lines[i])
        const itemName = cols[nameIdx]?.replace(/^"|"$/g,'').trim(); if (!itemName) { skipped++; continue }

        // DEDUP CHECK — skip if item already exists in this event (case-insensitive)
        if (existingNames.has(itemName.toLowerCase().trim())) { skipped++; continue }

        const desc    = descIdx>=0 ? cols[descIdx]?.replace(/^"|"$/g,'').trim()||'' : ''
        const catName = catIdx>=0  ? cols[catIdx]?.replace(/^"|"$/g,'').trim()||'General' : 'General'
        const isLive  = liveIdx>=0 ? ['yes','true','1','y'].includes((cols[liveIdx]?.replace(/^"|"$/g,'')||'').toLowerCase().trim()) : false
        const vegVal  = vegIdx>=0  ? (cols[vegIdx]?.replace(/^"|"$/g,'')||'yes').toLowerCase().trim() : 'yes'
        const isVeg   = !['no','false','0','nonveg','non-veg','n'].includes(vegVal)
        const imgUrl  = imgIdx>=0  ? cols[imgIdx]?.replace(/^"|"$/g,'').trim()||'' : ''

        const catKey = catName.toLowerCase()
        if (!catCache[catKey]) {
          const { data: nc, error: ce } = await supabase.from('menu_categories').insert({ event_id:eventData.id, name:catName, sort_order:Object.keys(catCache).length+1, is_visible:true }).select().single()
          if (ce) { errors.push('Category "'+catName+'": '+ce.message); skipped++; continue }
          catCache[catKey] = nc.id
        }
        const { error: ie } = await supabase.from('menu_items').insert({ category_id:catCache[catKey], name:itemName, description:desc, is_live_counter:isLive, is_veg:isVeg, photo_url:imgUrl||null, is_available:true })
        if (ie) { errors.push(itemName+': '+ie.message); skipped++ }
        else { added++; existingNames.add(itemName.toLowerCase().trim()) } // track newly added too
      } catch(err) { errors.push('Row '+(i+1)+': '+err.message); skipped++ }
    }`
)

// FIX 2: Copy from Event — dedup check before inserting each item
content = content.replace(
  `              for (const item of srcItems) {
                const srcCat = srcCats.find(c=>c.id===item.category_id)
                const catKey = (srcCat?.name||'General').toLowerCase()
                if (!catCache[catKey]) {
                  const { data: nc } = await supabase.from('menu_categories').insert({ event_id:eventData.id, name:srcCat?.name||'General', sort_order:Object.keys(catCache).length+1, is_visible:true }).select().single()
                  if (nc) catCache[catKey] = nc.id
                }
                // Check for duplicate by name in this event
              const alreadyExists = items.some(ex => ex.name.toLowerCase() === item.name.toLowerCase())
              if (!alreadyExists) {
                await supabase.from('menu_items').insert({ category_id:catCache[catKey], name:item.name, description:item.description, is_veg:item.is_veg, is_live_counter:item.is_live_counter, photo_url:item.photo_url, is_available:true })
              }
              }`,
  `              // Load existing names for dedup
              const { data: destCatsFull } = await supabase.from('menu_categories').select('id').eq('event_id', eventData.id)
              const destCatIds = (destCatsFull||[]).map(c=>c.id)
              const { data: destItemsFull } = destCatIds.length ? await supabase.from('menu_items').select('name').in('category_id', destCatIds) : { data:[] }
              const destNames = new Set((destItemsFull||[]).map(i=>i.name.toLowerCase().trim()))
              let copyAdded=0, copySkipped=0

              for (const item of srcItems) {
                // Skip duplicates
                if (destNames.has(item.name.toLowerCase().trim())) { copySkipped++; continue }
                const srcCat = srcCats.find(c=>c.id===item.category_id)
                const catKey = (srcCat?.name||'General').toLowerCase()
                if (!catCache[catKey]) {
                  const { data: nc } = await supabase.from('menu_categories').insert({ event_id:eventData.id, name:srcCat?.name||'General', sort_order:Object.keys(catCache).length+1, is_visible:true }).select().single()
                  if (nc) catCache[catKey] = nc.id
                }
                await supabase.from('menu_items').insert({ category_id:catCache[catKey], name:item.name, description:item.description, is_veg:item.is_veg, is_live_counter:item.is_live_counter, photo_url:item.photo_url, is_available:true })
                destNames.add(item.name.toLowerCase().trim())
                copyAdded++
              }`
)

// FIX 3: Copy from event success message — show skipped count
content = content.replace(
  `              alert('✅ Copied ' + srcItems.length + ' items!')`,
  `              alert('✅ Copied ' + copyAdded + ' items!' + (copySkipped>0?' Skipped '+copySkipped+' duplicates.':''))`
)

// FIX 4: FoodMaster addToEvent — dedup check
const fmPath = BASE + '/components/supervisor/FoodMaster.jsx'
let fmContent = fs.readFileSync(fmPath, 'utf8')

fmContent = fmContent.replace(
  `    for (const food of selectedFoods) {
      const catKey = (food.category||'General').toLowerCase()
      if (!catCache[catKey]) {
        const { data: newCat } = await supabase.from('menu_categories')
          .insert({ event_id:eventData.id, name:food.category||'General', sort_order:Object.keys(catCache).length+1, is_visible:true })
          .select().single()
        if (newCat) catCache[catKey] = newCat.id
      }
      await supabase.from('menu_items').insert({
        category_id: catCache[catKey],
        name: food.name,
        description: food.description||null,
        is_veg: food.is_veg,
        is_live_counter: false,
        photo_url: food.photo_url||null,
        is_available: true
      })
    }
    alert('✅ Added ' + selected.size + ' items to ' + eventData.name)`,
  `    // Load existing item names to prevent duplicates
    const { data: existCats } = await supabase.from('menu_categories').select('id').eq('event_id', eventData.id)
    const existCatIds = (existCats||[]).map(c=>c.id)
    const { data: existItems } = existCatIds.length ? await supabase.from('menu_items').select('name').in('category_id', existCatIds) : { data:[] }
    const existNames = new Set((existItems||[]).map(i=>i.name.toLowerCase().trim()))

    let fmAdded=0, fmSkipped=0
    for (const food of selectedFoods) {
      if (existNames.has(food.name.toLowerCase().trim())) { fmSkipped++; continue }
      const catKey = (food.category||'General').toLowerCase()
      if (!catCache[catKey]) {
        const { data: newCat } = await supabase.from('menu_categories')
          .insert({ event_id:eventData.id, name:food.category||'General', sort_order:Object.keys(catCache).length+1, is_visible:true })
          .select().single()
        if (newCat) catCache[catKey] = newCat.id
      }
      await supabase.from('menu_items').insert({
        category_id: catCache[catKey],
        name: food.name,
        description: food.description||null,
        is_veg: food.is_veg,
        is_live_counter: false,
        photo_url: food.photo_url||null,
        is_available: true
      })
      existNames.add(food.name.toLowerCase().trim())
      fmAdded++
    }
    alert('✅ Added ' + fmAdded + ' items to ' + eventData.name + (fmSkipped>0?' · Skipped '+fmSkipped+' duplicates':''))`
)

fs.writeFileSync(mmPath, content)
fs.writeFileSync(fmPath, fmContent)

console.log('✅ Duplicate fix applied to:')
console.log('   - CSV Import (checks ALL existing items before inserting)')
console.log('   - Copy from Event (skips items that already exist by name)')
console.log('   - Food Master (skips items already in this event)')
console.log('   All checks are case-insensitive')
console.log('\nRun: npm run dev to test')
