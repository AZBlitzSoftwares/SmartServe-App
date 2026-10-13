/* Smart Serve Maestro - Event Setup sections (Control > Kitchens on a Maestro
   event). The kitchens, printers, cuisine routing and captain tables are the
   existing multi-kitchen sections; this adds what Maestro needs:
     Service settings    courses, late alert, pacing alert, First Course rule
     Kitchen rules       course rule, one or two barkers, late threshold
     Dish split          course of every dish, Barker A or B, auto-balance
     Barkers             who signs in on each kitchen screen, with a PIN
     VIP guests          VIP guests of the event: preferences, allergies (for all dishes or
                         one dish), preferred dishes, a fixed seat if known
     Big screens         the view-only Control Desk screen and Kitchens screen (name + PIN)
   and the Pre-service check shown at the top of the page. Each section is a MaestroPart, so
   Event set-up can place it in set-up order between the kitchen sections; they share one copy
   of the data (useMaestroSetup). */
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import './maestro.css'
import { coursesOf, routeDish, errText, useNow, eventDishes, PREF_CHIPS, ALLERGY_CHIPS, splitNote, joinNote } from './msData'

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}(:\d{1,5})?$/

function useSetupData(eventId, nonce) {
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    if (!eventId) return
    let alive = true
    ;(async () => {
      const [k, c, m, b, cp] = await Promise.all([
        supabase.from('kitchens').select('*').eq('event_id', eventId).order('sort_order'),
        supabase.from('menu_categories').select('*').eq('event_id', eventId).order('sort_order'),
        eventDishes(eventId),
        supabase.from('barkers').select('*').eq('event_id', eventId).order('created_at'),
        supabase.from('captains').select('id,name,table_number,is_active').eq('event_id', eventId).eq('is_active', true),
      ])
      if (!alive) return
      const bad = [k, c, m, b].find(r => r.error)
      if (bad) { setErr(bad.error.message); return }
      setErr('')
      setD({ kitchens: k.data || [], cats: c.data || [], dishes: m.data || [], barkers: b.data || [], captains: cp.data || [] })
    })()
    return () => { alive = false }
  }, [eventId, nonce])
  return { d, err, setD }
}

export function MaestroPreService({ eventData, nonce }) {
  const ev = eventData
  const now = useNow(15000)
  // re-read every 15 s: printer health is written by the Print Hub, not here
  const { d, err } = useSetupData(ev.id, `${nonce}:${Math.floor(now / 15000)}`)
  if (err) return <div className="ms"><div className="card"><h3>Pre-service check</h3><p className="sub" style={{ color: 'var(--red)' }}>Could not load: {err}. If it mentions barkers or ms_, run db/2026-10-08_maestro.sql on this database.</p></div></div>
  if (!d) return null
  const active = d.kitchens.filter(k => k.is_active)
  const catsById = Object.fromEntries(d.cats.map(c => [c.id, c]))
  const courses = coursesOf(ev)
  const dishes = d.dishes
  const noCourse = dishes.filter(x => !x.course || !courses.includes(x.course))
  const noKitchen = dishes.filter(x => !routeDish(x, catsById, active).kitchen)
  // a kitchen on cloud printing (Printer ID) needs no IP: the printer collects its KOTs itself
  const noIp = active.filter(k => !IPV4.test(String(k.printer_ip || '').trim()) && !String(k.cloud_print_id || '').trim())
  const tested = active.filter(k => ['online', 'paper_low'].includes(k.printer_status) && k.printer_checked_at && now - new Date(k.printer_checked_at) < 15 * 60000)
  const sides = active.flatMap(k => (Number(k.barkers) || 2) >= 2 ? [[k, 'A'], [k, 'B']] : [[k, 'A']])
  const noBarker = sides.filter(([k, s]) => !d.barkers.some(b => b.is_active && b.kitchen_id === k.id && b.side === s && /^\d{4,6}$/.test(String(b.pin || ''))))
  const tables = Math.max(1, Number(ev.number_of_tables) || 0)
  const tablesWithCap = new Set(d.captains.filter(c => c.table_number).map(c => c.table_number))
  const firstDish = dishes.filter(x => x.course === courses[0] && x.is_available !== false)
  const checks = [
    { ok: active.length > 0, t: active.length ? `${active.length} kitchens ready to take KOTs` : 'No kitchens yet: add them below' },
    { ok: active.length > 0 && !noIp.length, t: noIp.length ? `No printer IP or Printer ID: ${noIp.map(k => k.name).join(', ')}` : 'Every kitchen has a printer' },
    { ok: active.length > 0 && tested.length === active.length, t: tested.length === active.length ? 'Every printer answered in the last 15 minutes' : `Printer not confirmed: ${active.filter(k => !tested.includes(k)).map(k => k.name).join(', ')} (cloud printing: check the printer's Server Direct Print; otherwise switch on Print from this laptop or start the Print Hub; then Test print)` },
    { ok: dishes.length > 0 && !noKitchen.length, t: !dishes.length ? 'No dishes yet: add the menu under Menu' : noKitchen.length ? `${noKitchen.length} dishes have no kitchen` : `All ${dishes.length} dishes routed to a kitchen and a barker` },
    { ok: dishes.length > 0 && !noCourse.length, t: noCourse.length ? `${noCourse.length} dishes have no course: ${noCourse.slice(0, 3).map(x => x.name).join(', ')}${noCourse.length > 3 ? '…' : ''}` : 'Every dish has a course' },
    { ok: ev.first_course_auto === false || firstDish.length > 0, t: ev.first_course_auto === false ? `${courses[0]} is picked up by the captain` : firstDish.length ? `${courses[0]} (${firstDish.map(x => x.name).join(', ')}) is picked up when a cover is seated` : `No ${courses[0]} dish: add one, or switch the automatic ${courses[0]} off` },
    { ok: sides.length > 0 && !noBarker.length, t: noBarker.length ? `No barker with a PIN: ${noBarker.map(([k, s]) => `${k.name} ${s}`).join(', ')}` : `${d.barkers.filter(b => b.is_active).length} barkers can sign in on the kitchen screens` },
    { ok: tablesWithCap.size >= tables, t: `${tablesWithCap.size} of ${tables} tables have a table captain` },
  ]
  const bad = checks.filter(c => !c.ok).length
  return (
    <div className="ms">
      <div className="card" id="ms-ready" style={{ borderColor: bad ? 'var(--warn)' : 'var(--green)' }}>
        <h3>Pre-service check <span className={bad ? 'tagN' : 'tagF'} style={{ fontSize: 12 }}>{bad ? `${bad} to fix` : 'Ready for service'}</span></h3>
        {checks.map((c, i) => <div className="chk" key={i}><i className={c.ok ? 'ok' : 'bad'}>{c.ok ? '✓' : '!'}</i>{c.t}</div>)}
        <p className="sub" style={{ margin: '6px 0 0' }}>Kitchen screens: open <b>{location.origin}/kitchen</b> on each barker's system. Stewards need no device: the KOT tells them the table and cover.</p>
      </div>
    </div>
  )
}

