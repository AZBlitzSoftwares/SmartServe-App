const fs = require('fs')
const BASE = '/Users/asayyed/SmartServe/src'

// ═══════════════════════════════════════════════════════════════════
// Fix: MenuManager — add image upload for food items
// ═══════════════════════════════════════════════════════════════════
const mmPath = BASE + '/components/supervisor/MenuManager.jsx'
let content = fs.readFileSync(mmPath, 'utf8')

// Add useRef import
content = content.replace(
  `import { useState, useEffect, useRef } from 'react'`,
  `import { useState, useEffect, useRef } from 'react'`
)

// Add image upload state
content = content.replace(
  `  const [saving, setSaving] = useState(false)`,
  `  const [saving, setSaving] = useState(false)
  const [uploadingImg, setUploadingImg] = useState(false)
  const imgFileRef = useRef()`
)

// Add uploadFoodImage function after saveItem function
content = content.replace(
  `  function startEdit(item) {`,
  `  async function uploadFoodImage(file) {
    if (!file) return
    const ext = file.name.split('.').pop().toLowerCase()
    const allowed = ['jpg','jpeg','png','webp']
    if (!allowed.includes(ext)) { alert('Only JPG, PNG, or WebP images supported'); return }
    if (file.size > 5 * 1024 * 1024) { alert('Image too large. Max size is 5MB.'); return }
    setUploadingImg(true)
    try {
      const path = 'food-images/' + Date.now() + '-' + file.name.replace(/[^a-zA-Z0-9.]/g,'_')
      const { error: upErr } = await supabase.storage.from('smartserve').upload(path, file, { upsert:true })
      if (upErr) { alert('Upload failed: ' + upErr.message); return }
      const { data: urlData } = supabase.storage.from('smartserve').getPublicUrl(path)
      setNewItem(p => ({ ...p, photo_url: urlData.publicUrl }))
    } catch(e) { alert('Upload error: ' + e.message) }
    finally { setUploadingImg(false) }
  }

  function startEdit(item) {`
)

// Replace the photo_url input field with URL + Upload options
content = content.replace(
  `          <input value={newItem.photo_url} onChange={e=>setNewItem(p=>({...p,photo_url:e.target.value}))} placeholder="Image URL (optional) — paste any direct image link" style={INP} />`,
  `          {/* Image — URL or Upload */}
          <div style={{ marginBottom:10 }}>
            <label style={{ fontSize:13, fontWeight:600, color:'var(--ink2)', display:'block', marginBottom:6 }}>Food Image (optional)</label>
            <input ref={imgFileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>uploadFoodImage(e.target.files[0])} style={{ display:'none' }} />
            <div style={{ display:'flex', gap:8, marginBottom:8 }}>
              <input value={newItem.photo_url} onChange={e=>setNewItem(p=>({...p,photo_url:e.target.value}))}
                placeholder="Paste image URL, or upload below"
                style={{ flex:1, border:'1.5px solid var(--line)', borderRadius:10, padding:'10px 12px', fontSize:13, fontFamily:'Manrope', outline:'none' }} />
              {newItem.photo_url && <img src={newItem.photo_url} alt="preview" style={{ width:44, height:44, objectFit:'cover', borderRadius:8, border:'1px solid var(--line)', flexShrink:0 }} onError={e=>e.target.style.display='none'} />}
            </div>
            <button type="button" onClick={()=>imgFileRef.current?.click()} disabled={uploadingImg}
              style={{ width:'100%', background:uploadingImg?'#999':'#F0FDF4', border:'1.5px solid #BBF7D0', color:uploadingImg?'#fff':'#16A34A', borderRadius:10, padding:'9px', fontSize:13, fontWeight:700, cursor:'pointer', marginBottom:6 }}>
              {uploadingImg ? '⏳ Uploading...' : '📷 Upload from Device'}
            </button>
            <div style={{ fontSize:11, color:'var(--ink2)', lineHeight:1.7 }}>
              ✅ Formats: <strong>JPG, PNG, WebP</strong> &nbsp;·&nbsp; Max: <strong>5MB</strong> &nbsp;·&nbsp; Recommended: <strong>400×300px or square</strong>
            </div>
          </div>`
)

fs.writeFileSync(mmPath, content)
console.log('✅ 1/1 MenuManager — food image upload from device added')
console.log('Run: npm run dev')
