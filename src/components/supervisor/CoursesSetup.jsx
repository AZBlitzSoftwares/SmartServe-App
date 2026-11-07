import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { eventCourses, cleanCourse, saveCourseOrder, renameCourse, removeCourse, moveKotCode, isDefaultCourseList } from '../../lib/courses'

/* Control › Courses & categories (guest and captain events).

   Course   = the first filter row on the tablet (Beverages, Starters, Main
              Course, Desserts …) and, with One KOT per course, one KOT each.
   Category = the counter (Chaat Counter, Tandoor, Pizzeria …): the second
              filter row, inside its course.

   Both are made here. A category put in a course gives that course to all its
   dishes, and to dishes added to it later. A counter with dishes from two
   courses shows "Mixed": its dishes keep their own course (Menu tab).
   The dishes themselves are added in the Menu tab (or imported from Excel). */

const key = s => String(s || '').trim().toLowerCase()
const box = { background:'#fff', borderRadius:14, padding:'14px 16px', marginBottom:12, boxShadow:'var(--shadow)' }
const fld = { border:'1.5px solid var(--line)', borderRadius:9, padding:'7px 10px', fontSize:13.5, minWidth:0, fontFamily:'Manrope', background:'#fff' }
const arrow = { border:'1.5px solid var(--line)', background:'#fff', borderRadius:8, width:28, height:28, fontSize:12, fontWeight:900, cursor:'pointer', padding:0, lineHeight:'24px' }
const pillBtn = (bg, fg, bd) => ({ border:'1.5px solid ' + bd, background:bg, color:fg, borderRadius:999, padding:'7px 14px', fontSize:13, fontWeight:800, cursor:'pointer', whiteSpace:'nowrap' })