// The Maestro set-up data (kitchens, cuisines, dishes, barkers, captains), read once for all
// the Maestro sections of the page. refreshKey changes when kitchens or menu routing change in
// the kitchen sections, so the kitchen rules and dish split always list the same kitchens.
export function useMaestroSetup(eventData, refreshKey = '', enabled = true) {
  return useSetupData(enabled ? eventData?.id : null, refreshKey)
}

// Title of a section with its step number, like the kitchen sections of the page
function Title({ step, children }) {
  return <span className="mst">{step != null && <i className="mstep">{step}</i>}{children}</span>
}

// One Maestro section: courses | rules | dishes | barkers | screens | vip
export function MaestroPart({ part, eventData, ms, step, onEventChange, onChanged }) {
  const ev = eventData
  const changed = () => onChanged && onChanged()
  const evChange = ev2 => { onEventChange && onEventChange(ev2); changed() }
  if (ms.err) return part !== 'barkers' ? null : (
    <div className="ms"><div className="card" style={{ borderColor: 'var(--red)' }}>
      <h3>Maestro set-up could not load</h3>
      <p className="sub">{ms.err}. If this mentions a missing table or column, the Smart Serve Maestro database update has not been applied yet.</p>
    </div></div>
  )
  if (!ms.d) return <div className="ms"><div className="card muted">Loading…</div></div>
  const p = { ev, d: ms.d, setD: ms.setD, onChanged: changed, step }
  return (
    <div className="ms">
      {part === 'courses' && <ServiceSettings ev={ev} dishes={ms.d.dishes} onEventChange={evChange} step={step} />}
      {part === 'rules' && <KitchenRules {...p} />}
      {part === 'dishes' && <DishSplit {...p} />}
      {part === 'barkers' && <Barkers {...p} />}
      {part === 'screens' && <BigScreens ev={ev} step={step} />}
      {part === 'vip' && <VipGuests {...p} onEventChange={evChange} />}
    </div>
  )
}

function Saved({ at }) {
  const now = useNow(1000)
  return at && now - at < 2500 ? <span className="tagF">Saved</span> : null
}

