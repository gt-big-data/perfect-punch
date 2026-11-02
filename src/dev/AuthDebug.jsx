import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'

// TEMPORARY developer panel (shows only under `npm run dev`, never in a build).
// It lets you sign in and check what is inside the access token our API will receive.
// It never shows the token itself, only a summary of its claims.
// Delete this file, and its line in App.jsx, once card 5 (login pages) is done.

const apiScope = import.meta.env.VITE_API_SCOPE || ''

function decodePayload(token) {
  const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
  const bytes = Uint8Array.from(atob(part), (c) => c.charCodeAt(0))
  return JSON.parse(new TextDecoder().decode(bytes))
}

function buildChecks(claims) {
  const expectedAud = apiScope.replace(/^api:\/\//, '').split('/')[0]
  const scopeName = apiScope.split('/').pop()
  const tid = claims.tid
  const minutesLeft = claims.exp ? Math.round((claims.exp * 1000 - Date.now()) / 60000) : null
  return [
    { label: 'aud is the API app', ok: claims.aud === expectedAud, value: claims.aud },
    {
      label: 'iss uses the tenant id',
      ok: Boolean(tid) && claims.iss === `https://${tid}.ciamlogin.com/${tid}/v2.0`,
      value: claims.iss,
    },
    { label: 'ver is 2.0', ok: claims.ver === '2.0', value: claims.ver },
    {
      label: `scp contains ${scopeName}`,
      ok: String(claims.scp || '').split(' ').includes(scopeName),
      value: claims.scp,
    },
    { label: 'oid present', ok: Boolean(claims.oid), value: claims.oid ? 'yes' : 'missing' },
    { label: 'name present', ok: Boolean(claims.name), value: claims.name || 'missing' },
    { label: 'email present', ok: Boolean(claims.email), value: claims.email || 'missing' },
    { label: 'minutes until expiry', ok: minutesLeft > 0, value: minutesLeft },
  ]
}

export default function AuthDebug() {
  const { user, loading, authError, isConfigured, login, signup, logout, getAccessToken } = useAuth()
  const [checks, setChecks] = useState(null)
  const [message, setMessage] = useState('')

  const checkToken = async () => {
    setMessage('')
    setChecks(null)
    try {
      const token = await getAccessToken()
      if (!token) {
        setMessage('No token (not signed in, or being sent to Microsoft).')
        return
      }
      setChecks(buildChecks(decodePayload(token)))
    } catch (err) {
      setMessage(`Token request failed: ${err.errorCode || err.message}`)
    }
  }

  const box = {
    position: 'fixed', bottom: 12, right: 12, zIndex: 9999, width: 340, maxHeight: '80vh',
    overflow: 'auto', background: '#111', color: '#eee', border: '1px solid #555',
    borderRadius: 8, padding: 12, fontSize: 12, fontFamily: 'monospace',
  }
  const btn = { marginRight: 6, marginTop: 6, padding: '4px 8px', cursor: 'pointer' }

  return (
    <div style={box}>
      <strong>Auth debug (dev only)</strong>
      <div>configured: {String(isConfigured)} | loading: {String(loading)}</div>
      <div>user: {user ? `${user.name || '(no name)'} / ${user.email || '(no email)'}` : 'signed out'}</div>
      {authError && <div style={{ color: '#f88' }}>error: {authError}</div>}
      <div>
        <button style={btn} onClick={login}>Sign in</button>
        <button style={btn} onClick={signup}>Create account</button>
        <button style={btn} onClick={logout}>Sign out</button>
        <button style={btn} onClick={checkToken}>Check API token</button>
      </div>
      {message && <div style={{ marginTop: 6 }}>{message}</div>}
      {checks && (
        <table style={{ marginTop: 8, width: '100%' }}>
          <tbody>
            {checks.map((c) => (
              <tr key={c.label}>
                <td>{c.ok ? '✅' : '❌'}</td>
                <td>{c.label}</td>
                <td style={{ wordBreak: 'break-all' }}>{String(c.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
