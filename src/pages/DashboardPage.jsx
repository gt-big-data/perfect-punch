import React from "react";
import { useTrainingData } from "../hooks/useTrainingData";
import { buildTrend, buildSeries } from "../lib/trendAnalysis";
import {
  RED_LIGHT,
  RED_MID,
  RED_DARK,
  PUNCH_COLORS,
  ACCURACY_COLOR,
  REACTION_COLOR,
  GRADE_RED,
  GRADE_YELLOW,
  GRADE_GREEN,
  percentColor,
  cardStyle,
  eyebrowStyle,
  dividerStyle,
  tooltipStyle,
  primaryButtonStyle,
} from "./analysisTheme";
import { ChartHeader, ChartFooter } from "./analysisChrome";
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

const DashboardPage = ({
  onNavigate,
  onViewProgress = () => {},
  sessionId = null,
  metricsData = null,
}) => {
  const { sessionData, pastSessions, loading } = useTrainingData({
    sessionId,
    metricsData,
  });

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
          style={primaryButtonStyle}
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
    { name: "Dodged", value: defense.dodged || 0, color: RED_LIGHT },
    { name: "Blocked", value: defense.blocked || 0, color: RED_MID },
    { name: "Hit", value: defense.hit || 0, color: RED_DARK },
  ];

  const PUNCH_LEGEND = punchAccuracyData.map((d, idx) => ({
    name: d.name,
    color: PUNCH_COLORS[idx % PUNCH_COLORS.length],
  }));

  const totalDefense =
    (defense.blocked || 0) +
    (defense.dodged || 0) +
    (defense.hit || 0);

  // Calculate derived metrics from actual recorded data
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

  // ---------------------------------------------------------
  // 📈 PERFORMANCE OVER SESSIONS
  // Accuracy and reaction time share one chart, but their units never could
  // (%, ms). Each line is scaled against the user's own best
  // session for that metric, so 100 means "your best ever" and every line
  // rises when the user improves - reaction time included, which is inverted
  // because a lower number there is the better result. Raw values are kept on
  // each point so the tooltip can show what was actually recorded.
  // ---------------------------------------------------------
  const sessionSeries = buildSeries(sessionData, pastSessions);

  const TRACKED = [
    { key: "accuracy", label: "Punch accuracy", color: ACCURACY_COLOR, summaryKey: "accuracy", format: (v) => `${Math.round(v)}%` },
    { key: "reaction", label: "Reaction time", color: REACTION_COLOR, summaryKey: "avg_reaction_time", lowerIsBetter: true, format: (v) => `${Math.round(v)} ms` },
  ];

  const trackedBest = (metric) => {
    const values = sessionSeries.map((p) => p[metric.key]).filter((v) => v != null && v > 0);
    if (!values.length) return null;
    return metric.lowerIsBetter ? Math.min(...values) : Math.max(...values);
  };

  const relativeTo = (metric, value) => {
    const best = trackedBest(metric);
    if (best == null || value == null || value <= 0) return null;
    return metric.lowerIsBetter ? (best / value) * 100 : (value / best) * 100;
  };

  const sessionTrendData = sessionSeries.map((point) => {
    const row = { label: point.label, isCurrent: point.isCurrent };
    for (const metric of TRACKED) {
      row[metric.key] = relativeTo(metric, point[metric.key]);
      row[`${metric.key}Raw`] = point[metric.key];
    }
    return row;
  });

  // One padded range covering all three lines; the top is always 100 because
  // that is by definition the user's best session.
  const relativeValues = sessionTrendData
    .flatMap((row) => TRACKED.map((m) => row[m.key]))
    .filter((v) => v != null);
  const relativeFloor = relativeValues.length
    ? Math.max(0, Math.floor((Math.min(...relativeValues) - 4) / 5) * 5)
    : 0;
  const relativeDomain = [relativeFloor, 100];
  const relativeStep = Math.max(5, Math.round((100 - relativeFloor) / 4 / 5) * 5);
  const relativeTicks = [];
  for (let v = relativeFloor; v < 100; v += relativeStep) relativeTicks.push(v);
  relativeTicks.push(100);

  const enoughForTrendChart = sessionTrendData.length >= 2;

  // ---------------------------------------------------------
  // 📈 THIS SESSION VS PAST AVERAGES
  // The comparison itself lives in lib/trendAnalysis so this summary and the
  // full progress page always reach the same verdict.
  // ---------------------------------------------------------
  const {
    comparedMetrics,
    trendScore,
    trend,
    sessionsLabel: trendSessionsLabel,
  } = buildTrend(sessionData, pastSessions);

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
          style={primaryButtonStyle}
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

        {/* Total Punches - spans the full row so the odd card out never
            leaves a gap beside it. */}
        <div
          style={{
            gridColumn: '1 / -1',
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
            <BarChart
              data={punchAccuracyData}
              margin={{ top: 28, right: 16, left: 0, bottom: 8 }}
              barCategoryGap="20%"
            >
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
              <Bar dataKey="value" maxBarSize={300} isAnimationActive={false}>
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
            <BarChart
              data={reactionTimeData}
              margin={{ top: 28, right: 16, left: 0, bottom: 8 }}
              barCategoryGap="20%"
            >
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
              <Bar dataKey="time" maxBarSize={300} isAnimationActive={false}>
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

        {/* Progress vs past sessions */}
        <section style={cardStyle}>
          <ChartHeader
            title="Progress vs past sessions"
            right={
              trend ? (
                <div style={{ textAlign: 'right' }}>
                  <div style={eyebrowStyle}>OVERALL CHANGE</div>
                  <div
                    style={{
                      fontSize: '2rem',
                      fontWeight: '800',
                      lineHeight: '1.1',
                      color: trend.color,
                    }}
                  >
                    {trendScore >= 0 ? '+' : ''}
                    {trendScore.toFixed(1)}
                    <span style={{ color: trend.color }}>%</span>
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: 'right' }}>
                  <div style={eyebrowStyle}>SESSIONS ON RECORD</div>
                  <div style={{ fontSize: '2rem', fontWeight: '800', lineHeight: '1.1', color: "#ffffff" }}>
                    {pastSessions.length + 1}
                  </div>
                </div>
              )
            }
          />

          {/* Headline verdict */}
          <div style={{ textAlign: 'center', padding: '28px 0 24px' }}>
            <div style={{ color: "#b0b0b8", fontSize: '1.25rem' }}>You are...</div>
            <div
              style={{
                fontSize: 'clamp(2.25rem, 6vw, 4rem)',
                fontWeight: '800',
                letterSpacing: '-0.01em',
                lineHeight: '1.1',
                marginTop: '8px',
                color: trend ? trend.color : "#ffffff",
              }}
            >
              {trend ? trend.headline : 'Just getting started'}
            </div>
            <p style={{ color: "#8a8a8a", fontSize: '1rem', marginTop: '12px' }}>
              {trend
                ? `${trend.note} Measured ${trendSessionsLabel}.`
                : 'No past sessions on record yet - finish another session and your trend will show up here.'}
            </p>
          </div>

          {trend && (
            <>
              <div style={dividerStyle} />
              {comparedMetrics.map((m) => {
                const better = m.change >= 0;
                const deltaColor = better ? GRADE_GREEN : GRADE_RED;
                return (
                  <div
                    key={m.label}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '14px',
                      padding: '14px 0',
                      borderBottom: "1px solid #1f1f1f",
                      flexWrap: 'wrap',
                    }}
                  >
                    <span
                      style={{
                        width: '11px',
                        height: '11px',
                        borderRadius: '3px',
                        background: deltaColor,
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ flex: 1, color: "#e8e8e8", fontSize: '1.05rem', minWidth: '140px' }}>
                      {m.label}
                    </span>
                    <span style={{ color: "#9a9a9a", fontSize: '1rem', minWidth: '110px', textAlign: 'right' }}>
                      {m.format(m.past)} avg
                    </span>
                    <span style={{ color: "#ffffff", fontSize: '1rem', fontWeight: '700', minWidth: '90px', textAlign: 'right' }}>
                      {m.format(m.current)}
                    </span>
                    <span style={{ color: deltaColor, fontSize: '1rem', fontWeight: '700', minWidth: '80px', textAlign: 'right' }}>
                      {m.rawChange >= 0 ? '+' : ''}
                      {m.rawChange.toFixed(1)}%
                    </span>
                  </div>
                );
              })}
              <div style={{ marginTop: '20px' }}>
                <ChartFooter
                  items={[
                    { name: 'Better than your average', color: GRADE_GREEN },
                    { name: 'Below your average', color: GRADE_RED },
                  ]}
                  note={`Past average from ${pastSessions.length} session${pastSessions.length === 1 ? '' : 's'}`}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'center', marginTop: '28px' }}>
                <button
                  onClick={() => onViewProgress()}
                  style={primaryButtonStyle}
                >
                  View full progress analysis →
                </button>
              </div>
            </>
          )}
        </section>

        {/* Performance over sessions */}
        <section style={cardStyle}>
          <ChartHeader
            title="Performance over sessions"
            right={
              <div style={{ display: 'flex', alignItems: 'center', gap: '32px', flexWrap: 'wrap' }}>
                {TRACKED.map((metric) => {
                  const value = sessionData.summary?.[metric.summaryKey];
                  return (
                    <span key={metric.key} style={{ display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ width: '26px', height: '3px', borderRadius: '999px', background: metric.color }} />
                      <span style={eyebrowStyle}>{metric.label.toUpperCase()}</span>
                      <span style={{ fontSize: '1.05rem', fontWeight: '700', color: "#ffffff" }}>
                        {value ? metric.format(value) : '-'}
                      </span>
                    </span>
                  );
                })}
              </div>
            }
          />

          {enoughForTrendChart ? (
            <>
              <ResponsiveContainer width="100%" height={380}>
                <LineChart data={sessionTrendData} margin={{ top: 24, right: 16, left: 8, bottom: 8 }}>
                  <CartesianGrid vertical={false} stroke="#232323" />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={{ stroke: "#2b2b2b" }}
                    tick={{ fill: "#9a9a9a", fontSize: 13 }}
                    interval="preserveStartEnd"
                    minTickGap={28}
                    dy={10}
                    height={44}
                  />
                  <YAxis
                    domain={relativeDomain}
                    ticks={relativeTicks}
                    tickLine={false}
                    axisLine={false}
                    width={72}
                    tick={{ fill: "#8a8a8a", fontSize: 12 }}
                    label={{
                      value: '% of your best',
                      angle: -90,
                      position: 'insideLeft',
                      fill: "#8a8a8a",
                      fontSize: 12,
                      style: { textAnchor: 'middle' },
                    }}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    cursor={{ stroke: "#3a3a3a" }}
                    // Show what was actually recorded, not the scaled number.
                    formatter={(value, name, entry) => {
                      const metric = TRACKED.find((m) => m.label === name);
                      const raw = metric ? entry?.payload?.[`${metric.key}Raw`] : null;
                      return [raw != null ? metric.format(raw) : '-', name];
                    }}
                  />
                  {TRACKED.map((metric) => (
                    <Line
                      key={metric.key}
                      type="monotone"
                      dataKey={metric.key}
                      name={metric.label}
                      stroke={metric.color}
                      strokeWidth={2}
                      connectNulls
                      isAnimationActive={false}
                      dot={{ r: 4, fill: "#101010", stroke: metric.color, strokeWidth: 2 }}
                      activeDot={{ r: 6, fill: metric.color, stroke: "#101010", strokeWidth: 2 }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>

              <ChartFooter
                items={TRACKED.map((m) => ({ name: m.label, color: m.color }))}
                note="Each line is scaled against your best session - higher is always better"
              />
            </>
          ) : (
            <p style={{ color: "#8a8a8a", fontSize: '1rem', padding: '32px 0', textAlign: 'center' }}>
              Finish a second session and your three key metrics will chart here
              side by side.
            </p>
          )}
        </section>
      </div>

    </main>
  );
};

export default DashboardPage;