import React, { useState} from 'react'
import HomePage from './pages/HomePage'
import './App.css'
import LandingPage from './pages/LandingPage'
import CameraMirror from './pages/CameraMirror'
import LoginPage from './pages/LoginPage'
import DashboardPage from "./pages/DashboardPage"
import SignupPage from './pages/SignupPage'
import { AuthProvider, useAuth } from './contexts/AuthContext'

function AppContent() {
  const { user, loading } = useAuth() 
  const [currentPage, setCurrentPage] = useState('home')
  const [currentSessionId, setCurrentSessionId] = useState(null)
  const [analysisMetrics, setAnalysisMetrics] = useState(null)


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
    </AuthProvider>
  )
}

export default App
