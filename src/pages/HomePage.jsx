import React from 'react';

const HomePage = ({ onNavigate, onOpenSessions }) => {
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

  // Animated background overlay
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
    maxWidth: '900px',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  };

  const titleStyle = {
    fontSize: 'clamp(2.5rem, 5vw, 4.5rem)',
    fontWeight: '800',
    background: 'linear-gradient(135deg, #ff6b6b 0%, #ff8787 50%, #ff6b6b 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
    marginBottom: '1rem',
    textAlign: 'center',
    letterSpacing: '-1px',
    lineHeight: '1.1',
  };

  const subtitleStyle = {
    fontSize: 'clamp(1rem, 2vw, 1.3rem)',
    color: '#b0b0b8',
    marginBottom: '4rem',
    textAlign: 'center',
    fontWeight: '400',
    letterSpacing: '0.5px',
  };

  const buttonsContainerStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
    width: '100%',
    maxWidth: '500px',
  };

  const primaryButtonStyle = {
    backgroundColor: '#ff6b6b',
    color: 'white',
    border: 'none',
    borderRadius: '16px',
    padding: '24px 32px',
    fontSize: '1.1rem',
    fontWeight: '700',
    cursor: 'pointer',
    boxShadow: '0 8px 24px rgba(255, 107, 107, 0.35), 0 0 0 1px rgba(255, 255, 255, 0.05) inset',
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    textTransform: 'none',
    letterSpacing: '0.5px',
    position: 'relative',
    overflow: 'hidden',
    width: '100%',
    backdropFilter: 'blur(10px)',
  };

  const secondaryButtonStyle = {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    color: '#e0e0e8',
    border: '2px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '16px',
    padding: '24px 32px',
    fontSize: '1.1rem',
    fontWeight: '600',
    cursor: 'pointer',
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(255, 255, 255, 0.03) inset',
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    textTransform: 'none',
    letterSpacing: '0.5px',
    position: 'relative',
    overflow: 'hidden',
    width: '100%',
    backdropFilter: 'blur(10px)',
  };

  const buttonLabelStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
  };

  const handlePrimaryButtonHover = (e) => {
    e.target.style.backgroundColor = '#ff5252';
    e.target.style.transform = 'translateY(-4px) scale(1.02)';
    e.target.style.boxShadow = '0 12px 32px rgba(255, 107, 107, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.08) inset';
  };

  const handlePrimaryButtonLeave = (e) => {
    e.target.style.backgroundColor = '#ff6b6b';
    e.target.style.transform = 'translateY(0) scale(1)';
    e.target.style.boxShadow = '0 8px 24px rgba(255, 107, 107, 0.35), 0 0 0 1px rgba(255, 255, 255, 0.05) inset';
  };

  const handleSecondaryButtonHover = (e) => {
    e.target.style.backgroundColor = 'rgba(255, 255, 255, 0.08)';
    e.target.style.borderColor = 'rgba(255, 255, 255, 0.2)';
    e.target.style.color = '#ffffff';
    e.target.style.transform = 'translateY(-3px)';
    e.target.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.05) inset';
  };

  const handleSecondaryButtonLeave = (e) => {
    e.target.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
    e.target.style.borderColor = 'rgba(255, 255, 255, 0.1)';
    e.target.style.color = '#e0e0e8';
    e.target.style.transform = 'translateY(0)';
    e.target.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(255, 255, 255, 0.03) inset';
  };

  return (
    <div style={containerStyle}>
      <div style={backgroundOverlayStyle}></div>
      <div style={contentStyle}>
        <h1 style={titleStyle}>Perfect Punch</h1>
        <p style={subtitleStyle}>Advanced Boxing Analysis & Training</p>
        
        <div style={buttonsContainerStyle}>
          <button
            style={primaryButtonStyle}
            onClick={onNavigate}
            onMouseEnter={handlePrimaryButtonHover}
            onMouseLeave={handlePrimaryButtonLeave}
          >
            <div style={buttonLabelStyle}>
              <span>👊</span>
              <span>Open Coaching Session</span>
            </div>
          </button>
          <button
            style={secondaryButtonStyle}
            onMouseEnter={handleSecondaryButtonHover}
            onMouseLeave={handleSecondaryButtonLeave}
          >
            <div style={buttonLabelStyle}>
              <span>🎯</span>
              <span>Targeted Skill Session</span>
            </div>
          </button>

          <button
            style={secondaryButtonStyle}
            onMouseEnter={handleSecondaryButtonHover}
            onMouseLeave={handleSecondaryButtonLeave}
          >
            <div style={buttonLabelStyle}>
              <span>📚</span>
              <span>Tutorial Mode</span>
            </div>
          </button>

          <button
            style={secondaryButtonStyle}
            onClick={onOpenSessions}
            onMouseEnter={handleSecondaryButtonHover}
            onMouseLeave={handleSecondaryButtonLeave}
          >
            <div style={buttonLabelStyle}>
              <span>📊</span>
              <span>Your Sessions</span>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};

export default HomePage;