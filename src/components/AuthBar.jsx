import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'

// Small account control for the top-right corner of the Home and Landing pages.
//   signed out:  [Sign in] [Create account]
//   signed in:   Hi, <first name>  [Sign out]
// Each button sends the browser to Microsoft's page (see AuthContext) and the app
// reloads afterwards. Nothing in the game requires signing in: guests can still
// play, and signing in is what lets sessions be saved to an account.
//
// `onBeforeRedirect` runs just before the browser leaves, so the app can remember
// which page the player was on.

const wrapStyle = {
  position: 'fixed',
  top: 16,
  right: 16,
  zIndex: 1000,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: 8,
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
}

const rowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 10px 8px 16px',
  borderRadius: 999,
  background: 'rgba(255, 255, 255, 0.06)',
  border: '1px solid rgba(255, 255, 255, 0.12)',
  backdropFilter: 'blur(8px)',
}

const baseButton = {
  borderRadius: 999,
  padding: '8px 16px',
  fontSize: '0.9rem',
  fontWeight: 600,
  cursor: 'pointer',
  lineHeight: 1.2,
}

const ghostButton = {
  ...baseButton,
  background: 'transparent',
  color: '#e0e0e8',
  border: '1px solid rgba(255, 255, 255, 0.25)',
}

const primaryButton = {
  ...baseButton,
  background: '#ff6b6b',
  color: '#ffffff',
  border: '1px solid #ff6b6b',
}

const greetingStyle = { color: '#e0e0e8', fontSize: '0.9rem', fontWeight: 600 }

const errorStyle = {
  maxWidth: 320,
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  padding: '8px 12px',
  borderRadius: 10,
  background: '#fdecec',
  color: '#a12626',
  border: '1px solid #f5c2c2',
  fontSize: '0.85rem',
}

export default function AuthBar({ onBeforeRedirect }) {
  const { user, isConfigured, authError, clearAuthError, login, signup, logout } = useAuth()
  const [busy, setBusy] = useState(false)

  // Come back to this page with the browser's Back button after leaving for
  // Microsoft's page? Then re-enable the buttons.
  useEffect(() => {
    const onPageShow = (event) => {
      if (event.persisted) setBusy(false)
    }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [])

  // No sign-in settings (for example, no .env.local): stay in guest mode quietly.
  if (!isConfigured) return null

  // Disabled while we are leaving for Microsoft's page. If something goes wrong
  // there is an error message, and the buttons work again in that same moment.
  const disabled = busy && !authError

  const dismissError = () => {
    setBusy(false)
    clearAuthError()
  }

  const run = (action) => async () => {
    setBusy(true)
    if (onBeforeRedirect) onBeforeRedirect()
    await action()
  }

  const firstName = user ? (user.name || user.email || 'player').split(' ')[0] : null

  return (
    <div style={wrapStyle} role="region" aria-label="Account">
      <div style={rowStyle}>
        {user ? (
          <>
            <span style={greetingStyle}>Hi, {firstName}</span>
            <button type="button" style={ghostButton} disabled={disabled} onClick={run(logout)}>
              Sign out
            </button>
          </>
        ) : (
          <>
            <button type="button" style={ghostButton} disabled={disabled} onClick={run(login)}>
              Sign in
            </button>
            <button type="button" style={primaryButton} disabled={disabled} onClick={run(signup)}>
              Create account
            </button>
          </>
        )}
      </div>
      {authError && (
        <div role="alert" style={errorStyle}>
          <span>{authError}</span>
          <button
            type="button"
            aria-label="Dismiss message"
            onClick={dismissError}
            style={{ background: 'none', border: 'none', color: '#a12626', cursor: 'pointer', fontSize: '1rem', lineHeight: 1 }}
          >
            ×
          </button>
        </div>
      )}
    </div>
  )
}
