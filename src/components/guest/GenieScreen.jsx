import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { FaceSVG, SENTIMENT_CONFIG } from './FeedbackModal'

/* Genie confirmation screen.

   Everything must fit one screen with no scrolling, on tablets of
   different heights. The video is therefore capped as a share of
   the viewport rather than given its natural size, and the whole
   screen is locked to the viewport with overflow hidden. Text and
   spacing are sized in vh-aware steps so a short screen tightens
   up instead of pushing Place Another Order out of view.

   Exits, all of which clear the timer:
     Place Another Order  -> Menu
     any face     -> feedback saved -> Welcome
     30s timeout  -> Welcome                                    */

const SECONDS = 30

export default function GenieScreen({ tableData, eventData, orderId, onOrderAgain, onDone }) {
  const [left, setLeft] = useState(SECONDS)
  const [saving, setSaving] = useState(false)
  const [chosen, setChosen] = useState(null)
  const videoRef = useRef(null)
  const doneRef = useRef(false)

  useEffect(() => {
    const t = setInterval(() => {
      setLeft(prev => {
        if (prev <= 1) {
          clearInterval(t)
          if (!doneRef.current) { doneRef.current = true; onDone() }
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(t)
  }, [])

  // Sound on by default. Browsers block autoplay with audio unless
  // they treat it as user-initiated, so a rejected play() retries
  // muted - a silent genie beats an empty box.
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    v.muted = eventData?.video_sound_enabled === false
    const p = v.play()
    if (p && p.catch) p.catch(() => { v.muted = true; v.play().catch(() => {}) })
  }, [])

  async function pickFace(key) {
    if (saving || doneRef.current) return
    setChosen(key); setSaving(true)
    try {
      const toRating = { excellent: 5, good: 3, average: 2 }
      const payload = {
        event_id:     eventData?.id || null,
        table_number: tableData?.table_number || null,
        rating:       toRating[key] || 3,
      }
      // Offline ids are not UUIDs and would break the constraint
      if (orderId && !String(orderId).startsWith('offline-')) payload.order_id = orderId
      await supabase.from('feedback').insert(payload)
    } catch (e) {
      console.error('Quick feedback error:', e)
    }
    doneRef.current = true
    onDone()
  }

  return (
    <div className="ss-fullh" style={{ position:'fixed', inset:0, zIndex:90, background:'#EDEDED',
      overflow:'hidden',
      display:'flex', flexDirection:'column', alignItems:'center',
      justifyContent:'flex-start', gap:'0.9vh', padding:'1.4vh 12px' }}>

      {/* Countdown, floated so it takes no layout height */}
      <div style={{ position:'absolute', top:14, right:14, background:'rgba(0,0,0,0.55)',
        color:'#fff', borderRadius:999, padding:'5px 14px', fontSize:13, fontWeight:800 }}>
        {left}s
      </div>

      {/* Video capped by viewport height, never by its own size */}
      {/* Clipping frame. The video is scaled up and nudged upward so the
          generator's watermark in the bottom right corner falls outside
          the frame and is never painted. The same scale enlarges the
          genie, which was wanted regardless.

          This hides the watermark rather than removing it - the real fix
          is a re-export of the clip without it. */}
      {/* A fixed 3:4 frame, height-limited, with the video filling it.
          The source is 9:16, so filling 3:4 crops about a quarter of the
          height and makes the picture roughly a third wider - that is the
          side space being used, without any stretching.

          objectPosition biases the crop upward so more comes off the
          bottom than the top: the generator watermark in the bottom right
          goes, the genie's head near the top stays. */}
      <div style={{ flex:'1 1 auto', minHeight:0, aspectRatio:'3 / 4',
        maxWidth:'min(100%, 70vh)', overflow:'hidden', borderRadius:16,
        background:'#EDEDED', margin:'0 auto' }}>
        <video ref={videoRef} playsInline preload="auto"
          onEnded={e => { try { e.currentTarget.pause() } catch (err) {} }}
          style={{ height:'100%', width:'100%', objectFit:'cover',
            objectPosition:'50% 35%', display:'block' }}>
          <source src="/videos/genie.mp4" type="video/mp4" />
        </video>
      </div>

      <div style={{ fontSize:'clamp(15px, 2.1vh, 19px)', fontWeight:800, color:'#1A0A0A',
        fontStyle:'italic', letterSpacing:'0.3px', textAlign:'center', flexShrink:0, marginTop:'0.6vh' }}>
        Jo Hukum Mere Aaka
      </div>

      <div style={{ fontSize:'clamp(18px, 2.9vh, 26px)', fontWeight:900, color:'#1A0A0A',
        textAlign:'center', lineHeight:1.25, maxWidth:520, flexShrink:0 }}>
        Your order will be served in few minutes
      </div>

      <div style={{ fontSize:'clamp(12px, 1.7vh, 15px)', fontWeight:700, color:'#6B6B6B',
        textAlign:'center', marginTop:'0.6vh', flexShrink:0 }}>
        How is your experience using the app?
      </div>

      {/* Faces with their names. An unlabelled face is a guess - the
          middle one especially - and this is the only feedback most
          guests will ever give, so it should mean what they intended.
          Labels come from SENTIMENT_CONFIG so this screen and the
          detailed feedback page can never drift apart. */}
      <div style={{ display:'flex', gap:'5vw', maxWidth:380, justifyContent:'center',
        flexShrink:0 }}>
        {Object.keys(SENTIMENT_CONFIG).map(key => {
          const cfg = SENTIMENT_CONFIG[key]
          return (
            <button key={key} onClick={() => pickFace(key)} disabled={saving}
              style={{ background:'none', border:'none', padding:'4px 2px', cursor:'pointer',
                display:'flex', flexDirection:'column', alignItems:'center', gap:5,
                opacity: chosen && chosen !== key ? 0.35 : 1,
                transform: chosen === key ? 'scale(1.12)' : 'scale(1)',
                transition:'all 0.18s', WebkitTapHighlightColor:'transparent' }}>
              <FaceSVG type={key} size={50} />
              <span style={{ fontSize:'clamp(11px, 1.5vh, 14px)', fontWeight:800,
                color: cfg.color, whiteSpace:'nowrap', letterSpacing:'0.2px' }}>
                {cfg.label}
              </span>
            </button>
          )
        })}
      </div>

      {/* Flashes for the same reason Order Now does on the menu - it is the
          action we want the guest to notice on a screen that otherwise
          looks finished. */}
      <style>{`
        .ss-fullh { height:100vh; height:100dvh; }
        /* An amber ring pulsing outward, not a colour swing. The button is
           near-black, so any dark-to-dark shift is invisible however
           correctly it animates. */
        @keyframes ssAgainFlash {
          0%   { box-shadow:0 0 0 0 rgba(232,137,12,0.55), 0 6px 20px rgba(0,0,0,0.3);
                 transform:scale(1); }
          55%  { box-shadow:0 0 0 12px rgba(232,137,12,0), 0 8px 26px rgba(0,0,0,0.35);
                 transform:scale(1.045); }
          100% { box-shadow:0 0 0 0 rgba(232,137,12,0), 0 6px 20px rgba(0,0,0,0.3);
                 transform:scale(1); }
        }
        .ss-again { background:#1A0A0A; animation: ssAgainFlash 1.4s ease-out infinite; }
        @media (prefers-reduced-motion: reduce) { .ss-again { animation:none; } }
      `}</style>
      <button className="ss-again"
        onClick={() => { if (!doneRef.current) { doneRef.current = true; onOrderAgain() } }}
        style={{ marginTop:'0.6vh', marginBottom:'0.4vh', color:'#E8890C', border:'none',
          borderRadius:14, padding:'clamp(11px, 1.6vh, 15px) 40px',
          fontSize:'clamp(14px, 2vh, 17px)', fontWeight:900, cursor:'pointer',
          flexShrink:0 }}>
        Place Another Order
      </button>
    </div>
  )
}
