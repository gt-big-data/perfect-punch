import React, { useState} from 'react'
import HomePage from './pages/HomePage'
import './App.css'
import LandingPage from './pages/LandingPage'
import CameraMirror from './pages/CameraMirror'
import LoginPage from './pages/LoginPage'
import DashboardPage from "./pages/DashboardPage"
import ProgressPage from "./pages/ProgressPage"
import SignupPage from './pages/SignupPage'
import { AuthProvider, useAuth } from './contexts/AuthContext'

function AppContent() {
  const { user, loading } = useAuth() 
  const [currentPage, setCurrentPage] = useState('dashboard')
  const [currentSessionId, setCurrentSessionId] = useState(null)
  const [analysisMetrics, setAnalysisMetrics] = useState(null)
  // Where the progress page was opened from, so its back button returns there
  // instead of always dropping the user on the dashboard.
  const [progressOrigin, setProgressOrigin] = useState('dashboard')


  // navigation helpers
  const goToSignup = () => {
    setCurrentPage('signup')
  }

  const handleLogin = () => {
    setCurrentPage('login')
  }

  const handleSignup = () => {
    setCurrentPage('signup')
  }

  const handleLoginSuccess = () => {
    setCurrentPage('landing')
  }

  const handleSignupSuccess = () => {
    setCurrentPage('login')
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

  const goToProgress = (origin = 'dashboard') => {
    setProgressOrigin(origin)
    setCurrentPage('progress')
  }

  // Returns to whichever page opened the progress view, on the same session
  // the user drilled into - the session id is deliberately left untouched.
  const backFromProgress = () => {
    setCurrentPage(progressOrigin)
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
      {currentPage === 'home' && (
        <HomePage onNavigate={handleLogin} />
      )}

      {currentPage === 'login' && (
        <LoginPage 
          onLoginSuccess={handleLoginSuccess} 
          onSignup={goToSignup}
        />
      )}

      {currentPage === 'signup' && (
        <SignupPage 
          onNavigate={backToHome} 
          onSignupSuccess={handleSignupSuccess} 
        />
      )}

      {currentPage === 'landing' && (
        <LandingPage 
          onNavigate={handleStartAnalysis} 
          onBackToHome={backToHome}
          onViewProgress={() => goToProgress('landing')}
        />
      )}

      {currentPage === 'camera' && (
        <CameraMirror 
          onNavigate={backToLanding} 
          onGoToDashboard={goToDashboard}
        />
      )}

      {currentPage === 'dashboard' && (
        <DashboardPage
          onNavigate={backToLanding}
          onViewProgress={goToProgress}
          sessionId={currentSessionId}
          metricsData={analysisMetrics}
        />
      )}

      {currentPage === 'progress' && (
        <ProgressPage
          onNavigate={backFromProgress}
          backLabel={progressOrigin === 'landing' ? '← Back to Home' : '← Back to Dashboard'}
          sessionId={currentSessionId}
          metricsData={analysisMetrics}
        />
      )}
    </div>
  )
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  )
}

export default App
