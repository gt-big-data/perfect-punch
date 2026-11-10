import React, { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  LabelList,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
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

      // 3️⃣ THIRD: Try API endpoint
      try {
        const API_BASE_URL =
          import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

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
  }, [sessionId]);

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
          background: "#000000",
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
          background: "#000000",
        }}
      >
        <div style={{ fontSize: "1.5rem", fontWeight: "700", textAlign: "center", color: "#d6392c" }}>
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
            backgroundColor: "#d6392c",
            color: "white",
            border: "none",
            borderRadius: "16px",
            padding: "12px 24px",
            fontSize: "1rem",
            fontWeight: "700",
            cursor: "pointer",
            boxShadow: "0 8px 24px rgba(214, 57, 44, 0.45)",
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

  // One red ramp, light -> dark, shared by every chart: the lightest tone is
  // always the best outcome (Jab / Dodged) and the darkest the worst (Hit).
  const RED_LIGHT = "#ef8c7a";
  const RED_MID = "#df4b42";
  const RED_DARK = "#7e2026";
  const PUNCH_COLORS = [RED_LIGHT, RED_MID, RED_DARK];
  const VELOCITY_COLOR = "#f2695c";
  const ACCURACY_COLOR = "#e5c14c";

  const defenseData = [
    { name: "Dodged", value: defense.dodged || 0, color: RED_LIGHT },
    { name: "Blocked", value: defense.blocked || 0, color: RED_MID },
    { name: "Hit", value: defense.hit || 0, color: RED_DARK },
  ];

  const PUNCH_LEGEND = punchAccuracyData.map((d, idx) => ({
    name: d.name,
    color: PUNCH_COLORS[idx % PUNCH_COLORS.length],
  }));

  // Shared dark tooltip so the hover layer stops flashing white on black.
  const tooltipStyle = {
    background: "#1c1c1c",
    border: "1px solid #3a3a3a",
    borderRadius: "10px",
    color: "#f5f5f5",
  };

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

  // Punches landed vs. targets faced. Both numbers come from the defense
  // split so the count and the percentage beside it can never disagree; the
  // summary's critical_prevention is only a fallback when that split is empty.
  const punchesLanded = defense.hit || 0;
  const targetsFaced = totalDefense;
  const targetHitRate =
    targetsFaced > 0
      ? Math.round((punchesLanded / targetsFaced) * 100)
      : Math.round(sessionData.summary?.critical_prevention ?? 0);

  // Shared medal look, reused by every medaled metric.
  const BRONZE = { name: "Bronze", icon: "\u{1F949}", color: "#cd7f32" };
  const SILVER = { name: "Silver", icon: "\u{1F948}", color: "#c3cad1" };
  const GOLD = { name: "Gold", icon: "\u{1F947}", color: "#e3b341" };

  // Target hit rate: <=50% bronze, 51-75% silver, 76-100% gold.
  const MEDAL_TIERS = [
    { max: 50, ...BRONZE },
    { max: 75, ...SILVER },
    { max: Infinity, ...GOLD },
  ];
  const medal = MEDAL_TIERS.find((t) => targetHitRate <= t.max);

  // Avg punch speed (hand velocity). Boxing biomechanics benchmarks:
  // recreational boxers land around 6-8 m/s, competitive amateurs 7.5-9.5 m/s
  // (amateur mean ~9.1 m/s), elite/professional boxers 8.5-11+ m/s.
  const SPEED_TIERS = [
    { max: 7.5, ...BRONZE, note: "below the 7.5-9.5 m/s amateur range" },
    { max: 9.2, ...SILVER, note: "in the 7.5-9.5 m/s amateur range" },
    { max: Infinity, ...GOLD, note: "elite range (9.2+ m/s)" },
  ];
  const speedMedal =
    avgVelocityMs > 0 ? SPEED_TIERS.find((t) => avgVelocityMs < t.max) : null;

  // Avg reaction time, lower is better. Amateur competitors typically sit at
  // 300-400 ms, pro boxers average ~200 ms, elite fighters go under 150 ms.
  const avgReactionMs = sessionData.summary?.avg_reaction_time ?? 0;
  const REACTION_TIERS = [
    { max: 200, ...GOLD, note: "pro/elite range (under 200 ms)" },
    { max: 300, ...SILVER, note: "above average (200-300 ms)" },
    { max: Infinity, ...BRONZE, note: "amateur range (300 ms+)" },
  ];
  const reactionMedal =
    avgReactionMs > 0 ? REACTION_TIERS.find((t) => avgReactionMs < t.max) : null;

  // Percentage metrics are graded by color instead of a medal:
  // 0-50 red, 50-75 yellow, 75-100 green.
  const GRADE_RED = "#d6392c";
  const GRADE_YELLOW = "#e3b341";
  const GRADE_GREEN = "#3fb950";
  const PERCENT_COLORS = [
    { max: 50, color: GRADE_RED },
    { max: 75, color: GRADE_YELLOW },
    { max: Infinity, color: GRADE_GREEN },
  ];
  const percentColor = (pct) => PERCENT_COLORS.find((t) => pct < t.max).color;

  const accuracyPct = sessionData.summary?.accuracy ?? 0;
  const criticalPreventionPct = sessionData.summary?.critical_prevention ?? 0;
  const accuracyColor = percentColor(accuracyPct);
  const criticalPreventionColor = percentColor(criticalPreventionPct);

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
  // 📐 CHART AXES, LEGEND STATS AND SHARED CARD CHROME
  // ---------------------------------------------------------
  const sessionNumber =
    sessionData.session_number ?? sessionData.summary?.session_number ?? null;
  const sessionLabel =
    sessionNumber != null ? `Session ${sessionNumber}` : "This session";

  // Defense panel: the headline is everything that was *not* a clean hit.
  const defendedCount = (defense.dodged || 0) + (defense.blocked || 0);
  const pctOfDefense = (v) =>
    totalDefense > 0 ? Math.round((v / totalDefense) * 100) : 0;
  const defendedPct = pctOfDefense(defendedCount);
  // Graded on the same percentage scale as the summary cards up top.
  const defendedColor = percentColor(defendedPct);
  const defenseInsight =
    totalDefense === 0
      ? "No defensive exchanges recorded this session."
      : (defense.hit || 0) > defendedCount
      ? "More punches landed than you stopped - keep your guard up between combos."
      : (defense.dodged || 0) >= (defense.blocked || 0)
      ? "Dodging is your strongest defense - keep the head movement going."
      : "You block more than you dodge - adding head movement will save energy.";

  const avgAccuracyPct =
    punchAccuracyData.reduce((sum, d) => sum + d.value, 0) /
    (punchAccuracyData.length || 1);
  const avgReactionBar =
    reactionTimeData.reduce((sum, d) => sum + d.time, 0) /
    (reactionTimeData.length || 1);

  // Headline stats are graded so the number itself tells you how the session
  // went. Accuracy uses the red/yellow/green percentage scale directly;
  // reaction time keeps its medal thresholds but is shown on that same scale,
  // with gold reading green, silver yellow and bronze red.
  const MEDAL_GRADE_COLORS = {
    Gold: GRADE_GREEN,
    Silver: GRADE_YELLOW,
    Bronze: GRADE_RED,
  };
  const avgAccuracyColor = percentColor(avgAccuracyPct);
  const avgReactionColor =
    MEDAL_GRADE_COLORS[REACTION_TIERS.find((t) => avgReactionBar < t.max).name];

  // Round an axis up to a readable top value with ~4 evenly spaced ticks.
  const axisTicks = (maxValue) => {
    const padded = Math.max(maxValue * 1.08, 1);
    const magnitude = Math.pow(10, Math.floor(Math.log10(padded / 4)));
    const normalized = padded / 4 / magnitude;
    const step =
      (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) *
      magnitude;
    const top = Math.ceil(padded / step) * step;
    const ticks = [];
    for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v));
    return { top, ticks };
  };
  const reactionAxis = axisTicks(
    Math.max(...reactionTimeData.map((d) => d.time), 1)
  );

  // Performance timeline: both axes get their own padded, rounded range so the
  // two lines stay readable instead of hugging the top or bottom of the plot.
  const velocityValues = performanceTimeline.map((p) => p.velocity);
  const accuracyValues = performanceTimeline.map((p) => p.accuracy);
  const velocityDomain = [
    Math.max(0, Math.floor(Math.min(...velocityValues) - 0.5)),
    Math.ceil(Math.max(...velocityValues) + 0.5),
  ];
  const accuracyDomain = [
    Math.max(0, Math.floor((Math.min(...accuracyValues) - 5) / 10) * 10),
    Math.min(100, Math.ceil((Math.max(...accuracyValues) + 5) / 10) * 10),
  ];

  // Both timeline axes get whole-number ticks so the two scales stay legible
  // side by side instead of landing on quarters.
  const rangeTicks = ([min, max], minStep) => {
    const step = Math.max(minStep, Math.ceil((max - min) / 4 / minStep) * minStep);
    const ticks = [];
    for (let v = min; v <= max + step / 2; v += step) ticks.push(Math.round(v));
    return ticks;
  };
  const velocityTicks = rangeTicks(velocityDomain, 1);
  const accuracyTicks = rangeTicks(accuracyDomain, 10);
  velocityDomain[1] = Math.max(velocityDomain[1], velocityTicks[velocityTicks.length - 1]);
  accuracyDomain[1] = Math.max(accuracyDomain[1], accuracyTicks[accuracyTicks.length - 1]);

  const avgTimelineVelocity =
    velocityValues.reduce((sum, v) => sum + v, 0) / (velocityValues.length || 1);
  const avgTimelineAccuracy =
    accuracyValues.reduce((sum, v) => sum + v, 0) / (accuracyValues.length || 1);

  const cardStyle = {
    borderRadius: "18px",
    padding: "28px 32px 24px",
    background: "#101010",
    border: "1px solid #262626",
  };
  const titleStyle = {
    fontSize: "1.3rem",
    fontWeight: "700",
    color: "#f2f2f2",
    margin: 0,
  };
  const eyebrowStyle = {
    fontSize: "0.72rem",
    letterSpacing: "0.18em",
    color: "#8a8a8a",
    fontWeight: "600",
  };
  const dividerStyle = { height: "1px", background: "#262626" };

  // Title on the left, a headline stat (or a custom node) on the right.
  const ChartHeader = ({ title, statLabel, statValue, statUnit, statColor, right }) => (
    <>
      <div
        style={{
          display: "flex",
          alignItems: right ? "center" : "flex-end",
          justifyContent: "space-between",
          gap: "24px",
          flexWrap: "wrap",
        }}
      >
        <h2 style={titleStyle}>{title}</h2>
        {right || (
          <div style={{ textAlign: "right" }}>
            <div style={eyebrowStyle}>{statLabel}</div>
            <div
              style={{
                fontSize: "2rem",
                fontWeight: "800",
                lineHeight: "1.1",
                color: statColor || "#ffffff",
              }}
            >
              {statValue}
              <span style={{ color: statColor || RED_MID }}>{statUnit}</span>
            </div>
          </div>
        )}
      </div>
      <div style={{ ...dividerStyle, margin: "18px 0 4px" }} />
    </>
  );

  const ChartFooter = ({ items, note }) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "16px",
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "22px", flexWrap: "wrap" }}>
        {items.map((item) => (
          <span
            key={item.name}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "9px",
              color: "#d2d2d2",
              fontSize: "0.95rem",
            }}
          >
            <span
              style={{
                width: "11px",
                height: "11px",
                borderRadius: "3px",
                background: item.color,
              }}
            />
            {item.name}
          </span>
        ))}
      </div>
      {note && <span style={{ color: "#8a8a8a", fontSize: "0.9rem" }}>{note}</span>}
    </div>
  );

  // Percentages sit inside their own pie slice rather than on leader lines.
  const renderPieLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }) => {
    if (!percent) return null;
    const radian = Math.PI / 180;
    const radius = innerRadius + (outerRadius - innerRadius) * 0.62;
    const x = cx + radius * Math.cos(-midAngle * radian);
    const y = cy + radius * Math.sin(-midAngle * radian);
    return (
      <text
        x={x}
        y={y}
        fill="#ffffff"
        fontSize={17}
        fontWeight={700}
        textAnchor="middle"
        dominantBaseline="central"
      >
        {`${Math.round(percent * 100)}%`}
      </text>
    );
  };

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
        background: "#000000",
      }}
    >
      {/* Navigation */}
      <nav style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', position: 'relative', zIndex: 10 }}>
        <div style={{ color: "#b0b0b8" }}>
          <div style={{ fontSize: "0.9rem" }}>
            {formatSessionDate(sessionData.timestamp)}
          </div>
          <div style={{ fontSize: "0.75rem", color: "#9ca3af", marginTop: "2px" }}>
            {medal.icon} {medal.name} | {totalPunches} punches
          </div>
        </div>

        <button
          onClick={() => onNavigate("landing")}
          style={{
            backgroundColor: "#d6392c",
            color: "white",
            border: "none",
            borderRadius: "16px",
            padding: "12px 24px",
            fontSize: "1rem",
            fontWeight: "700",
            cursor: "pointer",
            boxShadow: "0 8px 24px rgba(214, 57, 44, 0.45)",
          }}
        >
          ← Back to Landing
        </button>
      </nav>

      {/* Title */}
      <div style={{ textAlign: 'center', position: 'relative', zIndex: 10, width: '100%' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '20px',
            marginBottom: '8px',
            flexWrap: 'nowrap',
          }}
        >
          <img
            src="/perfect-punch-logo.png"
            alt="PerfectPunch logo"
            style={{ height: 'clamp(3rem, 7vw, 5.5rem)', width: 'auto', flexShrink: 0 }}
          />
          <h1
            style={{
              fontSize: 'clamp(1.75rem, 4.6vw, 3.75rem)',
              fontWeight: '800',
              color: "#ffffff",
              letterSpacing: '-0.01em',
            }}
          >
            PERFECTPUNCH DASHBOARD
          </h1>
        </div>
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
            background: "#121212",
            border: "1px solid #333333",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.3)",
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '9999px', backgroundColor: medal.color }}></div>
            <h2 style={{ fontSize: '0.875rem', fontWeight: '600', color: "#b0b0b8" }}>
              Score
            </h2>
          </div>
          <p
            style={{
              fontSize: '1.875rem',
              fontWeight: '800',
              color: medal.color,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
            }}
          >
            <span aria-hidden="true">{medal.icon}</span>
            {medal.name}
          </p>
          <p style={{ fontSize: '0.8125rem', marginTop: '4px', color: "#9ca3af" }}>
            {targetsFaced > 0
              ? `${punchesLanded} punches landed of ${targetsFaced} targets (${targetHitRate}%)`
              : `${targetHitRate}% of targets hit`}
          </p>
        </div>

        {/* Average Punch Speed */}
        <div
          style={{
            borderRadius: '16px',
            padding: '24px',
            background: "#121212",
            border: "1px solid #333333",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.3)",
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '9999px', backgroundColor: speedMedal ? speedMedal.color : "#d6392c" }}></div>
            <h2 style={{ fontSize: '0.875rem', fontWeight: '600', color: "#b0b0b8" }}>
              Avg Punch Speed
            </h2>
          </div>
          {speedMedal ? (
            <>
              <p
                style={{
                  fontSize: '1.875rem',
                  fontWeight: '800',
                  color: speedMedal.color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '10px',
                }}
              >
                <span aria-hidden="true">{speedMedal.icon}</span>
                {speedMedal.name}
              </p>
              <p style={{ fontSize: '0.8125rem', marginTop: '4px', color: "#9ca3af" }}>
                {avgVelocityMs.toFixed(1)} m/s - {speedMedal.note}
              </p>
            </>
          ) : (
            <p style={{ fontSize: '1.875rem', fontWeight: '800', color: "#d6392c" }}>
              {avgVelocityMs.toFixed(1)} m/s
            </p>
          )}
        </div>

        {/* Reaction Time */}
        <div
          style={{
            borderRadius: '16px',
            padding: '24px',
            background: "#121212",
            border: "1px solid #333333",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.3)",
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '9999px', backgroundColor: reactionMedal ? reactionMedal.color : "#d6392c" }}></div>
            <h2 style={{ fontSize: '0.875rem', fontWeight: '600', color: "#b0b0b8" }}>
              Reaction Time
            </h2>
          </div>
          {reactionMedal ? (
            <>
              <p
                style={{
                  fontSize: '1.875rem',
                  fontWeight: '800',
                  color: reactionMedal.color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '10px',
                }}
              >
                <span aria-hidden="true">{reactionMedal.icon}</span>
                {reactionMedal.name}
              </p>
              <p style={{ fontSize: '0.8125rem', marginTop: '4px', color: "#9ca3af" }}>
                {avgReactionMs} ms - {reactionMedal.note}
              </p>
            </>
          ) : (
            <p style={{ fontSize: '1.875rem', fontWeight: '800', color: "#d6392c" }}>
              {avgReactionMs} ms
            </p>
          )}
        </div>

        {/* Accuracy */}
        <div
          style={{
            borderRadius: '16px',
            padding: '24px',
            background: "#121212",
            border: "1px solid #333333",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.3)",
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '9999px', backgroundColor: accuracyColor }}></div>
            <h2 style={{ fontSize: '0.875rem', fontWeight: '600', color: "#b0b0b8" }}>
              Accuracy
            </h2>
          </div>
          <p style={{ fontSize: '1.875rem', fontWeight: '800', color: accuracyColor }}>
            {accuracyPct.toFixed(1)}%
          </p>
        </div>

        {/* Critical Prevention */}
        <div
          style={{
            borderRadius: '16px',
            padding: '24px',
            background: "#121212",
            border: "1px solid #333333",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.3)",
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '9999px', backgroundColor: criticalPreventionColor }}></div>
            <h2 style={{ fontSize: '0.875rem', fontWeight: '600', color: "#b0b0b8" }}>
              Critical Prevention
            </h2>
          </div>
          <p style={{ fontSize: '1.875rem', fontWeight: '800', color: criticalPreventionColor }}>
            {criticalPreventionPct.toFixed(1)}%
          </p>
        </div>

        {/* Total Punches */}
        <div
          style={{
            borderRadius: '16px',
            padding: '24px',
            background: "#121212",
            border: "1px solid #333333",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.3)",
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '9999px', backgroundColor: "#d6392c" }}></div>
            <h2 style={{ fontSize: '0.875rem', fontWeight: '600', color: "#b0b0b8" }}>
              Total Punches
            </h2>
          </div>
          <p style={{ fontSize: '1.875rem', fontWeight: '800', color: "#d6392c" }}>
            {totalPunches}
          </p>
        </div>
      </div>

      {/* CHARTS */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '32px',
          width: '100%',
          position: 'relative',
          zIndex: 10,
        }}
      >
        {/* Punch Accuracy */}
        <section style={cardStyle}>
          <ChartHeader
            title="Punch accuracy"
            statLabel="AVERAGE"
            statValue={Math.round(avgAccuracyPct)}
            statUnit="%"
            statColor={avgAccuracyColor}
          />
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={punchAccuracyData} margin={{ top: 28, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid vertical={false} stroke="#232323" />
              <XAxis
                dataKey="name"
                tickLine={false}
                axisLine={{ stroke: "#2b2b2b" }}
                tick={{ fill: "#b4b4b4", fontSize: 13 }}
                dy={10}
                height={40}
              />
              <YAxis
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
                tickLine={false}
                axisLine={false}
                width={54}
                tick={{ fill: "#7f7f7f", fontSize: 12 }}
                tickFormatter={(v) => (v === 0 ? "0" : `${v}%`)}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                cursor={{ fill: "rgba(255,255,255,0.05)" }}
                formatter={(v) => [`${Math.round(v)}%`, "Accuracy"]}
              />
              <Bar dataKey="value" maxBarSize={130} isAnimationActive={false}>
                {punchAccuracyData.map((_, idx) => (
                  <Cell key={idx} fill={PUNCH_COLORS[idx % PUNCH_COLORS.length]} />
                ))}
                <LabelList
                  dataKey="value"
                  position="top"
                  offset={12}
                  fill="#ffffff"
                  fontSize={14}
                  fontWeight={700}
                  formatter={(v) => `${Math.round(v)}%`}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <ChartFooter items={PUNCH_LEGEND} note={sessionLabel} />
        </section>

        {/* Reaction Time */}
        <section style={cardStyle}>
          <ChartHeader
            title="Reaction time"
            statLabel="AVERAGE"
            statValue={Math.round(avgReactionBar)}
            statUnit=" ms"
            statColor={avgReactionColor}
          />
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={reactionTimeData} margin={{ top: 28, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid vertical={false} stroke="#232323" />
              <XAxis
                dataKey="name"
                tickLine={false}
                axisLine={{ stroke: "#2b2b2b" }}
                tick={{ fill: "#b4b4b4", fontSize: 13 }}
                dy={10}
                height={40}
              />
              <YAxis
                domain={[0, reactionAxis.top]}
                ticks={reactionAxis.ticks}
                tickLine={false}
                axisLine={false}
                width={54}
                tick={{ fill: "#7f7f7f", fontSize: 12 }}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                cursor={{ fill: "rgba(255,255,255,0.05)" }}
                formatter={(v) => [`${Math.round(v)} ms`, "Reaction"]}
              />
              <Bar dataKey="time" maxBarSize={130} isAnimationActive={false}>
                {reactionTimeData.map((_, idx) => (
                  <Cell key={idx} fill={PUNCH_COLORS[idx % PUNCH_COLORS.length]} />
                ))}
                <LabelList
                  dataKey="time"
                  position="top"
                  offset={12}
                  fill="#ffffff"
                  fontSize={14}
                  fontWeight={700}
                  formatter={(v) => `${Math.round(v)} ms`}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <ChartFooter items={PUNCH_LEGEND} note={`Lower is better · ${sessionLabel}`} />
        </section>

        {/* Defense Breakdown */}
        <section style={cardStyle}>
          <ChartHeader
            title="Defense breakdown"
            right={
              <span style={{ color: "#8a8a8a", fontSize: "1rem" }}>
                {sessionLabel} · {totalDefense} punches
              </span>
            }
          />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              gap: '40px',
              alignItems: 'center',
              marginTop: '12px',
            }}
          >
            <ResponsiveContainer width="100%" height={340}>
              <PieChart>
                <Pie
                  data={defenseData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={150}
                  startAngle={90}
                  endAngle={-270}
                  labelLine={false}
                  label={renderPieLabel}
                  isAnimationActive={false}
                >
                  {defenseData.map((d) => (
                    <Cell key={d.name} fill={d.color} stroke="#000000" strokeWidth={3} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>

            <div>
              <div style={eyebrowStyle}>DEFENDED</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '18px', marginTop: '4px', flexWrap: 'wrap' }}>
                <div style={{ fontSize: '3.6rem', fontWeight: '800', lineHeight: '1', color: defendedColor }}>
                  {defendedPct}
                  <span style={{ color: defendedColor }}>%</span>
                </div>
                <div style={{ color: "#9a9a9a", fontSize: '1rem' }}>
                  {defendedCount} of {totalDefense} punches
                </div>
              </div>

              <div
                style={{
                  height: '4px',
                  borderRadius: '999px',
                  background: "#3a3a3a",
                  marginTop: '20px',
                  overflow: 'hidden',
                }}
              >
                <div style={{ width: `${defendedPct}%`, height: '100%', background: defendedColor }} />
              </div>

              <div style={{ ...dividerStyle, marginTop: '24px' }} />
              {defenseData.map((d) => (
                <div
                  key={d.name}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '14px',
                    padding: '14px 0',
                    borderBottom: "1px solid #1f1f1f",
                  }}
                >
                  <span
                    style={{
                      width: '11px',
                      height: '11px',
                      borderRadius: '3px',
                      background: d.color,
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ flex: 1, color: "#e8e8e8", fontSize: '1.05rem' }}>{d.name}</span>
                  <span style={{ color: "#9a9a9a", fontSize: '1rem', minWidth: '40px', textAlign: 'right' }}>
                    {d.value}
                  </span>
                  <span style={{ color: "#ffffff", fontSize: '1rem', fontWeight: '700', minWidth: '56px', textAlign: 'right' }}>
                    {pctOfDefense(d.value)}%
                  </span>
                </div>
              ))}

              <p style={{ color: "#8a8a8a", fontSize: '0.95rem', marginTop: '20px' }}>
                {defenseInsight}
              </p>
            </div>
          </div>
        </section>

        {/* Performance Over Session */}
        <section style={cardStyle}>
          <ChartHeader
            title="Performance over session"
            right={
              <div style={{ display: 'flex', alignItems: 'center', gap: '32px', flexWrap: 'wrap' }}>
                {[
                  { color: VELOCITY_COLOR, label: "AVG VELOCITY", value: `${avgTimelineVelocity.toFixed(1)} m/s` },
                  { color: ACCURACY_COLOR, label: "AVG ACCURACY", value: `${avgTimelineAccuracy.toFixed(1)}%` },
                ].map((stat) => (
                  <span key={stat.label} style={{ display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ width: '26px', height: '3px', borderRadius: '999px', background: stat.color }} />
                    <span style={eyebrowStyle}>{stat.label}</span>
                    <span style={{ fontSize: '1.05rem', fontWeight: '700', color: "#ffffff" }}>{stat.value}</span>
                  </span>
                ))}
              </div>
            }
          />
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={performanceTimeline} margin={{ top: 24, right: 16, left: 8, bottom: 8 }}>
              <CartesianGrid vertical={false} stroke="#232323" />
              <XAxis
                dataKey="time"
                tickLine={false}
                axisLine={{ stroke: "#2b2b2b" }}
                tick={{ fill: "#9a9a9a", fontSize: 13 }}
                dy={10}
                height={44}
              />
              <YAxis
                yAxisId="left"
                domain={velocityDomain}
                ticks={velocityTicks}
                tickLine={false}
                axisLine={false}
                width={72}
                tick={{ fill: "#8a8a8a", fontSize: 12 }}
                label={{
                  value: 'Velocity (m/s)',
                  angle: -90,
                  position: 'insideLeft',
                  fill: VELOCITY_COLOR,
                  fontSize: 12,
                  style: { textAnchor: 'middle' },
                }}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                domain={accuracyDomain}
                ticks={accuracyTicks}
                tickLine={false}
                axisLine={false}
                width={72}
                tick={{ fill: "#8a8a8a", fontSize: 12 }}
                label={{
                  value: 'Accuracy (%)',
                  angle: 90,
                  position: 'insideRight',
                  fill: ACCURACY_COLOR,
                  fontSize: 12,
                  style: { textAnchor: 'middle' },
                }}
              />
              <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: "#3a3a3a" }} />
              <Line
                yAxisId="left"
                type="linear"
                dataKey="velocity"
                stroke={VELOCITY_COLOR}
                strokeWidth={2}
                name="Velocity (m/s)"
                isAnimationActive={false}
                dot={{ r: 5, fill: "#101010", stroke: VELOCITY_COLOR, strokeWidth: 2 }}
                activeDot={{ r: 6, fill: VELOCITY_COLOR, stroke: "#101010", strokeWidth: 2 }}
              />
              <Line
                yAxisId="right"
                type="linear"
                dataKey="accuracy"
                stroke={ACCURACY_COLOR}
                strokeWidth={2}
                name="Accuracy (%)"
                isAnimationActive={false}
                dot={{ r: 5, fill: "#101010", stroke: ACCURACY_COLOR, strokeWidth: 2 }}
                activeDot={{ r: 6, fill: ACCURACY_COLOR, stroke: "#101010", strokeWidth: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </section>
      </div>

    </main>
  );
};

export default DashboardPage;