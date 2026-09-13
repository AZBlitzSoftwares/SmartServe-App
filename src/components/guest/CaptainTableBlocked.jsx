/* Shown when a captain picks a table that is already at its order limit.

   Deliberately not a dead end. The guest at that table will still ask what
   is in the biryani, and a captain who can only say "the app will not let
   me look" is worse than no app. So: explain, then offer the menu anyway.

   Anything they add is held for this table and goes the moment the current
   order is delivered - which is the actual shape of the problem. The
   alternative, taking the order again from scratch later, is what made the
   guest unhappy in the first place. */
export default function CaptainTableBlocked({ tableNum, live, limit, hasHeld, onBrowse, onBack }) {
  return (
    <div style={{ position:'fixed', inset:0, zIndex:130, background:'rgba(26,10,10,0.88)',
      display:'flex', alignItems:'center', justifyContent:'center', padding:22,
      fontFamily:'Manrope, sans-serif' }}>
      <div style={{ width:'100%', maxWidth:430, background:'#fff', borderRadius:24,
        padding:'30px 26px 24px', textAlign:'center',
        boxShadow:'0 20px 60px rgba(0,0,0,0.45)' }}>

        <div style={{ fontSize:50, marginBottom:10, lineHeight:1 }}>⏳</div>

        <div style={{ fontSize:15, fontWeight:800, color:'#9F1239', letterSpacing:'1px',
          marginBottom:4 }}>TABLE {tableNum}</div>

        <div style={{ fontWeight:900, fontSize:25, color:'#BE123C', marginBottom:10,
          lineHeight:1.2 }}>
          Order already in progress
        </div>

        <div style={{ fontSize:15, color:'#9F1239', lineHeight:1.6, fontWeight:600,
          marginBottom:22 }}>
          {live === 1
            ? 'This table has an order waiting to be delivered.'
            : 'This table has ' + live + ' orders waiting to be delivered.'}
          {limit === 1
            ? ' Only one at a time is allowed at this event.'
            : ' The limit is ' + limit + ' at a time.'}
        </div>

        {hasHeld > 0 && (
          <div style={{ background:'#FFF7ED', border:'1.5px solid #FED7AA', borderRadius:12,
            padding:'11px 14px', fontSize:13, color:'#9A3412', fontWeight:700,
            marginBottom:16, lineHeight:1.5 }}>
            You already have {hasHeld} item{hasHeld === 1 ? '' : 's'} saved for this table.
            They will still be here when it frees up.
          </div>
        )}

        {/* Browsing is the point of this screen. A guest is standing there
            asking questions, and the answers are in the menu. */}
        <button onClick={onBrowse}
          style={{ width:'100%', background:'#E8890C', color:'#fff', border:'none',
            borderRadius:14, padding:'16px', fontSize:16, fontWeight:900,
            cursor:'pointer', marginBottom:10 }}>
          🍽️ Show the menu anyway
        </button>

        <div style={{ fontSize:12, color:'#888', lineHeight:1.5, marginBottom:14 }}>
          You can add items now. They stay in the cart and can be sent as soon
          as the current order is delivered.
        </div>

        <button onClick={onBack}
          style={{ width:'100%', background:'transparent', border:'none', padding:'10px',
            fontSize:14, fontWeight:800, color:'#C06A00', textDecoration:'underline',
            cursor:'pointer' }}>
          ← Pick another table
        </button>
      </div>
    </div>
  )
}
