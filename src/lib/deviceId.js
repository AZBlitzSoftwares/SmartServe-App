/* A stable identifier for this tablet.

   Generated once on first launch and kept in localStorage. It is
   random and meaningless outside this system - it identifies the
   device only so the app can tell "this table is held by another
   tablet" apart from "this table is held by me, reopening".

   Clearing browser data or reinstalling produces a new id. That
   is fine: the old claim expires on its own after 30 minutes. */

const KEY = 'ss_device_id'

export function getDeviceId() {
  try {
    let id = localStorage.getItem(KEY)
    if (!id) {
      id = 'dev_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
      localStorage.setItem(KEY, id)
    }
    return id
  } catch (e) {
    // Private mode or storage disabled - fall back to a per-session id
    if (!window.__ssDeviceId) {
      window.__ssDeviceId = 'tmp_' + Math.random().toString(36).slice(2, 10)
    }
    return window.__ssDeviceId
  }
}

// A claim is stale once it has gone this long without a heartbeat.
// Kept in step with the OFFLINE threshold on the supervisor's Tables
// screen - if a claim expired sooner than a table showed OFFLINE, a
// second tablet could take a number that still read ONLINE there.
export const CLAIM_STALE_MS = 60 * 60 * 1000

export function isClaimLive(row) {
  if (!row?.claimed_by_device) return false
  const seen = row.last_seen_at || row.claimed_at
  if (!seen) return false
  return (Date.now() - new Date(seen).getTime()) < CLAIM_STALE_MS
}
