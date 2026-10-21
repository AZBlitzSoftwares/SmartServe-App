import { useEffect, useRef, useState } from 'react'
import { getSavedLaptop, isLaptopOrigin, lastLaptopBase, normaliseBase, DEFAULT_LAPTOP_BASE, DEFAULT_LAPTOP_PORT } from '../lib/serverSwitch'
import { agoText, netsToSearch, publishedLaptops, searchWifi } from '../lib/laptopFinder'

/* The "laptop address" box of the server switches (tablet Device tools, the
   desk's Offline kit card, kitchen screens, the "laptop did not answer"
   screen). It starts with the best address known, in this order:
     the laptop the cloud says is running for today's event,
     the last laptop address used on this device,
     192.168.1.10:8080 (a suggestion only),
   and offers "Search this Wi-Fi". Typing always wins.                     */
function startAddress() {
  if (isLaptopOrigin()) return window.location.origin
  return getSavedLaptop()?.base || lastLaptopBase() || DEFAULT_LAPTOP_BASE
}

export function useLaptopAddress() {
  const [address, setAddressState] = useState(startAddress)
  const [source, setSource] = useState(() => (isLaptopOrigin() ? 'here' : lastLaptopBase() ? 'last' : 'default'))
  const [published, setPublished] = useState([])
  const [search, setSearch] = useState(null) // { state: 'running', net, checked } | { state: 'found', base } | { state: 'none', blocked, nets }
  const touched = useRef(false)
  const typedAt = useRef(0)
  const searchNo = useRef(0)

  useEffect(() => {
    let live = true
    const searches = searchNo
    publishedLaptops().then(list => {
      if (!live) return
      setPublished(list)
      if (list[0] && !touched.current) { setAddressState(list[0].base); setSource('cloud') }
    })
    return () => { live = false; searches.current++ }
  }, [])

  function setAddress(v) {
    touched.current = true
    typedAt.current = Date.now()
    setAddressState(v)
    setSource('typed')
    setSearch(null)
  }

  async function runSearch() {
    if (search?.state === 'running') return
    const mine = ++searchNo.current
    const startedAt = Date.now()
    const stopped = () => searchNo.current !== mine
    const hints = [address, ...published.map(p => p.base), lastLaptopBase()].filter(Boolean)
    const base = normaliseBase(address)
    let port = DEFAULT_LAPTOP_PORT
    try { if (base) port = new URL(base).port || DEFAULT_LAPTOP_PORT } catch { /* default */ }
    setSearch({ state: 'running', net: '', checked: 0 })
    const r = await searchWifi({
      nets: netsToSearch(hints), port, isStopped: stopped,
      onProgress: ({ net, checked }) => { if (!stopped()) setSearch({ state: 'running', net, checked }) },
    })
    if (stopped()) return
    if (r.found.length && typedAt.current > startedAt) {
      // staff typed an address while the search ran: theirs stays
      setSearch({ state: 'found', base: r.found[0].base, events: r.found[0].events.map(e => e && e.name).filter(Boolean), kept: true })
    } else if (r.found.length) {
      touched.current = true
      setAddressState(r.found[0].base)
      setSource('found')
      setSearch({ state: 'found', base: r.found[0].base, events: r.found[0].events.map(e => e && e.name).filter(Boolean) })
    } else {
      setSearch({ state: 'none', blocked: r.blocked, nets: r.nets })
    }
  }
  function stopSearch() { searchNo.current++; setSearch(null) }

  // One line under the box: where the address came from, or how the search went.
  let note = ''
  let tone = 'muted'
  const pub = published.find(p => p.base === normaliseBase(address))
  if (search?.state === 'running') {
    note = search.net ? `Searching this Wi-Fi: ${search.net}.1–254 (${search.checked} checked)…` : 'Searching this Wi-Fi…'
  } else if (search?.state === 'found') {
    note = search.kept
      ? `Found a laptop at ${search.base.replace(/^http:\/\//, '')} on this Wi-Fi (your typed address is kept).`
      : `Found on this Wi-Fi${search.events?.length ? ': ' + search.events.join(', ') : ''}.`
    tone = 'ok'
  } else if (search?.state === 'none') {
    tone = 'warn'
    note = search.blocked
      ? 'This screen cannot search the Wi-Fi (the browser blocks it). Type the address shown in the laptop\'s Local Server window.'
      : `No laptop answered on ${search.nets.map(n => n + '.x').join(', ')}. Is its Local Server window open, and this device on the same Wi-Fi? Or type the address.`
  } else if (source === 'cloud' && pub) {
    note = `Found through the cloud: ${pub.label || 'the event laptop'}${pub.events.length ? ' · ' + pub.events.join(', ') : ''} · ${agoText(pub.ageSeconds)}.`
    tone = 'ok'
  } else if (source === 'last') {
    note = 'The laptop address this device used last time. Check it against the laptop\'s Local Server window.'
  } else if (source === 'default') {
    note = 'Type the address shown in the laptop\'s Local Server window.'
  }
  return { address, setAddress, published, search, runSearch, stopSearch, note, tone }
}
