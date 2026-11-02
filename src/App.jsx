import React, { useEffect, useState } from 'react'
import HomePage from './pages/HomePage'
import './App.css'
import LandingPage from './pages/LandingPage'
import CameraMirror from './pages/CameraMirror'
import DashboardPage from "./pages/DashboardPage"
import { AuthProvider, useAuth } from './contexts/AuthContext'
import AuthBar from './components/AuthBar'
import AuthDebug from './dev/AuthDebug'

// Signing in sends the browser to Microsoft and back, which reloads the app.
// Just before leaving we note which page the player was on, so they come back to it.
const RETURN_PAGE_KEY = 'pp.returnPage'
const RESTORABLE_PAGES = ['home', 'landing'] // the others need in-memory game state

const readReturnPage = () => {
  try {
    const saved = sessionStorage.getItem(RETURN_PAGE_KEY)
    return RESTORABLE_PAGES.includes(saved) ? saved : null
  } catch {
    return null // storage can be unavailable (private mode, blocked cookies)
  }
}

const writeReturnPage = (page) => {
  try {
    sessionStorage.setItem(RETURN_PAGE_KEY, page)
  } catch {
    /* not critical */
  }
}

const clearReturnPage = () => {
  try {
    sessionStorage.removeItem(RETURN_PAGE_KEY)
  } catch {
    /* not critical */
  }
}

function AppContent() {
  const { loading } = useAuth()
  const [currentPage, setCurrentPage] = useState(() => readReturnPage() || 'home')
  const [currentSessionId, setCurrentSessionId] = useState(null)
  const [analysisMetrics, setAnalysisMetrics] = useState(null)


  // The saved page has been used (it was read when the app started), so clear it.
  useEffect(() => {
    clearReturnPage()
  }, [])

  const rememberPageForRedirect = () => {
    if (RESTORABLE_PAGES.includes(currentPage)) writeReturnPage(currentPage)
  }

  // navigation helpers
  const openCoachingSession = () => {
    setCurrentPage('landing')
  }

  const handleStartAnalysis = (page, metricsData = null) => {
    // If called with 'dashboard', go directly to dashboard with metrics
    if (page === 'dashboard') {
      setAnalysisMetrics(metricsData)
      setCurrentPage('dashboard')
    } else {
      // Otherwise go to camera page (for old flow)
      setCurrentPage('camera')
    }
  }

  const backToLanding = () => {
    setCurrentPage('landing')
  }

  const backToHome = () => {
    setCurrentPage('home')
  }

  const goToDashboard = (sessionId = null) => {
    setCurrentSessionId(sessionId)
    setCurrentPage('dashboard')
  }


  if (loading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        fontSize: '18px',
        color: 'white',
        backgroundColor: '#1a1a1a'
      }}>
        Loading...
      </div>
    )
  }

  return (
    <div>
      {RESTORABLE_PAGES.includes(currentPage) && (
        <AuthBar onBeforeRedirect={rememberPageForRedirect} />
      )}

      {currentPage === 'home' && (
        <HomePage onNavigate={openCoachingSession} />
      )}

      {currentPage === 'landing' && (
        <LandingPage
          onNavigate={handleStartAnalysis}
          onBackToHome={backToHome}
        />
      )}

      {currentPage === 'camera' && (
        <CameraMirror
          onNavigate={backToLanding}
          onGoToDashboard={goToDashboard}
        />
      )}

      {currentPage === 'dashboard' && (
        <DashboardPage onNavigate={backToLanding} sessionId={currentSessionId} metricsData={analysisMetrics} />
      )}
    </div>
  )
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
      {import.meta.env.DEV && <AuthDebug />}
    </AuthProvider>
  )
}

export default App
