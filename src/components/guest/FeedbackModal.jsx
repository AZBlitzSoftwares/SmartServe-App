import { useState } from 'react'
import { supabase } from '../../lib/supabase'

function FaceSVG({ type, size = 80 }) {
  const configs = {
    excellent: { outline: '#16A34A', fill: '#DCFCE7', eyeType: 'happy' },
    good:      { outline: '#65A30D', fill: '#ECFCCB', eyeType: 'smile' },
    average:   { outline: '#D97706', fill: '#FEF3C7', eyeType: 'flat'  },
  }
  const c = configs[type]
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="10" stroke={c.outline} strokeWidth="2" fill={c.fill} />
      <circle cx="8.5" cy="9.5" r="1.2" fill={c.outline} />
      <circle cx="15.5" cy="9.5" r="1.2" fill={c.outline} />
      {c.eyeType === 'happy' && <path d="M 8,14 Q 12,18.5 16,14" stroke={c.outline} strokeWidth="1.8" strokeLinecap="round" fill="none" />}
      {c.eyeType === 'smile' && <path d="M 8.5,14 Q 12,17 15.5,14" stroke={c.outline} strokeWidth="1.8" strokeLinecap="round" fill="none" />}
      {c.eyeType === 'flat'  && <line x1="8.5" y1="15" x2="15.5" y2="15" stroke={c.outline} strokeWidth="1.8" strokeLinecap="round" />}
    </svg>
  )
}

const SENTIMENT_CONFIG = {
  excellent: { label: 'Excellent', color: '#16A34A', bg: '#DCFCE7', border: '#86EFAC' },
  good:      { label: 'Good',      color: '#65A30D', bg: '#ECFCCB', border: '#BEF264' },
  average:   { label: 'Average',   color: '#D97706', bg: '#FEF3C7', border: '#FCD34D' },
}

