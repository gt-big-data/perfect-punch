import React from 'react';
import { useAuth } from '../contexts/AuthContext';
const LandingPage = ({ onNavigate, onBackToHome }) => {
  const { user } = useAuth();
  const fullName = user?.name || 'Fighter';
  const firstName = fullName.split(' ')[0];
  const containerStyle = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    width: '100vw',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    padding: '40px 20px',
    color: 'white',
    background: 'linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 25%, #16213e 50%, #1a1a2e 75%, #0a0a0f 100%)',
    position: 'relative',
    overflow: 'hidden',
  };

  const backgroundOverlayStyle = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'radial-gradient(circle at 20% 50%, rgba(255, 107, 107, 0.1) 0%, transparent 50%), radial-gradient(circle at 80% 80%, rgba(107, 142, 255, 0.08) 0%, transparent 50%)',
    pointerEvents: 'none',
  };

  const contentStyle = {
    position: 'relative',
    zIndex: 1,
    maxWidth: '700px',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
  };

  const greetingStyle = {
    fontSize: 'clamp(2.5rem, 5vw, 4rem)',
    fontWeight: '800',
    background: 'linear-gradient(135deg, #ff6b6b 0%, #ff8787 50%, #ff6b6b 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
    marginBottom: '1.5rem',
    textAlign: 'center',
    letterSpacing: '-1px',
    lineHeight: '1.1',
  };

  const welcomeStyle = {
    fontSize: 'clamp(1rem, 2vw, 1.3rem)',
    color: '#b0b0b8',
    marginBottom: '3.5rem',
    textAlign: 'center',
    fontWeight: '400',
    letterSpacing: '0.5px',
    lineHeight: '1.6',
  };

  const buttonStyle = {
    backgroundColor: '#ff6b6b',
    color: 'white',
    border: 'none',
    borderRadius: '16px',
    padding: '24px 48px',
    fontSize: '1.2rem',
    fontWeight: '700',
    cursor: 'pointer',
    boxShadow: '0 8px 24px rgba(255, 107, 107, 0.35), 0 0 0 1px rgba(255, 255, 255, 0.05) inset',
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    textTransform: 'none',
    letterSpacing: '0.5px',
    position: 'relative',
    overflow: 'hidden',
    backdropFilter: 'blur(10px)',
  };

  const handleButtonHover = (e) => {
    e.target.style.backgroundColor = '#ff5252';
    e.target.style.transform = 'translateY(-4px) scale(1.02)';
    e.target.style.boxShadow = '0 12px 32px rgba(255, 107, 107, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.08) inset';
  };

  const handleButtonLeave = (e) => {
    e.target.style.backgroundColor = '#ff6b6b';
    e.target.style.transform = 'translateY(0) scale(1)';
    e.target.style.boxShadow = '0 8px 24px rgba(255, 107, 107, 0.35), 0 0 0 1px rgba(255, 255, 255, 0.05) inset';
  };

  const backButtonStyle = {
    position: 'absolute',
    top: '20px',
    left: '20px',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    color: '#e0e0e8',
    border: '2px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '12px',
    padding: '14px 28px',
    fontSize: '1.05rem',
    fontWeight: '600',
    cursor: 'pointer',
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.2)',
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    textTransform: 'none',
    letterSpacing: '0.5px',
    backdropFilter: 'blur(10px)',
    zIndex: 10,
  };

  const handleBackButtonHover = (e) => {
    e.target.style.backgroundColor = 'rgba(255, 255, 255, 0.08)';
    e.target.style.borderColor = 'rgba(255, 255, 255, 0.2)';
    e.target.style.color = '#ffffff';
    e.target.style.transform = 'translateY(-2px)';
    e.target.style.boxShadow = '0 6px 20px rgba(0, 0, 0, 0.3)';
  };

  const handleBackButtonLeave = (e) => {
    e.target.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
    e.target.style.borderColor = 'rgba(255, 255, 255, 0.1)';
    e.target.style.color = '#e0e0e8';
    e.target.style.transform = 'translateY(0)';
    e.target.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.2)';
  };

  // CameraMirror captures the player's browser camera. The old analysis
  // endpoint launched a camera on the server and wrote shared session files.
  const handleStartAnalysis = () => onNavigate('camera');

  return (
    <div style={containerStyle}>
      <div style={backgroundOverlayStyle}></div>
      <button
        style={backButtonStyle}
        onClick={onBackToHome}
        onMouseEnter={handleBackButtonHover}
        onMouseLeave={handleBackButtonLeave}
      >
        ← Back to Home
      </button>
      <div style={contentStyle}>
        <h1 style={greetingStyle}>Welcome back, {firstName}</h1>
        <p style={welcomeStyle}>Ready to analyze your punches?</p>
        <button
          style={buttonStyle}
          onClick={handleStartAnalysis}
          onMouseEnter={handleButtonHover}
          onMouseLeave={handleButtonLeave}
        >
          Start Punch Analysis
        </button>
      </div>
    </div>
  );
};

export default LandingPage;
