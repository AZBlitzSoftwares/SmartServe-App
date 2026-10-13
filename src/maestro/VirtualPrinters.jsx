/* Virtual printers: five kitchen printers that live in the cloud, for demos and training.

   A kitchen whose printer is VIRTUAL-1 … VIRTUAL-5 (Event set-up › Kitchens & printers) has its
   KOTs printed by the server the moment they are made (db/2026-10-14_maestro_v6.sql).
   This screen shows those slips as they come out of a real printer: the same layout (the Print
   Hub's escpos.mjs), newest on top, one column per printer. Nothing to start on any laptop:
   open /printers?event=<event id> (the link is in Kitchens & printers) on any screen. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { buildKot, decodeEscPos } from '../../printhub/escpos.mjs'

const PRINTERS = [1, 2, 3, 4, 5]
const POLL_MS = 2500
const SHOW = 25

const CSS = `
.vp { min-height:100vh; background:radial-gradient(1200px 600px at 50% -200px, #3a2342 0%, transparent 70%), #1b1220; color:#f5f0f8;
  font:14px/1.4 Manrope, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; display:flex; flex-direction:column; }
.vp .top { display:flex; align-items:center; gap:14px; flex-wrap:wrap; padding:14px 22px 12px; border-bottom:1px solid rgba(255,255,255,.07); }
.vp .top h1 { font-size:18px; margin:0; font-weight:900; }
.vp .top h1 small { display:block; font-size:12px; font-weight:600; color:#a898b3; }
.vp .top .sp { flex:1 }
.vp .top button { font:inherit; font-size:12.5px; font-weight:800; color:#f5f0f8; background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.12);
  border-radius:999px; padding:6px 12px; cursor:pointer; }
.vp .top .live { font-size:12px; font-weight:800; color:#22c55e; }
.vp .top .live.off { color:#f5a524; }
.vp .cols { flex:1; display:grid; grid-template-columns:repeat(5, minmax(300px, 1fr)); gap:14px; padding:14px 18px 24px; overflow-x:auto; align-items:start; }
.vp .col { min-width:0; container-type:inline-size; }
.vp .dev { background:linear-gradient(180deg, #2d2433, #221b28); border:1px solid rgba(255,255,255,.07); border-radius:14px; padding:10px 12px 12px; position:sticky; top:0; z-index:2; }
.vp .dev .d1 { display:flex; align-items:center; gap:8px; }
.vp .dev .d1 b { font-size:14px; }
.vp .dev .led { width:9px; height:9px; border-radius:50%; background:#22c55e; box-shadow:0 0 8px #22c55e; }
.vp .dev .led.idle { background:#625a6b; box-shadow:none; }
.vp .dev .n { margin-left:auto; font-size:12px; color:#a898b3; font-weight:700; }
.vp .dev .k { font-size:12.5px; color:#e8890c; font-weight:800; margin-top:3px; min-height:18px; }
.vp .dev .k.none { color:#6f6378; font-weight:600; }
.vp .dev .slot { height:6px; border-radius:3px; background:#120c15; margin-top:9px; box-shadow:inset 0 1px 3px rgba(0,0,0,.6); }
.vp .feed { display:flex; flex-direction:column; align-items:center; gap:12px; padding-top:10px; }
.vp .item { display:flex; flex-direction:column; align-items:center; gap:4px; }
.vp .meta { font-size:11.5px; color:#a898b3; font-weight:700; display:flex; gap:8px; align-items:center; }
.vp .meta .new { background:#e8890c; color:#1b1220; border-radius:999px; padding:0 7px; font-weight:900; }
.vp .shadow { filter:drop-shadow(0 8px 12px rgba(0,0,0,.45)) drop-shadow(0 1px 1px rgba(0,0,0,.3)); }
.vp .slip { --z:6px; --fs:10px; --fs:min(12px, calc((100cqw - 34px) / 29.5)); --lh:calc(var(--fs) * 1.3); width:calc(48ch + 28px); background:linear-gradient(180deg, #fffefa, #f8f5ec); color:#1c1b1f;
  font-family:"SF Mono", Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", "Courier New", monospace; font-size:var(--fs);
  padding:calc(var(--z) + 10px) 14px calc(var(--z) + 6px); overflow:hidden;
  -webkit-mask:conic-gradient(from 135deg at top, #0000, #000 1deg 89deg, #0000 90deg) top / calc(2 * var(--z)) 51% repeat-x,
    conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg) bottom / calc(2 * var(--z)) 51% repeat-x;
  mask:conic-gradient(from 135deg at top, #0000, #000 1deg 89deg, #0000 90deg) top / calc(2 * var(--z)) 51% repeat-x,
    conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg) bottom / calc(2 * var(--z)) 51% repeat-x; }
.vp .ln { display:flex; align-items:flex-end; height:calc(var(--lh) * var(--H, 1)); white-space:pre; }
.vp .ln.c { justify-content:center; } .vp .ln.r { justify-content:flex-end; }
.vp .ln > span { display:inline-block; white-space:pre; font-size:calc(var(--fs) * var(--w, 1)); line-height:calc(var(--lh) * var(--w, 1));
  transform:scaleY(var(--sy, 1)); transform-origin:50% 100%; }
.vp .ln > span.b { font-weight:800; } .vp .ln > span.rv { background:#1c1b1f; color:#fffefa; }
.vp .item.fresh .shadow { animation:vpout .8s cubic-bezier(.2,.8,.2,1) both; }
@keyframes vpout { from { opacity:0; transform:translateY(-36px); clip-path:inset(0 0 100% 0); } to { opacity:1; transform:none; clip-path:inset(0 0 0 0); } }
.vp .empty { color:#6f6378; font-size:12.5px; padding:18px 0; text-align:center; }
.vp .more { color:#6f6378; font-size:12px; text-align:center; }
.vp .msg { margin:40px auto; max-width:520px; text-align:center; color:#a898b3; }
@media (max-width:700px) { .vp .cols { grid-template-columns:repeat(5, minmax(300px, 88vw)); } }
`

const timeText = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

// One slip, drawn from the same bytes a real printer would get
function Slip({ job, at }) {
  // the slip's lines, at most two blank lines in a row (like the paper feed)
  const lines = useMemo(() => {
    let all
    try { all = decodeEscPos(buildKot(job, { printer: job.printer_ip || 'virtual', now: new Date(at) })).lines } catch { return [] }
    const out = []
    let blanks = 0
    for (const line of all) {
      const runs = line.runs && line.runs.length ? line.runs : [{ text: line.text, bold: line.bold, reverse: line.reverse, w: line.w, h: line.h }]
      if (!runs.map(r => r.text).join('').trim()) { if (++blanks > 2) continue } else blanks = 0
      out.push({ ...line, runs })
    }
    return out
  }, [job, at])
  return (
    <div className="shadow"><div className="slip" role="img" aria-label={'Printed slip ' + (job.kot_no || '')}>
      {lines.map((line, i) => {
        const runs = line.runs
        const H = Math.max(1, ...runs.map(r => r.h || 1))
        return (
          <div key={i} className={'ln' + (line.align === 'center' ? ' c' : line.align === 'right' ? ' r' : '')} style={{ '--H': H }}>
            {runs.map((r, j) => {
              const w = r.w || 1, h = r.h || 1
              return <span key={j} className={(r.bold ? 'b' : '') + (r.reverse ? ' rv' : '')}
                style={{ '--w': (r.small ? 0.75 : 1) * w, ...(h !== w ? { '--sy': h / w } : {}) }}>{r.text}</span>
            })}
          </div>
        )
      })}
    </div></div>
  )
}

export default function VirtualPrinters() {
  const eventId = new URLSearchParams(window.location.search).get('event') || ''
  const [ev, setEv] = useState(null)
  const [kitchens, setKitchens] = useState([])
  const [kots, setKots] = useState([])
  const [online, setOnline] = useState(true)
  const [err, setErr] = useState('')
  const [clearedAt, setClearedAt] = useState(0)
  const seen = useRef(null)
  const [fresh, setFresh] = useState(() => new Set())

  useEffect(() => {
    if (!eventId) return
    let alive = true
    let timer = null
    async function load() {
      try {
        const [e, k] = await Promise.all([
          supabase.from('events').select('id,name').eq('id', eventId).maybeSingle(),
          supabase.from('kitchens').select('id,name,printer_ip,is_active').eq('event_id', eventId).ilike('printer_ip', 'virtual-%'),
        ])
        if (e.error || k.error) throw e.error || k.error
        const ks = (k.data || []).filter(x => x.is_active !== false)
        let rows = []
        if (ks.length) {
          const since = new Date(Date.now() - 12 * 3600e3).toISOString()
          const r = await supabase.from('kots').select('*').in('kitchen_id', ks.map(x => x.id)).eq('print_status', 'printed')
            .gte('printed_at', since).order('printed_at', { ascending: false }).limit(250)
          if (r.error) throw r.error
          rows = r.data || []
        }
        if (!alive) return
        // slips that were not there at the last look slide out of the printer
        const ids = new Set(rows.map(x => x.id + '|' + x.printed_at))
        if (seen.current) {
          const add = [...ids].filter(x => !seen.current.has(x))
          if (add.length) {
            setFresh(f => new Set([...f, ...add]))
            setTimeout(() => { if (alive) setFresh(f => { const n = new Set(f); add.forEach(x => n.delete(x)); return n }) }, 8000)
          }
        }
        seen.current = ids
        setEv(e.data || null); setKitchens(ks); setKots(rows); setOnline(true); setErr('')
      } catch (x) {
        if (alive) { setOnline(false); setErr(String(x?.message || x)) }
      }
      if (alive) timer = setTimeout(load, POLL_MS)
    }
    load()
    return () => { alive = false; clearTimeout(timer) }
  }, [eventId])

  const printerOf = ip => Number(String(ip || '').trim().slice(8)) || 0
  const kitchenById = Object.fromEntries(kitchens.map(k => [k.id, k]))
  const shown = kots.filter(k => !clearedAt || new Date(k.printed_at).getTime() > clearedAt)

  if (!eventId) return (
    <div className="vp"><style>{CSS}</style>
      <div className="msg">Open the Virtual printers from <b>Event set-up › Kitchens &amp; printers</b> (the link carries the event).</div>
    </div>
  )

  return (
    <div className="vp">
      <style>{CSS}</style>
      <div className="top">
        <h1>Virtual printers<small>{ev?.name || 'Loading…'} · kitchens on Virtual printer 1–5 print here, nothing to start</small></h1>
        <span className="sp" />
        <span className={'live' + (online ? '' : ' off')}>{online ? '● Live' : '● Not connected · retrying'}</span>
        <button onClick={() => setClearedAt(Date.now())} title="Clear the slips on screen (nothing is deleted)">Clear paper</button>
      </div>
      {err && !online && <div className="msg" style={{ margin: '10px auto' }}>{err}</div>}
      <div className="cols">
        {PRINTERS.map(n => {
          const ks = kitchens.filter(k => printerOf(k.printer_ip) === n)
          const list = shown.filter(x => printerOf(x.printer_ip || kitchenById[x.kitchen_id]?.printer_ip) === n)
          return (
            <section className="col" key={n} data-printer={n}>
              <div className="dev">
                <div className="d1"><span className={'led' + (ks.length ? '' : ' idle')} /><b>Virtual printer {n}</b><span className="n">{list.length} slips</span></div>
                <div className={'k' + (ks.length ? '' : ' none')}>{ks.length ? ks.map(k => k.name).join(', ') : 'No kitchen on this printer'}</div>
                <div className="slot" />
              </div>
              <div className="feed">
                {list.slice(0, SHOW).map(job => {
                  const key = job.id + '|' + job.printed_at
                  return (
                    <div key={key} className={'item' + (fresh.has(key) ? ' fresh' : '')}>
                      <div className="meta">{timeText(job.printed_at)} · {job.kind === 'test' ? 'Test print' : job.kind === 'cancel' ? 'VOID ' + (job.kot_no || '') : 'KOT ' + (job.kot_no || '')}
                        {fresh.has(key) && <span className="new">New</span>}</div>
                      <Slip job={{ ...job, kitchen_name: job.kitchen_name || kitchenById[job.kitchen_id]?.name, event_name: ev?.name }} at={job.printed_at} />
                    </div>
                  )
                })}
                {!list.length && <div className="empty">{ks.length ? 'Waiting for KOTs…' : 'Set a kitchen to Virtual ' + n + ' under Kitchens & printers.'}</div>}
                {list.length > SHOW && <div className="more">+ {list.length - SHOW} earlier slips</div>}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
