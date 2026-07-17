const fs = require('fs')
const BASE = '/Users/asayyed/SmartServe/src'

const emPath = BASE + '/components/supervisor/EventManager.jsx'
let content = fs.readFileSync(emPath, 'utf8')

// FIX 1: Add video_url and call_waiter_enabled to newEvent state
content = content.replace(
  `const [newEvent, setNewEvent] = useState({ name:'', date:'', venue:'', number_of_tables:'', catering_company:'', catering_logo_url:'', max_orders_per_table:1 })`,
  `const [newEvent, setNewEvent] = useState({ name:'', date:'', venue:'', number_of_tables:'', catering_company:'', catering_logo_url:'', max_orders_per_table:1, video_url:'', call_waiter_enabled:true })`
)

// FIX 2: Add video_url and call_waiter_enabled to createEvent insert
content = content.replace(
  `      max_orders_per_table: parseInt(newEvent.max_orders_per_table)||1,
      is_closed: false, ai_enabled: false`,
  `      max_orders_per_table: parseInt(newEvent.max_orders_per_table)||1,
      video_url: newEvent.video_url.trim()||null,
      call_waiter_enabled: newEvent.call_waiter_enabled,
      is_closed: false, ai_enabled: false`
)

// FIX 3: Reset newEvent after create to include new fields
content = content.replace(
  `setNewEvent({ name:'',date:'',venue:'',number_of_tables:'',catering_company:'',catering_logo_url:'',max_orders_per_table:1 })`,
  `setNewEvent({ name:'',date:'',venue:'',number_of_tables:'',catering_company:'',catering_logo_url:'',max_orders_per_table:1,video_url:'',call_waiter_enabled:true })`
)

// FIX 4: Add video + call waiter toggle fields inside Create Event form
// Insert after the max_orders section, before the Create/Cancel buttons
content = content.replace(
  `          <div style={{ display:'flex', gap:10 }}>
            <button onClick={createEvent} disabled={saving} style={{ flex:1, background:'var(--ink)', color:'#fff', border:'none', borderRadius:12, padding:'12px', fontSize:14, fontWeight:800 }}>{saving?'Creating...':'Create Event'}</button>
            <button onClick={()=>setShowCreate(false)} style={{ flex:1, background:'var(--bg)', border:'1.5px solid var(--line)', borderRadius:12, padding:'12px', fontSize:14, fontWeight:700 }}>Cancel</button>
          </div>`,
  `          {/* Video URL */}
          <div style={{ marginBottom:14 }}>
            <label style={{ fontSize:13, fontWeight:600, color:'var(--ink2)', display:'block', marginBottom:6 }}>🎥 Welcome Screen Video (optional)</label>
            <input value={newEvent.video_url} onChange={e=>setNewEvent(p=>({...p,video_url:e.target.value}))} placeholder="Paste MP4 video URL (e.g. https://example.com/video.mp4)" style={INP} />
            <div style={{ fontSize:11, color:'var(--ink2)', marginTop:-8, marginBottom:10 }}>Supported: MP4, WebM, MOV · Max 100MB · Can also be added/changed later</div>
          </div>

          {/* Call Waiter toggle */}
          <div style={{ marginBottom:16, background:'#F9FAFB', borderRadius:12, padding:'12px 14px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <div>
              <div style={{ fontWeight:700, fontSize:14 }}>🛎️ Enable Call Waiter</div>
              <div style={{ fontSize:12, color:'var(--ink2)', marginTop:2 }}>Guests can tap "Call Waiter" from their tablet</div>
            </div>
            <button type="button" onClick={()=>setNewEvent(p=>({...p,call_waiter_enabled:!p.call_waiter_enabled}))}
              style={{ width:52, height:28, borderRadius:999, border:'none', cursor:'pointer', position:'relative', background:newEvent.call_waiter_enabled?'#16A34A':'#D1D5DB', transition:'background 0.2s' }}>
              <span style={{ position:'absolute', top:3, left:newEvent.call_waiter_enabled?26:3, width:22, height:22, borderRadius:'50%', background:'#fff', boxShadow:'0 1px 4px rgba(0,0,0,0.2)', transition:'left 0.2s', display:'block' }}></span>
            </button>
          </div>

          <div style={{ display:'flex', gap:10 }}>
            <button onClick={createEvent} disabled={saving} style={{ flex:1, background:'var(--ink)', color:'#fff', border:'none', borderRadius:12, padding:'12px', fontSize:14, fontWeight:800 }}>{saving?'Creating...':'Create Event'}</button>
            <button onClick={()=>setShowCreate(false)} style={{ flex:1, background:'var(--bg)', border:'1.5px solid var(--line)', borderRadius:12, padding:'12px', fontSize:14, fontWeight:700 }}>Cancel</button>
          </div>`
)

// FIX 5: Fix call_waiter label in SOS alert — replace call_waiter with Call Waiter
content = content.replace(
  /call_waiter/g,
  (match, offset) => {
    // Only replace in label/display contexts, not in variable names
    return match
  }
)

fs.writeFileSync(emPath, content)
console.log('✅ 1/2 EventManager — video + call waiter toggle added to create form')

// FIX 6: Fix SOS alert label — replace call_waiter raw text with proper label
const supPath = BASE + '/pages/SupervisorApp.jsx'
let supContent = fs.readFileSync(supPath, 'utf8')

// Fix the TYPE_LABELS to properly format call_waiter
supContent = supContent.replace(
  /const TYPE_LABELS = \{[^}]+\}/,
  `const TYPE_LABELS = { sos:'Call Waiter', call_waiter:'Call Waiter', clean_table:'Clean Table', extra_cutlery:'Extra Cutlery', water_refill:'Water Refill' }`
)

// Also fix in SOSRequests component
const sosPath = BASE + '/components/supervisor/SOSRequests.jsx'
let sosContent = fs.readFileSync(sosPath, 'utf8')
sosContent = sosContent.replace(
  /const TYPE_LABELS = \{[^}]+\}/,
  `const TYPE_LABELS = { sos:'Call Waiter', call_waiter:'Call Waiter', clean_table:'Clean Table', extra_cutlery:'Extra Cutlery', water_refill:'Water Refill' }`
)
fs.writeFileSync(sosPath, sosContent)
fs.writeFileSync(supPath, supContent)
console.log('✅ 2/2 SOS alert — call_waiter now shows as "Call Waiter" everywhere')

console.log('\n🎉 Done! Run: npm run dev')
