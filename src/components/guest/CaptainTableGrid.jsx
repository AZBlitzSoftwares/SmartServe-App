import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import janusLogo from '../../assets/janus_logo.jpg'

/* The captain's home screen: pick a table, then the menu opens.

   This used to be the last step - build a cart, then say which table it was
   for - and it put the bad news in the worst possible place. With one order
   per table allowed, a captain would take a full order at a table that was
   already blocked and only find out at the moment of sending. The guest had
   already spoken; the captain had to go back and explain.

   Asking first moves the refusal to before anyone has said anything.

   Three states, because two was not enough to be useful:
     GREEN   nothing outstanding, order freely
     ORANGE  something is live but the table is under its limit
     RED     at the limit, ordering blocked until something is delivered

   With the limit set to 1, orange never appears - that is correct, not a
   gap. It earns its place the moment the limit is 2 or more, where "one
   order out, room for another" is a real and common state.

   Red is not a locked door. The menu still opens, because a guest at a red
   table still asks what the dessert is, and a captain who can only say
   "I cannot look" is worse than useless. Only placing is blocked, and the
   cart is kept so it can go the moment the table frees up.

   Held carts belong to the TABLE, not to this tablet. Whoever walks past
   next sees what was already taken down, and by whom. That is the whole
   point: the guest says "we already gave our order" to whichever captain is
   nearest, and being told "that was someone else's tablet" is exactly the
   answer that makes them give up on the app. */

const POLL_MS = 5000

