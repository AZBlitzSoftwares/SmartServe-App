import { useState, useRef, useEffect } from 'react'
import DeviceTools, { LaptopPill } from './DeviceTools'
import LaptopOffer from './LaptopOffer'

/* What every entry screen (Setup, Captain Sign In, the chooser, No event)
   puts on itself to reach the device tools:
     logoProps / logoHoldStyle  hold the logo for 2 seconds
     element                    the "⚙ Device" corner button, the LAPTOP
                                SERVER pill, the "laptop server is on"
                                offer and, when open, the panel
     openTools('laptop')        opens straight on the laptop address (the
                                "Can't reach the server" screen)          */

const HOLD_MS = 2000

/** Hold-to-open for the logo. Mouse and touch both, as on the Welcome
    screen's table number, which is proven on these tablets. */
export function useDeviceTools() {
  const [open, setOpen] = useState(false)
  const [opensOn, setOpensOn] = useState(null)
  const [holding, setHolding] = useState(false)
  const timer = useRef(null)

  function start() {
    if (timer.current) return
    setHolding(true)
    timer.current = setTimeout(() => {
      timer.current = null
      setHolding(false)
      setOpen(true)
    }, HOLD_MS)
  }
  function stop() {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    setHolding(false)
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const logoProps = {
    onMouseDown: start, onMouseUp: stop, onMouseLeave: stop,
    onTouchStart: start, onTouchEnd: stop, onTouchCancel: stop,
    onContextMenu: e => e.preventDefault(),
    draggable: false,
    'data-testid': 'brand-logo',
  }
  // Merged into the logo's own style: a visible "keep holding" cue.
  const logoHoldStyle = {
    WebkitTouchCallout: 'none', userSelect: 'none', WebkitUserSelect: 'none',
    transition: holding ? 'transform 2s linear' : 'transform 0.15s',
    ...(holding ? { transform: 'scale(0.88)', borderColor: '#E8890C' } : {}),
  }

  const element = (
    <>
      <LaptopPill />
      <LaptopOffer />
      <button onClick={() => { setOpensOn(null); setOpen(true) }} aria-label="Device tools"
        style={{ position: 'fixed', right: 12, bottom: 12, zIndex: 50,
          background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.18)',
          color: 'rgba(255,255,255,0.55)', borderRadius: 999, padding: '8px 14px',
          fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'Manrope, sans-serif' }}>
        ⚙ Device
      </button>
      {open && <DeviceTools start={opensOn} onClose={() => setOpen(false)} />}
    </>
  )
  return { logoProps, logoHoldStyle, element, openTools: (s = null) => { setOpensOn(s); setOpen(true) } }
}

