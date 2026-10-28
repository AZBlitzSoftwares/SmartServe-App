import { useState, useEffect, useRef } from 'react'
import janusLogo from '../../assets/janus_logo.jpg'
import igQr from '../../assets/ig_qr_card.jpg'
import { saveContact, cleanPhone, cleanEmail } from '../../lib/contactOutbox'

/* Contact us - guest tablets only (never on a captain's tablet).

   Janu's Smart Serve's own advert, from the poster, and one thing to do: a
   short form - name, WhatsApp number, email (number or email required) - so
   the team can contact them. Nothing here opens another app - no
   phone, WhatsApp or Instagram links - so the guest never leaves Smart Serve.
   The number and the Instagram code are there to read and to scan with the
   guest's own phone.

   The page closes itself after 3 minutes without a touch, so a tablet left on
   it goes back to the menu (and from there to Welcome, as usual). */

export const CONTACT_PHONE = '+91 98331 04763'
const IDLE_CLOSE_MS = 3 * 60 * 1000

const NAVY = '#1B2559'
const GOLD = '#F4B400'

const POINTS = [
  { icon:'⏱️', title:'Fast & convenient', text:'Order in minutes without leaving your seat.' },
  { icon:'🛎️', title:'Easy-to-browse menu', text:'A wide range of food & drinks at your fingertips.' },
  { icon:'⭐', title:'More time to enjoy', text:'Relax and celebrate. The catering team takes care of your order.' },
  { icon:'🎉', title:'Perfect for all events', text:'Weddings · Corporate events · Parties · Celebrations · Banquets' },
]

