const fs = require('fs')
const BASE = '/Users/asayyed/SmartServe/src'

// ═══════════════════════════════════════════════════════════════════
// FIX 1: SupervisorLogin — after login, load only their assigned event
// FIX 2: SupervisorApp — supervisor locked to their event, no switcher
// FIX 3: EventManager — fix Remove by adding proper delete + error log
// ═══════════════════════════════════════════════════════════════════

// Fix SupervisorLogin — fetch event_id from supervisors table on login
const loginPath = BASE + '/components/supervisor/SupervisorLogin.jsx'
let loginContent = fs.readFileSync(loginPath, 'utf8')

loginContent = loginContent.replace(
  `      // Check supervisors table
      const { data: sups } = await supabase.from('supervisors').select('*').eq('pin', p).eq('is_active', true)
      const sup = sups?.find(s => s.name.toLowerCase() === u.toLowerCase())
      if (sup) { onLogin({ ...sup, role:'supervisor' }); return }`,
  `      // Check supervisors table — match by name + pin
      const { data: sups } = await supabase.from('supervisors').select('*').eq('pin', p).eq('is_active', true)
      const sup = sups?.find(s => s.name.toLowerCase() === u.toLowerCase())
      if (sup) {
        // Fetch the event this supervisor is assigned to
        const { data: evData } = await supabase.from('events').select('*').eq('id', sup.event_id).single()
        onLogin({ ...sup, role:'supervisor', assignedEvent: evData || null })
        return
      }`
)

fs.writeFileSync(loginPath, loginContent)
console.log('✅ 1/3 SupervisorLogin — loads assigned event on login')

// Fix SupervisorApp — supervisor sees only their event, no change option
const supPath = BASE + '/pages/SupervisorApp.jsx'
let supContent = fs.readFileSync(supPath, 'utf8')

supContent = supContent.replace(
  `  useEffect(() => { if (authed) loadEvents() }, [authed])

  async function loadEvents() {
    const { data } = await supabase.from('events').select('*').order('created_at', { ascending:false })
    const evs = data || []
    setAllEvents(evs)
    // Default: first non-closed event, or first event
    if (!eventData) {
      const active = evs.find(e=>!e.is_closed) || evs[0]
      if (active) setEventData(active)
    }
  }`,
  `  useEffect(() => { if (authed) loadEvents() }, [authed])

  async function loadEvents() {
    const { data } = await supabase.from('events').select('*').order('created_at', { ascending:false })
    const evs = data || []
    setAllEvents(evs)

    if (currentUser?.role === 'supervisor' && currentUser?.assignedEvent) {
      // Supervisor is locked to their assigned event only
      setEventData(currentUser.assignedEvent)
    } else if (!eventData) {
      // Admin: default to first active event
      const active = evs.find(e=>!e.is_closed) || evs[0]
      if (active) setEventData(active)
    }
  }`
)

// Supervisor cannot change event — hide the "change" link in header
supContent = supContent.replace(
  `          {eventData && (
            <button onClick={() => setShowEventPicker(true)} style={{ background:'none', border:'none', padding:0, cursor:'pointer', textAlign:'left' }}>
              <div style={{ color:'rgba(255,255,255,0.7)', fontSize:12, marginTop:2 }}>
                📍 {eventData.name} <span style={{ color:'#E8890C', fontSize:11 }}>▾ change</span>
              </div>
            </button>
          )}`,
  `          {eventData && (
            isAdmin
              ? <button onClick={() => setShowEventPicker(true)} style={{ background:'none', border:'none', padding:0, cursor:'pointer', textAlign:'left' }}>
                  <div style={{ color:'rgba(255,255,255,0.7)', fontSize:12, marginTop:2 }}>
                    📍 {eventData.name} <span style={{ color:'#E8890C', fontSize:11 }}>▾ change</span>
                  </div>
                </button>
              : <div style={{ color:'rgba(255,255,255,0.6)', fontSize:12, marginTop:2 }}>
                  📍 {eventData.name}
                </div>
          )}`
)

// Supervisor cannot see Events tab
supContent = supContent.replace(
  `    ...(isAdmin ? [{ id:'events', label:'Events', emoji:'📅', badge:0 }] : []),`,
  `    ...(isAdmin ? [{ id:'events', label:'Events', emoji:'📅', badge:0 }] : []),`
)

fs.writeFileSync(supPath, supContent)
console.log('✅ 2/3 SupervisorApp — supervisor locked to assigned event, no change option')

// Fix EventManager — fix Remove supervisor/waiter with better error handling
const emPath = BASE + '/components/supervisor/EventManager.jsx'
let emContent = fs.readFileSync(emPath, 'utf8')

emContent = emContent.replace(
  `  async function removeSup(id) {
    if (!confirm('Remove this supervisor?')) return
    setRemoving(id)
    await supabase.from('supervisors').delete().eq('id', id)
    setRemoving(null); loadAll()
  }

  async function removeWaiter(id) {
    if (!confirm('Remove this waiter?')) return
    setRemoving(id)
    await supabase.from('waiters').delete().eq('id', id)
    setRemoving(null); loadAll()
  }`,
  `  async function removeSup(id) {
    if (!confirm('Remove this supervisor?')) return
    setRemoving(id)
    const { error } = await supabase.from('supervisors').delete().eq('id', id)
    if (error) {
      console.error('Remove supervisor error:', error)
      alert('Failed to remove: ' + error.message)
    }
    setRemoving(null)
    await loadAll()
  }

  async function removeWaiter(id) {
    if (!confirm('Remove this waiter?')) return
    setRemoving(id)
    const { error } = await supabase.from('waiters').delete().eq('id', id)
    if (error) {
      console.error('Remove waiter error:', error)
      alert('Failed to remove: ' + error.message)
    }
    setRemoving(null)
    await loadAll()
  }`
)

fs.writeFileSync(emPath, emContent)
console.log('✅ 3/3 EventManager — Remove now shows error if it fails')
console.log('\nAlso run this SQL in Supabase to fix RLS on supervisors and waiters:')
console.log('See fix_rls.sql')