// ------------------------------------------------------------- settings
function ServiceSettings({ ev, dishes = [], onEventChange, step }) {
  const [courses, setCourses] = useState(coursesOf(ev))
  // a course added elsewhere (a menu import) shows here at once, so Save settings keeps it
  const evCourses = coursesOf(ev).join('|')
  useEffect(() => { setCourses(evCourses.split('|')) }, [evCourses])
  const [late, setLate] = useState(ev.late_minutes ?? 5)
  const [pacing, setPacing] = useState(ev.pacing_minutes ?? 25)
  const [hide, setHide] = useState(ev.served_hide_minutes ?? 3)
  const [auto, setAuto] = useState(ev.first_course_auto !== false)
  const [add, setAdd] = useState('')
  const [msg, setMsg] = useState('')
  const [saved, setSaved] = useState(0)
  const move = (i, dir) => setCourses(c => { const n = [...c]; const j = i + dir; if (j < 0 || j >= n.length) return c; [n[i], n[j]] = [n[j], n[i]]; return n })
  async function save() {
    setMsg('')
    const list = courses.map(s => s.trim()).filter(Boolean)
    if (list.length < 2) { setMsg('Keep at least two courses.'); return }
    const dropped = coursesOf(ev).filter(c => !list.includes(c) && dishes.some(x => x.course === c))
    if (dropped.length && !window.confirm(dropped.map(c => `${c} (${dishes.filter(x => x.course === c).length} dishes)`).join(', ')
      + ' will be removed. Those dishes will have no course, so captains cannot order them, until you give them one under Menu. Save anyway?')) return
    const patch = { courses: list, late_minutes: Math.max(1, Number(late) || 3), pacing_minutes: Math.max(5, Number(pacing) || 25), first_course_auto: auto,
      served_hide_minutes: Math.min(30, Math.max(1, Number(hide) || 3)) }
    const { data, error } = await supabase.from('events').update(patch).eq('id', ev.id).select('*').maybeSingle()
    if (error) { setMsg(errText(error)); return }
    setSaved(Date.now())
    if (data && onEventChange) onEventChange(data)
  }
  return (
    <div className="card" id="ms-courses">
      <h3><Title step={step}>Courses &amp; service settings</Title> <Saved at={saved} /></h3>
      <p className="sub">The courses of this event in the order they are served; the number after each is how many dishes the menu has in it. ‹ › move a course earlier or later, ✕ removes it, <b>Add</b> adds one, then <b>Save settings</b>. Captains see the courses in this order and fire them one after another. The dishes go into their course in the <b>Menu</b> tab: one by one, or a whole Excel menu with a Course column.</p>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        {courses.map((c, i) => (
          <span key={c + i} className="cc" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', background: i === 0 ? 'var(--goldl)' : '#fff' }}>
            <button className="x" style={{ border: 0, background: 'transparent', fontWeight: 800 }} onClick={() => move(i, -1)} title="Earlier">‹</button>
            <b>{i + 1}. {c}</b><span style={{ opacity: .6, fontWeight: 700 }}>{dishes.filter(x => x.course === c).length}</span>
            <button className="x" style={{ border: 0, background: 'transparent', fontWeight: 800 }} onClick={() => move(i, 1)} title="Later">›</button>
            <button className="x" style={{ border: 0, background: 'transparent', color: 'var(--red)', fontWeight: 800 }} onClick={() => setCourses(cs => cs.filter((_, j) => j !== i))} title="Remove">✕</button>
          </span>
        ))}
        <input className="fld" value={add} onChange={e => setAdd(e.target.value)} placeholder="Add a course" style={{ width: 140 }}
          onKeyDown={e => { if (e.key === 'Enter' && add.trim()) { setCourses(c => [...c, add.trim()]); setAdd('') } }} />
        <button className="btn btn-ghost" disabled={!add.trim()} onClick={() => { setCourses(c => [...c, add.trim()]); setAdd('') }}>Add</button>
      </div>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }}>
        <label>Kitchen alert after <input className="fld" type="number" min="1" value={late} onChange={e => setLate(e.target.value)} style={{ width: 64 }} /> min from pick-up</label>
        <label>Delivered dishes leave the captain's order after <input className="fld" type="number" min="1" max="30" value={hide} onChange={e => setHide(e.target.value)} style={{ width: 64 }} /> min</label>
        <label>Pacing alert after <input className="fld" type="number" min="5" value={pacing} onChange={e => setPacing(e.target.value)} style={{ width: 64 }} /> min with nothing picked up</label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} /> Pick up the {courses[0] || 'first course'} automatically when a cover is seated</label>
        <button className="btn btn-navy" onClick={save}>Save settings</button>
        {msg && <span style={{ color: 'var(--red)', fontWeight: 700 }}>{msg}</span>}
      </div>
      <p className="sub" style={{ marginTop: 10, marginBottom: 0 }}>
        <b>Kitchen alert:</b> a KOT not delivered this many minutes after it was picked up flashes on the kitchen screen until the barker taps Delivered, and is listed under Needs attention on the Control Desk (3 minutes is usual).{' '}
        <b>Delivered dishes:</b> on the captain's tablet a delivered dish stays in the cover's order this long (3 or 5 minutes), then hides; <i>Show delivered</i> brings it back for a moment.{' '}
        <b>Pacing alert:</b> a seated table where nothing has been picked up for this long is listed on the Control Desk with <i>Remind captain</i>, so no table waits too long between courses.{' '}
        <b>Automatic first course:</b> when ticked, seating a cover sends the {courses[0] || 'first course'} straight to the kitchen (for a course every guest gets, like a welcome bite); leave it off when guests choose it.
      </p>
    </div>
  )
}

