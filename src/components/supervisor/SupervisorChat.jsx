import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import ChatThread from '../chat/ChatThread'

/* The supervisor's end: every captain on the event, one thread each.

   Docked bottom-right over the orders board rather than living in a tab.
   A supervisor answering "table 12 has been waiting" needs to look at
   table 12 on the board while they type, and a tab would replace exactly
   the thing they are being asked about.

   The list is every captain on the event, not only the ones who have
   written. The supervisor starting the conversation is as common as the
   captain starting it - "where are you", "come to the kitchen" - and a
   list that only fills up after someone messages first makes that
   impossible on the one occasion it matters.

   Sorted by most recent activity, with unread first. On a forty table
   event with eight captains, the one who needs answering should not have
   to be hunted for alphabetically.                                       */

const POLL_MS = 4000

const QUICK = [
  'On it',
  'Waiter sent',
  'Give me 5 minutes',
  'That item is finished',
  'Please call me',
]

export default function SupervisorChat({ eventData, meName, minimized, unread = 0, onToggle, focus }) {
  const [threads, setThreads] = useState([])
  const [openId, setOpenId] = useState(null)
  const [loading, setLoading] = useState(true)
  // True for a few seconds after the panel has opened itself for a new
  // message. The pill's blink cannot do this job: opening the panel reads
  // the message, so the unread count is zero almost immediately.
  const [flash, setFlash] = useState(false)

  useEffect(() => {
    if (!eventData?.id) return
    load()
    const t = setInterval(load, POLL_MS)
    return () => clearInterval(t)
  }, [eventData?.id])

  // Leaving one event for another must not leave the previous event's
  // conversation open on screen.
  useEffect(() => { setOpenId(null) }, [eventData?.id])

  // A new message opens its own thread. Keyed on a nonce rather than the id
  // so a second message from the SAME captain reopens it too.
  useEffect(() => {
    if (!focus || !focus.captainId) return
    setOpenId(focus.captainId)
    setFlash(true)
    const t = setTimeout(() => setFlash(false), 4000)
    return () => clearTimeout(t)
  }, [focus ? focus.nonce : null])

  async function load() {
    if (!eventData?.id) return
    try {
      const [{ data: caps }, { data: msgs }] = await Promise.all([
        supabase.from('captains').select('id, name, mobile, is_active')
          .eq('event_id', eventData.id),
        supabase.from('chat_messages')
          .select('captain_id, sender, body, created_at, read_by_supervisor')
          .eq('event_id', eventData.id)
          .order('created_at', { ascending: true }),
      ])

      const last = {}, unreadBy = {}
      ;(msgs || []).forEach(m => {
        last[m.captain_id] = m
        if (m.sender === 'captain' && !m.read_by_supervisor) {
          unreadBy[m.captain_id] = (unreadBy[m.captain_id] || 0) + 1
        }
      })

      const list = (caps || [])
        .filter(c => c.is_active !== false)
        .map(c => ({ ...c, last: last[c.id] || null, unread: unreadBy[c.id] || 0 }))
        .sort((a, b) => {
          if ((b.unread > 0) !== (a.unread > 0)) return b.unread - a.unread
          const at = a.last ? new Date(a.last.created_at).getTime() : 0
          const bt = b.last ? new Date(b.last.created_at).getTime() : 0
          if (bt !== at) return bt - at
          return (a.name || '').localeCompare(b.name || '')
        })
      setThreads(list)
    } catch (e) { /* the next poll covers it */ }
    setLoading(false)
  }

  if (minimized) {
    /* ss-chat-pulse. A static badge in the corner of a board that is itself
       full of red flashing rows is invisible. This one alternates red and
       near-black and throws an expanding ring, so it reads as movement out
       of the corner of the eye rather than as one more red thing.

       It stops the instant the thread is read - a light that never goes out
       is a light nobody looks at. */
    const shouting = unread > 0
    return (
      <>
      {shouting && (
        <style>{`@keyframes ssChatPulse{
          0%   {background:#DC2626;box-shadow:0 0 0 0 rgba(220,38,38,0.8);transform:scale(1)}
          50%  {background:#1A0A0A;box-shadow:0 0 0 16px rgba(220,38,38,0);transform:scale(1.07)}
          100% {background:#DC2626;box-shadow:0 0 0 0 rgba(220,38,38,0);transform:scale(1)}
        }.ss-chat-pulse{animation:ssChatPulse 0.85s ease-in-out infinite}`}</style>
      )}
      <button onClick={onToggle} className={shouting ? 'ss-chat-pulse' : undefined}
        style={{ position:'fixed', right:18, bottom:18, zIndex:150,
          display:'flex', alignItems:'center', gap:9,
          background:'#1A0A0A', color:'#fff',
          border:'2px solid ' + (shouting ? '#FFFFFF' : '#E8890C'),
          borderRadius:999, padding:'12px 20px', fontSize:14, fontWeight:900,
          cursor:'pointer', boxShadow:'0 8px 26px rgba(0,0,0,0.4)' }}>
        💬 Captains
        {unread > 0 && (
          <span style={{ background:'#DC2626', color:'#fff', borderRadius:999,
            minWidth:21, height:21, fontSize:11, fontWeight:900, padding:'0 6px',
            display:'inline-flex', alignItems:'center', justifyContent:'center' }}>
            {unread}
          </span>
        )}
      </button>
      {/* ss-chat-pulse-end */}
      </>
    )
  }

  const open = threads.find(t => t.id === openId) || null

  return (
    <div style={{ position:'fixed', right:18, bottom:18, zIndex:150,
      width:'min(390px, calc(100vw - 36px))', height:'min(540px, calc(100vh - 120px))',
      background:'#FFFFFF', borderRadius:18, overflow:'hidden',
      display:'flex', flexDirection:'column',
      boxShadow:'0 18px 50px rgba(0,0,0,0.42)' }}>

      {flash && (
        <style>{`@keyframes ssChatHead{0%,100%{background:#DC2626}50%{background:#1A0A0A}}
          .ss-chat-head-flash{animation:ssChatHead 0.7s ease-in-out infinite}`}</style>
      )}
      <div className={flash ? 'ss-chat-head-flash' : undefined}
        style={{ flexShrink:0, background:'#1A0A0A', padding:'12px 10px 12px 14px',
        display:'flex', alignItems:'center', gap:9 }}>
        {open && (
          <button onClick={() => setOpenId(null)} title="All captains"
            style={{ flexShrink:0, background:'rgba(255,255,255,0.14)', border:'none',
              color:'#fff', borderRadius:9, width:32, height:32, fontSize:16,
              fontWeight:900, cursor:'pointer', lineHeight:1 }}>‹</button>
        )}
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ color:'#fff', fontSize:15, fontWeight:900,
            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {open ? open.name : 'Captains'}
          </div>
          <div style={{ color:'rgba(255,255,255,0.5)', fontSize:11, fontWeight:600,
            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {open ? (open.mobile || eventData?.name || '') : (eventData?.name || '')}
          </div>
        </div>
        {/* One button. Minimise and close would do the same thing here -
            the panel shrinks back to the pill and nothing is lost. */}
        <button onClick={onToggle} title="Minimise"
          style={{ flexShrink:0, background:'rgba(255,255,255,0.14)', border:'none',
            color:'#fff', borderRadius:9, padding:'0 14px', height:34, fontSize:15,
            fontWeight:900, cursor:'pointer', lineHeight:1 }}>— Minimise</button>
      </div>

      {open ? (
        <div style={{ flex:1, minHeight:0 }}>
          {/* Keyed, so switching captains clears the composer. Without it a
              half typed reply would follow you into the next thread and be
              sent to the wrong person. */}
          <ChatThread key={open.id} eventId={eventData?.id} captainId={open.id}
            me="supervisor" meName={meName || 'Operator'}
            quickReplies={QUICK}
            emptyHint={'Nothing from ' + open.name + ' yet.\nYou can start here.'} />
        </div>
      ) : (
        <div style={{ flex:1, overflowY:'auto', background:'#F7F7F8', minHeight:0 }}>
          {loading ? (
            <div style={{ textAlign:'center', padding:34, color:'#9CA3AF', fontSize:13 }}>Loading…</div>
          ) : threads.length === 0 ? (
            <div style={{ textAlign:'center', padding:'30px 20px', color:'#9CA3AF',
              fontSize:13, lineHeight:1.7 }}>
              No captains on this event yet.<br />
              Add them under Control, then they appear here.
            </div>
          ) : threads.map(t => (
            <button key={t.id} onClick={() => setOpenId(t.id)}
              style={{ width:'100%', textAlign:'left', background:'#FFFFFF',
                border:'none', borderBottom:'1px solid #F0F0F0', padding:'12px 14px',
                cursor:'pointer', display:'flex', alignItems:'center', gap:11 }}>
              <span style={{ flexShrink:0, width:38, height:38, borderRadius:999,
                background: t.unread ? '#E8890C' : '#F3F4F6',
                color: t.unread ? '#FFFFFF' : '#6B7280',
                display:'flex', alignItems:'center', justifyContent:'center',
                fontSize:16, fontWeight:900 }}>
                {(t.name || '?').trim().charAt(0).toUpperCase()}
              </span>
              <span style={{ flex:1, minWidth:0 }}>
                <span style={{ display:'block', fontSize:14, fontWeight:900, color:'#1A0A0A',
                  overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {t.name}
                </span>
                <span style={{ display:'block', fontSize:12, marginTop:2,
                  color: t.unread ? '#1A0A0A' : '#9CA3AF',
                  fontWeight: t.unread ? 800 : 600,
                  overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {t.last
                    ? (t.last.sender === 'supervisor' ? 'You: ' : '') + t.last.body
                    : 'No messages yet'}
                </span>
              </span>
              {t.unread > 0 && (
                <span style={{ flexShrink:0, background:'#DC2626', color:'#fff',
                  borderRadius:999, minWidth:21, height:21, fontSize:11, fontWeight:900,
                  padding:'0 6px', display:'inline-flex', alignItems:'center',
                  justifyContent:'center' }}>{t.unread}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
