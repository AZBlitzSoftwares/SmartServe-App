import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'

/* One conversation, used by both sides.

   There is no thread id. The pair (event_id, captain_id) IS the thread,
   which is what makes a captain who logs out - or hands the tablet on
   mid-shift - land back in the same conversation rather than an empty one.

   Polling rather than a realtime subscription, on purpose. Everything else
   on this app polls, the hall Wi-Fi drops often enough that a socket which
   silently stops delivering is a real risk, and a chat that appears to
   work while quietly missing messages is worse than a three second delay.

   Read receipts are one-directional per side: the captain marks the
   supervisor's messages read, the supervisor marks the captain's. Neither
   ever writes the other's flag, so an unread badge cannot be cleared by
   the wrong person.                                                       */

const POLL_MS = 3000

export default function ChatThread({ eventId, captainId, me, meName, quickReplies = [], emptyHint }) {
  const [msgs, setMsgs] = useState([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState('')
  const endRef = useRef(null)
  const countRef = useRef(0)

  const theirFlag = me === 'captain' ? 'read_by_captain' : 'read_by_supervisor'
  const theirSender = me === 'captain' ? 'supervisor' : 'captain'

  useEffect(() => {
    if (!eventId || !captainId) return
    countRef.current = 0
    load()
    const t = setInterval(load, POLL_MS)
    return () => clearInterval(t)
  }, [eventId, captainId])

  async function load() {
    if (!eventId || !captainId) return
    try {
      const { data } = await supabase.from('chat_messages')
        .select('*')
        .eq('event_id', eventId)
        .eq('captain_id', captainId)
        .order('created_at', { ascending: true })
      const list = data || []
      setMsgs(list)

      // Only scroll when something actually arrived. Scrolling on every
      // poll would fight anyone reading back through the thread.
      if (list.length !== countRef.current) {
        countRef.current = list.length
        setTimeout(() => { try { endRef.current?.scrollIntoView({ block:'end' }) } catch (e) {} }, 40)
      }

      // Mark the other side's messages read. Scoped to this thread and to
      // their sender, so it can never clear someone else's badge.
      const unread = list.filter(m => m.sender === theirSender && !m[theirFlag])
      if (unread.length) {
        await supabase.from('chat_messages')
          .update({ [theirFlag]: true })
          .in('id', unread.map(m => m.id))
      }
    } catch (e) { /* the next poll covers it */ }
  }

  async function send(body) {
    const clean = (body || '').trim()
    if (!clean || sending) return
    setSending(true); setErr('')

    // Shown immediately with a clock against it. A captain who taps Send and
    // sees nothing for three seconds taps again, and the supervisor gets the
    // same sentence twice.
    const temp = { id:'temp-' + Date.now(), sender:me, sender_name:meName,
      body:clean, created_at:new Date().toISOString(), pending:true }
    setMsgs(prev => [...prev, temp])
    setText('')
    setTimeout(() => { try { endRef.current?.scrollIntoView({ block:'end' }) } catch (e) {} }, 40)

    try {
      const { error } = await supabase.from('chat_messages').insert({
        event_id: eventId,
        captain_id: captainId,
        sender: me,
        sender_name: meName || '',
        body: clean,
        read_by_captain: me === 'captain',
        read_by_supervisor: me === 'supervisor',
      })
      if (error) throw error
      countRef.current = -1   // force the scroll on the next load
      load()
    } catch (e) {
      setMsgs(prev => prev.filter(m => m.id !== temp.id))
      setText(clean)          // hand the words back rather than losing them
      setErr('Not sent. Check the connection and try again.')
    }
    setSending(false)
  }

  const timeOf = s => { try { return new Date(s).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) } catch (e) { return '' } }

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', minHeight:0 }}>

      <div style={{ flex:1, overflowY:'auto', padding:'12px 12px 4px',
        background:'#F7F7F8', minHeight:0 }}>
        {msgs.length === 0 && (
          <div style={{ textAlign:'center', padding:'26px 16px', color:'#9CA3AF',
            fontSize:13, lineHeight:1.7 }}>
            {emptyHint || 'No messages yet.'}
          </div>
        )}
        {msgs.map(m => {
          const mine = m.sender === me
          return (
            <div key={m.id} style={{ display:'flex', marginBottom:8,
              justifyContent: mine ? 'flex-end' : 'flex-start' }}>
              <div style={{ maxWidth:'82%', borderRadius:14,
                padding:'8px 12px',
                background: mine ? '#E8890C' : '#FFFFFF',
                color: mine ? '#FFFFFF' : '#1A0A0A',
                border: mine ? 'none' : '1px solid #E5E7EB',
                opacity: m.pending ? 0.65 : 1 }}>
                {!mine && m.sender_name && (
                  <div style={{ fontSize:10, fontWeight:800, opacity:0.6, marginBottom:2 }}>
                    {m.sender_name}
                  </div>
                )}
                <div style={{ fontSize:14, fontWeight:600, lineHeight:1.45,
                  whiteSpace:'pre-wrap', wordBreak:'break-word' }}>{m.body}</div>
                <div style={{ fontSize:10, marginTop:3, textAlign:'right',
                  color: mine ? 'rgba(255,255,255,0.8)' : '#9CA3AF' }}>
                  {m.pending ? 'sending…' : timeOf(m.created_at)}
                </div>
              </div>
            </div>
          )
        })}
        <div ref={endRef} />
      </div>

      {err && (
        <div style={{ background:'#FEF2F2', borderTop:'1px solid #FECACA',
          padding:'7px 12px', fontSize:12, fontWeight:700, color:'#B91C1C' }}>{err}</div>
      )}

      {/* The four things anyone actually types during service. A captain with
          a guest in front of them has one hand free, and a tap beats a
          sentence typed on a tablet keyboard that covers half the screen. */}
      {quickReplies.length > 0 && (
        <div style={{ display:'flex', gap:6, flexWrap:'wrap', padding:'8px 10px',
          background:'#FFFFFF', borderTop:'1px solid #ECECEC' }}>
          {quickReplies.map(q => (
            <button key={q} onClick={() => send(q)} disabled={sending}
              style={{ flexShrink:0, background:'#FFF7ED', border:'1.5px solid #FED7AA',
                color:'#9A3412', borderRadius:999, padding:'7px 13px',
                fontSize:12, fontWeight:800, cursor: sending ? 'wait' : 'pointer',
                whiteSpace:'nowrap' }}>{q}</button>
          ))}
        </div>
      )}

      <div style={{ display:'flex', gap:8, padding:'10px', background:'#FFFFFF',
        borderTop:'1px solid #ECECEC', alignItems:'center' }}>
        <input value={text} placeholder="Type a message"
          onChange={e => { setText(e.target.value); setErr('') }}
          onKeyDown={e => { if (e.key === 'Enter') send(text) }}
          style={{ flex:1, minWidth:0, borderRadius:999, padding:'11px 15px',
            border:'1.5px solid #E5E7EB', background:'#F7F7F8', fontSize:14,
            fontWeight:600, outline:'none', fontFamily:'inherit' }} />
        <button onClick={() => send(text)} disabled={!text.trim() || sending}
          style={{ flexShrink:0, border:'none', borderRadius:999, padding:'11px 20px',
            fontSize:14, fontWeight:900,
            background: text.trim() && !sending ? '#E8890C' : '#E5E7EB',
            color: text.trim() && !sending ? '#FFFFFF' : '#9CA3AF',
            cursor: text.trim() && !sending ? 'pointer' : 'not-allowed' }}>
          Send
        </button>
      </div>
    </div>
  )
}
