import { supabase } from './supabase'
import { DEFAULT_COURSES } from '../maestro/msData'

/* Courses of a guest or captain event.

   The course is kept on each dish (menu_items.course) and the order of the
   courses on the event (events.courses). Every event row is born with the
   Maestro default list (First Course, Soup, Starters, Mains, Dessert), so on a
   guest or captain event that list means nothing until someone sets courses:
   then only the default courses that dishes really use count.

   courses = the event's courses in order: its list (or, while it is still the
   default, the part of it the dishes use), then any course a dish has that is
   not in the list yet (for example set by an import). */

const key = s => String(s || '').trim().toLowerCase()
export const cleanCourse = s => String(s || '').replace(/\s+/g, ' ').trim()

export function isDefaultCourseList(list) {
  const a = (Array.isArray(list) ? list : []).map(String)
  return a.length === DEFAULT_COURSES.length && a.every((c, i) => c === DEFAULT_COURSES[i])
}

export function eventCourses(ev, dishCourses = []) {
  const used = [...new Set(dishCourses.map(cleanCourse).filter(Boolean))]
  const usedKeys = new Set(used.map(key))
  const list = (Array.isArray(ev?.courses) ? ev.courses : []).map(cleanCourse).filter(Boolean)
  const base = isDefaultCourseList(ev?.courses) ? list.filter(c => usedKeys.has(key(c))) : list
  const out = []
  for (const c of [...base, ...used]) if (!out.some(x => key(x) === key(c))) out.push(c)
  return out
}

// Saves the order (and the set) of the courses on the event; returns the event row
export async function saveCourseOrder(ev, list) {
  const { data, error } = await supabase.from('events').update({ courses: list }).eq('id', ev.id).select('*').maybeSingle()
  if (error) throw error
  return data
}

/* Rename a course everywhere: the event's order, the dishes, the printer it
   prints on and its KOT code (db/2026-11-08_courses.sql). On a database
   without that update the dishes, order and printer are changed here; the
   KOT code then starts again from the new name. */
export async function renameCourse(ev, list, oldName, newName) {
  const nu = cleanCourse(newName)
  if (!nu) throw new Error('A course needs a name.')
  if (key(nu) !== key(oldName) && list.some(c => key(c) === key(nu))) throw new Error(nu + ' is already a course.')
  // the event must list the course first, so it keeps its place
  const ordered = list.map(c => (key(c) === key(oldName) ? oldName : c))
  await saveCourseOrder(ev, ordered)
  const { error } = await supabase.rpc('ss_course_rename', { p_event: ev.id, p_old: oldName, p_new: nu })
  if (!error) return { codeMoved: true }
  if (/NAME_TAKEN/.test(error.message || '')) throw new Error(nu + ' is already a course.')
  if (!/ss_course_rename|function|schema cache|PGRST202/i.test((error.message || '') + (error.code || ''))) throw error
  // older database: do it here
  await saveCourseOrder(ev, list.map(c => (key(c) === key(oldName) ? nu : c)))
  const catIds = await eventCategoryIds(ev.id)
  if (catIds.length) {
    const { error: e2 } = await supabase.from('menu_items').update({ course: nu }).in('category_id', catIds).eq('course', oldName)
    if (e2) throw e2
    // categories carry a course only after the database update; nothing to do without it
    await supabase.from('menu_categories').update({ course: nu }).eq('event_id', ev.id).eq('course', oldName)
  }
  const { data: ks } = await supabase.from('kitchens').select('id,courses').eq('event_id', ev.id)
  for (const k of ks || []) {
    const cs = Array.isArray(k.courses) ? k.courses : []
    if (cs.some(c => key(c) === key(oldName))) await supabase.from('kitchens').update({ courses: cs.map(c => (key(c) === key(oldName) ? nu : c)) }).eq('id', k.id)
  }
  return { codeMoved: false }
}

// Remove a course: its dishes keep their category and have no course any more
export async function removeCourse(ev, list, name) {
  await saveCourseOrder(ev, list)
  const { error } = await supabase.rpc('ss_course_remove', { p_event: ev.id, p_name: name })
  if (!error) return
  if (!/ss_course_remove|function|schema cache|PGRST202/i.test((error.message || '') + (error.code || ''))) throw error
  await saveCourseOrder(ev, list.filter(c => key(c) !== key(name)))
  const catIds = await eventCategoryIds(ev.id)
  if (catIds.length) {
    const { error: e2 } = await supabase.from('menu_items').update({ course: null }).in('category_id', catIds).eq('course', name)
    if (e2) throw e2
    await supabase.from('menu_categories').update({ course: null }).eq('event_id', ev.id).eq('course', name)
  }
  const { data: ks } = await supabase.from('kitchens').select('id,courses').eq('event_id', ev.id)
  for (const k of ks || []) {
    const cs = Array.isArray(k.courses) ? k.courses : []
    if (cs.some(c => key(c) === key(name))) {
      const next = cs.filter(c => key(c) !== key(name))
      await supabase.from('kitchens').update({ courses: next.length ? next : null }).eq('id', k.id)
    }
  }
}

// A renamed category keeps its KOT code (needs db/2026-11-08_courses.sql; harmless without it)
export async function moveKotCode(evId, oldName, newName) {
  if (key(oldName) === key(newName)) return
  await supabase.rpc('ss_kot_code_move', { p_event: evId, p_old: oldName, p_new: newName })
}

async function eventCategoryIds(evId) {
  const { data, error } = await supabase.from('menu_categories').select('id').eq('event_id', evId)
  if (error) throw error
  return (data || []).map(c => c.id)
}
