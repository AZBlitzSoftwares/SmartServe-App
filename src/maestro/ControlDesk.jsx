/* Smart Serve Maestro - Control Desk (operations head, laptop at the desk).

   The whole service at a glance: every kitchen's queue and printer, the
   progress of every table (click one to see its covers and every order, as
   the captain sees it) and what needs attention (sorted by urgency, each
   with its action). The same laptop runs the Print Hub.
   readOnly: the Control Desk screen, a big screen anyone may look at: everything is shown,
   nothing can be changed (no actions on alerts, no reprint or void in a table). */
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import logo from '../assets/janus_logo.jpg'
import './maestro.css'
import TableView from './TableView'
import { lateMinutes, useLive, useNow, rpc, errText, mmss, clockText, ago, tc, eventDishes, captainsForCover, coversOf, chairsOf } from './msData'

const WAIT_MS = 2 * 60000      // a plate Ready this long without a steward is an alert

export default function ControlDesk({ eventData, onShowPrinters, readOnly = false }) {
  const ev = eventData
  const now = useNow(1000)
  const [acked, setAcked] = useState({})   // alert key -> until (ms)
  const [openTable, setOpenTable] = useState(null)
  const [toast, setToast] = useState(null)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), toast.err ? 6000 : 3500)
    return () => clearTimeout(t)
  }, [toast])
  const [busy, setBusy] = useState(false)

  const q = useLive(async () => {
    const since = new Date(Date.now() - 18 * 3600e3).toISOString()
    // Open KOTs with their dishes (alerts name them); finished ones without, as with one KOT
    // per dish an evening adds up to a thousand or more
    const KCOLS = 'id,kot_no,kitchen_id,kitchen_name,table_number,cover_no,barker,barker_name,course,stage,fired_at,received_at,in_prep_at,ready_at,dispatched_at,served_at,status,kind,print_status,last_error,is_remake,created_at'
    const [evr, kitchens, kotsOpen, kotsDone, items, covers, caps, barkers, sos, sold] = await Promise.all([
      supabase.from('events').select('*').eq('id', ev.id).maybeSingle(),
      supabase.from('kitchens').select('*').eq('event_id', ev.id).eq('is_active', true).order('sort_order'),
      supabase.from('kots').select(KCOLS + ',items').eq('event_id', ev.id).eq('status', 'open').gte('created_at', since),
      supabase.from('kots').select(KCOLS).eq('event_id', ev.id).neq('status', 'open').gte('created_at', since),
      supabase.from('ms_items').select('id,table_number,cover_no,course,state,fired_at,served_at,held_at,kitchen_id').eq('event_id', ev.id),
      supabase.from('ms_covers').select('table_number,cover_no,seated_at').eq('event_id', ev.id),
      supabase.from('captains').select('*').eq('event_id', ev.id),
      supabase.from('barkers').select('id,name,side,kitchen_id,is_active,last_seen_at').eq('event_id', ev.id),
      supabase.from('sos_requests').select('id,table_id,table_number,captain_id,request_type,status,created_at,tables(table_number)').eq('event_id', ev.id).in('status', ['open', 'acknowledged', 'in_progress']),
      eventDishes(ev.id, 'id,name,is_available,sold_out_at,sold_out_by'),
    ])
    for (const r of [kitchens, kotsOpen, kotsDone, items]) if (r.error) throw r.error
    return {
      ev: evr.data || ev, kitchens: kitchens.data || [], kots: [...(kotsOpen.data || []), ...(kotsDone.data || [])], items: items.data || [],
      covers: covers.data || [], caps: (caps.data || []).filter(c => c.is_active !== false), barkers: (barkers.data || []).filter(b => b.is_active !== false),
      sos: sos.error ? [] : (sos.data || []), sold: (sold.data || []).filter(m => m.is_available === false && m.sold_out_at),
    }
  }, { eventId: ev.id, tables: ['kots', 'ms_items', 'ms_covers', 'kitchens', 'sos_requests'], intervalMs: 4000, minGapMs: 2500 })

  const d = q.data
  const E = d?.ev || ev
  const kitchenById = useMemo(() => Object.fromEntries((d?.kitchens || []).map(k => [k.id, k])), [d])
  const orders = (d?.kots || []).filter(k => k.kind === 'order' && k.status !== 'cancelled')
  const lateOf = k => lateMinutes(kitchenById[k.kitchen_id], E)
  // Late: not delivered within the kitchen alert time
  const doneAt = k => k.dispatched_at || k.served_at
  const isLate = k => k.stage !== 'dispatched' && !k.served_at && now - new Date(k.fired_at || k.created_at) > lateOf(k) * 60000
  const fireDone = orders.filter(k => doneAt(k) && k.fired_at).map(k => new Date(doneAt(k)) - new Date(k.fired_at)).filter(x => x >= 0)
  const avgFR = fireDone.length ? fireDone.reduce((a, b) => a + b, 0) / fireDone.length : null
  const plates = (d?.items || []).filter(i => i.state !== 'cancelled')
  const platesOrdered = plates.length
  const tables = Math.max(1, Number(E.number_of_tables) || 0)
  // every chair counts: C1–C8, 1A, 2A at a table of 10 (a table can have its own number)
  const covers = Array.from({ length: tables }, (_, i) => chairsOf(E, i + 1)).reduce((a, b) => a + b, 0)
  const seatedN = (d?.covers || []).filter(c => c.seated_at).length

  // ---------------------------------------------------------------- alerts
  const alerts = []
  if (d) {
    // Late KOTs: one line each, unless a kitchen has several - then one line
    // for that kitchen, so a slow kitchen does not push everything else away.
    const lateByK = {}
    for (const k of orders.filter(isLate)) (lateByK[k.kitchen_id] ||= []).push(k)
    const stageText = k => k.stage === 'new' ? 'not on the kitchen screen' : 'not delivered'
    for (const [kid, list] of Object.entries(lateByK)) {
      const ages = list.map(k => now - new Date(k.fired_at || k.created_at))
      if (list.length > 2) {
        const oldest = list[ages.indexOf(Math.max(...ages))]
        const barkers = [...new Set(list.map(k => `${k.barker || 'A'}${k.barker_name ? ' ' + k.barker_name : ''}`))].join(', ')
        const key = `late-k-${kid}-${list.length}`
        alerts.push({
          key, w: 100 + Math.max(...ages) / 60000, icon: '!', color: 'var(--red)',
          title: `${list.length} KOTs late in ${kitchenById[kid]?.name || oldest.kitchen_name}`,
          sub: `Oldest ${oldest.kot_no} ${stageText(oldest)} ${mmss(Math.max(...ages))} · Barker ${barkers} · ${list.map(k => k.kot_no).slice(0, 6).join(', ')}${list.length > 6 ? '…' : ''}`,
          action: 'Call kitchen', onAct: () => ack(key, 3),
        })
        continue
      }
      list.forEach((k, i) => alerts.push({
        key: 'late-' + k.id, w: 100 + ages[i] / 60000, icon: '!', color: 'var(--red)',
        title: `${k.kot_no} ${stageText(k)} ${mmss(ages[i])}`,
        sub: `${k.kitchen_name} · Barker ${k.barker || 'A'}${k.barker_name ? ' ' + k.barker_name : ''} · ${(k.items || []).map(x => `${x.qty} × ${x.name}`).join(', ')} · ${tc(k.table_number, k.cover_no)}`,
        action: 'Call kitchen', onAct: () => ack('late-' + k.id, 3),
      }))
    }
    // A KOT is in progress the moment a kitchen screen shows it. Still New after a
    // minute: no screen of that kitchen is open, the printed slip is the only copy.
    for (const kt of d.kitchens) {
      const unseen = orders.filter(k => k.kitchen_id === kt.id && k.stage === 'new' && now - new Date(k.fired_at || k.created_at) > 60000)
      if (!unseen.length) continue
      const key = 'unseen-' + kt.id + '-' + unseen.length
      alerts.push({
        key, w: 95, icon: 'K', color: 'var(--warn)',
        title: `${unseen.length} KOT${unseen.length === 1 ? '' : 's'} not on the ${kt.name} kitchen screen`,
        sub: `${unseen.map(k => k.kot_no).slice(0, 6).join(', ')} · no ${kt.name} kitchen screen is open · ask the barker to open it`,
        action: 'Seen', onAct: () => ack(key, 5),
      })
    }
    for (const kt of d.kitchens) {
      const failed = (d.kots || []).filter(k => k.kitchen_id === kt.id && k.print_status === 'failed' && k.status !== 'cancelled')
      const down = ['offline', 'paper_out', 'error'].includes(kt.printer_status)
      if (down || failed.length) {
        alerts.push({
          key: 'pr-' + kt.id + '-' + failed.length, w: 90, icon: 'P', color: 'var(--warn)',
          title: down ? `${kt.name} printer ${kt.printer_status === 'paper_out' ? 'out of paper' : 'not responding'}` : `${failed.length} KOT${failed.length === 1 ? '' : 's'} did not print in ${kt.name}`,
          sub: failed.length ? `${failed.map(k => k.kot_no).join(', ')} · ${kt.backup_printer_ip ? 'the backup printer takes over automatically' : 'reprint, or send to another printer'}` : 'KOTs go to the backup printer automatically; they are also on the barker\'s screen',
          action: failed.length ? 'Reprint' : 'Seen', onAct: failed.length ? () => reprint(failed) : () => ack('pr-' + kt.id + '-0', 10),
        })
      }
      // Barker B's own printer
      const bDown = (Number(kt.barkers) || 2) >= 2 && String(kt.printer_ip_b || '').trim() && ['offline', 'paper_out', 'error'].includes(kt.printer_b_status)
      if (bDown) {
        alerts.push({
          key: 'prb-' + kt.id, w: 90, icon: 'P', color: 'var(--warn)',
          title: `${kt.name} Barker B printer ${kt.printer_b_status === 'paper_out' ? 'out of paper' : 'not responding'}`,
          sub: 'Barker B\'s KOTs print on the Barker A printer automatically; they are also on the barker\'s screen',
          action: 'Seen', onAct: () => ack('prb-' + kt.id, 10),
        })
      }
    }
    const waiting = orders.filter(k => k.stage === 'ready' && k.ready_at && now - new Date(k.ready_at) > WAIT_MS)
    const wByK = {}
    for (const k of waiting) (wByK[k.kitchen_id] ||= []).push(k)
    for (const [kid, list] of Object.entries(wByK)) {
      const oldest = Math.max(...list.map(k => now - new Date(k.ready_at)))
      alerts.push({
        key: 'wait-' + kid + '-' + list.length, w: 80 + oldest / 60000, icon: 'W', color: 'var(--warn)',
        title: `${list.length} plate${list.length === 1 ? '' : 's'} waiting for a steward for ${Math.floor(oldest / 60000)} min`,
        sub: `${kitchenById[kid]?.name || 'Kitchen'} pass · more stewards needed`, action: 'Send stewards', onAct: () => ack('wait-' + kid + '-' + list.length, 3),
      })
    }
    const pacing = Number(E.pacing_minutes) || 25
    const byCover = {}
    for (const i of d.items) if (i.state !== 'cancelled') (byCover[i.table_number + '|' + i.cover_no] ||= []).push(i)
    for (const c of d.covers.filter(x => x.seated_at)) {
      const its = byCover[c.table_number + '|' + c.cover_no] || []
      const held = its.filter(i => i.state === 'held')
      if (!held.length) continue
      const last = Math.max(new Date(c.seated_at).getTime(), ...its.filter(i => i.fired_at).map(i => new Date(i.fired_at).getTime()))
      const open = its.some(i => i.state === 'fired' && !i.served_at)
      if (!open && now - last > pacing * 60000) {
        const cap = captainsForCover(d.caps, c.table_number, c.cover_no, coversOf(E, c.table_number)).map(x => x.name).join(', ')
        const key = `pace-${c.table_number}-${c.cover_no}`
        alerts.push({
          key, w: 60, icon: 'P', color: 'var(--blue)',
          title: `Pacing: nothing picked up for ${tc(c.table_number, c.cover_no)} in ${Math.floor((now - last) / 60000)} min`,
          sub: `Held: ${[...new Set(held.map(i => i.course))].join(', ')}${cap ? ' · table captain ' + cap : ''}`,
          action: 'Seen', onAct: () => ack(key, 10),
        })
      }
    }
    for (const s of d.sos) {
      const t = s.tables?.table_number ?? s.table_number
      const cap = d.caps.find(c => c.id === s.captain_id)?.name
      alerts.push({
        key: 'sos-' + s.id, w: 70, icon: 'H', color: 'var(--navy2)',
        title: `Help requested${t ? ' · table T' + t : ''}`, sub: `${cap ? 'Table captain ' + cap + ' · ' : ''}${ago(s.created_at, now)}`,
        action: 'Resolve', onAct: () => resolve(s),
      })
    }
    for (const m of d.sold) {
      alerts.push({
        key: 'so-' + m.id, w: 10, icon: 'S', color: 'var(--slate)',
        title: `${m.name} marked sold out`, sub: `${m.sold_out_by ? 'By ' + m.sold_out_by + ' · ' : ''}shown as sold out on every captain tablet`,
        action: 'Undo', onAct: () => undoSold(m),
      })
    }
  }
  const shown = alerts.filter(a => !(acked[a.key] > now)).sort((a, b) => b.w - a.w)

  function ack(key, minutes) { setAcked(x => ({ ...x, [key]: Date.now() + minutes * 60000 })) }
  async function run(fn, ok) {
    setBusy(true)
    try { await fn(); if (ok) setToast({ text: ok }); q.reload() } catch (e) { setToast({ text: errText(e), err: true }) }
    setBusy(false)
  }
  const reprint = list => run(async () => { for (const k of list) await rpc('ms_reprint', { p_kot_id: k.id, p_printer_ip: null }) }, `${list.length} KOT${list.length === 1 ? '' : 's'} sent to print again`)
  const resolve = s => run(async () => {
    const { error } = await supabase.from('sos_requests').update({ status: 'resolved', resolved_at: new Date().toISOString() }).eq('id', s.id)
    if (error) throw error
  }, 'Help request resolved')
  const undoSold = m => run(() => rpc('ms_sold_out', { p_menu_item_id: m.id, p_sold_out: false, p_by: 'Control Desk' }), `${m.name} is available again`)

  // ---------------------------------------------------------------- tables
  const tableStats = useMemo(() => {
    const m = {}
    for (const i of plates) {
      const t = (m[i.table_number] ||= { ordered: 0, served: 0, late: false })
      t.ordered++
      if (i.served_at) t.served++
    }
    for (const k of orders) if (isLate(k)) (m[k.table_number] ||= { ordered: 0, served: 0, late: false }).late = true
    // dishes picked up and still in the kitchen, per table
    for (const k of orders) if (!doneAt(k)) { const t = (m[k.table_number] ||= { ordered: 0, served: 0, late: false }); t.kit = (t.kit || 0) + 1 }
    for (const c of d?.covers || []) if (c.seated_at) { const t = (m[c.table_number] ||= { ordered: 0, served: 0, late: false }); t.seated = (t.seated || 0) + 1 }
    for (const s of d?.sos || []) { const n = s.tables?.table_number ?? s.table_number; if (n) (m[n] ||= { ordered: 0, served: 0, late: false }).help = true }
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, now])

  // One pill per KOT printer: a two-barker kitchen shows Barker A's and Barker B's printer
  const pill = (s, label, key) => {
    if (s === 'online') return <span key={key} className="pr pon">{label ? label + ' OK' : 'Printer OK'}</span>
    if (s === 'paper_low') return <span key={key} className="pr pon">{label ? label + ' paper low' : 'Paper low'}</span>
    if (['offline', 'paper_out', 'error'].includes(s)) return <span key={key} className="pr poff">{label ? label + (s === 'paper_out' ? ' paper out' : ' not responding') : (s === 'paper_out' ? 'Paper out' : 'Printer not responding')}</span>
    return <span key={key} className="pr punk">{label ? label + ' ?' : 'Printer ?'}</span>
  }
  const hasB = kt => (Number(kt.barkers) || 2) >= 2 && !!String(kt.printer_ip_b || '').trim()
  const printerPill = kt => {
    if (!hasB(kt)) {
      if ((Number(kt.barkers) || 2) >= 2 && 'printer_ip_b' in kt) {
        return <span className="prs">{pill(kt.printer_status, 'A', 'a')}<span className="pr punk" title="Barker B has no printer: its KOTs print on Barker A's printer">B on A</span></span>
      }
      return pill(kt.printer_status, '', 'a')
    }
    return <span className="prs">{pill(kt.printer_status, 'A', 'a')}{pill(kt.printer_b_status, 'B', 'b')}</span>
  }

  return (
    <div className="ms desk">
      <div className="appbar">
        <div className="lft">
          <div className="brandmk"><div className="lt"><img src={logo} alt="" /></div><div className="wm"><small>Smart Serve</small><b>Maestro</b></div></div>
          <div className="brandsep" />
          <div><div className="t">Control Desk · {E.name}</div>
            <div className="s">{tables} tables · {covers} covers ({seatedN} seated) · {d?.kitchens.length ?? '–'} kitchens · {d?.caps.length ?? '–'} table captains · {d?.barkers.length ?? '–'} barkers</div></div>
        </div>
        <div className="r">
          <span className="pill">Plates ordered {platesOrdered}</span>
          <span className="pill">Avg. pick-up to delivered {mmss(avgFR)}</span>
          {!q.online && <span className="pill" style={{ background: 'var(--red)' }}>Offline</span>}
          {readOnly && <span className="pill">View only</span>}
          <span className="pill">{clockText(new Date(now))}</span>
          {onShowPrinters && !readOnly && <button className="pill" onClick={onShowPrinters}>Printers &amp; print queue</button>}
        </div>
      </div>
      {!d ? <div className="empty">Loading the service…</div> : (
        <>
          <div className="kits">
            {d.kitchens.map(kt => {
              const ks = orders.filter(k => k.kitchen_id === kt.id && !k.served_at && k.stage !== 'dispatched')
              const n = ks.length
              const dn = orders.filter(k => k.kitchen_id === kt.id && (k.served_at || k.stage === 'dispatched')).length
              const l = ks.filter(isLate).length
              const fr = orders.filter(k => k.kitchen_id === kt.id && doneAt(k) && k.fired_at).map(k => new Date(doneAt(k)) - new Date(k.fired_at)).filter(x => x >= 0)
              const bs = d.barkers.filter(b => b.kitchen_id === kt.id)
              return (
                <div className="kt" key={kt.id}>
                  <h5>{kt.name}{printerPill(kt)}</h5>
                  <div className="n3"><div><b>{n}</b>In progress</div><div className={l ? 'l' : ''}><b>{l}</b>Late</div><div><b>{dn}</b>Delivered</div></div>
                  <div className="meta"><span>{bs.length ? <>Barkers {bs.sort((a, b) => a.side.localeCompare(b.side)).map(b => (
                    <span key={b.id} className="bk" title={`Barker ${b.side} · ${b.name} · ${b.last_seen_at && now - new Date(b.last_seen_at) < 90000 ? 'screen on' : 'screen not open'}`}>
                      {b.side}<i className={b.last_seen_at && now - new Date(b.last_seen_at) < 90000 ? 'on' : 'off'} /></span>))}</> : 'No barker yet'}</span><span>Avg {mmss(fr.length ? fr.reduce((a, b) => a + b, 0) / fr.length : null)}</span></div>
                </div>
              )
            })}
          </div>
          <div className="lo">
            <div className="pan"><h4>Tables <span>click a table to see its covers and every order · dishes delivered / ordered</span></h4>
              <div className="tg">
                {Array.from({ length: tables }, (_, i) => i + 1).map(t => {
                  const s = tableStats[t] || { ordered: 0, served: 0, late: false }
                  return (
                    <button className={'tb' + (s.late ? ' l' : '') + (s.help ? ' h' : '')} key={t} onClick={() => setOpenTable(t)} title={`Open table T${t}`}>
                      <b>T{t}{s.help && <i className="hdot" title="Help requested" />}</b>{s.served}/{s.ordered} delivered
                      <small>{s.seated || 0} seated · {s.kit || 0} in kitchen{s.late ? ' · late' : ''}</small>
                      <div className="pbar"><i style={{ width: (s.ordered ? Math.round(100 * s.served / s.ordered) : 0) + '%', background: s.late ? 'var(--red)' : undefined }} /></div>
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="pan"><h4>Needs attention <span>sorted by urgency</span></h4>
              <div style={{ overflowY: 'auto', minHeight: 0 }}>
                {shown.length ? shown.map(a => (
                  <div className="al" key={a.key}>
                    <div className="ic" style={{ background: a.color }}>{a.icon}</div>
                    <div style={{ minWidth: 0 }}><b>{a.title}</b><small>{a.sub}</small></div>
                    {!readOnly && <button className="ac" disabled={busy} onClick={a.onAct}>{a.action}</button>}
                  </div>
                )) : <div className="empty">All clear. Late dishes, printer problems, waiting plates, pacing, help requests and sold-out dishes appear here.</div>}
              </div>
            </div>
          </div>
        </>
      )}
      {openTable != null && <TableView ev={E} table={openTable} caps={d?.caps || []} kitchens={d?.kitchens || []} readOnly={readOnly} onClose={() => setOpenTable(null)} />}
      {toast && (
        <div className={'toast' + (toast.err ? ' err' : '')}>
          {toast.text}<button onClick={() => setToast(null)}>OK</button>
        </div>
      )}
    </div>
  )
}
