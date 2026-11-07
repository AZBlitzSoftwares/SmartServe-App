import { useKitInfo, mb } from '../../lib/kitInfo'

/* The Print Hub for a normal day, built with every deploy (tools/offline-kit.mjs): one
   program, nothing to install, on the laptop connected to the printers' router. The Node.js
   version stays as a fallback (Intel Macs, or a laptop that blocks the program). */
const hubLink = { fontWeight:800, color:'var(--ink)', whiteSpace:'nowrap' }
export default function PrintHubDownload() {
  const kit = useKitInfo()
  const files = kit && Array.isArray(kit.printhub) ? kit.printhub : []
  if (!files.length) return null
  const app = os => files.find(x => x.os === os && x.kind === 'app')
  const node = os => files.find(x => x.os === os && x.kind !== 'app')
  const apps = [['windows', 'Windows'], ['mac', 'Mac (Apple chip)']].filter(([os]) => app(os))
  return (
    <div data-testid="printhub-download" style={{ marginTop:10, fontSize:12.5, color:'var(--ink2)', lineHeight:1.55 }}>
      <div style={{ display:'flex', alignItems:'center', gap:'6px 14px', flexWrap:'wrap' }}>
        <span><b style={{ color:'var(--ink)' }}>Print Hub:</b> runs on one laptop connected to the printers’ router.
          {apps.length ? ' Download, double-click, keep its window open and the laptop plugged in and awake. Nothing to install.' : ' Needs Node.js.'}</span>
        {(apps.length ? apps : [['windows', 'Windows'], ['mac', 'Mac']]).map(([os, label]) => {
          const f = apps.length ? app(os) : node(os)
          return f && (
            <a key={os} href={`/downloads/${f.file}`} download data-testid={`hub-${os}`} style={hubLink}>⬇ Download for {label}
              <span style={{ fontWeight:600, opacity:0.7 }}> ({mb(f.bytes)})</span></a>
          )
        })}
      </div>
      {apps.length > 0 && (
        <div style={{ fontSize:11.5, marginTop:4 }}>
          First start only: Windows may say “Windows protected your PC” › <b>More info</b> › <b>Run anyway</b>. Mac: double-click,
          then System Settings › Privacy &amp; Security › <b>Open Anyway</b>.
          {(node('windows') || node('mac')) && <> Intel Mac, or the program is blocked? The Node.js version:{' '}
            {node('windows') && <a href={`/downloads/${node('windows').file}`} download data-testid="hub-node-windows" style={hubLink}>Windows</a>}
            {node('windows') && node('mac') && ' · '}
            {node('mac') && <a href={`/downloads/${node('mac').file}`} download data-testid="hub-node-mac" style={hubLink}>Mac</a>}
            {' '}(install Node.js first).</>}
        </div>
      )}
    </div>
  )
}
