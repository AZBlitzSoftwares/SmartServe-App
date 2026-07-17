const fs = require('fs')
const BASE = '/Users/asayyed/SmartServe/src'

const emPath = BASE + '/components/supervisor/EventManager.jsx'
let content = fs.readFileSync(emPath, 'utf8')

// Add useRef if not already imported
content = content.replace(
  `import { useState, useEffect, useRef } from 'react'`,
  `import { useState, useEffect, useRef } from 'react'`
)

// Add logo upload state + refs
content = content.replace(
  `  const [uploading, setUploading] = useState(null)`,
  `  const [uploading, setUploading] = useState(null)
  const [uploadingLogo, setUploadingLogo] = useState(null)
  const logoFileRefs = useRef({})`
)

// Add uploadLogo function right after uploadVideo function
content = content.replace(
  `  async function addSupervisor() {`,
  `  async function uploadLogo(eventId, file) {
    if (!file) return
    const ext = file.name.split('.').pop().toLowerCase()
    const allowed = ['jpg','jpeg','png','webp','svg']
    if (!allowed.includes(ext)) { alert('Only JPG, PNG, WebP or SVG logos supported'); return }
    if (file.size > 2 * 1024 * 1024) { alert('Logo too large. Max size is 2MB.'); return }
    setUploadingLogo(eventId)
    try {
      const path = 'catering-logos/' + eventId + '-' + Date.now() + '.' + ext
      const { error: upErr } = await supabase.storage.from('smartserve').upload(path, file, { upsert:true })
      if (upErr) { alert('Upload failed: ' + upErr.message); return }
      const { data: urlData } = supabase.storage.from('smartserve').getPublicUrl(path)
      await supabase.from('events').update({ catering_logo_url: urlData.publicUrl }).eq('id', eventId)
      alert('✅ Logo uploaded!')
      loadAll()
    } catch(e) { alert('Upload error: ' + e.message) }
    finally { setUploadingLogo(null) }
  }

  async function addSupervisor() {`
)