export default function CaptainTableGrid({ eventData, captain, heldCarts, onPick, onSwitchCaptain, onTrack }) {
  const [counts, setCounts] = useState({})
  const [loading, setLoading] = useState(true)
  const [typed, setTyped] = useState('')
  const [err, setErr] = useState('')

  const total = eventData?.number_of_tables || 0
  const limit = eventData?.max_orders_per_table || 0

  useEffect(() => {
    load()
    // Another captain can fill a table while this one is looking at it, so
    // the grid has to keep moving rather than being a snapshot.
    const t = setInterval(load, POLL_MS)
    return () => clearInterval(t)
  }, [eventData?.id])

  async function load() {
    if (!eventData?.id) { setLoading(false); return }
    try {
      const { data } = await supabase.from('orders')
        .select('id, tables(table_number)')
        .eq('event_id', eventData.id)
        .in('status', ['pending', 'placed', 'in_progress'])
      const m = {}
      ;(data || []).forEach(o => {
        const n = o.tables?.table_number
        if (n != null) m[n] = (m[n] || 0) + 1
      })
      setCounts(m)
    } catch (e) { /* the next poll covers it */ }
    setLoading(false)
  }

  function stateOf(n) {
    const live = counts[n] || 0
    if (limit > 0 && live >= limit) return 'red'
    if (live > 0) return 'orange'
    return 'green'
  }

  const TONE = {
    green:  { bg:'#F0FDF4', border:'#16A34A', fg:'#15803D' },
    orange: { bg:'#FFF7ED', border:'#E8890C', fg:'#C2410C' },
    red:    { bg:'#FEF2F2', border:'#DC2626', fg:'#B91C1C' },
  }

  function pick(n) {
    setErr('')
    onPick(n, stateOf(n), counts[n] || 0)
  }

  function goTyped() {
    const n = parseInt(typed, 10)
    if (!n || n < 1 || (total && n > total)) {
      setErr(total ? 'This event has tables 1 to ' + total + '.' : 'Enter a table number.')
      return
    }
    setTyped('')
    pick(n)
  }

  const nums = Array.from({ length: total }, (_, i) => i + 1)

  return (
    <div style={{ minHeight:'100vh', background:'linear-gradient(160deg,#1A0A0A,#2D1010)',
      display:'flex', flexDirection:'column', fontFamily:'Manrope, sans-serif' }}>

      <div style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 16px',
        flexShrink:0, borderBottom:'1px solid rgba(255,255,255,0.1)' }}>
        <img src={janusLogo} alt="" style={{ width:42, height:42, borderRadius:10,
          objectFit:'contain', background:'rgba(232,137,12,0.12)' }} />
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ color:'#fff', fontSize:17, fontWeight:900 }}>Which table?</div>
          <div style={{ color:'rgba(255,255,255,0.5)', fontSize:12, fontWeight:600,
            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {eventData?.name || ''}
          </div>
        </div>

        <button onClick={onTrack}
          style={{ flexShrink:0, background:'#16A34A', color:'#fff', border:'none',
            borderRadius:999, padding:'10px 18px', fontSize:14, fontWeight:800,
            cursor:'pointer' }}>📦 Track</button>

        <div style={{ flexShrink:0, textAlign:'center' }}>
          <div style={{ color:'rgba(255,255,255,0.45)', fontSize:10, fontWeight:700,
            letterSpacing:'0.5px' }}>CAPTAIN</div>
          <div style={{ color:'#fff', fontSize:15, fontWeight:900, maxWidth:100,
            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {captain?.name}
          </div>
          <button onClick={onSwitchCaptain}
            style={{ background:'rgba(255,255,255,0.12)', border:'1px solid rgba(255,255,255,0.25)',
              color:'rgba(255,255,255,0.75)', borderRadius:999, padding:'2px 10px',
              fontSize:10, fontWeight:700, cursor:'pointer', marginTop:2 }}>Switch</button>
        </div>
      </div>

      <div style={{ display:'flex', alignItems:'center', gap:14, padding:'10px 16px',
        flexShrink:0, flexWrap:'wrap' }}>
        {[['green','Free'],['orange','In progress'],['red','At limit']].map(([k,label]) => (
          <span key={k} style={{ display:'flex', alignItems:'center', gap:6,
            fontSize:12, color:'rgba(255,255,255,0.65)', fontWeight:700 }}>
            <span style={{ width:13, height:13, borderRadius:4,
              background:TONE[k].border }} />
            {label}
          </span>
        ))}
        <span style={{ display:'flex', alignItems:'center', gap:6,
          fontSize:12, color:'rgba(255,255,255,0.65)', fontWeight:700 }}>
          <span style={{ width:15, height:15, borderRadius:999, background:'#1A0A0A',
            border:'2px solid #E8890C' }} />
          Items waiting
        </span>

        <span style={{ flex:1 }} />

        {/* Typing beats hunting past about thirty tables. Same box the Track
            screen uses, so it is the same habit in both places. */}
        <input value={typed} inputMode="numeric" placeholder="Table no."
          onChange={e => { setTyped(e.target.value.replace(/\D/g,'').slice(0,3)); setErr('') }}
          onKeyDown={e => { if (e.key === 'Enter') goTyped() }}
          style={{ flexShrink:0, width:96, borderRadius:9, padding:'9px 8px',
            border:'1.5px solid rgba(255,255,255,0.25)', background:'rgba(255,255,255,0.08)',
            color:'#fff', fontSize:14, fontWeight:900, textAlign:'center',
            fontFamily:'Manrope', outline:'none', boxSizing:'border-box' }} />
        <button onClick={goTyped} disabled={!typed}
          style={{ flexShrink:0, borderRadius:9, padding:'9px 18px', fontSize:14,
            fontWeight:900, border:'none',
            background: typed ? '#E8890C' : 'rgba(255,255,255,0.12)',
            color: typed ? '#fff' : 'rgba(255,255,255,0.4)',
            cursor: typed ? 'pointer' : 'not-allowed' }}>Go</button>
      </div>

      {err && (
        <div style={{ margin:'0 16px 8px', background:'rgba(220,38,38,0.18)',
          border:'1px solid rgba(220,38,38,0.4)', borderRadius:10, padding:'9px 13px',
          fontSize:13, color:'#FCA5A5', fontWeight:700 }}>{err}</div>
      )}

      <div style={{ flex:1, overflowY:'auto', padding:'4px 16px 28px' }}>
        {loading ? (
          <div style={{ textAlign:'center', padding:50, color:'rgba(255,255,255,0.5)' }}>Loading…</div>
        ) : total === 0 ? (
          <div style={{ textAlign:'center', padding:'40px 20px', color:'rgba(255,255,255,0.6)',
            fontSize:14, lineHeight:1.7 }}>
            No table count is set for this event.<br />
            Ask the supervisor to set it under Control › Tables,<br />
            or type a table number above.
          </div>
        ) : (
          <div style={{ display:'grid',
            gridTemplateColumns:'repeat(auto-fill, minmax(76px, 1fr))', gap:9 }}>
            {nums.map(n => {
              const st = stateOf(n)
              const tone = TONE[st]
              const live = counts[n] || 0
              const held = heldCarts?.[n]
              return (
                <button key={n} onClick={() => pick(n)}
                  style={{ position:'relative', padding:'14px 4px', borderRadius:13,
                    border:'2.5px solid ' + tone.border, background:tone.bg,
                    color:tone.fg, fontSize:22, fontWeight:900, cursor:'pointer',
                    display:'flex', flexDirection:'column', alignItems:'center', gap:2,
                    fontFamily:'Manrope' }}>
                  {n}
                  {live > 0 && (
                    <span style={{ fontSize:9, fontWeight:800, opacity:0.9 }}>
                      {live} live
                    </span>
                  )}
                  {/* A cart waiting for this table, wherever it was written.
                      It belongs to the table now, not to a tablet - so this
                      badge is the same on every captain's screen, and the name
                      under it says who took it down. */}
                  {held?.count > 0 && (
                    <>
                      <span style={{ position:'absolute', top:-7, right:-7, background:'#1A0A0A',
                        color:'#E8890C', borderRadius:999, minWidth:21, height:21,
                        fontSize:11, fontWeight:900, display:'flex', alignItems:'center',
                        justifyContent:'center', padding:'0 5px',
                        border:'2px solid ' + tone.border }}>{held.count}</span>
                      <span style={{ fontSize:8, fontWeight:800, opacity:0.85,
                        maxWidth:66, overflow:'hidden', textOverflow:'ellipsis',
                        whiteSpace:'nowrap' }}>
                        {held.captain ? 'by ' + held.captain : 'in cart'}
                      </span>
                    </>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
