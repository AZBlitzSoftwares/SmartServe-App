import ChatThread from '../chat/ChatThread'

/* The captain's end of the supervisor chat.

   Docked bottom-right over the table grid rather than a screen of its own.
   A captain messaging the supervisor is usually looking at the grid while
   they do it - "table 12 has been waiting" is a sentence about something
   on that screen - and a full screen chat would hide it.

   Minimised is a real state, not a close. The bar stays on screen with its
   unread count, so a captain who is mid-conversation and needs the grid
   back does not have to remember to reopen anything.

   Only rendered on the table grid. On the menu screen the bottom strip
   belongs to the order bar, and an incoming message shows as a toast at
   the top instead - a captain standing at a table taking an order should
   not have a chat panel land on the button they are reaching for.        */

const QUICK = [
  'Need help at my table',
  'Guest waiting too long',
  'Is this item finished?',
  'Please call me',
]

export default function CaptainChat({ eventData, captain, minimized, unread = 0, onToggle, hidePill, bottomOffset = 16 }) {
  // On the menu screen the launcher lives in the bottom bar instead, so the
  // pill is suppressed there. A floating pill would sit on top of the order
  // buttons, which is the one part of that screen that must stay clear.
  if (minimized && hidePill) return null
  if (minimized) {
    const shouting = unread > 0
    return (
      <>
      {shouting && (
        <style>{`@keyframes ssCapChatPulse{
          0%   {background:#DC2626;box-shadow:0 0 0 0 rgba(220,38,38,0.8);transform:scale(1)}
          50%  {background:#1A0A0A;box-shadow:0 0 0 16px rgba(220,38,38,0);transform:scale(1.07)}
          100% {background:#DC2626;box-shadow:0 0 0 0 rgba(220,38,38,0);transform:scale(1)}
        }.ss-cap-chat-pulse{animation:ssCapChatPulse 0.85s ease-in-out infinite}`}</style>
      )}
      <button onClick={onToggle} className={shouting ? 'ss-cap-chat-pulse' : undefined}
        style={{ position:'fixed', right:16, bottom:16, zIndex:150,
          display:'flex', alignItems:'center', gap:9,
          background:'#1A0A0A', color:'#fff',
          border:'2px solid ' + (shouting ? '#FFFFFF' : '#E8890C'),
          borderRadius:999, padding:'12px 20px', fontSize:14, fontWeight:900,
          cursor:'pointer', boxShadow:'0 8px 26px rgba(0,0,0,0.45)',
          fontFamily:'Manrope, sans-serif' }}>
        💬 Supervisor
        {unread > 0 && (
          <span style={{ background:'#DC2626', color:'#fff', borderRadius:999,
            minWidth:21, height:21, fontSize:11, fontWeight:900, padding:'0 6px',
            display:'inline-flex', alignItems:'center', justifyContent:'center' }}>
            {unread}
          </span>
        )}
      </button>
      {/* ss-cap-chat-pulse-end */}
      </>
    )
  }

  return (
    <div style={{ position:'fixed', right:16, bottom:bottomOffset, zIndex:150,
      width:'min(380px, calc(100vw - 32px))',
      height:'min(520px, calc(100vh - ' + (bottomOffset + 94) + 'px))',
      background:'#FFFFFF', borderRadius:18, overflow:'hidden',
      display:'flex', flexDirection:'column',
      boxShadow:'0 18px 50px rgba(0,0,0,0.45)', fontFamily:'Manrope, sans-serif' }}>

      <div style={{ flexShrink:0, background:'#1A0A0A', padding:'12px 10px 12px 16px',
        display:'flex', alignItems:'center', gap:10 }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ color:'#fff', fontSize:15, fontWeight:900 }}>Supervisor</div>
          <div style={{ color:'rgba(255,255,255,0.5)', fontSize:11, fontWeight:600,
            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            You are {captain?.name || 'captain'}
          </div>
        </div>
        {/* One button, because minimise and close would do the same thing.
            The panel shrinks to the pill it came from and nothing is lost. */}
        <button onClick={onToggle} title="Minimise"
          style={{ flexShrink:0, background:'rgba(255,255,255,0.14)', border:'none',
            color:'#fff', borderRadius:9, padding:'0 14px', height:34, fontSize:15,
            fontWeight:900, cursor:'pointer', lineHeight:1 }}>— Minimise</button>
      </div>

      <div style={{ flex:1, minHeight:0 }}>
        <ChatThread eventId={eventData?.id} captainId={captain?.id}
          me="captain" meName={captain?.name || ''}
          quickReplies={QUICK}
          emptyHint={'Message the supervisor from here.\nThey see it on their screen straight away.'} />
      </div>
    </div>
  )
}