// ------------------------------------------------------------- kitchen rules
function KitchenRules({ ev, d, setD, onChanged, step }) {
  const courses = coursesOf(ev)
  const [saved, setSaved] = useState(0)
  const [msg, setMsg] = useState('')
  async function patch(k, fields) {
    setMsg('')
    setD(x => ({ ...x, kitchens: x.kitchens.map(y => y.id === k.id ? { ...y, ...fields } : y) }))
    const { error } = await supabase.from('kitchens').update(fields).eq('id', k.id)
    if (error) setMsg(errText(error)); else { setSaved(Date.now()); onChanged() }
  }
  const active = d.kitchens.filter(k => k.is_active)
  return (
    <div className="card" id="ms-rules">
      <h3><Title step={step}>Kitchen rules</Title> <Saved at={saved} /></h3>
      <p className="sub">Which kitchen prepares a dish: a kitchen chosen for the dish itself first, then a <b>course rule</b> below (for example every Dessert goes to the Desserts kitchen, whatever its cuisine), then the kitchen of its <b>cuisine</b> (menu category, set above), then the default kitchen.</p>
      {msg && <p style={{ color: 'var(--red)', fontWeight: 700 }}>{msg}</p>}
      <table className="tbl">
        <thead><tr><th>Kitchen</th><th>Course rule: these courses come here</th><th>Barkers</th><th>Kitchen alert</th></tr></thead>
        <tbody>
          {active.map(k => (
            <tr key={k.id}>
              <td><b>{k.name}</b> <span className="muted">· {k.prefix}</span>{k.is_default && <span className="tagH" style={{ marginLeft: 6 }}>default</span>}</td>
              <td>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {courses.map(c => {
                    const on = Array.isArray(k.courses) && k.courses.includes(c)
                    return <button key={c} className={'cc' + (on ? ' a' : '')} onClick={() => patch(k, { courses: on ? k.courses.filter(x => x !== c) : [...(k.courses || []), c] })}>{c}</button>
                  })}
                </div>
              </td>
              <td><div className="seg2">{[1, 2].map(n => <button key={n} className={(Number(k.barkers) || 2) === n ? 'a' : ''} onClick={() => patch(k, { barkers: n })}>{n === 1 ? 'A only' : 'A and B'}</button>)}</div></td>
              <td><input className="fld" type="number" min="1" placeholder={String(ev.late_minutes ?? 3)} defaultValue={k.late_minutes ?? ''} style={{ width: 64 }}
                onBlur={e => { const v = e.target.value === '' ? null : Math.max(1, Number(e.target.value) || 3); if (v !== (k.late_minutes ?? null)) patch(k, { late_minutes: v }) }} /> min</td>
            </tr>
          ))}
          {!active.length && <tr><td colSpan={4} className="muted">Add kitchens above first.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

// ------------------------------------------------------------- dish split
function DishSplit({ ev, d, setD, onChanged, step }) {
  const courses = coursesOf(ev)
  const [kid, setKid] = useState(null)
  const [msg, setMsg] = useState('')
  const [saved, setSaved] = useState(0)
  const active = d.kitchens.filter(k => k.is_active)
  const catsById = useMemo(() => Object.fromEntries(d.cats.map(c => [c.id, c])), [d.cats])
  const routed = useMemo(() => d.dishes.map(x => ({ ...x, r: routeDish(x, catsById, active) })), [d.dishes, catsById, active])
  const k = active.find(x => x.id === kid) || active[0]
  const mine = routed.filter(x => x.r.kitchen?.id === k?.id)
  const two = (Number(k?.barkers) || 2) >= 2

  async function patchDish(x, fields) {
    setMsg('')
    setD(s => ({ ...s, dishes: s.dishes.map(y => y.id === x.id ? { ...y, ...fields } : y) }))
    const { error } = await supabase.from('menu_items').update(fields).eq('id', x.id)
    if (error) setMsg(errText(error)); else { setSaved(Date.now()); onChanged() }
  }
  async function autoBalance() {
    // alternate A/B by course, so each barker gets a share of every course
    const sorted = [...mine].sort((a, b) => courses.indexOf(a.course) - courses.indexOf(b.course) || String(a.name).localeCompare(b.name))
    const plan = sorted.map((x, i) => ({ x, side: i % 2 === 0 ? 'A' : 'B' }))
    setD(s => ({ ...s, dishes: s.dishes.map(y => { const p = plan.find(q => q.x.id === y.id); return p ? { ...y, barker: p.side } : y }) }))
    for (const side of ['A', 'B']) {
      const ids = plan.filter(p => p.side === side).map(p => p.x.id)
      if (ids.length) {
        const { error } = await supabase.from('menu_items').update({ barker: side }).in('id', ids)
        if (error) { setMsg(errText(error)); return }
      }
    }
    setSaved(Date.now()); onChanged()
  }
  const col = side => mine.filter(x => (two ? (String(x.barker || 'A').toUpperCase() === 'B' ? 'B' : 'A') : 'A') === side)
  const barkerName = side => d.barkers.find(b => b.kitchen_id === k?.id && b.side === side && b.is_active)?.name

  return (
    <div className="card" id="ms-dishes">
      <h3><Title step={step}>Dishes: course and barker</Title> <Saved at={saved} /></h3>
      <p className="sub">Every dish needs a course. Inside each kitchen the dishes are split between Barker A and Barker B, so a rush is shared. Choose a kitchen for a single dish only when it must go somewhere other than its rule.</p>
      {msg && <p style={{ color: 'var(--red)', fontWeight: 700 }}>{msg}</p>}
      <div className="tabs">
        {active.map(x => <button key={x.id} className={'tab' + (x.id === k?.id ? ' a' : '')} onClick={() => setKid(x.id)}>{x.name} · {routed.filter(y => y.r.kitchen?.id === x.id).length}</button>)}
      </div>
      {k && (
        <>
          {two && <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}><button className="btn btn-amber" onClick={autoBalance}>Auto-balance A / B</button></div>}
          <div style={{ display: 'grid', gridTemplateColumns: two ? '1fr 1fr' : '1fr', gap: 12 }}>
            {(two ? ['A', 'B'] : ['A']).map(side => (
              <div key={side} style={{ border: '1.5px solid var(--line)', borderRadius: 12, padding: 10 }}>
                <div style={{ fontWeight: 800, color: 'var(--navy)', marginBottom: 6 }}>Barker {side}{barkerName(side) ? ` · ${barkerName(side)}` : ''} · {k.prefix}-{side} series · {col(side).length} dishes</div>
                {col(side).map(x => (
                  <div key={x.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 0', borderBottom: '1px dashed var(--line)', flexWrap: 'wrap' }}>
                    <b style={{ fontSize: 13, flex: '1 1 140px' }}>{x.name}</b>
                    <select className="fld" value={x.course || ''} onChange={e => patchDish(x, { course: e.target.value || null })} style={{ borderColor: x.course ? 'var(--line)' : 'var(--warn)' }}>
                      <option value="">Course?</option>
                      {courses.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <select className="fld" value={x.kitchen_id || ''} onChange={e => patchDish(x, { kitchen_id: e.target.value || null })} title="Kitchen for this dish only">
                      <option value="">By rule</option>
                      {active.map(y => <option key={y.id} value={y.id}>{y.name}</option>)}
                    </select>
                    {two && <button className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => patchDish(x, { barker: side === 'A' ? 'B' : 'A' })}>{side === 'A' ? 'Move to B ›' : '‹ Move to A'}</button>}
                  </div>
                ))}
                {!col(side).length && <div className="muted" style={{ fontSize: 12.5 }}>No dishes.</div>}
              </div>
            ))}
          </div>
        </>
      )}
      {!active.length && <div className="muted">Add kitchens above first.</div>}
    </div>
  )
}

// ------------------------------------------------------------- barkers
function Barkers({ ev, d, setD, onChanged, step }) {
  const active = d.kitchens.filter(k => k.is_active)
  const [msg, setMsg] = useState('')
  const [saved, setSaved] = useState(0)
  const used = new Set(d.barkers.map(b => String(b.pin || '')))
  const randomPin = () => { for (let i = 0; i < 500; i++) { const p = String(1000 + Math.floor(Math.random() * 9000)); if (!used.has(p)) { used.add(p); return p } } return '' }

  async function upsert(k, side, fields) {
    setMsg('')
    const cur = d.barkers.find(b => b.kitchen_id === k.id && b.side === side && b.is_active)
    if (cur) {
      setD(s => ({ ...s, barkers: s.barkers.map(b => b.id === cur.id ? { ...b, ...fields } : b) }))
      const { error } = await supabase.from('barkers').update(fields).eq('id', cur.id)
      if (error) setMsg(errText(error)); else { setSaved(Date.now()); onChanged() }
    } else {
      if (!fields.name) return
      const row = { event_id: ev.id, kitchen_id: k.id, side, name: fields.name, pin: fields.pin || randomPin(), is_active: true }
      const { data, error } = await supabase.from('barkers').insert(row).select('*').maybeSingle()
      if (error) { setMsg(errText(error)); return }
      setD(s => ({ ...s, barkers: [...s.barkers, data] }))
      { setSaved(Date.now()); onChanged() }
    }
  }
  async function remove(b) {
    const { error } = await supabase.from('barkers').update({ is_active: false }).eq('id', b.id)
    if (error) { setMsg(errText(error)); return }
    setD(s => ({ ...s, barkers: s.barkers.map(x => x.id === b.id ? { ...x, is_active: false } : x) }))
  }
  async function givePins() {
    for (const b of d.barkers.filter(x => x.is_active && !/^\d{4,6}$/.test(String(x.pin || '')))) {
      const pin = randomPin()
      await supabase.from('barkers').update({ pin }).eq('id', b.id)
      setD(s => ({ ...s, barkers: s.barkers.map(x => x.id === b.id ? { ...x, pin } : x) }))
    }
    { setSaved(Date.now()); onChanged() }
  }
  function copy() {
    const lines = [`${ev.name} · Kitchen Display: ${location.origin}/kitchen`]
    for (const k of active) for (const b of d.barkers.filter(x => x.is_active && x.kitchen_id === k.id)) lines.push(`${k.name} Barker ${b.side}: ${b.name} · PIN ${b.pin}`)
    try { navigator.clipboard.writeText(lines.join('\n')); setMsg('Copied the sign-in list.') } catch { setMsg(lines.join(' | ')) }
  }
  return (
    <div className="card" id="ms-barkers">
      <h3><Title step={step}>Barkers</Title> <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Saved at={saved} /><button className="btn btn-ghost" onClick={givePins}>Give missing PINs</button><button className="btn btn-ghost" onClick={copy}>Copy sign-in list</button></span></h3>
      <p className="sub">Each barker signs in on their kitchen screen with their name and PIN. The name is printed on their KOTs. A kitchen has Barker A and Barker B; set <b>A only</b> for a small kitchen under Kitchen rules. Which dishes each barker prepares is set under Dishes.</p>
      {msg && <p style={{ color: msg.startsWith('Copied') ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>{msg}</p>}
      <table className="tbl">
        <thead><tr><th>Kitchen</th><th>Side</th><th>Name</th><th>PIN</th><th /></tr></thead>
        <tbody>
          {active.flatMap(k => ((Number(k.barkers) || 2) >= 2 ? ['A', 'B'] : ['A']).map(side => {
            const b = d.barkers.find(x => x.kitchen_id === k.id && x.side === side && x.is_active)
            return (
              <tr key={k.id + side}>
                <td><b>{k.name}</b></td>
                <td>Barker {side}</td>
                <td><input className="fld" defaultValue={b?.name || ''} key={(b?.id || 'n') + (b?.name || '')} placeholder="Name"
                  onBlur={e => { const v = e.target.value.trim(); if (v && v !== (b?.name || '')) upsert(k, side, { name: v }) }} /></td>
                <td><input className="fld" defaultValue={b?.pin || ''} key={(b?.id || 'p') + (b?.pin || '')} placeholder="4 digits" style={{ width: 90 }} disabled={!b}
                  onBlur={e => { const v = e.target.value.replace(/\D/g, '').slice(0, 6); if (b && v && v !== b.pin) upsert(k, side, { pin: v }) }} /></td>
                <td>{b && <button className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: 12, color: 'var(--red)' }} onClick={() => remove(b)}>Remove</button>}</td>
              </tr>
            )
          }))}
        </tbody>
      </table>
    </div>
  )
}

// ------------------------------------------------------------- big screens
/* Two view-only users for big screens anyone may look at: the Control Desk screen (every
   table, kitchen, printer and alert) and the Kitchens screen (every kitchen's KOTs side by
   side). They sign in at /supervisor with the name and PIN set here; nothing on those screens
   can change anything. Kept in supervisors with role screen_desk / screen_kitchens. */
const newPin = () => String(1000 + Math.floor(Math.random() * 9000))
const nowMs = () => Date.now()
const SCREENS = [
  { role: 'screen_desk', title: 'Control Desk screen', name: 'Desk Screen', what: 'every table, kitchen, printer and alert' },
  { role: 'screen_kitchens', title: 'Kitchens screen', name: 'Kitchen Screen', what: "every kitchen's KOTs side by side" },
]
function BigScreens({ ev, step }) {
  const [rows, setRows] = useState(null)
  const [msg, setMsg] = useState('')
  const [saved, setSaved] = useState(0)
  useEffect(() => {
    let alive = true
    supabase.from('supervisors').select('*').eq('event_id', ev.id).in('role', SCREENS.map(x => x.role)).eq('is_active', true)
      .then(({ data, error }) => { if (alive) { if (error) setMsg(errText(error)); setRows(data || []) } })
    return () => { alive = false }
  }, [ev.id])
  async function upsert(sc, fields) {
    setMsg('')
    const cur = (rows || []).find(r => r.role === sc.role)
    if (cur) {
      const { error } = await supabase.from('supervisors').update(fields).eq('id', cur.id)
      if (error) { setMsg(errText(error)); return }
      setRows(rs => rs.map(r => (r.id === cur.id ? { ...r, ...fields } : r)))
    } else {
      const row = { event_id: ev.id, name: fields.name || sc.name, pin: fields.pin || newPin(), role: sc.role, is_active: true }
      const { data, error } = await supabase.from('supervisors').insert(row).select('*').maybeSingle()
      if (error) { setMsg(/role/i.test(error.message) ? 'Run 2026-10-13_maestro_v3.sql in Supabase first, then try again.' : errText(error)); return }
      setRows(rs => [...(rs || []), data])
    }
    setSaved(nowMs())
  }
  async function remove(r) {
    const { error } = await supabase.from('supervisors').update({ is_active: false }).eq('id', r.id)
    if (error) { setMsg(errText(error)); return }
    setRows(rs => rs.filter(x => x.id !== r.id))
  }
  function copy() {
    const lines = [`${ev.name} · Big screens (view only): ${location.origin}/supervisor`]
    for (const sc of SCREENS) { const r = (rows || []).find(x => x.role === sc.role); if (r) lines.push(`${sc.title}: ${r.name} · PIN ${r.pin}`) }
    try { navigator.clipboard.writeText(lines.join('\n')); setMsg('Copied the sign-in list.') } catch { setMsg(lines.join(' | ')) }
  }
  return (
    <div className="card" id="ms-screens">
      <h3><Title step={step}>Big screens (view only)</Title> <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Saved at={saved} /><button className="btn btn-ghost" onClick={copy}>Copy sign-in list</button></span></h3>
      <p className="sub">For TVs or monitors that anyone may look at: waiters, stewards, guests. Sign in at <b>{location.origin}/supervisor</b> with the name and PIN below. The screen shows everything and changes nothing; it stays signed in after a reload, and signing out needs its PIN.</p>
      {msg && <p style={{ color: msg.startsWith('Copied') ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>{msg}</p>}
      <table className="tbl">
        <thead><tr><th>Screen</th><th>Shows</th><th>Sign-in name</th><th>PIN</th><th /></tr></thead>
        <tbody>
          {SCREENS.map(sc => {
            const r = (rows || []).find(x => x.role === sc.role)
            return (
              <tr key={sc.role}>
                <td><b>{sc.title}</b></td>
                <td className="muted">{sc.what}</td>
                <td>{r
                  ? <input className="fld" defaultValue={r.name} key={r.id + r.name} onBlur={e => { const v = e.target.value.trim(); if (v && v !== r.name) upsert(sc, { name: v }) }} />
                  : <button className="btn btn-navy" disabled={!rows} onClick={() => upsert(sc, { name: sc.name })}>+ Add {sc.title}</button>}</td>
                <td>{r && <input className="fld" defaultValue={r.pin} key={r.id + 'p' + r.pin} style={{ width: 90 }}
                  onBlur={e => { const v = e.target.value.replace(/\D/g, '').slice(0, 6); if (v.length >= 4 && v !== r.pin) upsert(sc, { pin: v }) }} />}</td>
                <td>{r && <button className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: 12, color: 'var(--red)' }} onClick={() => remove(r)}>Remove</button>}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ------------------------------------------------------------- VIP guests
/* VIP guests of the event. The captain picks one with the VIP Guests button (or a guest with a
   fixed table and cover is loaded by itself when that cover is opened): the allergies, dislikes
   and notes print on every KOT of that cover, and the preferred dishes are added to its order.
   Special dishes made only for VIP guests are menu dishes marked VIP guests only (Menu › Add
   Dish): captains see them on a VIP guest's cover only. Allergies are for every dish of the
   guest, or for one preferred dish (that dish's KOT prints it). */

function VipGuests({ ev, d, onChanged, step }) {
  const [vips, setVips] = useState(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [saved, setSaved] = useState(0)
  const courses = coursesOf(ev)
  const catName = id => d.cats.find(c => c.id === id)?.name || ''
  const dishById = Object.fromEntries(d.dishes.map(x => [x.id, x]))
  const dishOpts = [...d.dishes].sort((a, b) => catName(a.category_id).localeCompare(catName(b.category_id)) || courses.indexOf(a.course) - courses.indexOf(b.course) || String(a.name).localeCompare(b.name))

  async function load() {
    const { data, error } = await supabase.from('ms_vip_guests').select('*').eq('event_id', ev.id).eq('is_active', true).order('sort_order').order('created_at')
    if (error) { setErr(errText(error)); setVips([]); return }
    setErr(''); setVips(data || [])
  }
  useEffect(() => { load() }, [ev.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function patch(v, fields) {
    setMsg('')
    setVips(list => list.map(x => (x.id === v.id ? { ...x, ...fields } : x)))
    const { error } = await supabase.from('ms_vip_guests').update(fields).eq('id', v.id)
    if (error) setMsg(errText(error)); else setSaved(Date.now())
  }
  async function add() {
    setMsg('')
    const { data, error } = await supabase.from('ms_vip_guests').insert({ event_id: ev.id, name: 'New VIP guest', label: 'VIP', sort_order: (vips?.length || 0) + 1, dishes: [] }).select('*').maybeSingle()
    if (error) { setMsg(errText(error)); return }
    setVips(list => [...(list || []), data]); setSaved(Date.now())
  }
  async function remove(v) {
    const { error } = await supabase.from('ms_vip_guests').update({ is_active: false }).eq('id', v.id)
    if (error) { setMsg(errText(error)); return }
    setVips(list => list.filter(x => x.id !== v.id))
  }
  const num = s => { const n = parseInt(String(s || '').replace(/\D/g, ''), 10); return n > 0 ? n : null }
  // Food preferences: one tap adds or takes one off the guest's notes for the kitchen
  const prefOn = (v, x) => splitNote(v.notes).some(y => y.toLowerCase() === x.toLowerCase())
  const flipPref = (v, x) => {
    const list = splitNote(v.notes)
    const next = prefOn(v, x) ? list.filter(y => y.toLowerCase() !== x.toLowerCase()) : [...list, x]
    patch(v, { notes: joinNote(next) || null })
  }
  // Allergies: the same one-tap list, for every dish of the guest
  const algOn = (v, x) => splitNote(v.allergies).some(y => y.toLowerCase() === x.toLowerCase())
  const flipAlg = (v, x) => {
    const list = splitNote(v.allergies)
    const next = algOn(v, x) ? list.filter(y => y.toLowerCase() !== x.toLowerCase()) : [...list, x]
    patch(v, { allergies: joinNote(next) || null })
  }
  const setDish = (v, i, fields) => patch(v, { dishes: (v.dishes || []).map((y, j) => (j === i ? { ...y, ...fields } : y)) })

  return (
    <div className="card" id="ms-vip">
      <h3><Title step={step}>VIP guests</Title> <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Saved at={saved} /><button className="btn btn-amber" onClick={add} disabled={!!err}>+ Add VIP guest</button></span></h3>
      <p className="sub">Guests whose preferences are known in advance. On the captain's tablet, <b>VIP Guests</b> lists them: the captain picks the guest and the cover, and their allergies, dislikes and notes print on every KOT of that cover, and their preferred dishes are added to the order to fire one by one. A guest given a table and cover here is loaded by itself when the captain opens that cover.</p>
      {err && <p style={{ color: 'var(--red)', fontWeight: 700 }}>{err}. Run db/2026-10-13_maestro_v2.sql on this database first.</p>}
      {msg && <p style={{ color: 'var(--red)', fontWeight: 700 }}>{msg}</p>}
      {vips === null ? <div className="muted">Loading…</div> : !vips.length && !err ? <div className="muted">No VIP guests yet.</div> : null}
      {(vips || []).map(v => (
        <div key={v.id} className="vipcard" data-vip={v.name}>
          <div className="vr1">
            <span className="vstar">★</span>
            <input className="fld" defaultValue={v.name} key={'n' + v.id} placeholder="Name" style={{ flex: '1 1 180px', fontWeight: 800 }}
              onBlur={e => { const x = e.target.value.trim(); if (x && x !== v.name) patch(v, { name: x }) }} />
            <input className="fld" defaultValue={v.label || ''} key={'l' + v.id} placeholder="VIP / VVIP" style={{ width: 90 }}
              onBlur={e => { const x = e.target.value.trim() || null; if (x !== (v.label || null)) patch(v, { label: x }) }} />
            <label className="vsm">Table <input className="fld" defaultValue={v.table_number || ''} key={'t' + v.id} placeholder="any" style={{ width: 56 }}
              onBlur={e => { const x = num(e.target.value); if (x !== (v.table_number || null)) patch(v, { table_number: x }) }} /></label>
            <label className="vsm">Cover <input className="fld" defaultValue={v.cover_no || ''} key={'c' + v.id} placeholder="any" style={{ width: 56 }}
              onBlur={e => { const x = num(e.target.value); if (x !== (v.cover_no || null)) patch(v, { cover_no: x }) }} /></label>
            <button className="btn btn-ghost" style={{ color: 'var(--red)', padding: '4px 9px', fontSize: 12 }} onClick={() => remove(v)}>Remove</button>
          </div>
          <div className="vr2">
            {[['allergies', 'Allergies', 'e.g. Peanuts, Shellfish'], ['likes', 'Likes', 'e.g. Mild Italian'], ['dislikes', 'Dislikes', 'e.g. Mushroom'], ['notes', 'Notes for the kitchen', 'e.g. Less spicy, Jain']].map(([f, label, ph]) => (
              <label key={f} className={'vfld' + (f === 'allergies' ? ' va' : '')}><span>{label}</span>
                <input className="fld" defaultValue={v[f] || ''} key={f + v.id + (f === 'notes' || f === 'allergies' ? '|' + (v[f] || '') : '')} placeholder={ph}
                  onBlur={e => { const x = e.target.value.trim() || null; if (x !== (v[f] || null)) patch(v, { [f]: x }) }} /></label>
            ))}
          </div>
          <div className="vpref va">
            <span>Allergies (all dishes)</span>
            {ALLERGY_CHIPS.map(x => <button key={x} className={algOn(v, x) ? 'a' : ''} onClick={() => flipAlg(v, x)}>{x}</button>)}
          </div>
          <div className="vpref">
            <span>Food preferences</span>
            {PREF_CHIPS.map(x => <button key={x} className={prefOn(v, x) ? 'a' : ''} onClick={() => flipPref(v, x)}>{x}</button>)}
          </div>
          <div className="vr3">
            <b>Preferred dishes</b>
            {(v.dishes || []).map((x, i) => {
              const dd = dishById[x.menu_item_id]
              return (
                <div key={x.menu_item_id + i} className="vdish">
                  <span className="vdn">{dd ? dd.name : 'Dish no longer on the menu'}</span>
                  <span className="muted">{dd ? `${catName(dd.category_id)} · ${dd.course || 'no course'}${dd.vip_only ? ' · VIP only' : ''}` : ''}</span>
                  <input className="fld" defaultValue={x.note || ''} key={'dn' + v.id + i} placeholder="Note for this dish" style={{ flex: '1 1 140px' }}
                    onBlur={e => { const note = e.target.value.trim(); if (note !== (x.note || '')) setDish(v, i, { note: note || null }) }} />
                  <input className="fld vda" defaultValue={x.allergy || ''} key={'da' + v.id + i + (x.allergy || '')} placeholder="Allergy for this dish" list="ms-allergy-list" style={{ flex: '1 1 130px' }}
                    onBlur={e => { const a = e.target.value.trim(); if (a !== (x.allergy || '')) setDish(v, i, { allergy: a || null }) }} />
                  <button className="x" onClick={() => patch(v, { dishes: (v.dishes || []).filter((_, j) => j !== i) })} title="Remove">✕</button>
                </div>
              )
            })}
            <select className="fld" value="" onChange={e => { const id = e.target.value; if (id) patch(v, { dishes: [...(v.dishes || []), { menu_item_id: id, note: null }] }) }}>
              <option value="">+ Add a preferred dish…</option>
              {dishOpts.map(x => <option key={x.id} value={x.id}>{catName(x.category_id)} · {x.course || '—'} · {x.name}{x.vip_only ? ' (VIP only)' : ''}</option>)}
            </select>
          </div>
        </div>
      ))}
      <datalist id="ms-allergy-list">{ALLERGY_CHIPS.map(x => <option key={x} value={x} />)}</datalist>
      <p className="sub" style={{ margin: '10px 0 0' }}><b>Special dishes for VIP guests only:</b> add them under <b>Menu › + Add Dish</b> with <b>VIP guests only</b> switched on (or Edit an existing dish). They are offered on a VIP guest's cover only, and can be picked above as a preferred dish.</p>
    </div>
  )
}
