import React, { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../config/supabase'

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
    if (!supabase) {
    setLoading(false)
    return
    }

    // Check active sessions and sets the initial user
    supabase.auth.getSession().then(({ data: { session } }) => {
    setUser(session?.user ?? null)
    setLoading(false)
    })

    // Listen for changes on auth state (login/logout)
    const {
    data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
    setUser(session?.user ?? null)
    setLoading(false)
    })

    return () => subscription.unsubscribe()
}, [])

const value = {
    user,
    loading,
}

return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}