export default function ContactUs({ eventData, tableData, tableNumber, onClose }) {
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(null)   // { phone, email } saved
  const formRef = useRef(null)

  // Close by itself when nobody touches it for a while
  useEffect(() => {
    let t = null
    const arm = () => { clearTimeout(t); t = setTimeout(() => onClose?.(), IDLE_CLOSE_MS) }
    arm()
    const evs = ['touchstart', 'pointerdown', 'keydown', 'scroll']
    evs.forEach(e => window.addEventListener(e, arm, { passive: true, capture: true }))
    return () => { clearTimeout(t); evs.forEach(e => window.removeEventListener(e, arm, { capture: true })) }
  }, [onClose])

  async function send() {
    if (busy) return
    const p = phone.trim() ? cleanPhone(phone) : null
    const m = email.trim() ? cleanEmail(email) : null
    if (!phone.trim() && !email.trim()) { setErr('Please enter your mobile number or email ID.'); return }
    if (phone.trim() && !p) { setErr('Please enter a 10-digit mobile number (another country: start with + and its code).'); return }
    if (email.trim() && !m) { setErr('Please check the email ID.'); return }
    setErr(''); setBusy(true)
    try {
      await saveContact({ eventId: eventData?.id, tableId: tableData?.id, tableNumber, phone: p, email: m, name })
      setSent({ phone: p, email: m })   // saved now, or kept on the tablet and sent as soon as the server answers
    } finally { setBusy(false) }
  }

  // The keyboard covers the bottom half of the tablet: bring the box up
  const lift = () => setTimeout(() => { try { formRef.current?.scrollIntoView({ block:'center', behavior:'smooth' }) } catch { /* old webview */ } }, 250)

  const input = { width:'100%', boxSizing:'border-box', border:'2px solid #D6DAE8', borderRadius:12,
    padding:'13px 14px', fontSize:18, fontWeight:700, outline:'none', background:'#fff', color:NAVY }

  return (
    <div data-testid="contact-us" style={{ position:'fixed', inset:0, zIndex:150, background:'#F3F4F8',
      display:'flex', flexDirection:'column' }}>
      {/* Same header as Track */}
      <div style={{ display:'flex', alignItems:'center', gap:12, padding:'14px 16px', background:'#1A0A0A',
        flexShrink:0, boxShadow:'0 2px 12px rgba(0,0,0,0.35)' }}>
        <button onClick={onClose} style={{ background:'#E8890C', border:'none', borderRadius:10,
          padding:'11px 20px', fontSize:15, fontWeight:800, cursor:'pointer', color:'#fff',
          boxShadow:'0 3px 12px rgba(232,137,12,0.5)', flexShrink:0 }}>← Back</button>
        <h2 style={{ fontSize:17, fontWeight:800, color:'#fff', flex:1, margin:0 }}>Contact us</h2>
      </div>

      <div style={{ flex:1, overflowY:'auto', WebkitOverflowScrolling:'touch', padding:'14px 14px 40px' }}>
        <div style={{ maxWidth:720, margin:'0 auto' }}>

          {/* The advert */}
          <div style={{ background:NAVY, borderRadius:20, padding:'18px 18px 20px', color:'#fff',
            boxShadow:'0 8px 24px rgba(27,37,89,0.25)' }}>
            <div style={{ display:'flex', alignItems:'center', gap:14 }}>
              <img src={janusLogo} alt="" style={{ width:76, height:76, borderRadius:16, objectFit:'cover',
                background:'#fff', flexShrink:0 }} />
              <div style={{ minWidth:0 }}>
                <div style={{ fontSize:26, fontWeight:900, lineHeight:1.1 }}>Janu's <span style={{ color:GOLD }}>Smart Serve</span></div>
                <div style={{ fontSize:14, fontStyle:'italic', color:'rgba(255,255,255,0.75)', marginTop:4 }}>Jo hukum mere aaka</div>
              </div>
            </div>
            <div style={{ fontSize:22, fontWeight:900, lineHeight:1.2, marginTop:16, textTransform:'uppercase', letterSpacing:'0.3px' }}>
              Enjoy the event.<br /><span style={{ color:GOLD }}>Order from your table!</span>
            </div>
            <div style={{ display:'inline-block', marginTop:10, background:'rgba(255,255,255,0.1)', borderRadius:999,
              padding:'6px 14px', fontSize:13, fontWeight:800, letterSpacing:'0.5px' }}>
              YOUR TABLE. YOUR MENU. <span style={{ color:GOLD }}>YOUR CHOICE.</span>
            </div>
          </div>

          {/* Why */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(2, minmax(0,1fr))', gap:10, marginTop:12 }}>
            {POINTS.map(p => (
              <div key={p.title} style={{ background:'#fff', borderRadius:14, padding:'12px 12px', boxShadow:'0 2px 8px rgba(0,0,0,0.05)' }}>
                <div style={{ fontSize:22, lineHeight:1 }}>{p.icon}</div>
                <div style={{ fontSize:14, fontWeight:900, color:NAVY, marginTop:6 }}>{p.title}</div>
                <div style={{ fontSize:12.5, color:'#555', marginTop:3, lineHeight:1.45 }}>{p.text}</div>
              </div>
            ))}
          </div>

          {/* The one thing to do */}
          <div ref={formRef} style={{ background:'#fff', borderRadius:18, padding:'16px 16px 18px', marginTop:12,
            border:'2px solid ' + GOLD, boxShadow:'0 6px 18px rgba(244,180,0,0.18)' }}>
            {sent ? (
              <div data-testid="contact-thanks" style={{ textAlign:'center', padding:'8px 4px' }}>
                <div style={{ fontSize:44, lineHeight:1, marginBottom:8 }}>✅</div>
                <div style={{ fontSize:20, fontWeight:900, color:NAVY }}>Thank you{name.trim() ? ', ' + name.trim() : ''}!</div>
                <div style={{ fontSize:15, color:'#555', marginTop:6, lineHeight:1.5 }}>
                  {sent.phone
                    ? <>Our team will contact you on <b>{sent.phone.startsWith('+') ? sent.phone : '+91 ' + sent.phone.slice(0, 5) + ' ' + sent.phone.slice(5)}</b>{sent.email ? <> or <b>{sent.email}</b></> : null}.</>
                    : <>Our team will email you at <b>{sent.email}</b>.</>}
                </div>
                <button onClick={onClose} style={{ marginTop:16, background:'#1A0A0A', color:'#fff', border:'none',
                  borderRadius:14, padding:'14px 28px', fontSize:16, fontWeight:800, cursor:'pointer' }}>
                  🍽️ Back to Menu
                </button>
              </div>
            ) : (
              <>
                <div style={{ fontSize:18, fontWeight:900, color:NAVY }}>Want Janu's Smart Serve at your event?</div>
                <div style={{ fontSize:14, color:'#555', marginTop:4, marginBottom:12 }}>
                  Leave your details and our team will contact you.
                </div>
                <input data-testid="contact-name" value={name} maxLength={60} placeholder="Your name" onFocus={lift}
                  autoComplete="name" onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') send() }}
                  style={{ ...input, marginBottom:8, fontSize:16, fontWeight:600 }} />
                <div style={{ display:'flex', gap:8, alignItems:'stretch' }}>
                  <span style={{ display:'flex', alignItems:'center', padding:'0 12px', borderRadius:12,
                    background:'#EEF0F6', fontSize:17, fontWeight:800, color:NAVY, flexShrink:0 }}>+91</span>
                  <input data-testid="contact-phone" value={phone} type="tel" inputMode="numeric" autoComplete="tel"
                    maxLength={20} placeholder="Mobile (WhatsApp) number" onFocus={lift}
                    onChange={e => { setPhone(e.target.value.replace(/[^\d+ ]/g, '')); setErr('') }}
                    onKeyDown={e => { if (e.key === 'Enter') send() }}
                    style={{ ...input, flex:1, minWidth:0, letterSpacing:'0.5px' }} />
                </div>
                <input data-testid="contact-email" value={email} maxLength={120} type="email" inputMode="email" autoComplete="email"
                  autoCapitalize="none" placeholder="Email ID" onFocus={lift}
                  onChange={e => { setEmail(e.target.value.replace(/\s/g, '')); setErr('') }} onKeyDown={e => { if (e.key === 'Enter') send() }}
                  style={{ ...input, marginTop:8, fontSize:16, fontWeight:600 }} />
                <div style={{ fontSize:12, color:'#888', marginTop:6 }}>Mobile number or email ID is enough.</div>
                {err && <div style={{ color:'#B91C1C', fontSize:13, fontWeight:700, marginTop:8 }}>{err}</div>}
                <button data-testid="contact-send" onClick={send} disabled={busy}
                  style={{ width:'100%', marginTop:12, background: busy ? '#6B9E7E' : '#16A34A', color:'#fff', border:'none',
                    borderRadius:14, padding:'15px', fontSize:17, fontWeight:900, cursor: busy ? 'wait' : 'pointer' }}>
                  {busy ? 'Sending…' : 'Submit'}
                </button>
              </>
            )}
          </div>

          {/* To read and to scan - nothing to tap */}
          <div style={{ display:'flex', gap:12, marginTop:12, alignItems:'stretch', flexWrap:'wrap' }}>
            <div style={{ flex:'1 1 220px', background:NAVY, color:'#fff', borderRadius:16, padding:'14px 16px',
              display:'flex', flexDirection:'column', justifyContent:'center' }}>
              <div style={{ fontSize:12, fontWeight:800, letterSpacing:'1px', color:'rgba(255,255,255,0.7)' }}>📞 FOR ANY ASSISTANCE</div>
              <div style={{ fontSize:24, fontWeight:900, marginTop:4, letterSpacing:'0.5px', whiteSpace:'nowrap' }}>{CONTACT_PHONE}</div>
            </div>
            <div style={{ flex:'0 1 auto', background:'#fff', borderRadius:16, padding:'10px 14px', display:'flex',
              alignItems:'center', gap:12, boxShadow:'0 2px 8px rgba(0,0,0,0.05)' }}>
              <img src={igQr} alt="Instagram @janusmartserve" style={{ width:120, height:120, objectFit:'contain', display:'block' }} />
              <div style={{ fontSize:13, color:'#444', lineHeight:1.45, maxWidth:150 }}>
                <b style={{ color:NAVY, fontSize:14 }}>Follow us on Instagram</b><br />
                Scan with your phone camera
              </div>
            </div>
          </div>

          <div style={{ textAlign:'center', fontSize:11, fontWeight:800, letterSpacing:'2px', color:'#9AA0B4', marginTop:18 }}>
            GOOD FOOD • GREAT TIMES • JANU'S SMART SERVE
          </div>
        </div>
      </div>
    </div>
  )
}