function FacePicker({ onSelect, onClose }) {
  return (
    <div style={{ position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.65)', zIndex:100, display:'flex', flexDirection:'column', justifyContent:'flex-end' }}>
      <div style={{ background:'#fff', borderRadius:'24px 24px 0 0', padding:'24px 20px 48px', width:'100%', boxSizing:'border-box' }}>
        <div style={{ width:40, height:4, background:'#E5E7EB', borderRadius:999, margin:'0 auto 20px' }} />
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <h3 style={{ fontSize:19, fontWeight:800, color:'#1A1A1A', margin:0 }}>How was your experience?</h3>
          <button onClick={onClose} style={{ background:'#F5F5F5', border:'none', borderRadius:999, width:36, height:36, fontSize:20, color:'#888', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>✕</button>
        </div>
        <p style={{ fontSize:14, color:'#888', marginBottom:24, marginTop:0 }}>Tap a face to share your feedback</p>
        <div style={{ display:'flex', justifyContent:'space-around', alignItems:'center', paddingBottom:8 }}>
          {Object.entries(SENTIMENT_CONFIG).map(([key, cfg]) => (
            <button key={key} onClick={() => onSelect(key)}
              style={{ background:'none', border:'2px solid transparent', cursor:'pointer', display:'flex', flexDirection:'column', alignItems:'center', gap:8, padding:'12px 8px', borderRadius:16, flex:1, WebkitTapHighlightColor:'transparent' }}>
              <FaceSVG type={key} size={72} />
              <span style={{ fontSize:14, fontWeight:800, color:cfg.color }}>{cfg.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// Flash animation for Skip button
const skipFlashStyle = `
  @keyframes skipFlash {
    0%, 100% { background: transparent; border-color: #D1D5DB; color: #9CA3AF; }
    50% { background: #1A0A0A; border-color: #E8890C; color: #E8890C; }
  }
  .skip-flash { animation: skipFlash 2s ease-in-out infinite; }
`

function DetailedForm({ sentiment, orderId, tableData, eventData, onClose, onDone }) {
  const cfg = SENTIMENT_CONFIG[sentiment]
  const [foodRating, setFoodRating] = useState(null)
  const [serviceRating, setServiceRating] = useState(null)
  const [name, setName] = useState('')
  const [mobile, setMobile] = useState('')
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  function FaceRow({ label, value, onChange }) {
    return (
      <div style={{ marginBottom:18 }}>
        <div style={{ fontWeight:700, fontSize:14, color:'#444', marginBottom:10 }}>{label}</div>
        <div style={{ display:'flex', gap:12, justifyContent:'center' }}>
          {Object.entries(SENTIMENT_CONFIG).map(([key, c]) => (
            <button key={key} onClick={() => onChange(key)}
              style={{ background: value===key ? c.bg : '#F9F9F9', border:'2px solid', borderColor: value===key ? c.border : '#E5E7EB', borderRadius:16, padding:'10px 14px', cursor:'pointer', display:'flex', flexDirection:'column', alignItems:'center', gap:6, transition:'all 0.15s', flex:1 }}>
              <FaceSVG type={key} size={36} />
              <span style={{ fontSize:11, fontWeight:700, color: value===key ? c.color : '#888' }}>{c.label}</span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  async function submit() {
    setSubmitting(true)
    try {
      const sentimentToRating = { excellent: 5, good: 3, average: 2 }
      const payload = {
        event_id:       eventData?.id || null,
        table_number:   tableData?.table_number || null,
        rating:         sentimentToRating[sentiment] || 3,
        food_rating:    foodRating ? sentimentToRating[foodRating] : null,
        service_rating: serviceRating ? sentimentToRating[serviceRating] : null,
        guest_name:     name.trim() || null,
        guest_mobile:   mobile.trim() || null,
        comment:        comment.trim() || null,
        // sentiment column — add via SQL: ALTER TABLE feedback ADD COLUMN IF NOT EXISTS sentiment TEXT;
        // sentiment: sentiment, // uncomment after running SQL above
      }
      if (orderId && !orderId.startsWith('offline-')) payload.order_id = orderId
      const { error } = await supabase.from('feedback').insert(payload)
      if (error) {
        console.error('Feedback INSERT error:', error.message)
        // Fallback without sentiment column (if column not yet added)
        const fallback = { ...payload }
        delete fallback.sentiment
        const { error: err2 } = await supabase.from('feedback').insert(fallback)
        if (err2) console.error('Feedback fallback error:', err2.message)
      }
      setSubmitted(true)
      setTimeout(() => onDone(), 2800)
    } catch(e) {
      console.error('Feedback exception:', e)
      setSubmitted(true)
      setTimeout(() => onDone(), 2800)
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) return (
    <div style={{ position:'fixed', inset:0, background:'linear-gradient(160deg,#1A0A0A,#3A1A2E)', zIndex:100, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:24, textAlign:'center' }}>
      <div style={{ marginBottom:20 }}><FaceSVG type={sentiment} size={100} /></div>
      <h2 style={{ color:'#fff', fontSize:26, fontWeight:800, marginBottom:10 }}>Thank You!</h2>
      <p style={{ color:'rgba(255,255,255,0.7)', fontSize:15, lineHeight:1.6, maxWidth:260 }}>Your feedback helps us serve you better!</p>
    </div>
  )

  return (
    <div style={{ position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.65)', zIndex:100, display:'flex', flexDirection:'column', justifyContent:'flex-end' }}>
      <div style={{ background:'#fff', borderRadius:'24px 24px 0 0', width:'100%', maxHeight:'90vh', display:'flex', flexDirection:'column', boxSizing:'border-box' }}>
        <div style={{ padding:'20px 24px 0', flexShrink:0 }}>
          <div style={{ width:40, height:4, background:'#E5E7EB', borderRadius:999, margin:'0 auto 16px' }} />
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
            <h3 style={{ fontSize:18, fontWeight:800, margin:0 }}>Your Feedback</h3>
            <button onClick={onClose} style={{ background:'#F5F5F5', border:'none', borderRadius:999, width:34, height:34, fontSize:18, color:'#888', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>✕</button>
          </div>
          <div style={{ display:'inline-flex', alignItems:'center', gap:8, background:cfg.bg, border:'1.5px solid '+cfg.border, borderRadius:999, padding:'6px 14px', marginBottom:16 }}>
            <FaceSVG type={sentiment} size={22} />
            <span style={{ fontWeight:800, fontSize:14, color:cfg.color }}>{cfg.label}</span>
          </div>
        </div>
        <div style={{ flex:1, overflowY:'auto', padding:'0 24px' }}>
          <FaceRow label="Food Experience" value={foodRating} onChange={setFoodRating} />
          <FaceRow label="How Was The Service?" value={serviceRating} onChange={setServiceRating} />
          <div style={{ marginBottom:12 }}>
            <div style={{ fontWeight:700, fontSize:14, color:'#444', marginBottom:8 }}>Your Name (optional)</div>
            <input value={name} onChange={e=>setName(e.target.value)} placeholder="Your name"
              style={{ width:'100%', border:'1.5px solid #ddd', borderRadius:10, padding:'10px 14px', fontSize:14, fontFamily:'Manrope', outline:'none', boxSizing:'border-box' }} />
          </div>
          <div style={{ marginBottom:12 }}>
            <div style={{ fontWeight:700, fontSize:14, color:'#444', marginBottom:8 }}>Mobile (optional)</div>
            <input value={mobile} onChange={e=>setMobile(e.target.value)} placeholder="Mobile number" type="tel"
              style={{ width:'100%', border:'1.5px solid #ddd', borderRadius:10, padding:'10px 14px', fontSize:14, fontFamily:'Manrope', outline:'none', boxSizing:'border-box' }} />
          </div>
          <div style={{ marginBottom:16 }}>
            <div style={{ fontWeight:700, fontSize:14, color:'#444', marginBottom:8 }}>Comments (optional)</div>
            <textarea value={comment} onChange={e=>setComment(e.target.value)} placeholder="Tell us about your experience..."
              style={{ width:'100%', border:'1.5px solid #ddd', borderRadius:10, padding:'10px 14px', fontSize:14, fontFamily:'Manrope', outline:'none', resize:'none', height:72, boxSizing:'border-box' }} />
          </div>
        </div>
        <div style={{ padding:'12px 24px 32px', flexShrink:0, borderTop:'1px solid #F0F0F0', display:'flex', gap:10 }}>
          <style>{skipFlashStyle}</style>
          {/* Skip — flashes between grey and amber to attract attention */}
          <button onClick={onClose} className="skip-flash"
            style={{ flex:1, border:'2px solid #D1D5DB',
              borderRadius:14, padding:'15px', fontSize:14, fontWeight:700,
              cursor:'pointer', letterSpacing:'0.3px', transition:'all 0.3s' }}>
            Skip
          </button>
          {/* Submit — solid dark, amber text, larger */}
          <button onClick={submit} disabled={submitting}
            style={{ flex:2, background:submitting?'#555':'#1A0A0A', color:'#E8890C',
              border:'none', borderRadius:14, padding:'15px', fontSize:16,
              fontWeight:900, cursor:submitting?'wait':'pointer' }}>
            {submitting ? 'Submitting...' : 'Submit →'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function FeedbackModal({ orderId, tableData, eventData, onClose }) {
  const [step, setStep] = useState('picker')
  const [sentiment, setSentiment] = useState(null)
  function handleFaceSelect(s) { setSentiment(s); setStep('form') }
  if (step === 'picker') return <FacePicker onSelect={handleFaceSelect} onClose={onClose} />
  return <DetailedForm sentiment={sentiment} orderId={orderId} tableData={tableData} eventData={eventData} onClose={onClose} onDone={onClose} />
}
