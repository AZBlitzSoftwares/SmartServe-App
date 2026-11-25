import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { LANGS, langInfo, fontFor, localOf, courseLocal, withLocal, withCourseLocal, hasPhrases } from '../../lib/menuLang'

/* Menu › 🌐 Menu language (v2.18).

   One screen for the event's second language: pick it, then see every
   course, category and dish with its name in that language next to the
   English, and fill in or correct what is missing. Only rows that changed
   are written when you press Save. The quickest way to fill a whole menu is
   still the Excel import (a "Dish (Gujarati)" column); this is for checking
   and fixing. */

const box = { background:'#fff', borderRadius:16, padding:20, width:'100%', maxWidth:900, maxHeight:'92vh', overflowY:'auto', boxSizing:'border-box' }
const btn = { border:'none', borderRadius:10, padding:'10px 16px', fontSize:13.5, fontWeight:800, cursor:'pointer', fontFamily:'Manrope' }
const head = { fontSize:12, fontWeight:900, color:'var(--ink2)', textTransform:'uppercase', letterSpacing:'.4px', margin:'16px 0 8px' }

export default function MenuLanguagePanel({ eventData, categories, items, courses, onClose, onSaved, onEventChange }) {
  const [code, setCode] = useState(langInfo(eventData?.menu_lang)?.code || '')
  const info = langInfo(code)
  const [edits, setEdits] = useState({})   // 'd:<id>:name' | 'd:<id>:description' | 'c:<id>' | 'k:<course>' -> text
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [onlyMissing, setOnlyMissing] = useState(false)
  const [q, setQ] = useState('')

  const val = (key, saved) => (key in edits ? edits[key] : saved)
  const set = (key, v) => setEdits(e => ({ ...e, [key]: v }))
  const savedDish = (it, f) => (info ? localOf(it, info.code, f) : '')

  const missing = info ? items.filter(it => !localOf(it, info.code)).length : 0
  const shown = items.filter(it => {
    if (onlyMissing && info && localOf(it, info.code)) return false
    const s = q.trim().toLowerCase()
    return !s || (it.name || '').toLowerCase().includes(s) || savedDish(it, 'name').toLowerCase().includes(s)
  })
  const catName = id => categories.find(c => c.id === id)?.name || ''
  const changed = Object.keys(edits).length > 0 || code !== (langInfo(eventData?.menu_lang)?.code || '')

  async function save() {
    setBusy(true); setErr('')
    try {
      // the language itself, and the course names (both on the event)
      const evPatch = {}
      const was = langInfo(eventData?.menu_lang)?.code || ''
      if (code !== was) evPatch.menu_lang = code || null
      if (info) {
        let ev = eventData.i18n || null
        for (const [k, v] of Object.entries(edits)) if (k.startsWith('k:')) ev = withCourseLocal(ev, info.code, k.slice(2), v)
        if (JSON.stringify(ev) !== JSON.stringify(eventData.i18n || null)) evPatch.i18n = ev
      }
      if (Object.keys(evPatch).length) {
        const { data, error } = await supabase.from('events').update(evPatch).eq('id', eventData.id).select('*').maybeSingle()
        if (error) throw new Error(/menu_lang|i18n/.test(error.message || '') ? 'The language columns are missing: run db/2026-11-26_menu_language.sql in Supabase first' : error.message)
        if (data) onEventChange?.(data)
      }
      if (info) {
        // categories
        const catIds = [...new Set(Object.keys(edits).filter(k => k.startsWith('c:')).map(k => k.slice(2)))]
        for (const id of catIds) {
          const c = categories.find(x => x.id === id)
          if (!c) continue
          const next = withLocal(c.i18n, info.code, { name: edits['c:' + id] })
          const { error } = await supabase.from('menu_categories').update({ i18n: next }).eq('id', id)
          if (error) throw error
        }
        // dishes
        const dishIds = [...new Set(Object.keys(edits).filter(k => k.startsWith('d:')).map(k => k.split(':')[1]))]
        for (let i = 0; i < dishIds.length; i += 20) {
          const res = await Promise.all(dishIds.slice(i, i + 20).map(id => {
            const it = items.find(x => x.id === id)
            const f = {}
            if ('d:' + id + ':name' in edits) f.name = edits['d:' + id + ':name']; else f.name = localOf(it, info.code)
            if ('d:' + id + ':description' in edits) f.description = edits['d:' + id + ':description']; else f.description = localOf(it, info.code, 'description')
            return supabase.from('menu_items').update({ i18n: withLocal(it?.i18n, info.code, f) }).eq('id', id)
          }))
          const bad = res.find(r => r.error)
          if (bad) throw bad.error
        }
      }
      setEdits({})
      onSaved?.()
    } catch (e) {
      setErr('Not saved: ' + (e?.message || String(e)))
    }
    setBusy(false)
  }

  const locInput = (key, saved, placeholder, wide) => (
    <input value={val(key, saved)} onChange={e => set(key, e.target.value)} placeholder={placeholder}
      lang={info?.code} dir={info?.rtl ? 'rtl' : undefined}
      style={{ width:'100%', boxSizing:'border-box', border:'1.5px solid ' + (key in edits ? '#A78BFA' : val(key, saved) ? 'var(--line)' : '#FED7AA'),
        background: val(key, saved) ? '#fff' : '#FFFBF5', borderRadius:9, padding:'8px 10px', fontSize: wide ? 13 : 14, fontWeight: wide ? 500 : 700,
        fontFamily: fontFor(info), outline:'none' }} />
  )

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:120, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div style={box}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12 }}>
          <div>
            <h3 style={{ fontSize:18, fontWeight:900 }}>🌐 Menu language</h3>
            <div style={{ fontSize:12.5, color:'var(--ink2)', marginTop:3, maxWidth:640 }}>
              Guest and captain tablets show every dish in English with this language under it. KOTs and kitchen screens stay in English.
            </div>
          </div>
          <button onClick={onClose} disabled={busy} style={{ background:'none', border:'none', fontSize:20, cursor:'pointer', color:'#888' }}>✕</button>
        </div>

        <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap', marginTop:14 }}>
          <b style={{ fontSize:13 }}>Second language</b>
          <select value={code} onChange={e => { setCode(e.target.value); setEdits({}) }} data-testid="menu-lang-select"
            style={{ border:'1.5px solid var(--line)', borderRadius:10, padding:'8px 12px', fontSize:14, fontFamily:'Manrope', fontWeight:700, background:'#fff' }}>
            <option value="">English only</option>
            {LANGS.map(l => <option key={l.code} value={l.code}>{l.name} · {l.native}</option>)}
          </select>
          {info && !hasPhrases(info.code) && (
            <span style={{ fontSize:12, color:'#B45309', fontWeight:700 }}>Dish names show in {info.name}; the guest buttons stay English for this language.</span>
          )}
        </div>

        {err && <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', color:'#B91C1C', borderRadius:10, padding:'9px 12px', fontSize:13, fontWeight:700, marginTop:12 }}>{err}</div>}

        {info && (
          <>
            {courses.length > 0 && (
              <>
                <div style={head}>Courses</div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(260px, 1fr))', gap:8 }}>
                  {courses.map(c => (
                    <label key={c} style={{ display:'grid', gridTemplateColumns:'110px 1fr', gap:8, alignItems:'center', fontSize:13, fontWeight:700 }}>
                      <span style={{ overflow:'hidden', textOverflow:'ellipsis' }}>{c}</span>
                      {locInput('k:' + c, courseLocal(eventData, c, info.code), info.native)}
                    </label>
                  ))}
                </div>
              </>
            )}

            {categories.length > 0 && (
              <>
                <div style={head}>Categories</div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(260px, 1fr))', gap:8 }}>
                  {categories.map(c => (
                    <label key={c.id} style={{ display:'grid', gridTemplateColumns:'110px 1fr', gap:8, alignItems:'center', fontSize:13, fontWeight:700 }}>
                      <span style={{ overflow:'hidden', textOverflow:'ellipsis' }}>{c.name}</span>
                      {locInput('c:' + c.id, localOf(c, info.code), info.native)}
                    </label>
                  ))}
                </div>
              </>
            )}

            <div style={{ ...head, display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
              <span>Dishes · {items.length - missing} of {items.length} have a {info.name} name</span>
              <label style={{ textTransform:'none', letterSpacing:0, fontWeight:700, fontSize:12.5, color:'var(--ink)' }}>
                <input type="checkbox" checked={onlyMissing} onChange={e => setOnlyMissing(e.target.checked)} /> only the missing ones</label>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…"
                style={{ marginLeft:'auto', border:'1.5px solid var(--line)', borderRadius:999, padding:'5px 12px', fontSize:12.5, fontFamily:'Manrope', textTransform:'none', fontWeight:600 }} />
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {shown.map(it => (
                <div key={it.id} data-testid="lang-dish" style={{ display:'grid', gridTemplateColumns:'minmax(150px, 1fr) minmax(170px, 1.2fr) minmax(170px, 1.4fr)', gap:8, alignItems:'start',
                  background:'var(--bg)', borderRadius:10, padding:'8px 10px' }}>
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontWeight:800, fontSize:13.5 }}>{it.name}</div>
                    <div style={{ fontSize:11.5, color:'var(--ink2)' }}>{catName(it.category_id)}{it.description ? ' · ' + it.description : ''}</div>
                  </div>
                  {locInput('d:' + it.id + ':name', savedDish(it, 'name'), 'Dish name in ' + info.name)}
                  {locInput('d:' + it.id + ':description', savedDish(it, 'description'), it.description ? 'Description in ' + info.name : '(no description)', true)}
                </div>
              ))}
              {shown.length === 0 && <div style={{ fontSize:13, color:'var(--ink2)', padding:10 }}>{onlyMissing ? 'Every dish has a ' + info.name + ' name.' : 'No dishes.'}</div>}
            </div>
            <div style={{ fontSize:12, color:'var(--ink2)', marginTop:10 }}>
              Faster for a whole menu: add a “Dish ({info.name})” column (and “Description ({info.name})”) to the menu Excel and import it again with “update them”.
            </div>
          </>
        )}

        <div style={{ display:'flex', gap:8, marginTop:16, position:'sticky', bottom:-20, background:'#fff', padding:'10px 0' }}>
          <button onClick={save} disabled={busy || !changed} data-testid="menu-lang-save"
            style={{ ...btn, background:'#16A34A', color:'#fff', flex:2, opacity: busy || !changed ? 0.6 : 1 }}>{busy ? 'Saving…' : 'Save'}</button>
          <button onClick={onClose} disabled={busy} style={{ ...btn, background:'var(--bg)', border:'1.5px solid var(--line)', flex:1 }}>Close</button>
        </div>
      </div>
    </div>
  )
}
