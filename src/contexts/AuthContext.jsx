import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { InteractionRequiredAuthError } from '@azure/msal-browser'
import { msalInstance, initializeMsal } from '../msalInstance'
import {
  isAuthConfigured,
  isApiScopeConfigured,
  loginRequest,
  apiTokenRequest,
} from '../authConfig'

const NOT_CONFIGURED_MESSAGE =
  'Sign-in is not configured. Add the VITE_AZURE_* settings (client ID, tenant subdomain, tenant ID) to .env.local - see .env.example.'

// Errors from a silent token request that mean "the user has to sign in again".
// (msal-browser v5 reports a stalled silent renewal with these codes.)
const SIGN_IN_AGAIN_CODES = new Set([
  'timed_out',
  'bridge_timeout',
  'redirect_bridge_empty_response',
  'monitor_window_timeout', // older msal-browser versions
])

const AuthContext = createContext(null)

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

// Turns an MSAL account into the small user object the rest of the app uses.
// NOTE: this id is for display only. The API never trusts an id sent by the
// browser; it reads the user from the verified access token.
function toUser(account) {
  if (!account) return null
  const claims = account.idTokenClaims || {}
  return {
    id: claims.oid || account.localAccountId || claims.sub || null,
    email: account.username || claims.email || null,
    name: account.name || claims.name || null,
  }
}

function describeError(err) {
  if (err?.errorCode === 'user_cancelled') return 'Sign-in was cancelled.'
  return err?.errorMessage || err?.message || 'Something went wrong with sign-in.'
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(isAuthConfigured) // nothing to wait for if unconfigured
  const [authError, setAuthError] = useState(isAuthConfigured ? null : NOT_CONFIGURED_MESSAGE)

  // On every page load: start MSAL, finish a returning sign-in, restore a cached one.
  useEffect(() => {
    if (!isAuthConfigured) return undefined
    let cancelled = false
    initializeMsal()
      .then((account) => {
        if (!cancelled) setUser(toUser(account))
      })
      .catch((err) => {
        if (!cancelled) setAuthError(describeError(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Each of these sends the browser to Microsoft's page, so the app reloads
  // afterwards and the effect above picks up the result.
  const startRedirect = useCallback(async (request) => {
    if (!msalInstance) {
      setAuthError(NOT_CONFIGURED_MESSAGE)
      return
    }
    setAuthError(null)
    try {
      await initializeMsal()
      await msalInstance.loginRedirect(request)
    } catch (err) {
      setAuthError(describeError(err))
    }
  }, [])

  const login = useCallback(() => startRedirect(loginRequest), [startRedirect])

  // prompt=create opens Microsoft's page on "create account". Microsoft documents
  // it for external tenants, though some people report it behaving inconsistently;
  // if it lands on the sign-in screen, the "No account? Create one" link there works.
  const signup = useCallback(
    () => startRedirect({ ...loginRequest, prompt: 'create' }),
    [startRedirect],
  )

  const logout = useCallback(async () => {
    if (!msalInstance) return
    setAuthError(null)
    try {
      await initializeMsal()
      await msalInstance.logoutRedirect({ account: msalInstance.getActiveAccount() })
    } catch (err) {
      setAuthError(describeError(err))
    }
  }, [])

  // Returns an access token for the game API, or null if there isn't one right now
  // (not signed in, auth not configured, or the browser is being sent to Microsoft
  // to sign in again). Callers should treat null as "do not call the API yet".
  const getAccessToken = useCallback(async () => {
    if (!msalInstance || !isApiScopeConfigured) return null
    await initializeMsal()
    const account = msalInstance.getActiveAccount()
    if (!account) return null
    try {
      const result = await msalInstance.acquireTokenSilent({ ...apiTokenRequest, account })
      return result.accessToken
    } catch (err) {
      const needsSignIn =
        err instanceof InteractionRequiredAuthError || SIGN_IN_AGAIN_CODES.has(err?.errorCode)
      if (needsSignIn) {
        await msalInstance.acquireTokenRedirect({ ...apiTokenRequest, account })
        return null // the page is navigating away to Microsoft
      }
      throw err
    }
  }, [])

  const clearAuthError = useCallback(() => setAuthError(null), [])

  const value = useMemo(
    () => ({
      user,
      loading,
      authError,
      clearAuthError,
      isConfigured: isAuthConfigured,
      login,
      signup,
      logout,
      getAccessToken,
    }),
    [user, loading, authError, clearAuthError, login, signup, logout, getAccessToken],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}