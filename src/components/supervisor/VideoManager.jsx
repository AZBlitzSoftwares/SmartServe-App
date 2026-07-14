import { useState } from 'react'
import { supabase } from '../../lib/supabase'
export default function VideoManager({ eventData, onUpdated }) {
  const [uploading, setUploading] = useState(false)
  const [videoUrl, setVideoUrl] = useState(eventData?.video_url||'')
  const [manualUrl, setManualUrl] = useState('')
  const [mode, setMode] = useState('url')

  async function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    if (file.size > 100*1024*1024) { alert('Video must be under 100MB'); return }
    setUploading(true)
    try {
      const ext = file.name.split('.').pop()
      const name = 'event-videos/'+eventData.id+'-'+Date.now()+'.'+ext
      const { error } = await supabase.storage.from('smartserve-media').upload(name, file, { upsert:true })
      if (error) throw error
      const { data: urlData } = supabase.storage.from('smartserve-media').getPublicUrl(name)
      await supabase.from('events').update({ video_url: urlData.publicUrl }).eq('id', eventData.id)
      setVideoUrl(urlData.publicUrl)
      if (onUpdated) onUpdated()
      alert('Video uploaded!')
    } catch(e) { alert('Upload failed: '+e.message) }
    finally { setUploading(false) }
  }

  async function saveUrl() {
    if (!manualUrl.trim()) return
    await supabase.from('events').update({ video_url: manualUrl.trim() }).eq('id', eventData.id)
    setVideoUrl(manualUrl.trim())
    if (onUpdated) onUpdated()
    alert('Video URL saved!')
  }

  async function removeVideo() {
    if (!confirm('Remove video?')) return
    await supabase.from('events').update({ video_url: null }).eq('id', eventData.id)
    setVideoUrl(''); if (onUpdated) onUpdated()
  }

  return (
    <div style={{ background:'#fff',borderRadius:16,padding:20,marginBottom:16,boxShadow:'var(--shadow)' }}>
      <div style={{ fontWeight:800,fontSize:16,marginBottom:4 }}>Welcome Screen Video</div>
      <div style={{ fontSize:13,color:'var(--ink2)',marginBottom:16 }}>Plays on guest tablet welcome screen</div>
      {videoUrl ? (
        <div style={{ marginBottom:16 }}>
          <video src={videoUrl} controls style={{ width:'100%',borderRadius:12,maxHeight:180 }} />
          <button onClick={removeVideo} style={{ marginTop:10,background:'#FEF2F2',border:'1px solid #FECACA',color:'#DC2626',borderRadius:10,padding:'8px 16px',fontSize:13,fontWeight:700,width:'100%' }}>Remove Video</button>
        </div>
      ) : (
        <div style={{ background:'var(--bg)',borderRadius:12,padding:24,textAlign:'center',marginBottom:16,border:'2px dashed var(--line)' }}>
          <div style={{ fontSize:36,marginBottom:8 }}>🎥</div>
          <div style={{ fontSize:14,color:'var(--ink2)' }}>No video uploaded yet</div>
        </div>
      )}
      <div style={{ display:'flex',gap:8,marginBottom:16 }}>
        <button onClick={() => setMode('url')} style={{ flex:1,background:mode==='url'?'var(--ink)':'#fff',color:mode==='url'?'#fff':'var(--ink)',border:'1.5px solid',borderColor:mode==='url'?'var(--ink)':'var(--line)',borderRadius:10,padding:'8px',fontSize:13,fontWeight:700 }}>Paste URL</button>
        <button onClick={() => setMode('upload')} style={{ flex:1,background:mode==='upload'?'var(--ink)':'#fff',color:mode==='upload'?'#fff':'var(--ink)',border:'1.5px solid',borderColor:mode==='upload'?'var(--ink)':'var(--line)',borderRadius:10,padding:'8px',fontSize:13,fontWeight:700 }}>Upload File</button>
      </div>
      {mode==='url' ? (
        <div>
          <input value={manualUrl} onChange={e => setManualUrl(e.target.value)} placeholder="https://example.com/video.mp4" style={{ width:'100%',border:'1.5px solid var(--line)',borderRadius:10,padding:'10px 14px',fontSize:14,marginBottom:10,fontFamily:'Manrope',outline:'none',boxSizing:'border-box' }} />
          <button onClick={saveUrl} style={{ width:'100%',background:'var(--ink)',color:'#fff',border:'none',borderRadius:12,padding:'12px',fontSize:14,fontWeight:800 }}>Save URL</button>
        </div>
      ) : (
        <label style={{ display:'block',background:uploading?'#ccc':'var(--ink)',color:'#fff',borderRadius:12,padding:'14px',fontSize:14,fontWeight:800,textAlign:'center',cursor:uploading?'not-allowed':'pointer' }}>
          {uploading?'Uploading...':'Choose Video File (max 100MB)'}
          <input type="file" accept="video/*" onChange={handleFile} disabled={uploading} style={{ display:'none' }} />
        </label>
      )}
    </div>
  )
}