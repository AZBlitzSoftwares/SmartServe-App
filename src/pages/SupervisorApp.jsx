import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import SupervisorLogin from '../components/supervisor/SupervisorLogin'
import KOTDashboard from '../components/supervisor/KOTDashboard'
import SOSRequests from '../components/supervisor/SOSRequests'
import MenuManager from '../components/supervisor/MenuManager'

export default function SupervisorApp() {
  const [authed, setAuthed] = useState(false)
  const [activeTab, setActiveTab] = useState('kot')
  const [eventData, setEventData] = useState(null)
  const [orderCount, setOrderCount] = useState(0)
  const [sosCount, setSosCount] = useState(0)

  useEffect(() => { if (authed) loadEvent() }, [authed])

  async function loadEvent() {
    const { data } = await supabase.from('events').select('*').eq('is_closed', false).order('created_at', { ascending: false }).limit(1)
    if (data?.length) setEventData(data[0])
  }

  if (!authed) return <SupervisorLogin onLogin={() => setAuthed(true)} />

  const TABS = [
    { id: 'kot', label: 'Live Orders', emoji: '🎫', badge: orderCount },
    { id: 'sos', label: 'Requests', emoji: '🆘', badge: sosCount },
    { id: 'menu', label: 'Menu', emoji: '📋', badge: 0 },
  ]

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', paddingBottom: 80 }}>
      <div style={{ background: 'var(--ink)', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ color: '#fff', fontWeight: 800, fontSize: 18 }}>Smart<span style={{ color: '#E8890C' }}>Serve</span> <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, fontWeight: 500 }}>Supervisor</span></div>
          {eventData && <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 2 }}>{eventData.name}</div>}
        </div>
        <button onClick={() => setAuthed(false)} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600 }}>Logout</button>
      </div>
      <div style={{ padding: '16px' }}>
        {activeTab === 'kot' && <KOTDashboard eventData={eventData} onOrderCountChange={setOrderCount} />}
        {activeTab === 'sos' && <SOSRequests eventData={eventData} onSosCountChange={setSosCount} />}
        {activeTab === 'menu' && <MenuManager eventData={eventData} />}
      </div>
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#fff', borderTop: '1px solid var(--line)', display: 'flex', zIndex: 50 }}>
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{ flex: 1, padding: '12px 8px', background: 'none', border: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, cursor: 'pointer', borderTop: activeTab === tab.id ? '3px solid var(--ink)' : '3px solid transparent', position: 'relative' }}>
            <span style={{ fontSize: 22 }}>{tab.emoji}</span>
            <span style={{ fontSize: 11, fontWeight: activeTab === tab.id ? 800 : 500, color: activeTab === tab.id ? 'var(--ink)' : '#999' }}>{tab.label}</span>
            {tab.badge > 0 && <div style={{ position: 'absolute', top: 8, right: '28%', background: '#DC2626', color: '#fff', fontSize: 10, fontWeight: 800, borderRadius: 999, minWidth: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>{tab.badge}</div>}
          </button>
        ))}
      </div>
    </div>
  )
}