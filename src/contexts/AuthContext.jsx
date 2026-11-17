import React, { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../config/supabase'
import { syncLocalSessions } from '../config/sessionStore'

const AuthContext = createContext({})

export const useAuth = () => {
const context = useContext(AuthContext)
if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
}
return context
}

export const AuthProvider = ({ children }) => {
const [user, setUser] = useState(null)
const [loading, setLoading] = useState(true)

useEffect(() => {
    // Check active sessions and sets the initial user
    supabase.auth.getSession().then(({ data: { session } }) => {
    setUser(session?.user ?? null)
    setLoading(false)
    })

    // Listen for changes on auth state (login/logout)
    const {
    data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
    setUser(session?.user ?? null)
    setLoading(false)

    // Anything trained while signed out lives only on this device. Push it
    // up on sign-in so the account's history stays complete.
    if (event === 'SIGNED_IN') {
        syncLocalSessions().catch((error) =>
        console.warn('⚠️ Could not back-fill local sessions:', error)
        )
    }
    })

    return () => subscription.unsubscribe()
}, [])

const value = {
    user,
    loading,
}

return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}