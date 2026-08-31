import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import CaptainTablePrompt from './CaptainTablePrompt'

/* Help panel.

   A small service menu rather than a single Call Waiter button, so
   the waiter arrives already carrying the right things instead of
   walking over to ask and then walking back.

   The item list comes from help_items. Rows belonging to this event
   win; if the event has none of its own we fall back to the global
   rows (event_id is null). That way a brand new event is usable with
   no setup at all, and customising one event never touches another.

   Items with has_quantity get + and -. The rest - Clean the Table,
   Help - are a single tap, since a quantity would be meaningless.

   Captain mode changes two things and nothing else. The table is asked
   for on sending, exactly as it is for an order, and the "a waiter is
   already on the way" hold is dropped: that rule exists to stop one
   guest ringing the bell five times, but a captain works every table
   in the room and would be blocked by the previous table's request. */

const REQUEST_UNBLOCK_MS = 3 * 60 * 1000

export default function SOSPanel({ tableData, eventData, onClose, captain }) {
  const [items, setItems] = useState([])
  const [qty, setQty] = useState({})
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [activeRequest, setActiveRequest] = useState(null)
  const [sent, setSent] = useState(false)
  // Captain mode: which table this request is for, asked at send time
  const [showTablePrompt, setShowTablePrompt] = useState(false)
  const [sentTable, setSentTable] = useState(null)

  const captainMode = !!captain

  useEffect(() => { load() }, [tableData?.id, eventData?.id])

  async function load() {
    setLoading(true)
    try {
      if (eventData?.id) {
        // Event's own list first, global defaults if it has none
        let { data: list } = await supabase.from('help_items')
          .select('*').eq('event_id', eventData.id).eq('is_active', true)
          .order('sort_order')
        if (!list || list.length === 0) {
          const g = await supabase.from('help_items')
            .select('*').is('event_id', null).eq('is_active', true)
            .order('sort_order')
          list = g.data || []
        }
        setItems(list || [])
      }
      // A captain has no table, so there is no "this table's open request"
      // to find. Skipping the lookup also skips the hold it would impose.
      if (tableData?.id && !captainMode) {
        const { data: open } = await supabase.from('sos_requests')
          .select('*').eq('table_id', tableData.id)
          .in('status', ['open', 'in_progress', 'acknowledged'])
          .order('created_at', { ascending: false }).limit(1)
        if (open && open.length) setActiveRequest(open[0])
      }
    } catch (e) {
      console.error('Help load error:', e)
    } finally {
      setLoading(false)
    }
  }

  // The panel must not claim a waiter is coming before one is assigned.
  // Poll the live request so it flips by itself when the supervisor acts.
  const assigned = !!(activeRequest && (activeRequest.status === 'in_progress' || activeRequest.waiter_id))

  useEffect(() => {
    if (captainMode) return
    if (!activeRequest?.id) return
    if (activeRequest.status === 'resolved') return
    const t = setInterval(async () => {
      const { data } = await supabase.from('sos_requests')
        .select('*, waiters(name)').eq('id', activeRequest.id).single()
      if (data) setActiveRequest(data)
    }, 5000)
    return () => clearInterval(t)
  }, [activeRequest?.id, activeRequest?.status, captainMode])

  function bump(item, delta) {
    setQty(prev => {
      const cur = prev[item.id] || 0
      const next = item.has_quantity ? Math.max(0, cur + delta) : (cur ? 0 : 1)
      const copy = { ...prev }
      if (next === 0) delete copy[item.id]
      else copy[item.id] = next
      return copy
    })
  }

  const chosen = items.filter(i => qty[i.id])
  const totalPicked = chosen.length

  // Writes the request and its lines. Shared by both paths so the two
  // cannot drift apart; only the table it is written against differs.
  async function writeRequest(tableId, tableNumber) {
    const { data: req, error } = await supabase.from('sos_requests').insert({
      event_id: eventData.id,
      table_id: tableId,
      table_number: tableNumber,
      request_type: 'help',
      status: 'open',
      ...(captainMode ? { captain_id: captain.id } : {})
    }).select().single()

    if (error || !req) throw new Error('Could not send the request. Please try again.')

    const lines = chosen.map(i => ({
      sos_request_id: req.id,
      help_item_id:   i.id,
      item_name:      i.name,
      quantity:       qty[i.id]
    }))
    const { error: liErr } = await supabase.from('sos_request_items').insert(lines)
    // The request itself is already in - a failed line insert should not
    // hide it from the supervisor, so we log and carry on.
    if (liErr) console.error('Help item lines error:', liErr.message)

    return req
  }

  /* Captain path: find or create the table row, then write against it.

     Deliberately no claimed_by_device, exactly as with a captain's order -
     the tablet is in the captain's hand, not sitting on that table, and
     claiming it would put a phantom device on the supervisor's screen. */
  async function sendForTable(tableNum) {
    if (!eventData?.id) throw new Error('No event loaded. Sign in again.')

    const { data: existing } = await supabase.from('tables')
      .select('*').eq('event_id', eventData.id).eq('table_number', tableNum).limit(1)
    let tableRecord = existing?.[0]
    if (!tableRecord) {
      const { data: made, error: mkErr } = await supabase.from('tables')
        .insert({ event_id: eventData.id, table_number: tableNum, is_active: true })
        .select().single()
      if (mkErr || !made) throw new Error('Could not open table ' + tableNum + '. Please try again.')
      tableRecord = made
    }

    const req = await writeRequest(tableRecord.id, tableNum)
    setActiveRequest(req)
    setQty({})
    setSentTable(tableNum)
    setShowTablePrompt(false)
    setSent(true)
  }

  async function submit() {
    if (sending || totalPicked === 0) return

    if (captainMode) { setShowTablePrompt(true); return }

    if (!tableData?.id || !eventData?.id) {
      alert('Table not set up. Please ask your supervisor.')
      return
    }
    setSending(true)
    try {
      const req = await writeRequest(tableData.id, tableData.table_number)
      setActiveRequest(req)
      setQty({})
      setSent(true)
    } catch (e) {
      console.error('Help exception:', e)
      alert(e?.message || 'Could not send request. Please try again.')
    } finally {
      setSending(false)
    }
  }

  const requestAgeMs = activeRequest?.created_at
    ? Date.now() - new Date(activeRequest.created_at).getTime() : 0
  // The hold never applies to a captain - see the note at the top.
  const canRaiseAnother = captainMode || !activeRequest || requestAgeMs >= REQUEST_UNBLOCK_MS

  const sheet = {
    width:'100%', background:'#fff', borderRadius:'24px 24px 0 0',
    padding:'22px 20px calc(28px + env(safe-area-inset-bottom))',
    maxHeight:'88vh', overflowY:'auto', boxSizing:'border-box'
  }

  if (loading) return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:70, display:'flex', alignItems:'flex-end' }}>
      <div style={{ ...sheet, textAlign:'center', padding:'34px 24px 46px' }}>
        <div style={{ color:'#888' }}>Loading...</div>
      </div>
    </div>
  )

  return (
    <>
    {showTablePrompt && (
      <CaptainTablePrompt eventData={eventData} itemCount={totalPicked}
        onCancel={() => setShowTablePrompt(false)}
        onConfirm={sendForTable} />
    )}

    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:70, display:'flex', alignItems:'flex-end' }}>
      <div style={sheet}>
        <div style={{ width:40, height:4, background:'#E5E7EB', borderRadius:999, margin:'0 auto 16px' }} />

        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
          <h3 style={{ fontSize:20, fontWeight:800, margin:0 }}>
            {captainMode ? 'What does the table need?' : 'What do you need?'}
          </h3>
          <button onClick={onClose} style={{ background:'#1A0A0A', border:'none', borderRadius:999, width:38, height:38, fontSize:18, fontWeight:800, color:'#fff', cursor:'pointer', flexShrink:0 }}>✕</button>
        </div>

        {/* Confirmation after sending */}
        {sent && (
          <div style={{ background:'#F0FDF4', border:'2px solid #BBF7D0', borderRadius:14,
            padding:'16px 16px', margin:'12px 0 4px', textAlign:'center' }}>
            <div style={{ fontSize:34, marginBottom:6 }}>🛎️</div>
            <div style={{ fontWeight:800, fontSize:17, color:'#16A34A', marginBottom:4 }}>
              {captainMode
                ? 'Request Sent' + (sentTable != null ? ' \u00B7 Table ' + sentTable : '')
                : assigned ? 'Waiter On The Way' : 'Request Sent'}
            </div>
            <div style={{ fontSize:14, color:'#15803D', lineHeight:1.5, fontWeight:600 }}>
              {captainMode
                ? 'The supervisor has it and will send a waiter.'
                : assigned
                  ? (activeRequest?.waiters?.name
                      ? 'Waiter ' + activeRequest.waiters.name + ' is coming to your table.'
                      : 'Your waiter is coming to your table.')
                  : 'A waiter will come to your table soon.'}
            </div>
            <div style={{ display:'flex', gap:8, marginTop:14 }}>
              {/* A captain will very often need to raise the next one straight
                  away for a different table, so that path stays one tap. */}
              {captainMode && (
                <button onClick={() => { setSent(false); setSentTable(null); setActiveRequest(null) }}
                  style={{ flex:1, background:'#F5F5F5', color:'#333', border:'none',
                    borderRadius:12, padding:'13px', fontSize:15, fontWeight:800, cursor:'pointer' }}>
                  Another table
                </button>
              )}
              <button onClick={onClose}
                style={{ flex:1, background:'#1A0A0A', color:'#fff', border:'none',
                  borderRadius:12, padding:'13px', fontSize:15, fontWeight:800, cursor:'pointer' }}>
                Done
              </button>
            </div>
          </div>
        )}

        {!sent && (
          <>
            <p style={{ fontSize:13, color:'#888', margin:'0 0 14px', lineHeight:1.5 }}>
              {captainMode
                ? 'Pick what the table needs. You will choose the table next.'
                : 'Pick what you need. We will bring it to your table.'}
            </p>

            {items.length === 0 && (
              <div style={{ textAlign:'center', padding:'26px 0', color:'#888', fontSize:14 }}>
                No help options are set up for this event yet.
              </div>
            )}

            {items.map(item => {
              const n = qty[item.id] || 0
              const on = n > 0
              return (
                <div key={item.id} style={{ display:'flex', alignItems:'center', gap:12,
                  background: on ? '#FFF8EE' : '#F8F8F8',
                  border: '2px solid ' + (on ? '#E8890C' : '#EFEFEF'),
                  borderRadius:14, padding:'11px 14px', marginBottom:8 }}>

                  <span style={{ flex:1, fontWeight:700, fontSize:15,
                    color: on ? '#C06A00' : '#1A1A1A' }}>{item.name}</span>

                  {item.has_quantity ? (
                    <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                      <button onClick={() => bump(item, -1)} disabled={n === 0}
                        style={{ width:32, height:32, borderRadius:'50%', border:'1.5px solid #E5E7EB',
                          background:'#fff', fontSize:18, fontWeight:800, cursor: n ? 'pointer' : 'not-allowed',
                          color: n ? '#1A1A1A' : '#CCC', lineHeight:1 }}>−</button>
                      <span style={{ minWidth:20, textAlign:'center', fontWeight:800, fontSize:16 }}>{n}</span>
                      <button onClick={() => bump(item, 1)}
                        style={{ width:32, height:32, borderRadius:'50%', border:'none',
                          background:'#1A0A0A', color:'#fff', fontSize:18, fontWeight:800,
                          cursor:'pointer', lineHeight:1 }}>+</button>
                    </div>
                  ) : (
                    <button onClick={() => bump(item, 1)}
                      style={{ width:32, height:32, borderRadius:'50%', border:'none',
                        background: on ? '#16A34A' : '#1A0A0A', color:'#fff', fontSize:17,
                        fontWeight:800, cursor:'pointer', lineHeight:1 }}>
                      {on ? '✓' : '+'}
                    </button>
                  )}
                </div>
              )
            })}

            <button onClick={submit} disabled={sending || totalPicked === 0 || !canRaiseAnother}
              style={{ width:'100%', marginTop:12,
                background: (totalPicked === 0 || !canRaiseAnother) ? '#E5E7EB' : (sending ? '#B0741C' : '#E8890C'),
                color: (totalPicked === 0 || !canRaiseAnother) ? '#9CA3AF' : '#fff',
                border:'none', borderRadius:14, padding:'16px', fontSize:16, fontWeight:900,
                cursor: (sending || totalPicked === 0 || !canRaiseAnother) ? 'not-allowed' : 'pointer' }}>
              {sending ? 'Sending...'
                : !canRaiseAnother ? 'A waiter is already on the way'
                : totalPicked === 0 ? 'Select what you need'
                : captainMode ? 'Choose Table (' + totalPicked + ') \u2192'
                : 'Send Request (' + totalPicked + ')'}
            </button>

            <button onClick={onClose}
              style={{ width:'100%', marginTop:8, background:'#f5f5f5', border:'none',
                borderRadius:12, padding:'13px', fontSize:14, fontWeight:600,
                color:'#888', cursor:'pointer' }}>
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
    </>
  )
}
