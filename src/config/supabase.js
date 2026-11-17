import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// createClient throws if either value is missing, which would crash module
// evaluation and leave the page blank. Without credentials we fall back to a
// stub so the app still mounts and demo mode works; auth calls report the
// missing config instead of failing silently.
const demoModeError = {
  message:
    'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.local and restart the dev server.',
}

const createStubClient = () => {
  console.warn(`⚠️ ${demoModeError.message} Running in demo mode without auth.`)

  // Every query terminates in { data, error } so callers can await any chain
  // without special-casing demo mode.
  const queryResult = Promise.resolve({ data: null, error: demoModeError })
  const queryBuilder = () => {
    const chain = {
      select: () => chain,
      insert: () => chain,
      upsert: () => chain,
      update: () => chain,
      delete: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => chain,
      then: (resolve, reject) => queryResult.then(resolve, reject),
    }
    return chain
  }

  return {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      getUser: async () => ({ data: { user: null }, error: null }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => {} } },
      }),
      signInWithPassword: async () => ({ data: null, error: demoModeError }),
      signUp: async () => ({ data: null, error: demoModeError }),
      signOut: async () => ({ error: null }),
    },
    from: queryBuilder,
  }
}

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : createStubClient()