export default function CoursesSetup({ eventData, onEventChange }) {
  const ev = eventData
  const [cats, setCats] = useState(null)
  const [dishes, setDishes] = useState([])
  const [hasCatCourse, setHasCatCourse] = useState(true)   // false = database without menu_categories.course
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [newCourse, setNewCourse] = useState('')
  const [newCat, setNewCat] = useState('')
  const [newCatCourse, setNewCatCourse] = useState('')
  const alive = useRef(true)

  async function load() {
    const { data: c, error } = await supabase.from('menu_categories').select('*').eq('event_id', ev.id).order('sort_order')
    if (!alive.current) return
    if (error) { setMsg('Could not read the menu: ' + error.message); return }
    setCats(c || [])
    setHasCatCourse(!(c || []).length || Object.prototype.hasOwnProperty.call(c[0], 'course'))
    const ids = (c || []).map(x => x.id)
    const { data: d } = ids.length ? await supabase.from('menu_items').select('id,category_id,course').in('category_id', ids) : { data: [] }
    if (alive.current) setDishes(d || [])
  }
  useEffect(() => {
    alive.current = true
    const t = setTimeout(load, 0)
    return () => { alive.current = false; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ev.id])

  const courses = eventCourses(ev, [...dishes.map(d => d.course), ...(cats || []).map(c => c.course)])
  const dishCount = name => dishes.filter(d => key(d.course) === key(name)).length
  const catsOfCourse = name => (cats || []).filter(c => key(c.course) === key(name) || dishes.some(d => d.category_id === c.id && key(d.course) === key(name)))
  const catDishes = c => dishes.filter(d => d.category_id === c.id)
  // the course a category shows: its own, else the one all its dishes share; '__mixed' when they differ
  const courseOfCat = c => {
    const ds = [...new Set(catDishes(c).map(d => key(d.course)).filter(Boolean))]
    if (ds.length > 1) return '__mixed'
    if (ds.length === 1) return courses.find(x => key(x) === ds[0]) || ''
    return courses.find(x => key(x) === key(c.course)) || ''
  }
  const noCourse = courses.length ? dishes.filter(d => !String(d.course || '').trim()).length : 0

  async function run(fn) {
    setBusy(true); setMsg('')
    try { await fn() } catch (e) { setMsg(e?.message || String(e)) }
    setBusy(false)
  }
  async function reloadEvent() {
    const { data } = await supabase.from('events').select('*').eq('id', ev.id).maybeSingle()
    if (data) onEventChange?.(data)
    await load()
  }
  // the event's list written out as shown (drops the unused default courses the first time)
  async function writeList(list) {
    const data = await saveCourseOrder(ev, list)
    if (data) onEventChange?.(data)
  }

  // ---------------------------------------------------------- courses
  const addCourse = () => run(async () => {
    const name = cleanCourse(newCourse)
    if (!name) return
    if (courses.some(c => key(c) === key(name))) throw new Error(name + ' is already a course.')
    await writeList([...courses, name])
    setNewCourse('')
  })
  const moveCourse = (i, dir) => run(async () => {
    const j = i + dir
    if (j < 0 || j >= courses.length) return
    const next = [...courses]; [next[i], next[j]] = [next[j], next[i]]
    await writeList(next)
  })
  const rename = (oldName, value) => {
    const nu = cleanCourse(value)
    if (!nu || nu === oldName) return
    run(async () => { await renameCourse(ev, courses, oldName, nu); await reloadEvent() })
  }
  const remove = name => {
    const n = dishCount(name)
    if (!window.confirm('Remove the course ' + name + '?' + (n ? '\n\n' + n + ' dish' + (n === 1 ? '' : 'es') + ' keep their category and have no course any more.' : ''))) return
    run(async () => { await removeCourse(ev, courses, name); await reloadEvent() })
  }

  // ---------------------------------------------------------- categories
  async function setCatCourse(c, course) {
    const list = courses
    const ds = catDishes(c)
    if (courseOfCat(c) === '__mixed' && course && !window.confirm('The dishes of ' + c.name + ' are in different courses.\n\nPut all ' + ds.length + ' of them in ' + course + '?')) return
    run(async () => {
      if (isDefaultCourseList(ev.courses) || (ev.courses || []).length !== list.length) await writeList(list)
      if (hasCatCourse) {
        const { error } = await supabase.from('menu_categories').update({ course: course || null }).eq('id', c.id)
        if (error) throw new Error('Not saved: ' + error.message)
      }
      if (ds.length) {
        const { error } = await supabase.from('menu_items').update({ course: course || null }).eq('category_id', c.id)
        if (error) throw new Error('Not saved: ' + error.message)
      }
      await load()
    })
  }
  const renameCat = (c, value) => {
    const nu = String(value || '').replace(/\s+/g, ' ').trim()
    if (!nu || nu === c.name) return
    if ((cats || []).some(x => x.id !== c.id && key(x.name) === key(nu))) { setMsg(nu + ' is already a category.'); return }
    run(async () => {
      const { error } = await supabase.from('menu_categories').update({ name: nu }).eq('id', c.id)
      if (error) throw new Error('Not saved: ' + error.message)
      try { await moveKotCode(ev.id, c.name, nu) } catch { /* the code is made again from the new name */ }
      await load()
    })
  }
  const moveCat = (i, dir) => run(async () => {
    const list = [...(cats || [])]
    const j = i + dir
    if (j < 0 || j >= list.length) return
    ;[list[i], list[j]] = [list[j], list[i]]
    setCats(list)
    const changed = list.map((c, n) => ({ c, n: n + 1 })).filter(({ c, n }) => c.sort_order !== n)
    const res = await Promise.all(changed.map(({ c, n }) => supabase.from('menu_categories').update({ sort_order: n }).eq('id', c.id)))
    const bad = res.find(r => r.error)
    if (bad) throw new Error('Not saved: ' + bad.error.message)
    await load()
  })
  const toggleVisible = c => run(async () => {
    const { error } = await supabase.from('menu_categories').update({ is_visible: c.is_visible === false }).eq('id', c.id)
    if (error) throw new Error('Not saved: ' + error.message)
    await load()
  })
  const deleteCat = c => {
    if (catDishes(c).length) { setMsg(c.name + ' still has dishes: move or delete them in the Menu tab first.'); return }
    if (!window.confirm('Delete the empty category ' + c.name + '?')) return
    run(async () => {
      const { error } = await supabase.from('menu_categories').delete().eq('id', c.id)
      if (error) throw new Error('Not deleted: ' + error.message)
      await load()
    })
  }
  const addCat = () => run(async () => {
    const name = String(newCat || '').replace(/\s+/g, ' ').trim()
    if (!name) return
    if ((cats || []).some(x => key(x.name) === key(name))) throw new Error(name + ' is already a category.')
    if (newCatCourse && (isDefaultCourseList(ev.courses) || (ev.courses || []).length !== courses.length)) await writeList(courses)
    const sort = Math.max(0, ...(cats || []).map(c => c.sort_order || 0)) + 1
    const row = { event_id: ev.id, name, sort_order: sort, is_visible: true, ...(hasCatCourse && newCatCourse ? { course: newCatCourse } : {}) }
    const { error } = await supabase.from('menu_categories').insert(row)
    if (error) throw new Error('Not added: ' + error.message)
    setNewCat('')
    await load()
  })

  if (!cats) return <div style={{ ...box, color:'var(--ink2)', fontSize:13 }}>Loading the menu…</div>

  return (
    <div data-testid="courses-setup">
      {/* ------------------------------------------------ courses */}
      <div style={box} data-testid="course-list">
        <div style={{ display:'flex', alignItems:'baseline', gap:8, marginBottom:6, flexWrap:'wrap' }}>
          <span style={{ fontWeight:900, fontSize:15 }}>Courses</span>
          <span style={{ fontSize:12.5, color:'var(--ink2)' }}>In the order they are served. This is the order of the first row on the tablet and of the KOTs.</span>
        </div>
        {!courses.length && (
          <div style={{ fontSize:13, color:'var(--ink2)', padding:'6px 0 10px' }}>
            No courses yet. A small menu does not need them. For a big menu, add courses such as Beverages, Starters, Main Course and Desserts.
          </div>
        )}
        {courses.map((c, i) => {
          const n = dishCount(c)
          const cs = catsOfCourse(c)
          return (
            <div key={c} data-course-row={c} style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', padding:'8px 0', borderTop:'1px solid var(--line)' }}>
              <span style={{ display:'flex', gap:4 }}>
                <button style={arrow} disabled={busy || i === 0} onClick={() => moveCourse(i, -1)} title="Earlier" aria-label={'Move ' + c + ' earlier'}>▲</button>
                <button style={arrow} disabled={busy || i === courses.length - 1} onClick={() => moveCourse(i, 1)} title="Later" aria-label={'Move ' + c + ' later'}>▼</button>
              </span>
              <span style={{ width:22, textAlign:'right', fontWeight:900, color:'var(--ink2)' }}>{i + 1}.</span>
              <input defaultValue={c} key={'c' + c} aria-label={'Course name ' + c} disabled={busy}
                onBlur={e => rename(c, e.target.value)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                style={{ ...fld, width:190, fontWeight:800 }} />
              <span style={{ fontSize:12, fontWeight:800, color: n ? '#15803D' : '#B45309', background: n ? '#DCFCE7' : '#FEF3C7', borderRadius:999, padding:'3px 10px' }}>
                {n} dish{n === 1 ? '' : 'es'}</span>
              <span style={{ flex:1, minWidth:120, fontSize:12, color:'var(--ink2)' }}>{cs.map(x => x.name).join(' · ')}</span>
              <button onClick={() => remove(c)} disabled={busy} style={{ border:'none', background:'none', color:'#B91C1C', fontWeight:800, fontSize:12.5, cursor:'pointer' }}>Remove</button>
            </div>
          )
        })}
        <div style={{ display:'flex', gap:8, marginTop:10, flexWrap:'wrap' }}>
          <input value={newCourse} onChange={e => setNewCourse(e.target.value)} placeholder="New course, e.g. Starters" data-testid="new-course"
            onKeyDown={e => { if (e.key === 'Enter') addCourse() }} style={{ ...fld, width:240 }} />
          <button onClick={addCourse} disabled={busy || !newCourse.trim()} data-testid="add-course" style={pillBtn('var(--ink)', '#fff', 'var(--ink)')}>+ Add course</button>
        </div>
      </div>

      {/* ------------------------------------------------ categories */}
      <div style={box} data-testid="category-list">
        <div style={{ display:'flex', alignItems:'baseline', gap:8, marginBottom:6, flexWrap:'wrap' }}>
          <span style={{ fontWeight:900, fontSize:15 }}>Categories (counters)</span>
          <span style={{ fontSize:12.5, color:'var(--ink2)' }}>
            {courses.length ? 'Put each category in its course: all its dishes take that course.' : 'The second row on the tablet. Add courses above to group them.'}
          </span>
        </div>
        {!cats.length && <div style={{ fontSize:13, color:'var(--ink2)', padding:'6px 0 10px' }}>No categories yet. Add the first one below, or import the whole menu in the Menu tab.</div>}
        {cats.map((c, i) => {
          const n = catDishes(c).length
          const cur = courseOfCat(c)
          const hidden = c.is_visible === false
          return (
            <div key={c.id} data-cat-row={c.name} style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', padding:'8px 0', borderTop:'1px solid var(--line)', opacity: hidden ? 0.65 : 1 }}>
              <span style={{ display:'flex', gap:4 }}>
                <button style={arrow} disabled={busy || i === 0} onClick={() => moveCat(i, -1)} title="Earlier" aria-label={'Move ' + c.name + ' earlier'}>▲</button>
                <button style={arrow} disabled={busy || i === cats.length - 1} onClick={() => moveCat(i, 1)} title="Later" aria-label={'Move ' + c.name + ' later'}>▼</button>
              </span>
              <input defaultValue={c.name} key={'n' + c.id + c.name} aria-label={'Category name ' + c.name} disabled={busy}
                onBlur={e => renameCat(c, e.target.value)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                style={{ ...fld, width:200, fontWeight:800 }} />
              {courses.length > 0 && (
                <select value={cur} onChange={e => e.target.value !== '__mixed' && setCatCourse(c, e.target.value)} disabled={busy} aria-label={'Course of ' + c.name}
                  style={{ ...fld, padding:'6px 8px', fontWeight:700, borderColor: cur === '' && n ? '#FDBA74' : 'var(--line)' }}>
                  {cur === '__mixed' && <option value="__mixed">Mixed (dish by dish)</option>}
                  <option value="">No course</option>
                  {courses.map(x => <option key={x} value={x}>{x}</option>)}
                </select>
              )}
              <span style={{ fontSize:12, fontWeight:700, color:'var(--ink2)' }}>{n} dish{n === 1 ? '' : 'es'}</span>
              <span style={{ flex:1 }} />
              <button onClick={() => toggleVisible(c)} disabled={busy} title="Show or hide on the tablets"
                style={{ fontSize:11.5, fontWeight:800, padding:'3px 10px', borderRadius:999, cursor:'pointer', border:'none',
                  background: hidden ? '#FEF2F2' : '#F0FDF4', color: hidden ? '#DC2626' : '#16A34A' }}>{hidden ? 'HIDDEN' : 'LIVE'}</button>
              <button onClick={() => deleteCat(c)} disabled={busy} style={{ border:'none', background:'none', color:'#B91C1C', fontWeight:800, fontSize:12.5, cursor:'pointer' }}>Delete</button>
            </div>
          )
        })}
        <div style={{ display:'flex', gap:8, marginTop:10, flexWrap:'wrap' }}>
          <input value={newCat} onChange={e => setNewCat(e.target.value)} placeholder="New category, e.g. Chaat Counter" data-testid="new-category"
            onKeyDown={e => { if (e.key === 'Enter') addCat() }} style={{ ...fld, width:240 }} />
          {courses.length > 0 && hasCatCourse && (
            <select value={newCatCourse} onChange={e => setNewCatCourse(e.target.value)} aria-label="Course of the new category" style={{ ...fld, padding:'6px 8px' }}>
              <option value="">No course</option>
              {courses.map(x => <option key={x} value={x}>in {x}</option>)}
            </select>
          )}
          <button onClick={addCat} disabled={busy || !newCat.trim()} data-testid="add-category" style={pillBtn('#FEF3C7', '#92400E', '#FCD34D')}>+ Add category</button>
        </div>
        {noCourse > 0 && (
          <div style={{ marginTop:10, fontSize:12.5, fontWeight:700, color:'#B45309' }}>
            {noCourse} dish{noCourse === 1 ? ' has' : 'es have'} no course: {noCourse === 1 ? 'it shows' : 'they show'} only under All on the tablet{ev.kot_per_course ? ' and print' + (noCourse === 1 ? 's' : '') + ' by category' : ''}.
          </div>
        )}
        {!hasCatCourse && courses.length > 0 && (
          <div style={{ marginTop:8, fontSize:12, color:'#B45309' }}>Run db/2026-11-08_courses.sql in Supabase so an empty category can keep its course.</div>
        )}
      </div>

      <div style={{ fontSize:12.5, color:'var(--ink2)', margin:'-4px 2px 12px', lineHeight:1.5 }}>
        Dishes are added in the <b>Menu</b> tab (one by one, or a whole Excel sheet with Dish, Category, Course columns). A dish in a mixed counter can take its own course there.
        {ev.kot_per_category ? <> KOT codes and printers per course: <b>KOT printing</b> below.</> : null}
      </div>
      {msg && <div style={{ ...box, background:'#FEF2F2', color:'#B91C1C', fontWeight:700, fontSize:13 }}>{msg}</div>}
    </div>
  )
}
