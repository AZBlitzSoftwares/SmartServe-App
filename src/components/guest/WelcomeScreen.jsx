export default function WelcomeScreen({ tableNumber, onStart, eventData }) {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(160deg, #2A1B2E 0%, #4A2340 50%, #8E2A5C 100%)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      textAlign: 'center', padding: '40px 24px', color: '#fff'
    }}>
      <div style={{ fontSize: 64, marginBottom: 16 }}>🍽️</div>
      <h1 style={{ fontSize: 36, fontWeight: 800, marginBottom: 8, letterSpacing: '-0.02em' }}>
        Smart<span style={{ color: '#E8890C' }}>Serve</span>
      </h1>
      {eventData && (
        <p style={{ fontSize: 15, opacity: 0.75, marginBottom: 8 }}>{eventData.name}</p>
      )}
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.25)',
        borderRadius: 999, padding: '10px 24px', margin: '24px 0 36px',
        fontSize: 16, fontWeight: 700, letterSpacing: '0.04em'
      }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#4ADE80', display: 'inline-block', boxShadow: '0 0 8px #4ADE80' }}></span>
        TABLE {tableNumber}
      </div>
      <p style={{ fontSize: 15, opacity: 0.65, marginBottom: 40, maxWidth: 280, lineHeight: 1.6 }}>
        Browse our menu and place your order directly from this tablet
      </p>
      <button
        onClick={onStart}
        style={{
          background: '#E8890C', color: '#fff', border: 'none',
          borderRadius: 16, padding: '20px 56px',
          fontSize: 19, fontWeight: 800, letterSpacing: '0.01em',
          boxShadow: '0 10px 30px rgba(232,137,12,0.5)',
          transition: 'transform 0.15s'
        }}
        onMouseDown={e => e.currentTarget.style.transform = 'scale(0.96)'}
        onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
      >
        Start Ordering →
      </button>
      <p style={{ marginTop: 32, fontSize: 12, opacity: 0.4 }}>
        Powered by SmartServe · Table {tableNumber}
      </p>
    </div>
  )
}
