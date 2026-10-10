import LaptopServerSwitch from '../LaptopServerSwitch'
import { isLaptopOrigin } from '../../lib/serverSwitch'
import { useKitInfo, mb } from '../../lib/kitInfo'

/* Control tab, every event type: the Offline Kit. If the venue internet is bad,
   one laptop on the event router runs the whole event (tablets, kitchen
   screens, this desk, waiter phones, the KOT printers). The kit is built with
   every deploy (tools/offline-kit.mjs) and downloaded here; the laptop needs
   only Node.js - no code, no build, no database password. */
const card = { background: '#fff', borderRadius: 12, padding: '14px 16px', marginBottom: 12, boxShadow: 'var(--shadow)' }
const hint = { fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.55 }
const dl = { display: 'inline-flex', alignItems: 'center', gap: 8, height: 40, padding: '0 16px', borderRadius: 10, background: 'var(--ink)',
  color: '#fff', fontSize: 13.5, fontWeight: 800, textDecoration: 'none', whiteSpace: 'nowrap' }

const STEPS = [
  ['Once on the laptop', 'Install Node.js (LTS) from nodejs.org, then unzip the kit (Windows: right-click > Extract All).'],
  ['The day before, with internet', 'Double-click "1 Prepare Event" and type the number of the event (several events of one day: 1,2). The first time it also downloads its own parts (about 150 MB).'],
  ['At the venue, if the internet is bad', '"2 Refresh Event Data" (if there is any internet), then "3 Start Local Server" and "4 Start Print Hub". Move every device to the laptop together and stay there until the end.'],
  ['Moving the devices', 'Tablets: Device > supervisor PIN > Use laptop server. Kitchen screens: menu > Use laptop server. This desk: the switch below. Everyone signs in again; KOT numbers jump by 100.'],
  ['After the event, with internet', '"5 Upload to Cloud" sends every order, KOT and dish taken on the laptop to the cloud.'],
]

export default function OfflineKitCard() {
  const onLaptop = isLaptopOrigin()
  const kit = useKitInfo()                 // offline-kit.json, false = not in this build
  const file = os => (kit && kit.kits.find(k => k.os === os)) || null

  return (
    <div id="ss-offline" style={{ ...card, borderTop: '4px solid #0F766E', marginTop: 18 }} data-testid="offline-kit">
      <div style={{ fontSize: 16, fontWeight: 900 }}>Offline kit · run this event from a laptop</div>
      <div style={{ ...hint, marginTop: 4 }}>
        If the venue internet is bad, one laptop on the event router runs the whole event: captain and guest tablets,
        kitchen screens, this desk, waiter phones and the KOT printers. Any Windows or Mac laptop works; it needs only
        Node.js. No password is needed: the kit already carries this system's address and public key.
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', margin: '12px 0 4px' }}>
        {onLaptop ? (
          <div style={{ ...hint, fontWeight: 700 }}>This desk is on the laptop server. Download the kit from the Control tab on the cloud.</div>
        ) : kit === null ? (
          <div style={hint}>Checking the kit…</div>
        ) : kit === false ? (
          <div style={{ ...hint, fontWeight: 700 }}>The kit is not part of this build.</div>
        ) : (
          <>
            {[['windows', 'Download for Windows'], ['mac', 'Download for Mac']].map(([os, label]) => file(os) && (
              <a key={os} href={`/downloads/${file(os).file}`} download style={dl} data-testid={`kit-${os}`}>
                ⬇ {label}<span style={{ fontWeight: 600, opacity: 0.75, fontSize: 12 }}>{mb(file(os).bytes)}</span>
              </a>
            ))}
            <span style={hint}>Kit of this version of the app. Download it again after an update.</span>
          </>
        )}
      </div>

      <ol style={{ margin: '10px 0 0', paddingLeft: 20 }}>
        {STEPS.map(([h, t]) => (
          <li key={h} style={{ ...hint, color: 'var(--ink)', marginBottom: 6 }}><b>{h}:</b> {t}</li>
        ))}
      </ol>
      <div style={{ ...hint, background: '#F0FDFA', border: '1px solid #99F6E4', borderRadius: 10, padding: '8px 12px', margin: '8px 0 12px' }}>
        <b>Several events:</b> one laptop can carry all the events of a day (choose 1,2 in Prepare Event). Events at
        different venues: one laptop for each venue. Never run two laptops for the same event. Make menu, kitchen and
        staff changes in the cloud before Prepare Event: changes made on the laptop are not uploaded.
      </div>

      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
        <div style={{ fontSize: 13.5, fontWeight: 900, marginBottom: 6 }}>This desk</div>
        <LaptopServerSwitch />
      </div>
    </div>
  )
}
