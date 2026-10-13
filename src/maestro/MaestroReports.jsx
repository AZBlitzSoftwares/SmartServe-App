/* Smart Serve Maestro - Reports (live during service, complete after it).

   Every stage of every dish is time-stamped, so the reports are exact:
     Kitchen performance  firing -> ready per kitchen, barker and dish; late KOTs
     Dispatch             ready -> dispatched per kitchen (steward cover)
     Course pacing        time between courses per cover
     Dish summary         plates per dish, remakes, sold-out times
     Exceptions           cancellations, remakes, reprints, print failures
   Export: CSV files (open in Excel) and Print / PDF. */
import { useMemo } from 'react'
import { supabase } from '../lib/supabase'
import logo from '../assets/janus_logo.jpg'
import './maestro.css'
import { coursesOf, courseRank, lateMinutes, useLive, mmss, coverLabel, chairsOf } from './msData'

const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)
const pct = (a, b) => (b ? (100 * a / b).toFixed(1) + '%' : '–')

function csv(rows) {
  return rows.map(r => r.map(v => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }).join(',')).join('\r\n')
}
function download(name, rows) {
  const blob = new Blob(['﻿' + csv(rows)], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

export default function MaestroReports({ eventData }) {
  const ev = eventData
  const q = useLive(async () => {
    const [evr, kitchens, kots, items, covers, firings] = await Promise.all([
      supabase.from('events').select('*').eq('id', ev.id).maybeSingle(),
      supabase.from('kitchens').select('*').eq('event_id', ev.id).order('sort_order'),
      supabase.from('kots').select('*').eq('event_id', ev.id).order('created_at'),
      supabase.from('ms_items').select('*').eq('event_id', ev.id),
      supabase.from('ms_covers').select('*').eq('event_id', ev.id),
      supabase.from('ms_firings').select('*').eq('event_id', ev.id),
    ])
    for (const r of [kitchens, kots, items]) if (r.error) throw r.error
    return { ev: evr.data || ev, kitchens: kitchens.data || [], kots: kots.data || [], items: items.data || [], covers: covers.data || [], firings: firings.data || [] }
  }, { eventId: ev.id, tables: [], intervalMs: 15000 })

  const r = useMemo(() => {
    const d = q.data
    if (!d) return null
    const E = d.ev
    const courses = coursesOf(E)
    const kById = Object.fromEntries(d.kitchens.map(k => [k.id, k]))
    const orders = d.kots.filter(k => k.kind === 'order')
    const live = orders.filter(k => k.status !== 'cancelled')
    const fr = k => (k.ready_at && k.fired_at ? new Date(k.ready_at) - new Date(k.fired_at) : null)
    const rd = k => (k.dispatched_at && k.ready_at ? new Date(k.dispatched_at) - new Date(k.ready_at) : null)
    const isLate = k => {
      const lm = lateMinutes(kById[k.kitchen_id], E) * 60000
      if (k.ready_at) return fr(k) > lm
      return Date.now() - new Date(k.fired_at || k.created_at) > lm && !k.served_at
    }
    const items = d.items.filter(i => i.state !== 'cancelled')
    const served = items.filter(i => i.served_at)
    const coversSet = Array.from({ length: Number(E.number_of_tables) || 0 }, (_, i) => chairsOf(E, i + 1)).reduce((a, b) => a + b, 0)
    const coversServed = new Set(served.map(i => i.table_number + '|' + i.cover_no)).size
    const printed = orders.filter(k => k.print_status === 'printed').length
    const lateK = live.filter(isLate)

    const kitchenRows = d.kitchens.map(kt => {
      const ks = live.filter(k => k.kitchen_id === kt.id)
      return {
        k: kt, kots: ks.length, fr: avg(ks.map(fr).filter(x => x != null)), late: ks.filter(isLate).length,
        rd: avg(ks.map(rd).filter(x => x != null)), remakes: ks.filter(k => k.is_remake).length,
      }
    })
    const barkerRows = []
    for (const kt of d.kitchens) for (const side of ['A', 'B']) {
      const ks = live.filter(k => k.kitchen_id === kt.id && (k.barker || 'A') === side)
      if (!ks.length) continue
      barkerRows.push({ kitchen: kt.name, side, name: ks.find(k => k.barker_name)?.barker_name || '', kots: ks.length, fr: avg(ks.map(fr).filter(x => x != null)), late: ks.filter(isLate).length })
    }
    const dishMap = {}
    for (const i of d.items) {
      const m = (dishMap[i.name] ||= { name: i.name, course: i.course, kitchen: kById[i.kitchen_id]?.name || '', plates: 0, served: 0, remakes: 0, cancelled: 0 })
      if (i.state === 'cancelled') m.cancelled += i.qty || 1
      else { m.plates += i.qty || 1; if (i.served_at) m.served += i.qty || 1 }
      if (i.remake_of) m.remakes += 1
    }
    const dishRows = Object.values(dishMap).sort((a, b) => courseRank(courses, a.course) - courseRank(courses, b.course) || b.plates - a.plates)

    // pacing: gap between consecutive courses served to the same cover
    const gaps = []
    const byCover = {}
    for (const i of served) (byCover[i.table_number + '|' + i.cover_no] ||= []).push(i)
    for (const list of Object.values(byCover)) {
      const perCourse = {}
      for (const i of list) { const t = new Date(i.served_at).getTime(); if (!perCourse[i.course] || t < perCourse[i.course]) perCourse[i.course] = t }
      const ts = Object.entries(perCourse).sort((a, b) => courseRank(courses, a[0]) - courseRank(courses, b[0])).map(x => x[1])
      for (let j = 1; j < ts.length; j++) if (ts[j] > ts[j - 1]) gaps.push(ts[j] - ts[j - 1])
    }

    // KOTs fired per 10 minutes
    const fired = live.filter(k => k.fired_at).map(k => new Date(k.fired_at).getTime())
    const buckets = []
    if (fired.length) {
      const start = Math.floor(Math.min(...fired) / 600000) * 600000
      const end = Math.max(...fired)
      for (let t = start; t <= end; t += 600000) buckets.push({ t, n: fired.filter(x => x >= t && x < t + 600000).length })
    }

    const exceptions = {
      cancellations: d.items.filter(i => i.state === 'cancelled').length,
      remakes: orders.filter(k => k.is_remake).length,
      reprints: orders.filter(k => k.is_reprint).length,
      printFailures: d.kots.filter(k => (k.print_attempts || 0) > 1 || k.print_status === 'failed').length,
    }
    return {
      E, courses, kitchenRows, barkerRows, dishRows, buckets, exceptions, gaps,
      kpi: {
        coversServed, coversSet, plates: served.length, perCover: coversServed ? served.length / coversServed : 0,
        kots: live.length, printed, fr: avg(live.map(fr).filter(x => x != null)), late: lateK.length,
        rd: avg(live.map(rd).filter(x => x != null)), gap: avg(gaps),
      },
      orders: live,
    }
  }, [q.data])

  if (!r) return <div className="ms"><div className="card">Loading reports…</div></div>
  const { kpi } = r
  const maxFr = Math.max(1, ...r.kitchenRows.map(x => x.fr || 0))
  const maxB = Math.max(1, ...r.buckets.map(b => b.n))

  function exportAll() {
    const stamp = new Date().toISOString().slice(0, 10)
    const base = `${(r.E.name || 'event').replace(/[^\w-]+/g, '_')}_${stamp}`
    download(`${base}_kitchens.csv`, [['Kitchen', 'KOTs', 'Pick-up to ready (min:sec)', 'Late KOTs', 'Ready to dispatched (min:sec)', 'Remakes'],
      ...r.kitchenRows.map(x => [x.k.name, x.kots, mmss(x.fr), x.late, mmss(x.rd), x.remakes])])
    download(`${base}_dishes.csv`, [['Dish', 'Course', 'Kitchen', 'Plates', 'Served', 'Remakes', 'Cancelled'],
      ...r.dishRows.map(x => [x.name, x.course, x.kitchen, x.plates, x.served, x.remakes, x.cancelled])])
    download(`${base}_kots.csv`, [['KOT', 'Kitchen', 'Barker', 'Table', 'Cover', 'Course', 'Dishes', 'Picked up', 'Received', 'In preparation', 'Ready', 'Dispatched', 'Served', 'Remake'],
      ...r.orders.map(k => [k.kot_no, k.kitchen_name, k.barker + (k.barker_name ? ' ' + k.barker_name : ''), k.table_number, coverLabel(k.cover_no), k.course,
        (k.items || []).map(i => `${i.qty} x ${i.name}${i.note ? ' (' + i.note + ')' : ''}`).join('; '),
        k.fired_at, k.received_at, k.in_prep_at, k.ready_at, k.dispatched_at, k.served_at, k.is_remake ? 'yes' : ''])])
  }

  return (
    <div className="ms print-area">
      <div className="appbar" style={{ borderRadius: 12, marginBottom: 12 }}>
        <div className="lft">
          <div className="brandmk"><div className="lt"><img src={logo} alt="" /></div><div className="wm"><small>Smart Serve</small><b>Maestro</b></div></div>
          <div className="brandsep" />
          <div><div className="t">Reports · Service report</div>
            <div className="s">{r.E.name} · {r.E.number_of_tables} tables · {kpi.coversServed} covers served · {r.kitchenRows.length} kitchens</div></div>
        </div>
        <div className="r noprint">
          <button className="pill" onClick={exportAll}>Export CSV (Excel)</button>
          <button className="pill" onClick={() => window.print()}>Print / PDF</button>
        </div>
      </div>
      <div className="kpis">
        <div className="kpi"><small>Covers served</small><b>{kpi.coversServed}</b><span>of {kpi.coversSet} covers set</span></div>
        <div className="kpi"><small>Plates served</small><b>{kpi.plates.toLocaleString()}</b><span>{kpi.perCover ? kpi.perCover.toFixed(1) + ' per cover' : '–'}</span></div>
        <div className="kpi"><small>KOTs</small><b>{kpi.kots.toLocaleString()}</b><span>{kpi.printed} printed · one cover each</span></div>
        <div className="kpi"><small>Pick-up → ready</small><b>{mmss(kpi.fr)}</b><span>average, min:sec</span></div>
        <div className="kpi"><small>Late KOTs</small><b>{pct(kpi.late, kpi.kots)}</b><span>{kpi.late} of {kpi.kots}</span></div>
        <div className="kpi"><small>Ready → dispatched</small><b>{mmss(kpi.rd)}</b><span>average at the pass</span></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', gap: 12 }}>
        <div className="card">
          <h3>Average time from pick-up to ready, by kitchen</h3>
          <p className="sub">Minutes from pick-up to the plate being ready at the pass</p>
          {r.kitchenRows.map(x => (
            <div className="hbar" key={x.k.id}><span className="lb">{x.k.name}</span><span className="tr2"><i style={{ width: (100 * (x.fr || 0) / maxFr) + '%' }} /></span><span className="v">{mmss(x.fr)}</span></div>
          ))}
        </div>
        <div className="card">
          <h3>KOTs picked up per 10 minutes</h3>
          <p className="sub">Each wave is a course being picked up across the tables</p>
          {r.buckets.length ? (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 150, borderBottom: '1px solid var(--line)' }}>
              {r.buckets.map(b => (
                <div key={b.t} title={`${new Date(b.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}: ${b.n}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--slate)' }}>{b.n || ''}</span>
                  <i style={{ display: 'block', width: '100%', height: (100 * b.n / maxB) + '%', background: 'var(--navy2)', borderRadius: '4px 4px 0 0' }} />
                </div>
              ))}
            </div>
          ) : <div className="muted">No KOTs picked up yet.</div>}
          {r.buckets.length > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            <span>{new Date(r.buckets[0].t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
            <span>{new Date(r.buckets[r.buckets.length - 1].t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></div>}
        </div>
      </div>
      <div className="card">
        <h3>Kitchen summary</h3>
        <table className="tbl"><thead><tr><th>Kitchen</th><th className="n">KOTs</th><th className="n">Pick-up → ready</th><th className="n">Late</th><th className="n">Ready → dispatched</th><th className="n">Remakes</th></tr></thead>
          <tbody>{r.kitchenRows.map(x => <tr key={x.k.id}><td>{x.k.name}</td><td className="n">{x.kots}</td><td className="n">{mmss(x.fr)}</td><td className="n">{pct(x.late, x.kots)}</td><td className="n">{mmss(x.rd)}</td><td className="n">{x.remakes}</td></tr>)}</tbody></table>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', gap: 12 }}>
        <div className="card">
          <h3>Barkers</h3>
          <table className="tbl"><thead><tr><th>Kitchen · barker</th><th className="n">KOTs</th><th className="n">Pick-up → ready</th><th className="n">Late</th></tr></thead>
            <tbody>{r.barkerRows.map(x => <tr key={x.kitchen + x.side}><td>{x.kitchen} · {x.side}{x.name ? ' ' + x.name : ''}</td><td className="n">{x.kots}</td><td className="n">{mmss(x.fr)}</td><td className="n">{x.late}</td></tr>)}</tbody></table>
        </div>
        <div className="card">
          <h3>Course pacing and exceptions</h3>
          <p className="sub">Average gap between courses per cover: <b>{kpi.gap ? Math.round(kpi.gap / 60000) + ' min' : '–'}</b></p>
          <div className="kpis" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 0 }}>
            <div className="kpi"><b>{r.exceptions.cancellations}</b><small>Cancellations</small></div>
            <div className="kpi"><b>{r.exceptions.remakes}</b><small>Remakes</small></div>
            <div className="kpi"><b>{r.exceptions.reprints}</b><small>Reprints</small></div>
            <div className="kpi"><b>{r.exceptions.printFailures}</b><small>Print retries</small></div>
          </div>
        </div>
      </div>
      <div className="card">
        <h3>Dish summary</h3>
        <table className="tbl"><thead><tr><th>Dish</th><th>Course</th><th>Kitchen</th><th className="n">Plates</th><th className="n">Served</th><th className="n">Remakes</th><th className="n">Cancelled</th></tr></thead>
          <tbody>{r.dishRows.map(x => <tr key={x.name}><td>{x.name}</td><td>{x.course}</td><td>{x.kitchen}</td><td className="n">{x.plates}</td><td className="n">{x.served}</td><td className="n">{x.remakes}</td><td className="n">{x.cancelled}</td></tr>)}</tbody></table>
      </div>
    </div>
  )
}
