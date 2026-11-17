import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Dev-only: puts seedSessionHistory() / clearSessionHistory() on window so a
// realistic training history can be generated from the browser console.
if (import.meta.env.DEV) {
  import('./devSeedSessions.js')
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
