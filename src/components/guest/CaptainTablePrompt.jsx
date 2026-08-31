import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

/* Which table is this order for?

   Asked at order time rather than at sign-in, because a captain works the
   whole floor from one tablet: fixing a table at the start would mean
   signing out and back in between every table.

   The grid shows which tables are already at their order limit before the
   captain commits, so a full table is visible rather than discovered by a
   rejection after tapping Confirm. Typing is offered alongside the grid -
   at 40 tables, hunting for 37 in a grid is slower than typing it. */
export default function CaptainTablePrompt({ eventData, itemCount, onCancel, onConfirm }) {
  const total = eventData?.number_of_tables || 0
  const maxOrders = eventData?.max_orders_per_table || 0

  const [picked, setPicked] = useState(null)
  const [typed, setTyped] = useState('')
  const [counts, setCounts] = useState({})   // table_number -> live order count
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { loadCounts() }, [eventData?.id])

  async function loadCounts() {
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
    } catch (e) { /* the limit is re-checked on confirm anyway */ }
    setLoading(false)
  }

  // 0 means the admin has turned the limit off for this event
  const atLimit = n => maxOrders > 0 && (counts[n] || 0) >= maxOrders

  function choose(n) {
    setError('')
    if (atLimit(n)) {
      setError('Table ' + n + ' already has ' + counts[n] + ' order' +
        (counts[n] === 1 ? '' : 's') + ' waiting. Mark one delivered, or pick another table.')
      return
    }
    setPicked(n); setTyped(String(n))
  }

  function onType(v) {
    const clean = v.replace(/\D/g, '').slice(0, 3)
    setTyped(clean); setError('')
    const n = parseInt(clean, 10)
    if (!clean) { setPicked(null); return }
    if (!n || n < 1 || (total && n > total)) {
      setPicked(null)
      setError(total ? 'This event has tables 1 to ' + total + '.' : 'Enter a table number.')
      return
    }
    if (atLimit(n)) {
      setPicked(null)
      setError('Table ' + n + ' already has ' + counts[n] + ' order' +
        (counts[n] === 1 ? '' : 's') + ' waiting.')
      return
    }
    setPicked(n)
  }

  async function confirm() {
    if (!picked || busy) return
    setBusy(true); setError('')
    try {
      await onConfirm(picked)
    } catch (e) {
      setError(e?.message || 'Could not place the order. Please try again.')
      setBusy(false)
    }
  }

  const nums = Array.from({ length: total }, (_, i) => i + 1)

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(26,10,10,0.82)', zIndex:130,
      display:'flex', alignItems:'flex-end', justifyContent:'center' }}>
      <div style={{ width:'100%', maxWidth:640, background:'#fff',
        borderRadius:'24px 24px 0 0', padding:'22px 20px calc(24px + env(safe-area-inset-bottom))',
        maxHeight:'92vh', overflowY:'auto', boxSizing:'border-box' }}>

        <div style={{ width:40, height:4, background:'#E5E7EB', borderRadius:999, margin:'0 auto 16px' }} />

        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
          <h3 style={{ fontSize:21, fontWeight:900, margin:0 }}>Which table?</h3>
          <button onClick={onCancel} disabled={busy}
            style={{ background:'#1A0A0A', border:'none', borderRadius:999, width:38, height:38,
              fontSize:18, fontWeight:800, color:'#fff', cursor: busy ? 'wait' : 'pointer',
              flexShrink:0 }}>✕</button>
        </div>
        <p style={{ fontSize:13, color:'#888', margin:'0 0 16px' }}>
          {itemCount} item{itemCount === 1 ? '' : 's'} ready to send
        </p>

        {/* Typing beats the grid past about twenty tables, so both are here
            and they stay in step with each other. */}
        <div style={{ display:'flex', gap:10, alignItems:'center', marginBottom:16 }}>
          <input value={typed} onChange={e => onType(e.target.value)} inputMode="numeric"
            placeholder="Type table no."
            onKeyDown={e => { if (e.key === 'Enter' && picked) confirm() }}
            style={{ flex:1, minWidth:0, border:'2px solid ' + (picked ? '#16A34A' : '#E5E7EB'),
              borderRadius:12, padding:'14px 16px', fontSize:20, fontWeight:900,
              textAlign:'center', fontFamily:'Manrope', outline:'none', boxSizing:'border-box' }} />
          <button onClick={confirm} disabled={!picked || busy}
            style={{ flexShrink:0, background: picked && !busy ? '#16A34A' : '#E5E7EB',
              color: picked && !busy ? '#fff' : '#9CA3AF', border:'none', borderRadius:12,
              padding:'14px 24px', fontSize:16, fontWeight:900,
              cursor: picked && !busy ? 'pointer' : 'not-allowed', whiteSpace:'nowrap' }}>
            {busy ? 'Sending…' : picked ? 'Send \u2192' : 'Send'}
          </button>
        </div>

        {error && (
          <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:10,
            padding:'10px 14px', fontSize:13, color:'#B91C1C', marginBottom:14, fontWeight:600,
            lineHeight:1.5 }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ textAlign:'center', padding:'24px 0', color:'#888', fontSize:13 }}>
            Checking tables…
          </div>
        ) : total === 0 ? (
          <div style={{ textAlign:'center', padding:'20px 0', color:'#888', fontSize:13, lineHeight:1.6 }}>
            No table count is set for this event.<br />
            Type the table number above, or ask the supervisor to set the count
            under Control › Tables.
          </div>
        ) : (
          <>
            <div style={{ display:'flex', gap:14, marginBottom:10, fontSize:12, color:'#888' }}>
              <span style={{ display:'flex', alignItems:'center', gap:5 }}>
                <span style={{ width:12, height:12, borderRadius:3, background:'#16A34A' }} /> Free
              </span>
              <span style={{ display:'flex', alignItems:'center', gap:5 }}>
                <span style={{ width:12, height:12, borderRadius:3, background:'#DC2626' }} /> At limit
              </span>
              <span style={{ display:'flex', alignItems:'center', gap:5 }}>
                <span style={{ width:12, height:12, borderRadius:3, background:'#E8890C' }} /> Selected
              </span>
            </div>

            <div style={{ display:'grid',
              gridTemplateColumns:'repeat(auto-fill, minmax(58px, 1fr))', gap:8 }}>
              {nums.map(n => {
                const full = atLimit(n)
                const on = picked === n
                const waiting = counts[n] || 0
                return (
                  <button key={n} onClick={() => choose(n)} disabled={busy}
                    title={full ? 'Table ' + n + ' is at its order limit' : 'Table ' + n}
                    style={{ padding:'12px 4px', borderRadius:12, border:'2px solid',
                      borderColor: on ? '#E8890C' : full ? '#FECACA' : '#BBF7D0',
                      background: on ? '#E8890C' : full ? '#FEF2F2' : '#F0FDF4',
                      color: on ? '#fff' : full ? '#B91C1C' : '#15803D',
                      fontSize:18, fontWeight:900, cursor: busy ? 'wait' : 'pointer',
                      display:'flex', flexDirection:'column', alignItems:'center', gap:1 }}>
                    {n}
                    {waiting > 0 && (
                      <span style={{ fontSize:8, fontWeight:700, opacity:0.85 }}>
                        {waiting} live
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </>
        )}

        <button onClick={onCancel} disabled={busy}
          style={{ width:'100%', marginTop:16, background:'#F5F5F5', border:'none',
            borderRadius:12, padding:'14px', fontSize:14, fontWeight:700, color:'#888',
            cursor: busy ? 'wait' : 'pointer' }}>
          Back to the order
        </button>
      </div>
    </div>
  )
}
