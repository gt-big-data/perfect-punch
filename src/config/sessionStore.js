import { supabase } from './supabase'

// Derived here rather than imported, so this module never depends on
// supabase.js exporting anything beyond the client itself. When the
// credentials are absent there is nothing to sync to and every path below
// falls back to the local mirror.
const isSupabaseConfigured = Boolean(
  import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY
)

// Where training sessions live.
//
// Supabase is the source of truth so history follows the account across
// devices. localStorage is kept as a mirror, not a legacy path: it is what
// makes the dashboard work when the user is signed out, offline, or when the
// Supabase project is unreachable. Reads merge both and prefer the row from
// Supabase when the same session_id exists in each.
//
// Run supabase/migrations/001_sessions.sql in the Supabase SQL editor once to
// create the table and its row-level-security policies.

const TABLE = 'sessions'
const LOCAL_PREFIX = 'demo_session_'

// Columns on the sessions table, in the shape the dashboard already expects.
const toRow = (session, userId) => ({
  user_id: userId,
  session_id: session.session_id,
  recorded_at: session.timestamp || new Date().toISOString(),
  summary: session.summary ?? {},
  punch_accuracy: session.punch_accuracy ?? {},
  reaction_times: session.reaction_times ?? {},
  defense: session.defense ?? {},
  timeline: session.timeline ?? [],
})

// Rows come back out as the same object the rest of the app passes around, so
// nothing downstream has to know where a session was loaded from.
const fromRow = (row) => ({
  session_id: row.session_id,
  timestamp: row.recorded_at,
  summary: row.summary ?? {},
  punch_accuracy: row.punch_accuracy ?? {},
  reaction_times: row.reaction_times ?? {},
  defense: row.defense ?? {},
  timeline: row.timeline ?? [],
  source: 'supabase',
})

const currentUser = async () => {
  if (!isSupabaseConfigured) return null
  try {
    const { data, error } = await supabase.auth.getUser()
    if (error) return null
    return data?.user ?? null
  } catch {
    return null
  }
}

// ---------------------------------------------------------
// LOCAL MIRROR
// ---------------------------------------------------------
export const saveSessionLocally = (session) => {
  try {
    localStorage.setItem(
      `${LOCAL_PREFIX}${session.session_id}`,
      JSON.stringify(session)
    )
    return true
  } catch (error) {
    console.error('❌ Failed to cache session locally:', error)
    return false
  }
}

export const readLocalSessions = () => {
  try {
    return Object.keys(localStorage)
      .filter((key) => key.startsWith(LOCAL_PREFIX))
      .map((key) => {
        try {
          const parsed = JSON.parse(localStorage.getItem(key))
          return parsed ? { ...parsed, source: parsed.source ?? 'local' } : null
        } catch (error) {
          console.error(`Error parsing session ${key}:`, error)
          return null
        }
      })
      .filter((s) => s && s.session_id && s.summary)
  } catch (error) {
    console.error('❌ Failed to read local sessions:', error)
    return []
  }
}

// ---------------------------------------------------------
// SAVE
// ---------------------------------------------------------
/**
 * Persist one finished session. The local mirror is written first and always,
 * so a failed or skipped sync never costs the user their session.
 *
 * @returns {{ local: boolean, synced: boolean, reason?: string }}
 */
export const saveSession = async (session) => {
  const local = saveSessionLocally(session)

  if (!isSupabaseConfigured) {
    return { local, synced: false, reason: 'Supabase is not configured' }
  }

  const user = await currentUser()
  if (!user) {
    return { local, synced: false, reason: 'No signed-in user - saved on this device only' }
  }

  try {
    // Upsert so re-saving the same session updates it instead of duplicating.
    const { error } = await supabase
      .from(TABLE)
      .upsert(toRow(session, user.id), { onConflict: 'user_id,session_id' })

    if (error) {
      console.error('❌ Supabase session sync failed:', error.message)
      return { local, synced: false, reason: error.message }
    }

    console.log('☁️ Session synced to Supabase:', session.session_id)
    return { local, synced: true }
  } catch (error) {
    console.error('❌ Supabase session sync threw:', error)
    return { local, synced: false, reason: String(error) }
  }
}

// ---------------------------------------------------------
// READ
// ---------------------------------------------------------
/**
 * All sessions available to this user, newest first, deduplicated by
 * session_id with the Supabase copy winning over the local mirror.
 */
export const fetchSessionHistory = async ({ limit = 50 } = {}) => {
  const byId = new Map()

  for (const session of readLocalSessions()) {
    byId.set(session.session_id, session)
  }

  const user = await currentUser()
  if (user) {
    try {
      const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .eq('user_id', user.id)
        .order('recorded_at', { ascending: false })
        .limit(limit)

      if (error) {
        console.warn('⚠️ Could not load Supabase history, using local only:', error.message)
      } else if (Array.isArray(data)) {
        for (const row of data) {
          byId.set(row.session_id, fromRow(row))
        }
        console.log(`☁️ Loaded ${data.length} session(s) from Supabase`)
      }
    } catch (error) {
      console.warn('⚠️ Supabase history request failed, using local only:', error)
    }
  }

  const sortTime = (s) => (s.timestamp ? new Date(s.timestamp).getTime() : 0)
  return [...byId.values()]
    .sort((a, b) => sortTime(b) - sortTime(a))
    .slice(0, limit)
}

/**
 * Push any device-only sessions up to the account. Called after sign-in so a
 * user who trained signed-out does not lose that history.
 */
export const syncLocalSessions = async () => {
  if (!isSupabaseConfigured) return { synced: 0 }

  const user = await currentUser()
  if (!user) return { synced: 0 }

  const pending = readLocalSessions().filter((s) => s.source !== 'supabase')
  if (pending.length === 0) return { synced: 0 }

  try {
    const { error } = await supabase
      .from(TABLE)
      .upsert(pending.map((s) => toRow(s, user.id)), { onConflict: 'user_id,session_id' })

    if (error) {
      console.warn('⚠️ Could not back-fill local sessions:', error.message)
      return { synced: 0, reason: error.message }
    }

    console.log(`☁️ Backed up ${pending.length} local session(s) to Supabase`)
    return { synced: pending.length }
  } catch (error) {
    console.warn('⚠️ Back-fill threw:', error)
    return { synced: 0, reason: String(error) }
  }
}
