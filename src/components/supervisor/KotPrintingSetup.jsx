import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'

/* KOT printing for Guest Self-Service and Captain Service events.

     One KOT per category (switch): every order is split into one KOT per menu
       category (Starters, Mains, Desserts ...). Each KOT gets its own waiter and
       its own Delivered on Live Orders, and prints when the desk assigns the waiter.
     Printers: the event's KOT printers (Wi-Fi or LAN, on our router), each with
       an address. The Print Hub on the event laptop prints on them.
     Categories: which printer each category's KOTs print on. A category left on
       "Default" uses the default printer; an event with no printers prints every
       KOT at the desk, on the desk computer's own printer (USB), as before.

   The printers are rows of the kitchens table (the same rows the Print Hub, the
   test print and the multi-kitchen events use). */

const catLabel = name => { const s = String(name || ''); const i = s.indexOf(' - '); return i === -1 ? s : s.slice(i + 3).trim() }
const STALE_MS = 2 * 60 * 1000

export default function KotPrintingSetup({ eventData, onEventChange }) {
  const ev = eventData
  const on = !!ev.kot_per_category
  const [printers, setPrinters] = useState(null)
  const [cats, setCats] = useState([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [tests, setTests] = useState({})     // printer id -> { phase, error }
  const [now, setNow] = useState(Date.now())
  const alive = useRef(true)

  async function load() {
    const [k, c] = await Promise.all([
      supabase.from('kitchens').select('*').eq('event_id', ev.id).order('sort_order').order('created_at'),
      supabase.from('menu_categories').select('id,name,sort_order,is_visible,kitchen_id').eq('event_id', ev.id).order('sort_order'),
    ])
    if (!alive.current) return
    if (!k.error) setPrinters(k.data || [])
    if (!c.error) setCats(c.data || [])
  }
  useEffect(() => {
    alive.current = true
    const first = setTimeout(load, 0)
    // printer status comes from the Print Hub; read it again every 10 s
    const t = setInterval(() => { load(); setNow(Date.now()) }, 10000)
    return () => { alive.current = false; clearTimeout(first); clearInterval(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ev.id])

  async function toggle() {
    setBusy(true); setMsg('')
    const { data, error } = await supabase.from('events').update({ kot_per_category: !on }).eq('id', ev.id).select().single()
    setBusy(false)
    if (error || !data) {
      setMsg(/kot_per_category/.test(error?.message || '') ? 'The database needs the update first: run 2026-10-22_kot_per_category.sql in Supabase.' : 'Not saved: ' + (error?.message || 'try again'))
      return
    }
    onEventChange?.(data)
  }

  async function addPrinter() {
    const n = (printers?.length || 0) + 1
    const { error } = await supabase.from('kitchens').insert({ event_id: ev.id, name: 'Printer ' + n, prefix: 'P' + n,
      sort_order: n, is_active: true, is_default: n === 1 })
    if (error) setMsg('Not added: ' + error.message)
    load()
  }
  async function save(p, patch) {
    const { error } = await supabase.from('kitchens').update(patch).eq('id', p.id)
    if (error) setMsg('Not saved: ' + error.message)
    load()
  }
  async function makeDefault(p) {
    await supabase.from('kitchens').update({ is_default: false }).eq('event_id', ev.id)
    await save(p, { is_default: true })
  }
  async function remove(p) {
    const n = cats.filter(c => c.kitchen_id === p.id).length
    if (!window.confirm('Remove ' + p.name + '?' + (n ? '\n\n' + n + ' categor' + (n === 1 ? 'y goes' : 'ies go') + ' back to the default printer.' : ''))) return
    const { error } = await supabase.from('kitchens').delete().eq('id', p.id)
    if (error) setMsg('Not removed: ' + error.message)
    load()
  }
  async function setCat(c, kitchenId) {
    setCats(list => list.map(x => (x.id === c.id ? { ...x, kitchen_id: kitchenId || null } : x)))
    const { error } = await supabase.from('menu_categories').update({ kitchen_id: kitchenId || null }).eq('id', c.id)
    if (error) { setMsg('Not saved: ' + error.message); load() }
  }

  async function testPrint(p) {
    setTests(t => ({ ...t, [p.id]: { phase: 'sending' } }))
    const { data, error } = await supabase.from('kots').insert({ event_id: ev.id, kitchen_id: p.id, kind: 'test',
      kitchen_name: p.name, kot_no: 'TEST', items: [], status: 'open' }).select('id').single()
    if (error || !data) { setTests(t => ({ ...t, [p.id]: { phase: 'failed', error: error?.message || 'not sent' } })); return }
    const started = Date.now()
    for (;;) {
      await new Promise(r => setTimeout(r, 1500))
      if (!alive.current) return
      const { data: row } = await supabase.from('kots').select('print_status,last_error').eq('id', data.id).maybeSingle()
      if (row?.print_status === 'printed') { setTests(t => ({ ...t, [p.id]: { phase: 'printed' } })); return }
      if (row?.print_status === 'failed') { setTests(t => ({ ...t, [p.id]: { phase: 'failed', error: row.last_error || 'printer did not answer' } })); return }
      if (Date.now() - started > 20000) { setTests(t => ({ ...t, [p.id]: { phase: 'waiting' } })); return }
    }
  }

  const list = printers || []
  const def = list.find(p => p.is_default && p.is_active) || list.find(p => p.is_active) || null
  const dupIp = ip => ip && list.filter(p => String(p.printer_ip || '').trim() === String(ip).trim()).length > 1
  const shown = [...cats].sort((a, b) => (b.is_visible !== false) - (a.is_visible !== false) || (a.sort_order ?? 0) - (b.sort_order ?? 0))
  const box = { background:'#fff', borderRadius:14, padding:'14px 16px', marginBottom:12, boxShadow:'var(--shadow)' }
  const fld = { border:'1.5px solid var(--line)', borderRadius:9, padding:'7px 10px', fontSize:13.5, minWidth:0 }

  return (
    <div data-testid="kot-printing">
      <div style={box}>
        <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
          <div style={{ flex:1, minWidth:220 }}>
            <div style={{ fontWeight:900, fontSize:15 }}>One KOT per category</div>
            <div style={{ fontSize:12.5, color:'var(--ink2)', marginTop:3, lineHeight:1.5 }}>
              {on
                ? 'On: every order is split into one KOT per category (Starters, Mains, Desserts…). Each KOT has its own card on Live Orders, its own waiter and its own Delivered, and prints when you assign the waiter.'
                : 'Off: one KOT per order, printed at the desk when you assign the waiter (as before).'}
            </div>
          </div>
          <button onClick={toggle} disabled={busy} data-testid="kpc-toggle"
            style={{ border:'none', borderRadius:999, padding:'9px 18px', fontSize:13.5, fontWeight:800, cursor:'pointer',
              background: on ? '#16A34A' : 'var(--ink)', color:'#fff' }}>{on ? 'ON · turn off' : 'Turn on'}</button>
        </div>
        {msg && <div style={{ marginTop:8, fontSize:12.5, color:'#B91C1C', fontWeight:700 }}>{msg}</div>}
      </div>

      {on && <>
        <div style={box}>
          <div style={{ display:'flex', alignItems:'baseline', gap:8, marginBottom:8, flexWrap:'wrap' }}>
            <span style={{ fontWeight:900, fontSize:15 }}>Printers</span>
            <span style={{ fontSize:12.5, color:'var(--ink2)' }}>
              {list.length ? 'Wi-Fi or LAN printers on our router; the Print Hub on the event laptop prints on them.'
                : 'None yet: every KOT prints at the desk on this computer\'s printer (USB). For two or more printers, add them here.'}
            </span>
          </div>
          {list.map(p => {
            const t = tests[p.id]
            const fresh = p.printer_checked_at && now - new Date(p.printer_checked_at).getTime() < STALE_MS
            const st = !String(p.printer_ip || '').trim() ? { t:'No address', c:'#92400E', b:'#FEF3C7' }
              : !fresh ? { t:'Not checked (Print Hub off?)', c:'#475569', b:'#F1F5F9' }
              : p.printer_status === 'online' ? { t:'Online', c:'#15803D', b:'#DCFCE7' }
              : { t: p.printer_status === 'paper_out' ? 'Paper out' : 'Offline', c:'#B91C1C', b:'#FEE2E2' }
            return (
              <div key={p.id} data-printer={p.name} style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', padding:'8px 0', borderTop:'1px solid var(--line)' }}>
                <input defaultValue={p.name} key={'n' + p.id + p.name} onBlur={e => e.target.value.trim() && e.target.value.trim() !== p.name && save(p, { name: e.target.value.trim() })}
                  style={{ ...fld, width:170, fontWeight:800 }} aria-label="Printer name" />
                <input defaultValue={p.prefix || ''} key={'x' + p.id + p.prefix} maxLength={4} title="KOT letters: KOT numbers read L-001, L-002 …"
                  onBlur={e => e.target.value.trim().toUpperCase() !== (p.prefix || '') && save(p, { prefix: e.target.value.trim().toUpperCase() || null })}
                  style={{ ...fld, width:62, textTransform:'uppercase' }} aria-label="KOT letters" />
                <input defaultValue={p.printer_ip || ''} key={'i' + p.id + p.printer_ip} placeholder="Printer address, e.g. 192.168.1.50"
                  onBlur={e => e.target.value.trim() !== (p.printer_ip || '') && save(p, { printer_ip: e.target.value.trim() || null, printer_port: 9100 })}
                  style={{ ...fld, width:210, borderColor: dupIp(p.printer_ip) ? '#DC2626' : 'var(--line)' }} aria-label="Printer address" />
                <span style={{ fontSize:11.5, fontWeight:800, color:st.c, background:st.b, borderRadius:999, padding:'3px 10px' }}>{st.t}</span>
                <button onClick={() => testPrint(p)} disabled={!String(p.printer_ip || '').trim() || t?.phase === 'sending'}
                  style={{ border:'1.5px solid var(--ink)', background:'#fff', borderRadius:9, padding:'6px 12px', fontSize:12.5, fontWeight:800, cursor:'pointer' }}>🖨 Test print</button>
                {t && <span style={{ fontSize:12, fontWeight:700, color: t.phase === 'printed' ? '#15803D' : t.phase === 'failed' ? '#B91C1C' : '#475569' }}>
                  {t.phase === 'sending' ? 'Sending…' : t.phase === 'printed' ? 'Printed ✓' : t.phase === 'failed' ? 'Failed: ' + t.error : 'Waiting for the Print Hub – is it running?'}</span>}
                <span style={{ flex:1 }} />
                {def && def.id === p.id
                  ? <span style={{ fontSize:11.5, fontWeight:800, color:'#1D4ED8', background:'#EFF6FF', borderRadius:999, padding:'3px 10px' }}>Default</span>
                  : <button onClick={() => makeDefault(p)} style={{ border:'none', background:'none', color:'#1D4ED8', fontWeight:800, fontSize:12.5, cursor:'pointer' }}>Make default</button>}
                <button onClick={() => remove(p)} style={{ border:'none', background:'none', color:'#B91C1C', fontWeight:800, fontSize:12.5, cursor:'pointer' }}>Remove</button>
                {dupIp(p.printer_ip) && <div style={{ width:'100%', fontSize:12, color:'#B91C1C', fontWeight:700 }}>Two printers have the same address.</div>}
              </div>
            )
          })}
          <button onClick={addPrinter} data-testid="add-printer"
            style={{ marginTop:8, border:'1.5px dashed var(--line)', background:'var(--bg)', borderRadius:10, padding:'8px 14px', fontSize:13, fontWeight:800, cursor:'pointer' }}>+ Add printer</button>
        </div>

        <div style={box}>
          <div style={{ display:'flex', alignItems:'baseline', gap:8, marginBottom:8, flexWrap:'wrap' }}>
            <span style={{ fontWeight:900, fontSize:15 }}>Categories</span>
            <span style={{ fontSize:12.5, color:'var(--ink2)' }}>Each category is its own KOT; choose the printer it prints on (also on the Menu tab).</span>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(260px, 1fr))', gap:8 }}>
            {shown.map(c => (
              <label key={c.id} data-cat={c.name} style={{ display:'flex', alignItems:'center', gap:8, background: c.is_visible === false ? '#F8FAFC' : '#fff',
                border:'1px solid var(--line)', borderRadius:10, padding:'7px 10px', opacity: c.is_visible === false ? 0.6 : 1 }}>
                <span style={{ flex:1, minWidth:0, fontWeight:700, fontSize:13, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={c.name}>
                  {catLabel(c.name)}{c.is_visible === false ? ' (hidden)' : ''}</span>
                <select value={c.kitchen_id || ''} onChange={e => setCat(c, e.target.value)} style={{ ...fld, padding:'5px 8px', fontSize:12.5 }}>
                  <option value="">{def ? 'Default · ' + def.name : 'Desk printer'}</option>
                  {list.filter(p => p.is_active).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
            ))}
            {!shown.length && <div style={{ fontSize:12.5, color:'var(--ink2)' }}>No categories yet: add the menu under the Menu tab.</div>}
          </div>
          <div style={{ fontSize:12, color:'var(--ink2)', marginTop:10, lineHeight:1.5 }}>
            How it prints: a printer with an address prints through the <b>Print Hub</b> on the event laptop (Offline Kit, “Start Print Hub”).
            With no printers, KOTs print at the desk on this computer's printer, as before.
          </div>
        </div>
      </>}
    </div>
  )
}
