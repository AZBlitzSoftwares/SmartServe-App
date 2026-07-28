import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, msg: '' }
  }

  static getDerivedStateFromError(err) {
    return { hasError: true, msg: (err && err.message) ? err.message : 'Unexpected error' }
  }

  componentDidCatch(err, info) {
    console.error('[SmartServe crash]', err, info)
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div style={{ minHeight:'100vh', background:'#1A0A0A', color:'#fff',
        display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
        padding:24, textAlign:'center', fontFamily:'system-ui, sans-serif' }}>
        <div style={{ fontSize:52, marginBottom:14 }}>🧞</div>
        <div style={{ fontSize:20, fontWeight:800, marginBottom:10 }}>Just a moment</div>
        <div style={{ fontSize:14, color:'rgba(255,255,255,0.6)', maxWidth:320,
          lineHeight:1.6, marginBottom:26 }}>
          Something went wrong on this screen. Tap below to reload — your table setup is safe.
        </div>
        <button
          onClick={() => { this.setState({ hasError:false, msg:'' }); window.location.reload() }}
          style={{ background:'#E8890C', color:'#fff', border:'none', borderRadius:14,
            padding:'16px 36px', fontSize:16, fontWeight:800, cursor:'pointer' }}>
          Reload App
        </button>
        <div style={{ fontSize:10, color:'rgba(255,255,255,0.25)', marginTop:22, maxWidth:320 }}>
          {this.state.msg}
        </div>
      </div>
    )
  }
}
