import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { parseDelimited, menuRows, matchCourse } from '../../lib/sheetImport'
import { coursesOf } from '../../maestro/msData'

/* Import a whole menu from a spreadsheet, with a preview before anything is
   written.

   The preview is the point: a 250-dish menu imported blind and wrong takes
   longer to clean up than to type. It shows what each column was read as,
   which courses and cuisines will be used or created, and how many dishes
   already exist (updated in place, or skipped). Only then does Import write,
   in a few bulk calls rather than one call per dish. */

const box = { background:'#fff', borderRadius:16, padding:20, width:'100%', maxWidth:860, maxHeight:'92vh', overflowY:'auto', boxSizing:'border-box' }
const pill = (bg, fg, bd) => ({ display:'inline-block', background:bg, color:fg, border:'1px solid ' + bd, borderRadius:999, padding:'2px 9px', fontSize:11.5, fontWeight:800, margin:'0 6px 6px 0' })
const btn = { border:'none', borderRadius:10, padding:'10px 16px', fontSize:13.5, fontWeight:800, cursor:'pointer', fontFamily:'Manrope' }
const COL_LABEL = { name:'Dish', category:'Cuisine', course:'Course', description:'Description', veg:'Veg', barker:'Barker', live:'Live counter', photo:'Image' }