// Replace the Catering Branding section with logo URL + upload
content = content.replace(
  `            {/* Catering logo update */}
            <div style={{ background:'var(--bg)', borderRadius:12, padding:'12px 14px', marginBottom:14 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--ink2)', marginBottom:8, textTransform:'uppercase' }}>🏷️ Catering Branding</div>
              <input
                defaultValue={ev.catering_company||''}
                onBlur={async e => { await supabase.from('events').update({ catering_company:e.target.value||null }).eq('id',ev.id); loadAll() }}
                placeholder="Catering company name (shown on tablet)"
                style={{ width:'100%', border:'1.5px solid var(--line)', borderRadius:10, padding:'8px 12px', fontSize:13, fontFamily:'Manrope', outline:'none', marginBottom:8, boxSizing:'border-box' }} />
              <div style={{ display:'flex', gap:8 }}>
                <input
                  defaultValue={ev.catering_logo_url||''}
                  onBlur={async e => { await supabase.from('events').update({ catering_logo_url:e.target.value||null }).eq('id',ev.id); loadAll() }}
                  placeholder="Logo URL (paste image link)"
                  style={{ flex:1, border:'1.5px solid var(--line)', borderRadius:10, padding:'8px 12px', fontSize:13, fontFamily:'Manrope', outline:'none' }} />
                {ev.catering_logo_url && <img src={ev.catering_logo_url} alt="logo" style={{ width:36, height:36, objectFit:'contain', borderRadius:6, border:'1px solid var(--line)' }} onError={e=>e.target.style.display='none'} />}
              </div>
              <div style={{ fontSize:11, color:'var(--ink2)', marginTop:6 }}>Logo appears on guest welcome screen and menu header</div>
            </div>`,

  `            {/* Catering logo update */}
            <div style={{ background:'var(--bg)', borderRadius:12, padding:'12px 14px', marginBottom:14 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--ink2)', marginBottom:8, textTransform:'uppercase' }}>🏷️ Catering Branding</div>

              {/* Catering Name */}
              <input
                defaultValue={ev.catering_company||''}
                onBlur={async e => { await supabase.from('events').update({ catering_company:e.target.value||null }).eq('id',ev.id); loadAll() }}
                placeholder="Catering company name (e.g. Delhi Darbar)"
                style={{ width:'100%', border:'1.5px solid var(--line)', borderRadius:10, padding:'8px 12px', fontSize:13, fontFamily:'Manrope', outline:'none', marginBottom:10, boxSizing:'border-box' }} />

              {/* Logo section */}
              <div style={{ fontSize:12, fontWeight:600, color:'var(--ink2)', marginBottom:6 }}>Catering Logo</div>
              <input ref={el=>logoFileRefs.current[ev.id]=el} type="file" accept="image/jpeg,image/png,image/webp,image/svg+xml" onChange={e=>uploadLogo(ev.id, e.target.files[0])} style={{ display:'none' }} />

              {/* Current logo preview */}
              {ev.catering_logo_url && (
                <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10, background:'#fff', borderRadius:10, padding:'8px 12px', border:'1px solid var(--line)' }}>
                  <img src={ev.catering_logo_url} alt="logo" style={{ width:48, height:48, objectFit:'contain', borderRadius:8 }} onError={e=>e.target.style.display='none'} />
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:12, fontWeight:600, color:'var(--ink)' }}>Logo set ✅</div>
                    <div style={{ fontSize:11, color:'var(--ink2)', wordBreak:'break-all' }}>{ev.catering_logo_url.slice(0,40)}...</div>
                  </div>
                  <button onClick={async()=>{ await supabase.from('events').update({catering_logo_url:null}).eq('id',ev.id); loadAll() }}
                    style={{ background:'#FEF2F2', border:'1px solid #FECACA', color:'#DC2626', borderRadius:8, padding:'4px 10px', fontSize:12, fontWeight:700, cursor:'pointer', flexShrink:0 }}>Remove</button>
                </div>
              )}

              {/* Upload + URL options */}
              <div style={{ display:'flex', gap:8, marginBottom:8 }}>
                <button onClick={()=>logoFileRefs.current[ev.id]?.click()} disabled={uploadingLogo===ev.id}
                  style={{ flex:1, background:uploadingLogo===ev.id?'#999':'var(--ink)', color:'#fff', border:'none', borderRadius:10, padding:'9px 12px', fontSize:13, fontWeight:700, cursor:'pointer' }}>
                  {uploadingLogo===ev.id ? '⏳ Uploading...' : '📷 Upload Logo from Device'}
                </button>
              </div>

              {/* OR paste URL */}
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                <div style={{ flex:1, height:1, background:'var(--line)' }}></div>
                <span style={{ fontSize:11, color:'var(--ink2)', flexShrink:0 }}>or paste URL</span>
                <div style={{ flex:1, height:1, background:'var(--line)' }}></div>
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <input
                  defaultValue={ev.catering_logo_url||''}
                  key={ev.catering_logo_url}
                  onBlur={async e => {
                    if (e.target.value.trim() && e.target.value !== ev.catering_logo_url) {
                      await supabase.from('events').update({ catering_logo_url:e.target.value.trim()||null }).eq('id',ev.id)
                      loadAll()
                    }
                  }}
                  placeholder="https://example.com/logo.png"
                  style={{ flex:1, border:'1.5px solid var(--line)', borderRadius:10, padding:'8px 12px', fontSize:13, fontFamily:'Manrope', outline:'none' }} />
              </div>
              <div style={{ fontSize:11, color:'var(--ink2)', marginTop:6, lineHeight:1.7 }}>
                ✅ Formats: <strong>JPG, PNG, WebP, SVG</strong> · Max: <strong>2MB</strong> · Recommended: <strong>Square (200×200px)</strong><br/>
                Logo shows on guest welcome screen and menu header
              </div>
            </div>`
)

fs.writeFileSync(emPath, content)
console.log('✅ EventManager — catering logo upload from device added')
console.log('Run: npm run dev')
