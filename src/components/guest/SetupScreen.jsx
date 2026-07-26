import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import janusLogo from '../../assets/janus_logo.jpg'

function eventStatus(dateStr) {
  if (!dateStr) return 'planned'
  const today = new Date()
  const todayStr = today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0')+'-'+String(today.getDate()).padStart(2,'0')
  if (dateStr > todayStr) return 'planned'
  if (dateStr === todayStr) return 'active'
  return 'completed'
}

export default function SetupScreen({ onSetupComplete }) {
  const [step, setStep] = useState('pin')      // 'pin' | 'event' | 'table'
  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [activeEvents, setActiveEvents] = useState([])
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [takenTables, setTakenTables] = useState([])
  const [selectedTable, setSelectedTable] = useState(null)
  const [confirming, setConfirming] = useState(false)
  const [loadingEvents, setLoadingEvents] = useState(false)

  // Load active events on mount
  useEffect(() => {
    loadActiveEvents()
  }, [])

  async function loadActiveEvents() {
    setLoadingEvents(true)
    const { data } = await supabase.from('events')
      .select('*').order('date', { ascending: false }).limit(50)
    const active = (data||[]).filter(e => eventStatus(e.date) === 'active')
    setActiveEvents(active)
    // If only 1 active event, auto-select it
    if (active.length === 1) setSelectedEvent(active[0])
    setLoadingEvents(false)
  }

  async function verifyPin() {
    if (!pin.trim()) { setPinError('Please enter your 4-digit PIN'); return }
    setVerifying(true); setPinError('')
    try {
      const p = pin.trim()
      let isAdmin = false
      let supervisorEventIds = [] // events this supervisor is assigned to

      // Check admins table
      const { data: admins } = await supabase.from('admins')
        .select('*').eq('pin', p).eq('is_active', true)
      if (admins?.length > 0) isAdmin = true
      if (p === '1234') isAdmin = true  // demo admin

      if (!isAdmin) {
        // Check supervisors — get which events they are assigned to
        const { data: sups } = await supabase.from('supervisors')
          .select('*').eq('pin', p).eq('is_active', true)
        if (sups?.length > 0) {
          supervisorEventIds = sups.map(s => s.event_id).filter(Boolean)
        }
      }

      const valid = isAdmin || supervisorEventIds.length > 0

      if (!valid) {
        setPinError('Incorrect PIN. Please ask your supervisor.')
        setVerifying(false)
        return
      }

      // Filter events based on role
      let allowedEvents = activeEvents
      if (!isAdmin && supervisorEventIds.length > 0) {
        // Supervisor — only show their assigned events
        allowedEvents = activeEvents.filter(e => supervisorEventIds.includes(e.id))
      }

      if (allowedEvents.length === 0) {
        setPinError('No active events assigned to you today. Please contact admin.')
      } else if (allowedEvents.length === 1) {
        setSelectedEvent(allowedEvents[0])
        await loadTakenTables(allowedEvents[0])
        setStep('table')
      } else {
        // Update activeEvents to only show allowed ones
        setActiveEvents(allowedEvents)
        setStep('event')
      }
    } catch(e) {
      setPinError('Connection error. Please check internet and try again.')
    }
    setVerifying(false)
  }

  async function selectEvent(ev) {
    setSelectedEvent(ev)
    await loadTakenTables(ev)
    setStep('table')
  }

  async function loadTakenTables(ev) {
    // Find tables that have active orders in this event
    const { data: tables } = await supabase.from('tables')
      .select('table_number').eq('event_id', ev.id).eq('is_active', true)
    // Find which of those have recent/active orders
    const tableIds = (tables||[]).map(t => t.id).filter(Boolean)
    setTakenTables([]) // Reset first
    if (tables?.length) {
      const { data: activeOrders } = await supabase.from('orders')
        .select('table_id, tables(table_number)')
        .in('status', ['pending','placed','in_progress'])
        .eq('event_id', ev.id)
      const takenNums = (activeOrders||[])
        .map(o => o.tables?.table_number)
        .filter(Boolean)
      setTakenTables(takenNums)
    }
  }

  async function confirmTable() {
    if (!selectedTable || !selectedEvent) return
    setConfirming(true)
    try {
      // Create or find table record
      const { data: existing } = await supabase.from('tables')
        .select('*').eq('event_id', selectedEvent.id)
        .eq('table_number', selectedTable).limit(1)

      let tableRecord = existing?.[0]
      if (!tableRecord) {
        const { data: newTable } = await supabase.from('tables')
          .insert({ event_id: selectedEvent.id, table_number: selectedTable, is_active: true })
          .select().single()
        tableRecord = newTable
      }

      if (!tableRecord) {
        alert('Could not set up table. Please try again.')
        setConfirming(false)
        return
      }

      // Save everything to localStorage
      localStorage.setItem('ss_setup_complete', 'true')
      localStorage.setItem('ss_setup_event', JSON.stringify(selectedEvent))
      localStorage.setItem('ss_setup_table', JSON.stringify(tableRecord))
      localStorage.setItem('ss_setup_table_number', String(selectedTable))
      localStorage.setItem('ss_last_table', String(selectedTable))

      onSetupComplete(selectedEvent, tableRecord)
    } catch(e) {
      alert('Setup failed. Please check connection and try again.')
    }
    setConfirming(false)
  }

  // ── RENDER ──────────────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(160deg, #1A0A0A, #2D1010)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '24px', fontFamily: 'Manrope, sans-serif'
    }}>
      {/* Logo */}
      <img src={janusLogo} alt="Janu's Smart Serve"
        style={{ width: 90, height: 90, borderRadius: 20, objectFit: 'contain',
          marginBottom: 16, border: '2px solid rgba(232,137,12,0.4)',
          background: 'rgba(232,137,12,0.1)' }} />
      <div style={{ color: '#fff', fontSize: 22, fontWeight: 900, marginBottom: 4 }}>
        Janu's <span style={{ color: '#E8890C' }}>Smart Serve</span>
      </div>
      <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, marginBottom: 32, fontStyle: 'italic' }}>
        • Jo hukum mere aaka •
      </div>

      <div style={{
        background: 'rgba(255,255,255,0.06)', borderRadius: 24,
        padding: '32px 28px', width: '100%', maxWidth: 420,
        border: '1px solid rgba(255,255,255,0.1)'
      }}>

        {/* ── STEP 1: PIN ── */}
        {step === 'pin' && (
          <>
            <div style={{ color: '#fff', fontSize: 18, fontWeight: 800, marginBottom: 6, textAlign: 'center' }}>
              🔐 Supervisor Setup
            </div>
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, textAlign: 'center', marginBottom: 24 }}>
              Enter your supervisor PIN to set up this tablet
            </div>
            {loadingEvents ? (
              <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.5)', padding: 20 }}>
                Loading events...
              </div>
            ) : activeEvents.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 20 }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>📅</div>
                <div style={{ color: '#FC8181', fontWeight: 700, marginBottom: 8 }}>No active events today</div>
                <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>Please ask admin to create today's event</div>
                <button onClick={loadActiveEvents}
                  style={{ marginTop: 16, background: '#E8890C', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 20px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                  Retry
                </button>
              </div>
            ) : (
              <>
                {activeEvents.length === 1 && (
                  <div style={{ background: 'rgba(232,137,12,0.15)', border: '1px solid rgba(232,137,12,0.3)', borderRadius: 12, padding: '12px 16px', marginBottom: 20, textAlign: 'center' }}>
                    <div style={{ color: '#E8890C', fontWeight: 700, fontSize: 13, marginBottom: 2 }}>Today's Event</div>
                    <div style={{ color: '#fff', fontWeight: 900, fontSize: 16 }}>{activeEvents[0].name}</div>
                    {activeEvents[0].venue && <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 2 }}>📍 {activeEvents[0].venue}</div>}
                  </div>
                )}
                {activeEvents.length > 1 && (
                  <div style={{ background: 'rgba(255,87,34,0.15)', border: '1px solid rgba(255,87,34,0.3)', borderRadius: 12, padding: '10px 16px', marginBottom: 20, textAlign: 'center' }}>
                    <div style={{ color: '#FF8A65', fontWeight: 700, fontSize: 13 }}>
                      {activeEvents.length} events active today — you will select one after PIN
                    </div>
                  </div>
                )}
                <input
                  value={pin}
                  onChange={e => setPin(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && verifyPin()}
                  placeholder="Enter PIN"
                  type="password"
                  maxLength={6}
                  style={{
                    width: '100%', background: 'rgba(255,255,255,0.08)',
                    border: '1.5px solid rgba(255,255,255,0.15)', borderRadius: 12,
                    padding: '16px', fontSize: 24, color: '#fff', textAlign: 'center',
                    letterSpacing: 12, fontWeight: 800, outline: 'none',
                    boxSizing: 'border-box', marginBottom: 12
                  }} />
                {pinError && (
                  <div style={{ color: '#FC8181', fontSize: 13, textAlign: 'center', marginBottom: 12 }}>
                    {pinError}
                  </div>
                )}
                <button onClick={verifyPin} disabled={verifying}
                  style={{
                    width: '100%', background: verifying ? '#555' : '#E8890C',
                    color: '#fff', border: 'none', borderRadius: 12,
                    padding: '16px', fontSize: 16, fontWeight: 800,
                    cursor: verifying ? 'wait' : 'pointer'
                  }}>
                  {verifying ? 'Verifying...' : 'Verify PIN →'}
                </button>
              </>
            )}
          </>
        )}

        {/* ── STEP 2: EVENT SELECTION (only when multiple events) ── */}
        {step === 'event' && (
          <>
            <div style={{ color: '#fff', fontSize: 18, fontWeight: 800, marginBottom: 6, textAlign: 'center' }}>
              📅 Select Event
            </div>
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, textAlign: 'center', marginBottom: 20 }}>
              {activeEvents.length} events are active today
            </div>
            {activeEvents.map(ev => (
              <button key={ev.id} onClick={() => selectEvent(ev)}
                style={{
                  width: '100%', background: 'rgba(255,255,255,0.06)',
                  border: '1.5px solid rgba(255,255,255,0.15)', borderRadius: 14,
                  padding: '16px 18px', marginBottom: 10, textAlign: 'left',
                  cursor: 'pointer', display: 'flex', justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                <div>
                  <div style={{ color: '#fff', fontWeight: 800, fontSize: 16 }}>{ev.name}</div>
                  <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 3 }}>
                    {ev.venue && '📍 ' + ev.venue}
                    {ev.catering_company && ' · 🍽️ ' + ev.catering_company}
                  </div>
                  <div style={{ color: '#fff', fontSize: 12, marginTop: 3 }}>
                    📋 {ev.number_of_tables || '?'} tables
                  </div>
                </div>
                <span style={{ color: '#E8890C', fontSize: 22 }}>→</span>
              </button>
            ))}
            <button onClick={() => setStep('pin')}
              style={{ width: '100%', background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 12, padding: '12px', color: 'rgba(255,255,255,0.4)', fontSize: 14, cursor: 'pointer', marginTop: 4 }}>
              ← Back
            </button>
          </>
        )}

        {/* ── STEP 3: TABLE SELECTION ── */}
        {step === 'table' && selectedEvent && (
          <>
            <div style={{ color: '#fff', fontSize: 18, fontWeight: 800, marginBottom: 2, textAlign: 'center' }}>
              🔢 Select Table
            </div>
            <div style={{ color: '#E8890C', fontWeight: 700, fontSize: 14, textAlign: 'center', marginBottom: 4 }}>
              {selectedEvent.name}
            </div>
            <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, textAlign: 'center', marginBottom: 20 }}>
              {selectedEvent.number_of_tables || 0} tables · Tap to select
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                <div style={{ width: 12, height: 12, borderRadius: 3, background: '#16A34A' }}></div> Available
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                <div style={{ width: 12, height: 12, borderRadius: 3, background: '#DC2626' }}></div> Active order
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                <div style={{ width: 12, height: 12, borderRadius: 3, background: '#E8890C' }}></div> Selected
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 20 }}>
              {Array.from({ length: selectedEvent.number_of_tables || 0 }, (_, i) => i + 1).map(tNum => {
                const isTaken = takenTables.includes(tNum)
                const isSelected = selectedTable === tNum
                return (
                  <button key={tNum}
                    onClick={() => !isTaken && setSelectedTable(tNum)}
                    style={{
                      padding: '14px 4px',
                      borderRadius: 10,
                      border: '2px solid',
                      borderColor: isSelected ? '#E8890C' : isTaken ? '#DC2626' : '#16A34A',
                      background: isSelected ? '#E8890C' : isTaken ? 'rgba(220,38,38,0.15)' : 'rgba(22,163,74,0.1)',
                      color: isSelected ? '#fff' : isTaken ? '#FC8181' : '#4ADE80',
                      fontSize: 18, fontWeight: 900,
                      cursor: isTaken ? 'not-allowed' : 'pointer',
                      opacity: isTaken ? 0.6 : 1
                    }}>
                    {tNum}
                  </button>
                )
              })}
            </div>
            {selectedTable && (
              <button onClick={confirmTable} disabled={confirming}
                style={{
                  width: '100%', background: confirming ? '#555' : '#16A34A',
                  color: '#fff', border: 'none', borderRadius: 12,
                  padding: '16px', fontSize: 16, fontWeight: 800,
                  cursor: confirming ? 'wait' : 'pointer', marginBottom: 10
                }}>
                {confirming ? 'Setting up...' : '✓ Confirm Table ' + selectedTable}
              </button>
            )}
            {!selectedTable && (
              <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 13, marginBottom: 10 }}>
                Tap a green table number to select it
              </div>
            )}
            {activeEvents.length > 1 && (
              <button onClick={() => { setStep('event'); setSelectedTable(null) }}
                style={{ width: '100%', background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 12, padding: '12px', color: 'rgba(255,255,255,0.4)', fontSize: 14, cursor: 'pointer' }}>
                ← Change Event
              </button>
            )}
          </>
        )}
      </div>

      <div style={{ color: 'rgba(255,255,255,0.2)', fontSize: 11, marginTop: 24 }}>
        Powered by Blitz Softwares
      </div>
    </div>
  )
}
