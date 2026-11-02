import { PublicClientApplication } from '@azure/msal-browser'
import { msalConfig, isAuthConfigured } from './authConfig'

// One MSAL instance for the whole app. It is null when auth is not configured.
export const msalInstance = isAuthConfigured ? new PublicClientApplication(msalConfig) : null

let initPromise = null

// Starts MSAL and finishes any sign-in that is returning from Microsoft's page.
// Safe to call many times: the work happens once, and every caller gets the same
// result. (React StrictMode runs effects twice in development, so this matters.)
// Resolves to the signed-in account, or null if nobody is signed in.
export function initializeMsal() {
  if (!msalInstance) return Promise.resolve(null)
  if (!initPromise) {
    initPromise = (async () => {
      await msalInstance.initialize()

      // If we just came back from Microsoft's sign-in page, this reads the result.
      const result = await msalInstance.handleRedirectPromise()
      if (result?.account) {
        msalInstance.setActiveAccount(result.account)
      } else if (!msalInstance.getActiveAccount()) {
        // Page refresh: pick up the account MSAL cached in sessionStorage.
        const accounts = msalInstance.getAllAccounts()
        if (accounts.length > 0) msalInstance.setActiveAccount(accounts[0])
      }
      return msalInstance.getActiveAccount()
    })()
  }
  return initPromise
}
