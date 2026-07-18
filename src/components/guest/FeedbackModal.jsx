import { useState } from 'react'
import { supabase } from '../../lib/supabase'

export default function FeedbackModal({ orderId, tableData, eventData, onClose }) {
  const [rating, setRating] = useState(0)
  const [hoverRating, setHoverRating] = useState(0)
  const [food, setFood] = useState(0); const [hf, setHf] = useState(0)
  const [service, setService] = useState(0); const [hs, setHs] = useState(0)
  const [appExp, setAppExp] = useState(0); const [happ, setHapp] = useState(0)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [mobile, setMobile] = useState('')
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [errors, setErrors] = useState({})

  const MOOD = { 5:'Excellent! 🎉', 4:'Great! 😊', 3:'Good 👍', 2:'Could be better 😐', 1:'Poor 😞' }
  const MOOD_COLOR = { 5:'#16A34A', 4:'#16A34A', 3:'#D97706', 2:'#D97706', 1:'#DC2626' }

  function Stars({ value, hover, onSet, onHover, size=36 }) {
    return (
      <div style={{ display:'flex', gap:6 }}>
        {[1,2,3,4,5].map(s => (
          <button key={s} onClick={() => onSet(s)} onMouseEnter={() => onHover(s)} onMouseLeave={() => onHover(0)}
            style={{ background:'none', border:'none', fontSize:size, cursor:'pointer', transition:'transform 0.15s', transform:(hover||value)>=s?'scale(1.2)':'scale(1)', filter:(hover||value)>=s?'none':'grayscale(1) opacity(0.3)', padding:0 }}>⭐</button>
        ))}
      </div>
    )
  }

  async function submit() {
    if (!rating) { setErrors({ rating:'Please select a rating' }); return }
    setSubmitting(true)
    try {
      const payload = {
        event_id: eventData?.id || null,
        table_id: tableData?.id || null,
        rating,
        food_rating: food || null,
        service_rating: service || null,
        app_experience_rating: appExp || null,
        guest_name: name.trim() || null,
        guest_email: email.trim() || null,
        guest_mobile: mobile.trim() || null,
        comment: comment.trim() || null
      }
      // Only add order_id if it's a valid UUID (not offline-)
      if (orderId && !orderId.startsWith('offline-')) {
        payload.order_id = orderId
      }
      const { error } = await supabase.from('feedback').insert(payload)
      if (error) {
        console.error('Feedback error:', error)
        // Still show thank you — don't block guest
      }
      setSubmitted(true)
      setTimeout(() => onClose(), 3500)
    } catch(e) {
      console.error('Feedback submit error:', e)
      setSubmitted(true) // show thank you anyway
      setTimeout(() => onClose(), 3500)
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) return (
    <div style={{ position:'fixed', inset:0, background:'linear-gradient(160deg,#2A1B2E,#4A2340,#8E2A5C)', zIndex:100, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:24, textAlign:'center' }}>
      <div style={{ fontSize:80, marginBottom:20 }}>🙏</div>
      <h2 style={{ color:'#fff', fontSize:28, fontWeight:800, marginBottom:12 }}>Thank You!</h2>
      <p style={{ color:'rgba(255,255,255,0.75)', fontSize:16, lineHeight:1.6, maxWidth:280, marginBottom:16 }}>Your feedback means a lot to us. We hope you had a wonderful experience!</p>
      <div style={{ display:'flex', gap:2, marginBottom:24 }}>
        {[...Array(rating)].map((_,i) => <span key={i} style={{ fontSize:36 }}>⭐</span>)}
      </div>
      <p style={{ color:'rgba(255,255,255,0.4)', fontSize:13 }}>Returning to home screen...</p>
    </div>
  )

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', zIndex:100, display:'flex', alignItems:'flex-end', justifyContent:'center' }}>
      <div style={{ background:'#fff', borderRadius:'24px 24px 0 0', padding:'24px 24px 48px', width:'100%', maxWidth:500, maxHeight:'92vh', overflowY:'auto' }}>
        <div style={{ width:40, height:4, background:'#E8E0F0', borderRadius:999, margin:'0 auto 20px' }}></div>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
          <h3 style={{ fontSize:20, fontWeight:800 }}>Share Your Experience</h3>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:22, color:'#999', cursor:'pointer' }}>✕</button>
        </div>
        <p style={{ fontSize:13, color:'#888', marginBottom:20 }}>Your feedback helps us serve you better</p>

        <div style={{ marginBottom:20 }}>
          <div style={{ fontWeight:700, fontSize:14, marginBottom:10 }}>Overall Rating *</div>
          <Stars value={rating} hover={hoverRating} onSet={setRating} onHover={setHoverRating} size={40} />
          {rating > 0 && <div style={{ marginTop:8, fontSize:14, fontWeight:700, color:MOOD_COLOR[rating] }}>{MOOD[rating]}</div>}
          {errors.rating && <div style={{ color:'#DC2626', fontSize:12, marginTop:4 }}>{errors.rating}</div>}
        </div>

        <div style={{ background:'#f9f9f9', borderRadius:14, padding:14, marginBottom:20 }}>
          <div style={{ fontWeight:700, fontSize:14, marginBottom:12 }}>Rate by Category</div>
          {[
              ['🍛 Food Quality', food, hf, setFood, setHf],
              ['⚡ Service Speed', service, hs, setService, setHs],
              ['📱 App Ease of Use', appExp, happ, setAppExp, setHapp],
            ].map(([label,val,hov,setVal,setHov]) => (
            <div key={label} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 0', borderBottom:'1px solid #eee' }}>
              <span style={{ fontSize:13, fontWeight:600 }}>{label}</span>
              <Stars value={val} hover={hov} onSet={setVal} onHover={setHov} size={22} />
            </div>
          ))}
        </div>

        <div style={{ marginBottom:16 }}>
          <div style={{ fontWeight:700, fontSize:14, marginBottom:10 }}>Your Details (optional)</div>
          {[['name','Your name','text',name,setName],['email','Email address','email',email,setEmail],['mobile','Mobile number','tel',mobile,setMobile]].map(([key,ph,type,val,set]) => (
            <input key={key} value={val} onChange={e=>set(e.target.value)} placeholder={ph} type={type}
              style={{ width:'100%', border:'1.5px solid #ddd', borderRadius:10, padding:'10px 14px', fontSize:14, fontFamily:'Manrope', outline:'none', boxSizing:'border-box', marginBottom:8 }} />
          ))}
        </div>

        <div style={{ marginBottom:24 }}>
          <div style={{ fontWeight:700, fontSize:14, marginBottom:10 }}>Comments</div>
          <textarea value={comment} onChange={e=>setComment(e.target.value)} placeholder="Tell us about your experience..."
            style={{ width:'100%', border:'1.5px solid #ddd', borderRadius:12, padding:'12px 16px', fontSize:14, fontFamily:'Manrope', outline:'none', resize:'none', height:80, boxSizing:'border-box' }} />
        </div>

        <div style={{ display:'flex', gap:10 }}>
          <button onClick={onClose} style={{ flex:1, background:'#f5f5f5', border:'none', borderRadius:14, padding:'16px', fontSize:15, fontWeight:700, color:'#888' }}>Skip</button>
          <button onClick={submit} disabled={submitting} style={{ flex:2, background:submitting?'#999':'#1a0a0a', color:'#E8890C', border:'none', borderRadius:14, padding:'16px', fontSize:15, fontWeight:800, cursor:submitting?'wait':'pointer' }}>
            {submitting?'Submitting...':'Submit Feedback →'}
          </button>
        </div>
      </div>
    </div>
  )
}
