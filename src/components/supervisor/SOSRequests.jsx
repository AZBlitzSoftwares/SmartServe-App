import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

const TYPE_LABELS = { sos:'Call Waiter', call_waiter:'Call Waiter', clean_table:'Clean Table', extra_cutlery:'Extra Cutlery', water_refill:'Water Refill' }
const TYPE_EMOJI  = { sos:'🆘', clean_table:'🧹', extra_cutlery:'🍴', water_refill:'💧' }
const TYPE_COLOR  = { sos:'#DC2626', clean_table:'#2563EB', extra_cutlery:'#7C3AED', water_refill:'#0891B2' }

// This is exported so SupervisorApp can show the floating alert on ALL screens
export function useSOSAlert(eventData) {
  const [openRequests, setOpenRequests] = useState([])
  const [newAlert, setNewAlert] = useState(null)
  const prevCount = { current: 0 }

  useEffect(() => {
    if (!eventData) return
    fetchRequests()
    const interval = setInterval(fetchRequests, 4000)
    return () => clearInterval(interval)
  }, [eventData])

  async function fetchRequests() {
    if (!eventData) return
    const { data } = await supabase.from('sos_requests')
      .select('*, tables(table_number)').eq('event_id', eventData.id)
      .eq('status', 'open').order('created_at', { ascending:false })
    const reqs = data || []
    // New open request arrived
    if (reqs.length > prevCount.current && prevCount.current >= 0) {
      const newest = reqs[0]
      if (newest) setNewAlert(newest)
    }
    prevCount.current = reqs.length
    setOpenRequests(reqs)
  }

  return { openRequests, newAlert, clearAlert: () => setNewAlert(null) }
}

export default function SOSRequests({ eventData, onSosCountChange }) {
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!eventData) return
    loadRequests(true)
    const interval = setInterval(() => loadRequests(false), 4000)
    return () => clearInterval(interval)
  }, [eventData])

  async function loadRequests(showSpinner=false) {
    if (!eventData) return
    if (showSpinner) setLoading(true)
    const { data } = await supabase.from('sos_requests').select('*, tables(table_number)').eq('event_id', eventData.id).order('created_at', { ascending:false })
    const reqs = data||[]
    setRequests(reqs)
    onSosCountChange(reqs.filter(r=>r.status==='open').length)
    if (showSpinner) setLoading(false)
  }

  async function acknowledge(id) {
    await supabase.from('sos_requests').update({ status:'acknowledged', acknowledged_at:new Date().toISOString() }).eq('id', id)
    loadRequests(false)
  }
  async function resolve(id) {
    await supabase.from('sos_requests').update({ status:'resolved', resolved_at:new Date().toISOString() }).eq('id', id)
    loadRequests(false)
  }

  const open = requests.filter(r=>r.status==='open')
  const acknowledged = requests.filter(r=>r.status==='acknowledged')
  const resolved = requests.filter(r=>r.status==='resolved')

  function Card({ req }) {
    return (
      <div style={{ background:'#fff', borderRadius:16, padding:16, marginBottom:10, boxShadow:'var(--shadow)', borderLeft:'4px solid '+(TYPE_COLOR[req.request_type]||'#999') }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:10 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ fontSize:28 }}>{TYPE_EMOJI[req.request_type]}</span>
            <div>
              <div style={{ fontWeight:800, fontSize:15, color:TYPE_COLOR[req.request_type] }}>{TYPE_LABELS[req.request_type]}</div>
              <div style={{ fontSize:13, color:'var(--ink2)', marginTop:2 }}>Table {req.tables?.table_number} · {new Date(req.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</div>
            </div>
          </div>
          <div style={{ fontSize:12, fontWeight:700, padding:'3px 10px', borderRadius:999, background:req.status==='open'?'#FEF2F2':req.status==='acknowledged'?'#FEF3C7':'#F0FDF4', color:req.status==='open'?'#DC2626':req.status==='acknowledged'?'#D97706':'#16A34A' }}>
            {req.status==='open'?'Open':req.status==='acknowledged'?'Acknowledged':'Resolved'}
          </div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          {req.status==='open' && <button onClick={()=>acknowledge(req.id)} style={{ flex:1, background:'#FEF3C7', border:'1px solid #FCD34D', color:'#92400E', borderRadius:10, padding:'10px', fontSize:13, fontWeight:700 }}>Acknowledge</button>}
          {req.status!=='resolved' && <button onClick={()=>resolve(req.id)} style={{ flex:1, background:'#F0FDF4', border:'1px solid #BBF7D0', color:'#16A34A', borderRadius:10, padding:'10px', fontSize:13, fontWeight:700 }}>Mark Resolved</button>}
        </div>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <h2 style={{ fontSize:20, fontWeight:800 }}>Call Waiter Requests</h2>
        <button onClick={()=>loadRequests(true)} style={{ background:'var(--ink)', color:'#fff', border:'none', borderRadius:10, padding:'8px 16px', fontSize:13, fontWeight:700 }}>Refresh</button>
      </div>
      {loading ? <div style={{ textAlign:'center', padding:60, color:'var(--ink2)' }}>Loading...</div>
      : requests.length === 0 ? (
        <div style={{ textAlign:'center', padding:60 }}>
          <div style={{ fontSize:48, marginBottom:12 }}>✅</div>
          <div style={{ color:'var(--ink2)', fontWeight:600 }}>No requests yet</div>
        </div>
      ) : (
        <>
          {open.length > 0 && <><div style={{ fontWeight:700, fontSize:13, color:'#DC2626', marginBottom:8, textTransform:'uppercase' }}>🔴 Open ({open.length})</div>{open.map(r=><Card key={r.id} req={r}/>)}</>}
          {acknowledged.length > 0 && <><div style={{ fontWeight:700, fontSize:13, color:'#D97706', marginBottom:8, marginTop:16, textTransform:'uppercase' }}>🟡 Acknowledged ({acknowledged.length})</div>{acknowledged.map(r=><Card key={r.id} req={r}/>)}</>}
          {resolved.length > 0 && <><div style={{ fontWeight:700, fontSize:13, color:'#16A34A', marginBottom:8, marginTop:16, textTransform:'uppercase' }}>🟢 Resolved ({resolved.length})</div>{resolved.map(r=><Card key={r.id} req={r}/>)}</>}
        </>
      )}
    </div>
  )
}
