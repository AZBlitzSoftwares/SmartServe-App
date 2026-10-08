import { lazy } from 'react'

// ss-split-routes. If a deploy lands between loading the page and loading a
// split-off screen, the old file name no longer exists on the server and the
// import fails. Reload once to pick up the new version instead of showing the
// crash screen; the timestamp stops a reload loop if the failure is something
// else.
export function lazyPage(load, name) {
  return lazy(() => load().catch(err => {
    try {
      const key = 'ss_chunk_reload_' + name
      const last = Number(sessionStorage.getItem(key)) || 0
      if (Date.now() - last > 60000) {
        sessionStorage.setItem(key, String(Date.now()))
        window.location.reload()
        return new Promise(() => {})
      }
    } catch { /* storage blocked: fall through to the error screen */ }
    throw err
  }))
}
