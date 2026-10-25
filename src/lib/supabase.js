import { createClient } from '@supabase/supabase-js'

// Local server mode (offline standby). When the app is served by the event
// laptop instead of Vercel, that server writes window.__SS_LOCAL__ = { url, key }
// into index.html, so the very same build talks to the laptop's database.
// On Vercel nothing is injected and the cloud settings below are used as before.
const local = typeof window !== 'undefined' ? window.__SS_LOCAL__ : null

const supabaseUrl = (local && local.url) || import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = (local && local.key) || import.meta.env.VITE_SUPABASE_ANON_KEY

// No request may hang on forever: a request the network lost holds one of the
// browser's few connections to the server, and the next taps queue behind it.
// A request that times out comes back as an error the screen handles (lists
// keep what they show and reload on the next round); writes are made safe to
// send again (Place Order carries its own id, Delivered is a no-op the second time).
export const supabase = createClient(supabaseUrl, supabaseAnonKey, { db: { timeout: local ? 15000 : 25000 } })
