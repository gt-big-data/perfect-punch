import React, { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

const DashboardPage = ({ onNavigate, sessionId = null, metricsData = null }) => {
  const [sessionData, setSessionData] = useState(null);
  const [loading, setLoading] = useState(true);

  // ---------------------------------------------------------
  // 🚀 FETCH REAL SESSION DATA (METRICS FIRST, THEN LOCALSTORAGE, THEN API)
  // ---------------------------------------------------------
  useEffect(() => {
    setLoading(true);

    async function fetchData() {
      console.log("🔍 Fetching session data...", { sessionId, metricsData });

      // 0️⃣ FIRST: Check if metrics were passed directly from analysis
      if (metricsData) {
        try {
          console.log("✅ Using metrics data from analysis:", metricsData);
          // The metrics data from the analysis is already transformed
          const metrics = Array.isArray(metricsData) ? metricsData[0] : metricsData;
          console.log("📊 Transformed metrics structure:", {
            hasSession: !!metrics.session_id,
            hasSummary: !!metrics.summary,
            hasPunchAccuracy: !!metrics.punch_accuracy,
            hasReactionTimes: !!metrics.reaction_times,
            hasDefense: !!metrics.defense
          });
          setSessionData(metrics);
          setLoading(false);
          return;
        } catch (err) {
          console.error("❌ Error processing metrics data:", err);
        }
      }

      // 1️⃣ THEN: Try loading from localStorage (for demo sessions)
      if (sessionId && sessionId.startsWith('demo-')) {
        try {
          const storedKey = `demo_session_${sessionId}`;
          const storedData = localStorage.getItem(storedKey);
          
          if (storedData) {
            const data = JSON.parse(storedData);
            console.log("✅ Loaded demo session from localStorage:", data.session_id);
            console.log("📊 Session data structure:", {
              hasSummary: !!data.summary,
              hasPunchAccuracy: !!data.punch_accuracy,
              hasReactionTimes: !!data.reaction_times,
              hasDefense: !!data.defense,
              hasTimeline: !!data.timeline,
              timelineLength: data.timeline?.length || 0
            });
            setSessionData(data);
            setLoading(false);
            return;
          } else {
            console.warn("⚠️ Demo session not found in localStorage:", storedKey);
          }
        } catch (error) {
          console.error("❌ Error loading from localStorage:", error);
        }
      }

      // 2️⃣ SECOND: If no sessionId provided, check for latest demo session
      if (!sessionId) {
        try {
          const demoKeys = Object.keys(localStorage).filter(k => k.startsWith('demo_session_'));
          if (demoKeys.length > 0) {
            // Load all sessions and sort by timestamp (newest first)
            const sessions = demoKeys.map(key => {
              try {
                const storedData = localStorage.getItem(key);
                if (storedData) {
                  const data = JSON.parse(storedData);
                  return {
                    key,
                    data,
                    timestamp: data.timestamp ? new Date(data.timestamp).getTime() : 0
                  };
                }
              } catch (e) {
                console.error(`Error parsing session ${key}:`, e);
              }
              return null;
            }).filter(s => s !== null);
            
            // Sort by timestamp descending (newest first)
            sessions.sort((a, b) => b.timestamp - a.timestamp);
            
            if (sessions.length > 0) {
              const latestSession = sessions[0].data;
              console.log("✅ Loaded latest demo session from localStorage:", latestSession.session_id);
              console.log("📊 Session timestamp:", latestSession.timestamp);
              console.log("📊 Session data structure:", {
                hasSummary: !!latestSession.summary,
                hasPunchAccuracy: !!latestSession.punch_accuracy,
                hasReactionTimes: !!latestSession.reaction_times,
                hasDefense: !!latestSession.defense,
                hasTimeline: !!latestSession.timeline,
                timelineLength: latestSession.timeline?.length || 0,
                score: latestSession.summary?.score,
                totalPunches: latestSession.summary?.total_punches
              });
              setSessionData(latestSession);
              setLoading(false);
              return;
            }
          }
        } catch (error) {
          console.error("❌ Error loading latest demo session:", error);
        }
      }

      // 3️⃣ THIRD: Try API endpoint when a backend URL is configured
      const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
      if (!API_BASE_URL) {
        setSessionData(null);
        setLoading(false);
        return;
      }

      try {

        let url = `${API_BASE_URL}/session/latest`;
        if (sessionId) {
          url += `?session_id=${encodeURIComponent(sessionId)}`;
        }

        const response = await fetch(url, { cache: "no-store" });

        if (!response.ok) {
          throw new Error(`Backend error: ${response.status}`);
        }

        const data = await response.json();
        console.log("📊 LOADED SESSION FROM API:", data);

        // Accept demo_001 as fallback if no real data is available
        // This allows the dashboard to display something while waiting for real game data
        if (data.session_id === "demo_001") {
          console.warn("⚠️ Backend returned demo data - this is fallback data. Play a game to see your real session data.");
        }

        setSessionData(data);
      } catch (error) {
        console.error("❌ Failed to load session data:", error);
        setSessionData(null);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [sessionId, metricsData]);

  // ---------------------------------------------------------
  // ⚠️ LOADING OR ERROR STATES
  // ---------------------------------------------------------
  if (loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          color: "white",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background:
            "linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 25%, #16213e 50%, #1a1a2e 75%, #0a0a0f 100%)",
        }}
      >
        <div style={{ fontSize: "1.5rem", color: "#b0b0b8" }}>
          Loading dashboard...
        </div>
      </div>
    );
  }

  if (!sessionData) {
    return (
      <div
        style={{
          minHeight: "100vh",
          color: "white",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: "24px",
          background:
            "linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 25%, #16213e 50%, #1a1a2e 75%, #0a0a0f 100%)",
        }}
      >
        <div style={{ fontSize: "1.5rem", fontWeight: "700", textAlign: "center", color: "#ff6b6b" }}>
          ⚠️ Using static data - play a new game to see your data
        </div>
        <div style={{ fontSize: "1.125rem", textAlign: "center", maxWidth: "600px", color: "#b0b0b8" }}>
          No session data found. To see your real game data:
          <ol style={{ marginTop: "16px", paddingLeft: "20px", textAlign: "left", listStyleType: "decimal" }}>
            <li>Go to the Landing page</li>
            <li>Click "Start Analysis" to play a game</li>
            <li>Hit some targets and click "End Game"</li>
            <li>Your data will appear here automatically</li>
          </ol>
        </div>
        <button
          onClick={() => onNavigate("landing")}
          style={{
            backgroundColor: "#ff6b6b",
            color: "white",
            border: "none",
            borderRadius: "16px",
            padding: "12px 24px",
            fontSize: "1rem",
            fontWeight: "700",
            cursor: "pointer",
            boxShadow: "0 8px 24px rgba(255, 107, 107, 0.35)",
          }}
        >
          Go to Landing Page
        </button>
      </div>
    );
  }

  // ---------------------------------------------------------
  // 📊 CHART DATA PREP (with safety checks)
  // ---------------------------------------------------------
  console.log("🎯 DashboardPage rendering with sessionData:", sessionData);
  console.log("📊 sessionData.punch_accuracy:", sessionData?.punch_accuracy);
  console.log("📊 sessionData.reaction_times:", sessionData?.reaction_times);
  console.log("📊 sessionData.defense:", sessionData?.defense);
  
  const punchAccuracy = sessionData.punch_accuracy || { jab: 0, hook: 0, uppercut: 0 };
  const punchAccuracyData = [
    { name: "Jab", value: punchAccuracy.jab || 0 },
    { name: "Hook", value: punchAccuracy.hook || 0 },
    { name: "Uppercut", value: punchAccuracy.uppercut || 0 },
  ];

  const reactionTimes = sessionData.reaction_times || { jab: 250, hook: 250, uppercut: 250 };
  const reactionTimeData = [
    { name: "Jab", time: reactionTimes.jab || 250 },
    { name: "Hook", time: reactionTimes.hook || 250 },
    { name: "Uppercut", time: reactionTimes.uppercut || 250 },
  ];

  const defense = sessionData.defense || { blocked: 0, dodged: 0, hit: 0 };
  const defenseData = [
    { name: "Blocked", value: defense.blocked || 0 },
    { name: "Dodged", value: defense.dodged || 0 },
    { name: "Hit", value: defense.hit || 0 },
  ];

  const COLORS = ["#ff6b6b", "#ff8787", "#ff5252", "#ff8a80"];

  const totalDefense =
    (defense.blocked || 0) +
    (defense.dodged || 0) +
    (defense.hit || 0);

  // Ensure timeline exists and is an array
  const timeline = Array.isArray(sessionData.timeline) && sessionData.timeline.length > 0
    ? sessionData.timeline
    : [
        { t: 5, velocity: 5.0, accuracy: 0 },
        { t: 10, velocity: 5.0, accuracy: 0 },
        { t: 15, velocity: 5.0, accuracy: 0 },
        { t: 20, velocity: 5.0, accuracy: 0 },
        { t: 25, velocity: 5.0, accuracy: 0 }
      ];

  // Calculate derived metrics from actual recorded data
  const avgVelocityMs = sessionData.summary?.avg_velocity ?? 0; // Already in m/s
  const totalPunches = sessionData.summary?.total_punches ?? 0;
  const sessionScore = sessionData.summary?.score ?? 0;  // Correct punch count

  // Format session date/time for display
  const formatSessionDate = (timestamp) => {
    try {
      if (!timestamp) return "Unknown";
      const date = new Date(timestamp);
      if (isNaN(date.getTime())) return "Invalid Date";
      
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const sessionDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      
      if (sessionDate.getTime() === today.getTime()) {
        // Today - show "Today at [time]"
        return `Today at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
      } else {
        // Another day - show date and time
        return date.toLocaleDateString('en-US', { 
          month: 'short', 
          day: 'numeric', 
          year: 'numeric'
        }) + ` at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
      }
    } catch (error) {
      console.error("Error formatting date:", error);
      return "Unknown";
    }
  };

  // Format timeline for Performance Over Session - only use recorded data
  const performanceTimeline = timeline.map((point) => {
    const minutes = Math.floor(point.t / 60);
    const seconds = point.t % 60;
    return {
      time: `${minutes}:${String(Math.floor(seconds)).padStart(2, '0')}`,
      timeValue: point.t, // Keep numeric for sorting
      velocity: point.velocity ?? 0, // Actual recorded velocity
      accuracy: point.accuracy ?? 0 // Actual recorded accuracy
    };
  }).sort((a, b) => a.timeValue - b.timeValue);

  // ---------------------------------------------------------
  // 🖥️ DASHBOARD UI
  // ---------------------------------------------------------
  return (
    <main
      style={{
        minHeight: "100vh",
        color: "white",
        padding: "40px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "32px",
        position: "relative",
        overflow: "hidden",
        background:
          "linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 25%, #16213e 50%, #1a1a2e 75%, #0a0a0f 100%)",
      }}
    >
      {/* Background */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(circle at 20% 50%, rgba(255, 107, 107, 0.1) 0%, transparent 50%), radial-gradient(circle at 80% 80%, rgba(107, 142, 255, 0.08) 0%, transparent 50%)",
          pointerEvents: "none",
        }}
      />

      {/* Navigation */}
      <nav style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', position: 'relative', zIndex: 10 }}>
        <div style={{ color: "#b0b0b8" }}>
          <div style={{ fontSize: "0.9rem" }}>
            {formatSessionDate(sessionData.timestamp)}
          </div>
          <div style={{ fontSize: "0.75rem", color: "#9ca3af", marginTop: "2px" }}>
            Score: {sessionScore} | {totalPunches} punches
          </div>
        </div>

        <button
          onClick={() => onNavigate("landing")}
          style={{
            backgroundColor: "#ff6b6b",
            color: "white",
            border: "none",
            borderRadius: "16px",
            padding: "12px 24px",
            fontSize: "1rem",
            fontWeight: "700",
            cursor: "pointer",
            boxShadow: "0 8px 24px rgba(255, 107, 107, 0.35)",
          }}
        >
          ← Back to Landing
        </button>
      </nav>

      {/* Title */}
      <div style={{ textAlign: 'center', position: 'relative', zIndex: 10, width: '100%' }}>
        <h1
          style={{
            fontSize: '3.75rem', // 6xl
            fontWeight: '800',
            filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.1))',
            marginBottom: '8px',
            background:
              "linear-gradient(135deg, #ff6b6b 0%, #ff8787 50%, #ff6b6b 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          🥊 PERFECTPUNCH DASHBOARD
        </h1>
        <p style={{ fontSize: '1.25rem', color: "#b0b0b8" }}>
          Today's Training Session
        </p>
        <p style={{ fontSize: '1.125rem', marginTop: '4px', color: "#9ca3af" }}>
          {totalPunches} total punches
        </p>
      </div>

      {/* SUMMARY CARDS - Only Show Recorded Data */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', md: { gridTemplateColumns: 'repeat(3, 1fr)' }, lg: { gridTemplateColumns: 'repeat(6, 1fr)' }, gap: '24px', width: '100%', position: 'relative', zIndex: 10 }}>
        {/* Score */}
        <div
          style={{
            borderRadius: '16px',
            padding: '24px',
            background: "rgba(255, 255, 255, 0.05)",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.3)",
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '9999px', backgroundColor: "#ff6b6b" }}></div>
            <h2 style={{ fontSize: '0.875rem', fontWeight: '600', color: "#b0b0b8" }}>
              Score
            </h2>
          </div>
          <p style={{ fontSize: '1.875rem', fontWeight: '800', color: "#ff6b6b" }}>
            {sessionData.summary?.score ?? 0}
          </p>
        </div>

        {/* Average Punch Speed */}
        <div
          style={{
            borderRadius: '16px',
            padding: '24px',
            background: "rgba(255, 255, 255, 0.05)",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.3)",
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '9999px', backgroundColor: "#ff6b6b" }}></div>
            <h2 style={{ fontSize: '0.875rem', fontWeight: '600', color: "#b0b0b8" }}>
              Avg Punch Speed
            </h2>
          </div>
          <p style={{ fontSize: '1.875rem', fontWeight: '800', color: "#ff6b6b" }}>
            {avgVelocityMs.toFixed(1)} m/s
          </p>
        </div>

        {/* Reaction Time */}
        <div
          style={{
            borderRadius: '16px',
            padding: '24px',
            background: "rgba(255, 255, 255, 0.05)",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.3)",
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '9999px', backgroundColor: "#ff6b6b" }}></div>
            <h2 style={{ fontSize: '0.875rem', fontWeight: '600', color: "#b0b0b8" }}>
              Reaction Time
            </h2>
          </div>
          <p style={{ fontSize: '1.875rem', fontWeight: '800', color: "#ff6b6b" }}>
            {sessionData.summary?.avg_reaction_time ?? 0} ms
          </p>
        </div>

        {/* Accuracy */}
        <div
          style={{
            borderRadius: '16px',
            padding: '24px',
            background: "rgba(255, 255, 255, 0.05)",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.3)",
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '9999px', backgroundColor: "#ff6b6b" }}></div>
            <h2 style={{ fontSize: '0.875rem', fontWeight: '600', color: "#b0b0b8" }}>
              Accuracy
            </h2>
          </div>
          <p style={{ fontSize: '1.875rem', fontWeight: '800', color: "#ff6b6b" }}>
            {(sessionData.summary?.accuracy ?? 0).toFixed(1)}%
          </p>
        </div>

        {/* Critical Prevention */}
        <div
          style={{
            borderRadius: '16px',
            padding: '24px',
            background: "rgba(255, 255, 255, 0.05)",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.3)",
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '9999px', backgroundColor: "#ff6b6b" }}></div>
            <h2 style={{ fontSize: '0.875rem', fontWeight: '600', color: "#b0b0b8" }}>
              Critical Prevention
            </h2>
          </div>
          <p style={{ fontSize: '1.875rem', fontWeight: '800', color: "#ff6b6b" }}>
            {(sessionData.summary?.critical_prevention ?? 0).toFixed(1)}%
          </p>
        </div>

        {/* Total Punches */}
        <div
          style={{
            borderRadius: '16px',
            padding: '24px',
            background: "rgba(255, 255, 255, 0.05)",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.3)",
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '9999px', backgroundColor: "#ff6b6b" }}></div>
            <h2 style={{ fontSize: '0.875rem', fontWeight: '600', color: "#b0b0b8" }}>
              Total Punches
            </h2>
          </div>
          <p style={{ fontSize: '1.875rem', fontWeight: '800', color: "#ff6b6b" }}>
            {totalPunches}
          </p>
        </div>
      </div>

      {/* CHARTS - 3 Column Layout */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(1, 1fr)', lg: { gridTemplateColumns: 'repeat(3, 1fr)' }, gap: '32px', width: '100%', position: 'relative', zIndex: 10 }}>
        {/* Punch Accuracy */}
        <section
          style={{
            borderRadius: '16px',
            padding: '32px',
            background: "rgba(255, 255, 255, 0.05)",
            border: "1px solid rgba(255, 255, 255, 0.1)",
          }}
        >
          <h2 style={{ fontSize: '1.5rem', fontWeight: '700', textAlign: 'center', marginBottom: '24px' }}>
            Punch Accuracy
          </h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={punchAccuracyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#4b5563" />
              <XAxis dataKey="name" stroke="#9ca3af" />
              <YAxis stroke="#9ca3af" domain={[0, 100]} />
              <Tooltip />
              <Bar dataKey="value" fill="#ff6b6b" />
            </BarChart>
          </ResponsiveContainer>
        </section>

        {/* Reaction Times */}
        <section
          style={{
            borderRadius: '16px',
            padding: '32px',
            background: "rgba(255, 255, 255, 0.05)",
            border: "1px solid rgba(255, 255, 255, 0.1)",
          }}
        >
          <h2 style={{ fontSize: '1.5rem', fontWeight: '700', textAlign: 'center', marginBottom: '24px' }}>
            Reaction Times
          </h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={reactionTimeData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#4b5563" />
              <XAxis dataKey="name" stroke="#9ca3af" />
              <YAxis stroke="#9ca3af" label={{ value: 'Time (ms)', angle: -90, position: 'insideLeft' }} />
              <Tooltip />
              <Bar dataKey="time" fill="#ff8787" />
            </BarChart>
          </ResponsiveContainer>
        </section>

        {/* Defense Breakdown */}
        <section
          style={{
            borderRadius: '16px',
            padding: '32px',
            background: "rgba(255, 255, 255, 0.05)",
            border: "1px solid rgba(255, 255, 255, 0.1)",
          }}
        >
          <h2 style={{ fontSize: '1.5rem', fontWeight: '700', textAlign: 'center', marginBottom: '24px' }}>
            Defense Breakdown
          </h2>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={defenseData}
                outerRadius={100}
                dataKey="value"
                label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
              >
                {defenseData.map((_, idx) => (
                  <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
          <p style={{ fontSize: '0.75rem', textAlign: 'center', marginTop: '8px', color: "#6b7280" }}>
            Hover over the chart for details
          </p>
        </section>
      </div>

      {/* PERFORMANCE OVER SESSION - Full Width */}
      <div style={{ width: '100%', position: 'relative', zIndex: 10 }}>
        <section
          style={{
            borderRadius: '16px',
            padding: '32px',
            background: "rgba(255, 255, 255, 0.05)",
            border: "1px solid rgba(255, 255, 255, 0.1)",
          }}
        >
          <h2 style={{ fontSize: '1.5rem', fontWeight: '700', textAlign: 'center', marginBottom: '24px' }}>
            Performance Over Session
          </h2>
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={performanceTimeline}>
              <CartesianGrid strokeDasharray="3 3" stroke="#4b5563" />
              <XAxis 
                dataKey="time" 
                stroke="#9ca3af"
                interval={0}
                angle={-45}
                textAnchor="end"
                height={80}
              />
              <YAxis 
                yAxisId="left" 
                stroke="#9ca3af" 
                label={{ value: 'Velocity (m/s)', angle: -90, position: 'insideLeft' }} 
              />
              <YAxis 
                yAxisId="right" 
                orientation="right" 
                stroke="#9ca3af"
                domain={[0, 100]}
                label={{ value: 'Accuracy (%)', angle: 90, position: 'insideRight' }} 
              />
              <Tooltip />
              <Legend />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="velocity"
                stroke="#ff6b6b"
                strokeWidth={3}
                name="Velocity (m/s)"
                dot={{ r: 4 }}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="accuracy"
                stroke="#fbbf24"
                strokeWidth={3}
                name="Accuracy (%)"
                dot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </section>
      </div>
    </main>
  );
};

export default DashboardPage;