export default function MenuImport({ eventData, rows: givenRows, fileName, onClose, onDone, onEventChange }) {
  const isMs = !!eventData?.maestro
  const courses = coursesOf(eventData)
  const [text, setText] = useState('')
  const [rows, setRows] = useState(givenRows || null)
  const [existing, setExisting] = useState('update')
  const [addCourses, setAddCourses] = useState(true)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [err, setErr] = useState('')

  const parsed = useMemo(() => rows ? menuRows(rows) : null, [rows])

  // Courses and cuisines as they will be written
  const plan = useMemo(() => {
    if (!parsed) return null
    const newCourses = []
    const titleCase = t => t === t.toUpperCase() ? t.charAt(0) + t.slice(1).toLowerCase() : t
    const dishes = parsed.dishes.map(d => {
      let rawCourse = isMs ? d.course || '' : ''
      let category = d.category
      if (isMs) {
        // a heading row such as "SOUPS" is the course when it names one, otherwise the cuisine
        if (!rawCourse && d.section && matchCourse(d.section, courses)) rawCourse = d.section
        else if (!category && d.section) category = titleCase(d.section)
      } else if (!category) {
        // events without courses: a heading ("STARTERS") or a Course column is the menu category
        category = d.section ? titleCase(d.section) : d.course ? titleCase(d.course) : ''
      }
      let course = rawCourse ? matchCourse(rawCourse, courses) : null
      if (rawCourse && !course) {
        const label = rawCourse.trim().replace(/\s+/g, ' ')
        const nice = label === label.toUpperCase() ? label.charAt(0) + label.slice(1).toLowerCase() : label
        if (!newCourses.some(c => c.toLowerCase() === nice.toLowerCase())) newCourses.push(nice)
        course = newCourses.find(c => c.toLowerCase() === nice.toLowerCase())
      }
      // hasCat: the sheet said which cuisine; only then does an existing dish change category
      return { ...d, category: category || 'General', hasCat: !!category, courseOut: course, courseIsNew: !!course && !courses.includes(course) }
    })
    const seen = new Set(), dupes = []
    const unique = dishes.filter(d => { const k = d.name.toLowerCase(); if (seen.has(k)) { dupes.push(d.name); return false } seen.add(k); return true })
    return { dishes: unique, dupes, newCourses }
  }, [parsed, courses, isMs])

  const [existingNames, setExistingNames] = useState(null)
  const [existingCats, setExistingCats] = useState([])
  useEffect(() => {
    if (!plan) return
    ;(async () => {
      try {
        const { data: cats, error: e1 } = await supabase.from('menu_categories').select('id, name').eq('event_id', eventData.id)
        if (e1) throw e1
        const ids = (cats || []).map(c => c.id)
        const { data: items, error: e2 } = ids.length ? await supabase.from('menu_items').select('id, name').in('category_id', ids) : { data: [] }
        if (e2) throw e2
        setExistingCats(cats || [])
        setExistingNames(new Map((items || []).map(i => [i.name.toLowerCase().trim(), i.id])))
      } catch (e) {
        // the preview still works; Import re-reads the menu itself before writing
        setErr('Could not read the current menu (' + (e?.message || 'no connection') + '). Dishes already on the menu are checked again when you press Import.')
        setExistingCats([]); setExistingNames(new Map())
      }
    })()
  }, [plan, eventData.id])

  function readPaste() {
    setErr('')
    const r = parseDelimited(text)
    if (!r.length) { setErr('Nothing to read. Copy the rows in Excel (including the header row) and paste them here.'); return }
    setRows(r)
  }

  const catCounts = useMemo(() => {
    const m = new Map()
    plan?.dishes.forEach(d => m.set(d.category, (m.get(d.category) || 0) + 1))
    return [...m.entries()]
  }, [plan])
  const courseCounts = useMemo(() => {
    const m = new Map()
    plan?.dishes.forEach(d => { const k = d.courseOut || '— no course'; m.set(k, (m.get(k) || 0) + 1) })
    return [...m.entries()]
  }, [plan])
  const isExisting = d => existingNames?.has(d.name.toLowerCase().trim())
  const nExisting = plan && existingNames ? plan.dishes.filter(isExisting).length : 0
  const nNew = plan ? plan.dishes.length - nExisting : 0
  const noCourse = plan?.dishes.filter(d => !d.courseOut).length || 0
  const catKnown = name => existingCats.some(c => c.name.toLowerCase() === name.toLowerCase())

  async function run() {
    if (!plan?.dishes.length) return
    setBusy(true); setErr('')
    try {
      // 1. new courses go on the event, after the existing ones (reorder them under Control)
      let courseList = courses
      if (isMs && plan.newCourses.length && addCourses) {
        setProgress('Adding courses…')
        courseList = [...courses, ...plan.newCourses]
        const { data, error } = await supabase.from('events').update({ courses: courseList }).eq('id', eventData.id).select('*').maybeSingle()
        if (error) throw error
        if (data && onEventChange) onEventChange(data)
      }
      const courseFor = d => isMs && d.courseOut && courseList.includes(d.courseOut) ? d.courseOut : null

      // 2. cuisines (menu categories)
      setProgress('Creating cuisines…')
      const { data: cats, error: ce } = await supabase.from('menu_categories').select('id, name, sort_order').eq('event_id', eventData.id)
      if (ce) throw ce
      const catId = new Map((cats || []).map(c => [c.name.toLowerCase(), c.id]))
      const missing = [...new Set(plan.dishes.map(d => d.category))].filter(n => !catId.has(n.toLowerCase()))
      let sort = Math.max(0, ...(cats || []).map(c => c.sort_order || 0))
      if (missing.length) {
        const { data: made, error } = await supabase.from('menu_categories')
          .insert(missing.map(name => ({ event_id: eventData.id, name, sort_order: ++sort, is_visible: true }))).select('id, name')
        if (error) throw error
        made.forEach(c => catId.set(c.name.toLowerCase(), c.id))
      }

      // 3. dishes: new ones in bulk, existing ones updated (or skipped)
      const ids = [...catId.values()]
      const { data: have } = await supabase.from('menu_items').select('id, name').in('category_id', ids)
      const byName = new Map((have || []).map(i => [i.name.toLowerCase().trim(), i.id]))
      const fresh = [], updates = []
      for (const d of plan.dishes) {
        const row = { category_id: catId.get(d.category.toLowerCase()), name: d.name, description: d.description || '',
          is_veg: d.is_veg, is_live_counter: d.is_live_counter, photo_url: d.photo_url }
        if (isMs) { row.course = courseFor(d); if (d.barker) row.barker = d.barker }
        const id = byName.get(d.name.toLowerCase().trim())
        if (!id) fresh.push({ ...row, is_available: true })
        else if (existing === 'update') {
          const patch = d.hasCat ? { category_id: row.category_id } : {}
          if (parsed.cols.description != null && d.description) patch.description = d.description
          if (parsed.cols.veg != null) patch.is_veg = d.is_veg
          if (isMs && row.course) patch.course = row.course
          if (isMs && d.barker) patch.barker = d.barker
          if (d.photo_url) patch.photo_url = d.photo_url
          if (Object.keys(patch).length) updates.push([id, patch])
        }
      }
      let added = 0, updated = 0
      for (let i = 0; i < fresh.length; i += 100) {
        setProgress('Adding dishes ' + (i + 1) + '–' + Math.min(fresh.length, i + 100) + ' of ' + fresh.length + '…')
        const { error } = await supabase.from('menu_items').insert(fresh.slice(i, i + 100))
        if (error) throw error
        added += Math.min(100, fresh.length - i)
      }
      for (let i = 0; i < updates.length; i += 20) {
        setProgress('Updating dishes ' + (i + 1) + '–' + Math.min(updates.length, i + 20) + ' of ' + updates.length + '…')
        const res = await Promise.all(updates.slice(i, i + 20).map(([id, patch]) => supabase.from('menu_items').update(patch).eq('id', id)))
        const bad = res.find(r => r.error)
        if (bad) throw bad.error
        updated += res.length
      }

      // 4. the shared dish library, best effort
      try {
        setProgress('Filing new dishes in the Food Master…')
        const names = fresh.map(d => d.name)
        const known = new Set()
        for (let i = 0; i < names.length; i += 100) {
          const { data } = await supabase.from('food_master').select('name').in('name', names.slice(i, i + 100))
          ;(data || []).forEach(r => known.add(String(r.name).toLowerCase()))
        }
        const lib = fresh.filter(d => !known.has(d.name.toLowerCase())).map(d => ({ name: d.name, description: d.description || null,
          category: plan.dishes.find(x => x.name === d.name)?.category || 'General', is_veg: d.is_veg, photo_url: d.photo_url || null }))
        for (let i = 0; i < lib.length; i += 100) await supabase.from('food_master').insert(lib.slice(i, i + 100))
      } catch { /* the library must never block a menu import */ }

      onDone({ added, updated, skipped: existing === 'skip' ? nExisting : 0, dupes: plan.dupes.length, newCats: missing.length,
        newCourses: isMs && addCourses ? plan.newCourses : [] })
    } catch (e) {
      setErr('Import stopped: ' + (e?.message || String(e)) + '. Dishes added before this point are kept; importing again updates them.')
    }
    setBusy(false); setProgress('')
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:120, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div style={box}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, marginBottom:12 }}>
          <div>
            <h3 style={{ fontSize:18, fontWeight:900 }}>{rows ? 'Check the menu before importing' : 'Paste the menu from Excel'}</h3>
            <div style={{ fontSize:12.5, color:'var(--ink2)', marginTop:3 }}>
              {rows ? (fileName ? fileName + ' · ' : '') + 'Nothing is saved until you press Import.'
                : 'In Excel, select the rows including the header row (Dish, Cuisine, Course, Description, Veg), copy, and paste below.'}
            </div>
          </div>
          <button onClick={onClose} disabled={busy} style={{ background:'none', border:'none', fontSize:20, cursor:'pointer', color:'#888' }}>✕</button>
        </div>

        {!rows && (
          <>
            <textarea value={text} onChange={e => setText(e.target.value)} autoFocus
              placeholder={'Dish\tCuisine\tCourse\tDescription\tVeg\nCream of Tomato\tContinental\tSoup\tBasil, croutons\tVeg'}
              style={{ width:'100%', height:260, boxSizing:'border-box', border:'1.5px solid var(--line)', borderRadius:12, padding:12,
                fontFamily:'ui-monospace, Menlo, monospace', fontSize:12.5, outline:'none', resize:'vertical' }} />
            <div style={{ display:'flex', gap:8, marginTop:12 }}>
              <button onClick={readPaste} disabled={!text.trim()} style={{ ...btn, background:'var(--ink)', color:'#fff', flex:1, opacity: text.trim() ? 1 : 0.5 }}>Read rows</button>
              <button onClick={onClose} style={{ ...btn, background:'var(--bg)', border:'1.5px solid var(--line)', flex:1 }}>Cancel</button>
            </div>
          </>
        )}

        {err && <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', color:'#B91C1C', borderRadius:10, padding:'9px 12px', fontSize:13, fontWeight:700, margin:'10px 0' }}>{err}</div>}

        {parsed && (parsed.problems.length ? (
          <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', color:'#B91C1C', borderRadius:10, padding:'10px 12px', fontSize:13, fontWeight:700 }}>
            {parsed.problems.join(' ')}
            <div style={{ marginTop:10 }}><button onClick={() => { setRows(null) }} style={{ ...btn, background:'#fff', border:'1.5px solid #FECACA', color:'#B91C1C' }}>Try again</button></div>
          </div>
        ) : plan && (
          <>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(150px, 1fr))', gap:8, marginBottom:12 }}>
              {[[plan.dishes.length, 'dishes in the sheet', 'var(--ink)'], [existingNames ? nNew : '…', 'new', '#16A34A'],
                [existingNames ? nExisting : '…', 'already on the menu', '#2563EB'],
                ...(isMs ? [[noCourse, 'without a course', noCourse ? '#B45309' : '#16A34A']] : [])].map(([n, l, c]) => (
                <div key={l} style={{ background:'var(--bg)', borderRadius:10, padding:'8px 10px', textAlign:'center' }}>
                  <div style={{ fontSize:20, fontWeight:900, color:c }}>{n}</div>
                  <div style={{ fontSize:11, fontWeight:800, color:'var(--ink2)', textTransform:'uppercase', letterSpacing:'.3px' }}>{l}</div>
                </div>
              ))}
            </div>

            <div style={{ fontSize:12.5, marginBottom:8 }}>
              <b>Columns read:</b>{' '}
              {Object.keys(parsed.cols).map(k => <span key={k} style={pill('#F0FDF4', '#15803D', '#BBF7D0')}>{COL_LABEL[k]}</span>)}
              {isMs && parsed.cols.course == null && <span style={pill('#FFF7ED', '#B45309', '#FED7AA')}>No Course column</span>}
            </div>
            {parsed.headings?.length > 0 && (
              <div style={{ fontSize:12.5, marginBottom:8, color:'var(--ink2)' }}>
                <b style={{ color:'var(--ink)' }}>Read as headings, not dishes:</b> {parsed.headings.slice(0, 10).join(', ')}{parsed.headings.length > 10 ? '…' : ''}
              </div>
            )}

            {isMs && (
              <div style={{ fontSize:12.5, marginBottom:8 }}>
                <b>Courses:</b>{' '}
                {courseCounts.map(([c, n]) => (
                  <span key={c} style={c.startsWith('—') ? pill('#FFF7ED', '#B45309', '#FED7AA')
                    : plan.newCourses.includes(c) ? pill('#EFF6FF', '#1D4ED8', '#BFDBFE') : pill('#fff', 'var(--ink)', 'var(--line)')}>
                    {c} · {n}{plan.newCourses.includes(c) ? ' · new' : ''}</span>
                ))}
                {plan.newCourses.length > 0 && (
                  <label style={{ display:'flex', gap:8, alignItems:'center', fontSize:12.5, fontWeight:700, margin:'2px 0 4px' }}>
                    <input type="checkbox" checked={addCourses} onChange={e => setAddCourses(e.target.checked)} />
                    Add {plan.newCourses.join(', ')} to this event’s courses (after {courses[courses.length - 1]}; change the order under Control)
                  </label>
                )}
                {noCourse > 0 && <div style={{ color:'#B45309', fontWeight:700 }}>Dishes without a course cannot be fired; give them one in the menu list after importing.</div>}
              </div>
            )}

            <div style={{ fontSize:12.5, marginBottom:10 }}>
              <b>Cuisines:</b>{' '}
              {catCounts.map(([c, n]) => (
                <span key={c} style={catKnown(c) ? pill('#fff', 'var(--ink)', 'var(--line)') : pill('#EFF6FF', '#1D4ED8', '#BFDBFE')}>{c} · {n}{catKnown(c) ? '' : ' · new'}</span>
              ))}
              {parsed.cols.category == null && <span style={{ color:'var(--ink2)' }}>No Cuisine column: dishes go under headings in the sheet, or General.</span>}
            </div>

            {plan.dupes.length > 0 && (
              <div style={{ fontSize:12.5, color:'#B45309', fontWeight:700, marginBottom:8 }}>
                Listed twice in the sheet, imported once: {plan.dupes.slice(0, 6).join(', ')}{plan.dupes.length > 6 ? ' and ' + (plan.dupes.length - 6) + ' more' : ''}
              </div>
            )}

            {nExisting > 0 && (
              <div style={{ display:'flex', gap:14, flexWrap:'wrap', alignItems:'center', fontSize:13, marginBottom:10 }}>
                <b>{nExisting} already on the menu:</b>
                <label><input type="radio" checked={existing === 'update'} onChange={() => setExisting('update')} /> update them from the sheet</label>
                <label><input type="radio" checked={existing === 'skip'} onChange={() => setExisting('skip')} /> leave them as they are</label>
              </div>
            )}

            <div style={{ border:'1px solid var(--line)', borderRadius:10, overflow:'hidden', marginBottom:14 }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12.5 }}>
                <thead><tr style={{ background:'var(--ink)', color:'#fff', textAlign:'left' }}>
                  <th style={{ padding:'7px 10px' }}>Dish</th><th style={{ padding:'7px 10px' }}>Cuisine</th>
                  {isMs && <th style={{ padding:'7px 10px' }}>Course</th>}<th style={{ padding:'7px 10px' }}>Veg</th><th style={{ padding:'7px 10px' }} />
                </tr></thead>
                <tbody>
                  {plan.dishes.slice(0, 12).map((d, i) => (
                    <tr key={i} style={{ borderTop:'1px solid var(--line)', background: i % 2 ? '#FAFAF9' : '#fff' }}>
                      <td style={{ padding:'6px 10px', fontWeight:700 }}>{d.name}{d.description && <div style={{ fontWeight:500, color:'var(--ink2)', fontSize:11.5 }}>{d.description}</div>}</td>
                      <td style={{ padding:'6px 10px' }}>{d.category}</td>
                      {isMs && <td style={{ padding:'6px 10px', color: d.courseOut ? 'inherit' : '#B45309', fontWeight: d.courseOut ? 500 : 800 }}>{d.courseOut || 'none'}</td>}
                      <td style={{ padding:'6px 10px', color: d.is_veg ? '#16A34A' : '#DC2626', fontWeight:800 }}>{d.is_veg ? 'Veg' : 'Non-veg'}</td>
                      <td style={{ padding:'6px 10px', color:'#2563EB', fontWeight:700, fontSize:11.5 }}>{isExisting(d) ? (existing === 'update' ? 'update' : 'skip') : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {plan.dishes.length > 12 && <div style={{ padding:'6px 10px', fontSize:12, color:'var(--ink2)', background:'var(--bg)' }}>…and {plan.dishes.length - 12} more</div>}
            </div>

            <div style={{ display:'flex', gap:8 }}>
              <button onClick={run} disabled={busy || !existingNames} style={{ ...btn, background:'#16A34A', color:'#fff', flex:2, opacity: busy ? 0.7 : 1 }}>
                {busy ? (progress || 'Importing…') : 'Import ' + (existing === 'update' ? plan.dishes.length : nNew) + ' dishes'}</button>
              {!givenRows && <button onClick={() => setRows(null)} disabled={busy} style={{ ...btn, background:'#fff', border:'1.5px solid var(--line)', flex:1 }}>Back</button>}
              <button onClick={onClose} disabled={busy} style={{ ...btn, background:'var(--bg)', border:'1.5px solid var(--line)', flex:1 }}>Cancel</button>
            </div>
          </>
        ))}
      </div>
    </div>
  )
}
