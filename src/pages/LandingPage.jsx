import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
const LandingPage = ({ onNavigate, onBackToHome }) => {
  const { user } = useAuth();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState(null);
  const fullName = user?.user_metadata?.full_name || 'Fighter';
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

  const handleStartAnalysis = async () => {
    setIsAnalyzing(true);
    setError(null);

    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;
    if (!apiBaseUrl) {
      onNavigate('camera');
      setIsAnalyzing(false);
      return;
    }

    try {
      const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/analysis/start`, {
        method: 'POST',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Analysis failed');
      }

      const data = await response.json();
      console.log('Analysis completed:', data);
      
      // Transform metrics data into dashboard format
      const metricsArray = data.metrics || [];
      console.log('📊 metricsArray:', metricsArray);
      
      const transformedMetrics = metricsArray.map(session => {
        const metrics = session.metrics;
        const offenseMetrics = metrics.offense;
        const defenseMetrics = metrics.defense;
        const miscMetrics = metrics.miscellaneous;
        
        // Extract the accuracy data
        const punchAccuracy = offenseMetrics.punch_accuracy;
        const reactionTime = offenseMetrics.punch_reaction_time;
        const punchSpeed = offenseMetrics.punch_speed;
        
        // Use the actual punches_thrown count from the session
        const totalPunches = session.punches_thrown || 0;
        const correctPunches = session.correct_punches || 0;
        
        // Calculate score: (correct_punches / total_punches) * 100
        const accuracyPercent = totalPunches > 0 ? Math.round((correctPunches / totalPunches) * 100 * 10) / 10 : 0;
        
        // Convert punch speed from px/s to m/s (assuming ~100 px = 1 meter for gesture tracking)
        // Handle null values gracefully
        const speedValue = punchSpeed?.derived?.average || 0;
        const avgVelocityMs = speedValue > 0 ? Math.round((speedValue / 100) * 100) / 100 : 0;
        
        // Get critical prevention from punches_avoided percentage
        const criticalPrevention = defenseMetrics?.punches_avoided?.value ?? 0;
        
        // Get defense breakdown from flying_blocks
        const defenseBreakdown = miscMetrics?.flying_blocks_summary?.values || { blocked: 0, dodged: 0, hit: 0 };
        
        // Get reaction time values, handling nulls
        const reactionTimeBest = reactionTime?.derived?.best || reactionTime?.derived?.average || 250;
        const reactionTimeJab = reactionTime?.types?.jab || 250;
        const reactionTimeHook = reactionTime?.types?.hook || 250;
        const reactionTimeUppercut = reactionTime?.types?.uppercut || 250;
        
        // Get punch accuracy values, handling nulls
        const accuracyJab = punchAccuracy?.types?.jab || 0;
        const accuracyHook = punchAccuracy?.types?.hook || 0;
        const accuracyUppercut = punchAccuracy?.types?.uppercut || 0;
        
        // Get punch speed values, handling nulls
        const speedJab = punchSpeed?.types?.jab || 0;
        const speedHook = punchSpeed?.types?.hook || 0;
        const speedUppercut = punchSpeed?.types?.uppercut || 0;

        const transformed = {
          session_id: session.session_id,
          fighter_id: session.fighter_id,
          timestamp: session.timestamp,
          summary: {
            score: correctPunches,  // Just the count, not percentage
            avg_velocity: avgVelocityMs,  // in m/s
            avg_reaction_time: Math.round(reactionTimeBest),
            accuracy: accuracyPercent,  // Overall accuracy percentage
            critical_prevention: criticalPrevention,  // % of punches avoided
            total_punches: totalPunches
          },
          punch_accuracy: {
            jab: accuracyJab,
            hook: accuracyHook,
            uppercut: accuracyUppercut
          },
          reaction_times: {
            jab: Math.round(reactionTimeJab),
            hook: Math.round(reactionTimeHook),
            uppercut: Math.round(reactionTimeUppercut)
          },
          defense: defenseBreakdown,  // blocked, dodged, hit counts
          punch_speed: {
            jab: speedJab,
            hook: speedHook,
            uppercut: speedUppercut
          },
          timeline: []
        };
        
        console.log('✅ Transformed single session:', transformed);
        return transformed;
      });
      
      console.log('✅ All transformedMetrics:', transformedMetrics);
      
      // Navigate to dashboard after successful analysis
      onNavigate('dashboard', transformedMetrics);
    } catch (err) {
      console.error('Error starting analysis:', err);
      const message = err?.message || '';
      const backendDown =
        err instanceof TypeError ||
        /failed to fetch|networkerror|load failed/i.test(message);
      if (backendDown) {
        onNavigate('camera');
        return;
      }
      setError(message || 'Failed to start analysis. Make sure the backend is running.');
    } finally {
      setIsAnalyzing(false);
    }
  };

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
          style={{
            ...buttonStyle,
            opacity: isAnalyzing ? 0.7 : 1,
            cursor: isAnalyzing ? 'not-allowed' : 'pointer',
          }}
          onClick={handleStartAnalysis}
          onMouseEnter={!isAnalyzing ? handleButtonHover : null}
          onMouseLeave={!isAnalyzing ? handleButtonLeave : null}
          disabled={isAnalyzing}
        >
          {isAnalyzing ? 'Analyzing... (Check Camera Window)' : 'Start Punch Analysis'}
        </button>
        {error && (
          <p style={{ color: '#ff6b6b', marginTop: '20px', fontSize: '0.95rem', textAlign: 'center' }}>
            ❌ {error}
          </p>
        )}
      </div>
    </div>
  );
};

export default LandingPage;
