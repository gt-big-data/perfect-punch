import React, { useEffect, useRef, useState } from 'react';
import { Pose } from '@mediapipe/pose';
import { Camera } from '@mediapipe/camera_utils';
import { useAuth } from '../contexts/AuthContext';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

const PUNCH_COLORS = {
  jab: '#FF0000',    // red
  hook: '#00FF00',   // green
  uppercut: '#0000FF' // blue
};

const buildHttpUrl = (path) => new URL(path, API_BASE_URL).toString();
const buildWsUrl = (path) => {
  const url = new URL(path, API_BASE_URL);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
};

export default function CameraMirror({ onNavigate, onGoToDashboard }) {
  const STREAM_WIDTH = 960;
  const STREAM_HEIGHT = 540;

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const wsRef = useRef(null);
  const statsIntervalRef = useRef(null);
  const sessionIdRef = useRef(null);
  const endedRef = useRef(false);
  
  const { user } = useAuth();
  const [sessionId, setSessionId] = useState(null);
  const [currentTarget, setCurrentTarget] = useState(null);
  const [score, setScore] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(30);
  const [preStartCountdown, setPreStartCountdown] = useState(3);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [gameData, setGameData] = useState({
    punchAttempts: [],
    targetsHit: 0,
    targetsSpawned: 0,
    startTime: null
  });

  const scoreRef = useRef(0);
  const gameDataRef = useRef({
    punchAttempts: [],
    targetsHit: 0,
    targetsSpawned: 0,
    startTime: null
  });
  const timeRef = useRef(30);
  const targetRef = useRef(null);
  const timerIntervalRef = useRef(null);
  const targetSpawnIntervalRef = useRef(null);
  const gameStartTimeRef = useRef(null);
  const isDemoModeRef = useRef(false);
  const hitTargetsRef = useRef(new Set());
  const landmarkBufferRef = useRef([]);
  
  useEffect(() => {
    scoreRef.current = score;
  }, [score]);

  useEffect(() => {
    gameDataRef.current = gameData;
  }, [gameData]);
  
  useEffect(() => {
    timeRef.current = timeRemaining;
  }, [timeRemaining]);
  
  useEffect(() => {
    targetRef.current = currentTarget;
  }, [currentTarget]);

  useEffect(() => {
    isDemoModeRef.current = isDemoMode;
  }, [isDemoMode]);
  
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);
  
  useEffect(() => {
    if (sessionId && timeRemaining === 0 && !endedRef.current) {
      endedRef.current = true;
      endGame();
    }
  }, [timeRemaining, sessionId]);
  
  // Initialize game session
  useEffect(() => {
    let isCancelled = false;

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const runPreStartCountdown = async () => {
      for (let count = 3; count >= 1; count -= 1) {
        if (isCancelled) return false;
        setPreStartCountdown(count);
        await sleep(1000);
      }

      if (isCancelled) return false;
      setPreStartCountdown(null);
      return true;
    };

    const initializeLiveSession = async () => {
      if (!API_BASE_URL) {
        return { mode: 'demo' };
      }

      try {
        const createResponse = await fetch(buildHttpUrl('/game/sessions'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            user_id: user?.id ?? 'demo-user',
            duration_seconds: 30,
          }),
        });

        if (!createResponse.ok) {
          throw new Error('Failed to create game session');
        }

        const session = await createResponse.json();
        setSessionId(session.session_id);
        setScore(session.score ?? 0);
        setTimeRemaining(session.duration_seconds ?? 30);
        setCurrentTarget(null);
        landmarkBufferRef.current = [];

        const startResponse = await fetch(buildHttpUrl(`/game/sessions/${session.session_id}/start`), {
          method: 'POST',
        });

        if (!startResponse.ok) {
          throw new Error('Failed to start game session');
        }

        const ws = new WebSocket(buildWsUrl(`/game/sessions/${session.session_id}/ws`));
        wsRef.current = ws;

        ws.onopen = () => {
          if (statsIntervalRef.current) {
            clearInterval(statsIntervalRef.current);
            statsIntervalRef.current = null;
          }
          statsIntervalRef.current = setInterval(() => {
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ type: 'request_stats' }));
            }
          }, 1000);
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'request_stats' }));
          }
        };

        ws.onmessage = (event) => {
          const message = JSON.parse(event.data);
          const { type, data } = message;

          const applyStats = (stats) => {
            if (!stats) return;
            setScore(Math.round(stats.score ?? 0));
            setTimeRemaining(Math.max(0, Math.ceil(stats.remaining_time ?? 0)));
          };

          switch (type) {
            case 'target_spawn':
              if (data) {
                setCurrentTarget({
                  x: data.center_x,
                  y: data.center_y,
                  radius: data.radius,
                  type: data.target_type,
                });
              }
              break;
            case 'punch_result':
              // Detailed result logging can help debugging in dev
              console.log('Punch result', data);
              break;
            case 'stats_update':
            case 'session_state':
            case 'session_started':
            case 'session_resumed':
            case 'session_paused':
              applyStats(data);
              break;
            case 'session_ended':
            case 'session_expired':
              applyStats(data);
              setCurrentTarget(null);
              endedRef.current = true;
              onGoToDashboard(sessionId);
              break;
            default:
              console.debug('Unhandled game message', message);
          }
        };

        ws.onerror = (err) => {
          console.error('WebSocket error', err);
        };
        
        ws.onclose = () => {
          if (statsIntervalRef.current) {
            clearInterval(statsIntervalRef.current);
            statsIntervalRef.current = null;
          }
        };

        return { mode: 'live' };
      } catch (error) {
        console.warn('Backend not available, starting demo mode:', error);
        return { mode: 'demo' };
      }
    };

    const startDemoMode = () => {
      const demoSessionId = `demo-${Date.now()}`;
      const startedAt = Date.now();
      const initialGameData = {
        punchAttempts: [],
        targetsHit: 0,
        targetsSpawned: 0,
        startTime: startedAt
      };
      sessionIdRef.current = demoSessionId;
      isDemoModeRef.current = true;
      gameDataRef.current = initialGameData;
      gameStartTimeRef.current = startedAt;
      setSessionId(demoSessionId);
      setIsDemoMode(true);
      setScore(0);
      scoreRef.current = 0;
      setTimeRemaining(30);
      setCurrentTarget(null);
      landmarkBufferRef.current = [];
      hitTargetsRef.current.clear();
      setGameData(initialGameData);
      startDemoGame();
    };

    const startGame = async () => {
      // Run countdown and backend session setup in parallel to reduce perceived startup delay.
      const [shouldContinue, initResult] = await Promise.all([
        runPreStartCountdown(),
        initializeLiveSession()
      ]);

      if (!shouldContinue || isCancelled) return;
      if (initResult?.mode === 'demo') {
        startDemoMode();
      }
    };
    
    startGame();
    
    return () => {
      isCancelled = true;
      if (wsRef.current) {
        wsRef.current.close();
      }
      // Clean up demo timers
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
      if (targetSpawnIntervalRef.current) {
        clearInterval(targetSpawnIntervalRef.current);
      }
      if (statsIntervalRef.current) {
        clearInterval(statsIntervalRef.current);
        statsIntervalRef.current = null;
      }
    };
  }, [user]);
  
  // Demo game logic - timer and target spawning
  const startDemoGame = () => {
    // Start countdown timer
    timerIntervalRef.current = setInterval(() => {
      setTimeRemaining((prev) => {
        const newTime = Math.max(0, prev - 1);
        if (newTime === 0) {
          clearInterval(timerIntervalRef.current);
          // Auto-end game when timer reaches 0
          setTimeout(() => endGame(), 1000);
        }
        return newTime;
      });
    }, 1000);

    // Spawn targets periodically
    const spawnTarget = () => {
      if (!canvasRef.current) return;
      
      const canvas = canvasRef.current;
      const targetTypes = ['jab', 'hook', 'uppercut'];
      const randomType = targetTypes[Math.floor(Math.random() * targetTypes.length)];
      
      // Random position on canvas (avoid edges)
      const x = Math.random() * (canvas.width - 200) + 100;
      const y = Math.random() * (canvas.height - 200) + 100;
      const radius = 30;
      
      const newTarget = {
        x,
        y,
        radius,
        type: randomType,
        spawnTime: Date.now()
      };
      setCurrentTarget(newTarget);
      targetRef.current = newTarget;
      
      setGameData(prev => ({
        ...prev,
        targetsSpawned: prev.targetsSpawned + 1
      }));

      // Remove target after 3 seconds if not hit
      setTimeout(() => {
        setCurrentTarget((current) => {
          if (current && current.x === x && current.y === y) {
            return null;
          }
          return current;
        });
      }, 3000);
    };

    // Spawn first target after 1 second
    setTimeout(spawnTarget, 1000);
    
    // Spawn targets every 2-4 seconds
    targetSpawnIntervalRef.current = setInterval(() => {
      if (timeRef.current > 0) {
        spawnTarget();
      }
    }, 3000);
  };

  // Handle target hits in demo mode
  const checkTargetHit = (landmarks) => {
    const activeTarget = targetRef.current;
    if (!activeTarget || !canvasRef.current || !isDemoModeRef.current) return;
    
    // Create a unique key for this target to prevent double-hits
    const targetKey = `${activeTarget.x}-${activeTarget.y}-${activeTarget.spawnTime}`;
    if (hitTargetsRef.current.has(targetKey)) {
      return; // Already hit this target
    }
    
    const canvas = canvasRef.current;
    // Check if wrists are near target
    const wristIndices = [15, 16]; // Left and right wrists
    
    for (const wristIdx of wristIndices) {
      if (landmarks[wristIdx] && landmarks[wristIdx].visibility > 0.5) {
        const wristX = landmarks[wristIdx].x * canvas.width;
        const wristY = landmarks[wristIdx].y * canvas.height;
        
        const distance = Math.sqrt(
          Math.pow(wristX - activeTarget.x, 2) + 
          Math.pow(wristY - activeTarget.y, 2)
        );
        
        // If wrist is within target radius
        if (distance < activeTarget.radius + 50) {
          // Mark this target as hit
          hitTargetsRef.current.add(targetKey);
          
          // Hit! Increase score
          const newScore = scoreRef.current + 10;
          setScore(newScore);
          scoreRef.current = newScore;
          
          console.log('Target hit! Score:', newScore, 'Target type:', activeTarget.type);
          
          setGameData((prev) => ({
            ...prev,
            targetsHit: prev.targetsHit + 1,
            punchAttempts: [
              ...prev.punchAttempts,
              {
                type: activeTarget.type,
                timestamp: Date.now(),
                wasCorrect: true,
                responseTime: Date.now() - (activeTarget.spawnTime || Date.now())
              }
            ]
          }));
          
          // Remove target immediately
          setCurrentTarget(null);
          targetRef.current = null;
          
          // Spawn new target after short delay
          setTimeout(() => {
            if (timeRef.current > 0 && canvasRef.current) {
              const canvas = canvasRef.current;
              const targetTypes = ['jab', 'hook', 'uppercut'];
              const randomType = targetTypes[Math.floor(Math.random() * targetTypes.length)];
              const x = Math.random() * (canvas.width - 200) + 100;
              const y = Math.random() * (canvas.height - 200) + 100;
              const newTarget = {
                x,
                y,
                radius: 30,
                type: randomType,
                spawnTime: Date.now()
              };
              setCurrentTarget(newTarget);
              targetRef.current = newTarget;
              setGameData(prev => ({
                ...prev,
                targetsSpawned: prev.targetsSpawned + 1
              }));
            }
          }, 800);
          
          break;
        }
      }
    }
  };

  // MediaPipe Pose Detection - Start camera regardless of sessionId
  useEffect(() => {
    if (!videoRef.current || !canvasRef.current) return;
    
    const pose = new Pose({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
    });
    
    pose.setOptions({
      modelComplexity: 0,
      smoothLandmarks: true,
      minDetectionConfidence: 0.45,
      minTrackingConfidence: 0.45
    });
    
    pose.onResults((results) => {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      
      // Draw video frame
      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
      
      // Draw pose landmarks
      if (results.poseLandmarks) {
        drawLandmarks(ctx, results.poseLandmarks);
        
        const normalized = extractLandmarks(results.poseLandmarks, canvas.width, canvas.height);
        const serializedLandmarks = serializeLandmarks(results.poseLandmarks);
        
        {
          const newBuffer = [...landmarkBufferRef.current, normalized].slice(-15);
          landmarkBufferRef.current = newBuffer;

          const normalizedBuffer = (() => {
            const names = ['RIGHT_ELBOW','RIGHT_WRIST','LEFT_ELBOW','LEFT_WRIST'];
            if (newBuffer.length === 0) return [];
            const base = names.map((n, i) => [newBuffer[0].landmarks[n].x, newBuffer[0].landmarks[n].y]);
            const rel = newBuffer.map(rec => names.map((n, i) => {
              const p = rec.landmarks[n];
              return [p.x - base[i][0], p.y - base[i][1]];
            }));
            let maxD = 0;
            for (const frame of rel) {
              for (const [x, y] of frame) {
                const d = Math.hypot(x, y);
                if (d > maxD) maxD = d;
              }
            }
            if (maxD > 0) {
              for (const frame of rel) {
                for (const pt of frame) {
                  pt[0] /= maxD;
                  pt[1] /= maxD;
                }
              }
            }
            return rel.map(frame => ({
              landmarks: Object.fromEntries(names.map((n, i) => [n, { x: frame[i][0], y: frame[i][1] }]))
            }));
          })();

          // Check for target hits in demo mode
          if (isDemoModeRef.current) {
            checkTargetHit(results.poseLandmarks);
          }

          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && sessionId && !sessionId.startsWith('demo-')) {
            wsRef.current.send(JSON.stringify({
              type: 'pose_data',
              data: {
                landmarks: serializedLandmarks,
                frame_width: canvas.width,
                frame_height: canvas.height,
                pose_coordinates: normalizedBuffer,
              },
            }));
          }
        }
      }
      
      const activeTarget = targetRef.current;
      if (activeTarget) {
        ctx.fillStyle = PUNCH_COLORS[activeTarget.type] || '#FFFFFF';
        ctx.beginPath();
        ctx.arc(activeTarget.x, activeTarget.y, activeTarget.radius, 0, 2 * Math.PI);
        ctx.fill();
        
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 16px Arial';
        ctx.fillText(activeTarget.type.toUpperCase(), activeTarget.x - 20, activeTarget.y - 35);
      }
      
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 24px Arial';
      ctx.fillText(`Score: ${scoreRef.current}`, 10, 30);
      ctx.fillText(`Time: ${timeRef.current}s`, canvas.width - 120, 30);
      
      // Debug: Show if demo mode is active
      if (isDemoModeRef.current) {
        ctx.fillStyle = '#00FF00';
        ctx.font = '12px Arial';
        ctx.fillText('DEMO MODE', 10, canvas.height - 10);
      }
      
      ctx.restore();
    });
    
    const camera = new Camera(videoRef.current, {
      onFrame: async () => {
        await pose.send({ image: videoRef.current });
      },
      width: STREAM_WIDTH,
      height: STREAM_HEIGHT
    });
    
    camera.start();
    
    return () => {
      camera.stop();
    };
  }, []); // Run once on mount, camera should start regardless of sessionId
  
  const calculatePunchAccuracy = () => {
    const attempts = gameDataRef.current.punchAttempts;
    const byType = { jab: [], hook: [], uppercut: [] };
    
    attempts.forEach(attempt => {
      if (byType[attempt.type]) {
        byType[attempt.type].push(attempt);
      }
    });
    
    return {
      jab: byType.jab.length > 0
        ? Math.round((byType.jab.filter(a => a.wasCorrect).length / byType.jab.length) * 100)
        : 0,
      hook: byType.hook.length > 0
        ? Math.round((byType.hook.filter(a => a.wasCorrect).length / byType.hook.length) * 100)
        : 0,
      uppercut: byType.uppercut.length > 0
        ? Math.round((byType.uppercut.filter(a => a.wasCorrect).length / byType.uppercut.length) * 100)
        : 0
    };
  };

  const calculateReactionTimes = () => {
    const attempts = gameDataRef.current.punchAttempts;
    const byType = { jab: [], hook: [], uppercut: [] };
    
    attempts.forEach(attempt => {
      if (byType[attempt.type] && attempt.responseTime) {
        byType[attempt.type].push(attempt.responseTime);
      }
    });
    
    const avg = (arr) => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 250;
    
    return {
      jab: avg(byType.jab),
      hook: avg(byType.hook),
      uppercut: avg(byType.uppercut)
    };
  };

  const generateTimeline = () => {
    const elapsed = gameStartTimeRef.current ? (Date.now() - gameStartTimeRef.current) / 1000 : 30;
    const intervals = 5;
    const intervalDuration = elapsed / intervals;
    const timeline = [];
    const attempts = gameDataRef.current.punchAttempts;
    
    for (let i = 0; i < intervals; i++) {
      const intervalStart = i * intervalDuration;
      const intervalEnd = (i + 1) * intervalDuration;
      const intervalAttempts = attempts.filter(a => {
        const attemptTime = (a.timestamp - gameStartTimeRef.current) / 1000;
        return attemptTime >= intervalStart && attemptTime < intervalEnd;
      });
      
      const accuracy = intervalAttempts.length > 0
        ? Math.round((intervalAttempts.filter(a => a.wasCorrect).length / intervalAttempts.length) * 100)
        : 0;
      
      timeline.push({
        t: Math.round((i + 1) * intervalDuration),
        velocity: 5.0 + (intervalAttempts.length * 0.2),
        accuracy: accuracy
      });
    }
    
    return timeline;
  };

  const endGame = async () => {
    // Stop demo timers
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
    }
    if (targetSpawnIntervalRef.current) {
      clearInterval(targetSpawnIntervalRef.current);
    }
    
    const activeSessionId = sessionIdRef.current;

    // Store demo game data in localStorage for dashboard
    if (isDemoModeRef.current && activeSessionId) {
      const finalScore = scoreRef.current;
      const finalGameData = gameDataRef.current;
      
      console.log('Saving demo session data:', {
        sessionId: activeSessionId,
        finalScore,
        targetsHit: finalGameData.targetsHit,
        targetsSpawned: finalGameData.targetsSpawned,
        punchAttempts: finalGameData.punchAttempts.length
      });
      
      const demoSessionData = {
        session_id: activeSessionId,
        timestamp: new Date().toISOString(),
        summary: {
          score: finalScore,
          avg_velocity: 5.5 + (finalScore * 0.1),
          avg_reaction_time: finalGameData.punchAttempts.length > 0
            ? Math.round(finalGameData.punchAttempts.reduce((sum, p) => sum + (p.responseTime || 0), 0) / finalGameData.punchAttempts.length)
            : 250,
          accuracy: finalGameData.punchAttempts.length > 0
            ? Math.round((finalGameData.punchAttempts.filter(p => p.wasCorrect).length / finalGameData.punchAttempts.length) * 100)
            : 0,
          critical_prevention: finalGameData.targetsSpawned > 0
            ? Math.round((finalGameData.targetsHit / finalGameData.targetsSpawned) * 100)
            : 0,
          total_punches: finalGameData.punchAttempts.length
        },
        punch_accuracy: calculatePunchAccuracy(),
        reaction_times: calculateReactionTimes(),
        defense: {
          blocked: 0,
          dodged: finalGameData.targetsSpawned - finalGameData.targetsHit,
          hit: finalGameData.targetsHit
        },
        timeline: generateTimeline()
      };
      
      localStorage.setItem(`demo_session_${activeSessionId}`, JSON.stringify(demoSessionData));
      console.log('✅ Demo session data saved to localStorage:', demoSessionData);
      console.log('📊 Score saved:', finalScore, 'Targets hit:', finalGameData.targetsHit);
    }
    
    // Close WebSocket if open
    if (wsRef.current) {
      wsRef.current.close();
    }
    
    // Try to end session on backend (optional, don't block navigation)
    if (API_BASE_URL && activeSessionId && !activeSessionId.startsWith('demo-')) {
      try {
        const response = await fetch(buildHttpUrl(`/game/sessions/${activeSessionId}/end`), {
          method: 'POST',
        });
        
        if (response.ok) {
          const stats = await response.json();
          setScore(stats.final_stats?.score ?? 0);
          setTimeRemaining(0);
        }
      } catch (error) {
        console.warn('Failed to end game on backend, navigating anyway:', error);
      }
    }
    
    // Always navigate to dashboard, regardless of sessionId or backend status
    setCurrentTarget(null);
    setTimeRemaining(0);
    console.log('Navigating to dashboard with sessionId:', activeSessionId);
    onGoToDashboard(activeSessionId || null);
  };
  
  const extractLandmarks = (landmarks, width, height) => {
    const selected = [
      { idx: 14, name: 'RIGHT_ELBOW' },
      { idx: 16, name: 'RIGHT_WRIST' },
      { idx: 13, name: 'LEFT_ELBOW' },
      { idx: 15, name: 'LEFT_WRIST' },
    ];
    const extracted = {};
    selected.forEach(({ idx, name }) => {
      const lm = landmarks[idx];
      extracted[name] = {
        x: lm.x * width,
        y: lm.y * height,
      };
    });
    return { landmarks: extracted };
  };

  const serializeLandmarks = (landmarks) => (
    landmarks?.map((lm) => ({
      x: lm.x,
      y: lm.y,
      z: lm.z,
      visibility: lm.visibility,
    })) ?? []
  );
  
  const drawLandmarks = (ctx, landmarks) => {
    // Draw pose skeleton
    ctx.strokeStyle = '#00FF00';
    ctx.lineWidth = 2;
    
    // Draw connections (simplified)
    const connections = [
      [11, 13], [13, 15], // Left arm
      [12, 14], [14, 16], // Right arm
    ];
    
    connections.forEach(([start, end]) => {
      const startLm = landmarks[start];
      const endLm = landmarks[end];
      
      ctx.beginPath();
      ctx.moveTo(startLm.x * ctx.canvas.width, startLm.y * ctx.canvas.height);
      ctx.lineTo(endLm.x * ctx.canvas.width, endLm.y * ctx.canvas.height);
      ctx.stroke();
    });
  };
  
  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', background: '#000' }}>
      <video 
        ref={videoRef} 
        style={{ display: 'none' }}
        autoPlay
        playsInline
        muted
      />
      <canvas 
        ref={canvasRef} 
        width={STREAM_WIDTH} 
        height={STREAM_HEIGHT}
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
      />
      {preStartCountdown !== null && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 20,
            pointerEvents: 'none'
          }}
        >
          <div
            style={{
              color: '#FFFFFF',
              fontSize: 'clamp(96px, 20vw, 260px)',
              fontWeight: 800,
              lineHeight: 1,
              textShadow: '0 8px 24px rgba(0, 0, 0, 0.65)'
            }}
          >
            {preStartCountdown}
          </div>
        </div>
      )}
      <button 
        onClick={endGame}
        style={{
          position: 'absolute',
          bottom: 20,
          right: 20,
          padding: '10px 20px',
          background: '#FF0000',
          color: '#FFF',
          border: 'none',
          borderRadius: 5,
          cursor: 'pointer',
          zIndex: 10
        }}
      >
        End Game
      </button>
    </div>
  );
}
