import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { FaceSVG, SENTIMENT_CONFIG } from './FeedbackModal'

/* Genie confirmation screen.

   Everything must fit one screen with no scrolling, on tablets of
   different heights. The video is therefore capped as a share of
   the viewport rather than given its natural size, and the whole
   screen is locked to the viewport with overflow hidden. Text and
   spacing are sized in vh-aware steps so a short screen tightens
   up instead of pushing Order Again out of view.

   Exits, all of which clear the timer:
     Order Again  -> Menu
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
    <div style={{ position:'fixed', inset:0, zIndex:90, background:'#EDEDED',
      height:'100dvh', overflow:'hidden',
      display:'flex', flexDirection:'column', alignItems:'center',
      justifyContent:'center', gap:'1.4vh', padding:'2vh 18px' }}>

      {/* Countdown, floated so it takes no layout height */}
      <div style={{ position:'absolute', top:14, right:14, background:'rgba(0,0,0,0.55)',
        color:'#fff', borderRadius:999, padding:'5px 14px', fontSize:13, fontWeight:800 }}>
        {left}s
      </div>

      {/* Video capped by viewport height, never by its own size */}
      <video ref={videoRef} playsInline preload="auto"
        onEnded={e => { try { e.currentTarget.pause() } catch (err) {} }}
        style={{ height:'40vh', maxHeight:400, width:'auto', maxWidth:'100%',
          objectFit:'contain', borderRadius:16, background:'#EDEDED',
          display:'block', flexShrink:0 }}>
        <source src="/videos/genie.mp4" type="video/mp4" />
      </video>

      <div style={{ fontSize:'clamp(15px, 2.1vh, 19px)', fontWeight:800, color:'#1A0A0A',
        fontStyle:'italic', letterSpacing:'0.3px', textAlign:'center', flexShrink:0 }}>
        Jo Hukam Mere Aaka
      </div>

      <div style={{ fontSize:'clamp(18px, 2.9vh, 26px)', fontWeight:900, color:'#1A0A0A',
        textAlign:'center', lineHeight:1.25, maxWidth:520, flexShrink:0 }}>
        Your order will be served in a few minutes
      </div>

      <div style={{ fontSize:'clamp(12px, 1.7vh, 15px)', fontWeight:700, color:'#6B6B6B',
        textAlign:'center', marginTop:'0.6vh', flexShrink:0 }}>
        How is your experience using the app?
      </div>

      {/* Faces only - no labels, no fields */}
      <div style={{ display:'flex', gap:'4vw', maxWidth:360, justifyContent:'center',
        flexShrink:0 }}>
        {Object.keys(SENTIMENT_CONFIG).map(key => (
          <button key={key} onClick={() => pickFace(key)} disabled={saving}
            style={{ background:'none', border:'none', padding:4, cursor:'pointer',
              opacity: chosen && chosen !== key ? 0.35 : 1,
              transform: chosen === key ? 'scale(1.12)' : 'scale(1)',
              transition:'all 0.18s', WebkitTapHighlightColor:'transparent',
              lineHeight:0 }}>
            <FaceSVG type={key} size={54} />
          </button>
        ))}
      </div>

      <button onClick={() => { if (!doneRef.current) { doneRef.current = true; onOrderAgain() } }}
        style={{ marginTop:'0.8vh', background:'#1A0A0A', color:'#E8890C', border:'none',
          borderRadius:14, padding:'clamp(11px, 1.6vh, 15px) 44px',
          fontSize:'clamp(14px, 2vh, 16px)', fontWeight:900, cursor:'pointer',
          boxShadow:'0 6px 20px rgba(0,0,0,0.28)', flexShrink:0 }}>
        Order Again
      </button>
    </div>
  )
}
