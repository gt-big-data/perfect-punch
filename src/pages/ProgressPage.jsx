import React from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { useTrainingData } from "../hooks/useTrainingData";
import { buildTrend, buildSeries, sessionHitRate } from "../lib/trendAnalysis";
import {
  RED_LIGHT,
  RED_MID,
  RED_DARK,
  GRADE_RED,
  GRADE_GREEN,
  percentColor,
  cardStyle,
  eyebrowStyle,
  dividerStyle,
  tooltipStyle,
  primaryButtonStyle,
  INK,
  INK_SOFT,
  INK_MUTED,
  INK_FAINT,
  SURFACE,
  PAGE_BG,
  BORDER_SOFT,
  GRID,
} from "./analysisTheme";
import { ChartHeader, ChartFooter } from "./analysisChrome";

// Deep dive on how the session on screen compares with everything before it.
// The dashboard answers "am I improving?" in one word; this page shows the
// working behind that answer.

const ProgressPage = ({
  onNavigate,
  backLabel = "← Back to Dashboard",
  sessionId = null,
  metricsData = null,
}) => {
  const { sessionData, pastSessions, loading } = useTrainingData({
    sessionId,
    metricsData,
  });

  const centered = {
    minHeight: "100vh",
    color: "white",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "column",
    gap: "24px",
    background: PAGE_BG,
  };

  if (loading) {
    return (
      <div style={centered}>
        <div style={{ fontSize: "1.5rem", color: "#b0b0b8" }}>
          Loading your progress...
        </div>
      </div>
    );
  }

  if (!sessionData) {
    return (
      <div style={centered}>
        <div style={{ fontSize: "1.5rem", fontWeight: "700", color: GRADE_RED }}>
          No session data found
        </div>
        <button onClick={() => onNavigate("dashboard")} style={primaryButtonStyle}>
          {backLabel}
        </button>
      </div>
    );
  }

  // ---------------------------------------------------------
  // 📊 COMPARISON DATA
  // ---------------------------------------------------------
  const { comparedMetrics, trendScore, trend, sessionsLabel } = buildTrend(
    sessionData,
    pastSessions
  );
  const series = buildSeries(sessionData, pastSessions);
  const hasHistory = pastSessions.length > 0;

  const formatDate = (timestamp) => {
    if (!timestamp) return "Unknown";
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return "Unknown";
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const oldest = pastSessions[pastSessions.length - 1];
  const dateRange = hasHistory
    ? `${formatDate(oldest?.timestamp)} - ${formatDate(sessionData.timestamp)}`
    : formatDate(sessionData.timestamp);

  // Per-punch-type comparison: this session against the average of the same
  // punch across history, so a weak uppercut shows up as a weak uppercut
  // rather than being buried in the overall accuracy number.
  const punchTypes = [
    { key: "jab", name: "Jab" },
    { key: "hook", name: "Hook" },
    { key: "uppercut", name: "Uppercut" },
  ];

  const averageOf = (pick) => {
    const values = pastSessions
      .map(pick)
      .filter((v) => typeof v === "number" && Number.isFinite(v) && v > 0);
    return values.length
      ? values.reduce((sum, v) => sum + v, 0) / values.length
      : null;
  };

  const punchAccuracyComparison = punchTypes.map((type) => ({
    name: type.name,
    current: sessionData.punch_accuracy?.[type.key] ?? 0,
    past: averageOf((s) => s.punch_accuracy?.[type.key]) ?? 0,
  }));

  const reactionComparison = punchTypes.map((type) => ({
    name: type.name,
    current: sessionData.reaction_times?.[type.key] ?? 0,
    past: averageOf((s) => s.reaction_times?.[type.key]) ?? 0,
  }));

  // Defense mix as percentages so a long session and a short one compare
  // fairly against each other.
  const defenseShare = (session) => {
    const d = session?.defense || {};
    const total = (d.dodged || 0) + (d.blocked || 0) + (d.hit || 0);
    if (total === 0) return { dodged: 0, blocked: 0, hit: 0 };
    return {
      dodged: Math.round(((d.dodged || 0) / total) * 100),
      blocked: Math.round(((d.blocked || 0) / total) * 100),
      hit: Math.round(((d.hit || 0) / total) * 100),
    };
  };

  const currentDefense = defenseShare(sessionData);
  const pastDefenseShares = pastSessions.map(defenseShare);
  const avgDefenseShare = (key) =>
    pastDefenseShares.length
      ? Math.round(
          pastDefenseShares.reduce((sum, d) => sum + d[key], 0) /
            pastDefenseShares.length
        )
      : 0;

  const defenseComparison = [
    { name: "Dodged", current: currentDefense.dodged, past: avgDefenseShare("dodged"), color: RED_LIGHT },
    { name: "Blocked", current: currentDefense.blocked, past: avgDefenseShare("blocked"), color: RED_MID },
    { name: "Hit", current: currentDefense.hit, past: avgDefenseShare("hit"), color: RED_DARK },
  ];

  // Session-by-session table, newest first, with the current one on top.
  const historyRows = [
    { session: sessionData, isCurrent: true },
    ...pastSessions.map((s) => ({ session: s, isCurrent: false })),
  ];

  // ---------------------------------------------------------
  // 🎨 SHARED PIECES
  // ---------------------------------------------------------
  const PAST_COLOR = "#5a5a5a"; // the baseline is deliberately quiet
  const sectionGap = { display: "flex", flexDirection: "column", gap: "32px", width: "100%" };

  // A small "+4.2%" style chip, green when the change is an improvement.
  const DeltaChip = ({ metric }) => {
    const color = metric.change >= 0 ? GRADE_GREEN : GRADE_RED;
    return (
      <span
        style={{
          color,
          fontWeight: "700",
          fontSize: "0.95rem",
          background: `${color}1a`,
          border: `1px solid ${color}44`,
          borderRadius: "999px",
          padding: "3px 10px",
          whiteSpace: "nowrap",
        }}
      >
        {metric.rawChange >= 0 ? "+" : ""}
        {metric.rawChange.toFixed(1)}%
      </span>
    );
  };

  // One metric's whole story: where it is now, where it usually is, its best
  // ever, and the line showing how it got here.
  const MetricTrendCard = ({ metric }) => {
    const improving = metric.change >= 0;
    const lineColor = improving ? GRADE_GREEN : GRADE_RED;
    const values = series.map((p) => p[metric.key]).filter((v) => v != null);
    const min = Math.min(...values, metric.past);
    const max = Math.max(...values, metric.past);
    const pad = Math.max((max - min) * 0.25, max * 0.04, 0.5);

    return (
      <section style={cardStyle}>
        <ChartHeader
          title={metric.label}
          right={
            <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
              <div style={{ textAlign: "right" }}>
                <div style={eyebrowStyle}>THIS SESSION</div>
                <div style={{ fontSize: "1.75rem", fontWeight: "800", color: INK, lineHeight: "1.1" }}>
                  {metric.format(metric.current)}
                </div>
              </div>
              <DeltaChip metric={metric} />
            </div>
          }
        />

        <div
          style={{
            display: "flex",
            gap: "28px",
            flexWrap: "wrap",
            padding: "14px 0 6px",
            color: INK_MUTED,
            fontSize: "0.95rem",
          }}
        >
          <span>
            Your average{" "}
            <strong style={{ color: INK_SOFT }}>{metric.format(metric.past)}</strong>
          </span>
          <span>
            Personal best{" "}
            <strong style={{ color: INK_SOFT }}>
              {metric.best != null ? metric.format(metric.best) : "-"}
            </strong>
          </span>
        </div>

        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={series} margin={{ top: 12, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={{ stroke: "#2b2b2b" }}
              tick={{ fill: INK_MUTED, fontSize: 11 }}
              interval="preserveStartEnd"
              minTickGap={24}
              dy={8}
              height={32}
            />
            <YAxis
              domain={[min - pad, max + pad]}
              tickLine={false}
              axisLine={false}
              width={52}
              tick={{ fill: INK_FAINT, fontSize: 11 }}
              tickFormatter={metric.axisFormat}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              cursor={{ stroke: "#3a3a3a" }}
              formatter={(value) => [metric.format(value), metric.label]}
            />
            {/* The baseline every comparison on this page is made against. */}
            <ReferenceLine
              y={metric.past}
              stroke={PAST_COLOR}
              strokeDasharray="5 4"
              label={{
                value: "your average",
                position: "insideTopLeft",
                fill: INK_FAINT,
                fontSize: 11,
              }}
            />
            <Line
              type="monotone"
              dataKey={metric.key}
              stroke={lineColor}
              strokeWidth={2}
              connectNulls
              isAnimationActive={false}
              dot={({ cx, cy, payload, index }) =>
                cy == null ? null : (
                  <circle
                    key={`${metric.key}-${index}`}
                    cx={cx}
                    cy={cy}
                    // The session you are looking at is drawn solid so it
                    // stands out from the history behind it.
                    r={payload.isCurrent ? 6 : 3.5}
                    fill={payload.isCurrent ? lineColor : SURFACE}
                    stroke={lineColor}
                    strokeWidth={2}
                  />
                )
              }
              activeDot={{ r: 6, fill: lineColor, stroke: SURFACE, strokeWidth: 2 }}
            />
          </LineChart>
        </ResponsiveContainer>

        <p style={{ color: INK_FAINT, fontSize: "0.9rem", marginTop: "12px" }}>
          {metric.description}
        </p>
      </section>
    );
  };

  // Current vs past-average bars, used for both punch-type panels.
  const ComparisonBars = ({ data, formatValue, height = 260 }) => (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 20, right: 12, left: 0, bottom: 4 }} barGap={6}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis
          dataKey="name"
          tickLine={false}
          axisLine={{ stroke: "#2b2b2b" }}
          tick={{ fill: INK_MUTED, fontSize: 13 }}
          dy={8}
          height={40}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={56}
          tick={{ fill: INK_FAINT, fontSize: 12 }}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          cursor={{ fill: "#ffffff0a" }}
          formatter={(value, name) => [formatValue(value), name]}
        />
        <Bar dataKey="past" name="Your average" fill={PAST_COLOR} radius={[6, 6, 0, 0]} isAnimationActive={false} />
        <Bar dataKey="current" name="This session" fill={RED_MID} radius={[6, 6, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );

  // ---------------------------------------------------------
  // 🖥️ PAGE
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
        background: PAGE_BG,
      }}
    >
      {/* Navigation */}
      <nav
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "16px",
          gap: "16px",
          flexWrap: "wrap",
        }}
      >
        <div style={{ color: "#b0b0b8" }}>
          <div style={{ fontSize: "0.9rem" }}>{dateRange}</div>
          <div style={{ fontSize: "0.75rem", color: "#9ca3af", marginTop: "2px" }}>
            {hasHistory
              ? `${pastSessions.length + 1} sessions compared`
              : "First session on record"}
          </div>
        </div>

        <button onClick={() => onNavigate("dashboard")} style={primaryButtonStyle}>
          {backLabel}
        </button>
      </nav>

      {/* Title */}
      <div style={{ textAlign: "center", width: "100%" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "20px",
            marginBottom: "8px",
            flexWrap: "nowrap",
          }}
        >
          <img
            src="/perfect-punch-logo.png"
            alt="PerfectPunch logo"
            style={{ height: "clamp(3rem, 7vw, 5.5rem)", width: "auto", flexShrink: 0 }}
          />
          <h1
            style={{
              fontSize: "clamp(1.75rem, 4.6vw, 3.75rem)",
              fontWeight: "800",
              color: INK,
              letterSpacing: "-0.01em",
            }}
          >
            PROGRESS ANALYSIS
          </h1>
        </div>
        <p style={{ fontSize: "1.25rem", color: "#b0b0b8" }}>
          This session measured against everything before it
        </p>
        <p style={{ fontSize: "1.125rem", marginTop: "4px", color: "#9ca3af" }}>
          {hasHistory ? sessionsLabel : "No past sessions to compare against yet"}
        </p>
      </div>

      <div style={sectionGap}>
        {/* ------------------------------------------------- */}
        {/* VERDICT                                           */}
        {/* ------------------------------------------------- */}
        <section style={cardStyle}>
          <ChartHeader
            title="Overall verdict"
            right={
              trend ? (
                <div style={{ textAlign: "right" }}>
                  <div style={eyebrowStyle}>OVERALL CHANGE</div>
                  <div
                    style={{
                      fontSize: "2rem",
                      fontWeight: "800",
                      lineHeight: "1.1",
                      color: trend.color,
                    }}
                  >
                    {trendScore >= 0 ? "+" : ""}
                    {trendScore.toFixed(1)}
                    <span style={{ color: trend.color }}>%</span>
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: "right" }}>
                  <div style={eyebrowStyle}>SESSIONS ON RECORD</div>
                  <div style={{ fontSize: "2rem", fontWeight: "800", lineHeight: "1.1", color: INK }}>
                    {pastSessions.length + 1}
                  </div>
                </div>
              )
            }
          />

          <div style={{ textAlign: "center", padding: "28px 0 24px" }}>
            <div style={{ color: "#b0b0b8", fontSize: "1.25rem" }}>You are...</div>
            <div
              style={{
                fontSize: "clamp(2.25rem, 6vw, 4rem)",
                fontWeight: "800",
                letterSpacing: "-0.01em",
                lineHeight: "1.1",
                marginTop: "8px",
                color: trend ? trend.color : INK,
              }}
            >
              {trend ? trend.headline : "Just getting started"}
            </div>
            <p style={{ color: INK_FAINT, fontSize: "1rem", marginTop: "12px" }}>
              {trend
                ? `${trend.note} Measured ${sessionsLabel}.`
                : "Finish another session and this page will fill in with your trend."}
            </p>
          </div>

          {trend && (
            <>
              <div style={dividerStyle} />
              {/* Each metric's contribution to the verdict above. */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                  gap: "16px",
                  marginTop: "24px",
                }}
              >
                {comparedMetrics.map((m) => {
                  const color = m.change >= 0 ? GRADE_GREEN : GRADE_RED;
                  return (
                    <div
                      key={m.key}
                      style={{
                        background: "#161616",
                        border: `1px solid ${BORDER_SOFT}`,
                        borderRadius: "14px",
                        padding: "18px 20px",
                      }}
                    >
                      <div style={eyebrowStyle}>{m.short.toUpperCase()}</div>
                      <div
                        style={{
                          fontSize: "1.6rem",
                          fontWeight: "800",
                          color: INK,
                          marginTop: "6px",
                          lineHeight: "1.1",
                        }}
                      >
                        {m.format(m.current)}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "10px",
                          marginTop: "10px",
                        }}
                      >
                        <span style={{ color: INK_MUTED, fontSize: "0.9rem" }}>
                          avg {m.format(m.past)}
                        </span>
                        <span style={{ color, fontWeight: "700", fontSize: "0.95rem" }}>
                          {m.rawChange >= 0 ? "+" : ""}
                          {m.rawChange.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p style={{ color: INK_FAINT, fontSize: "0.9rem", marginTop: "18px" }}>
                The overall change is the average of these three. Reaction time counts
                as an improvement when it goes <em>down</em>, which is why a negative
                number there still reads green.
              </p>
            </>
          )}
        </section>

        {/* ------------------------------------------------- */}
        {/* METRIC BY METRIC                                  */}
        {/* ------------------------------------------------- */}
        {hasHistory && (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))",
                gap: "32px",
              }}
            >
              {comparedMetrics.map((metric) => (
                <MetricTrendCard key={metric.key} metric={metric} />
              ))}
            </div>

            {/* --------------------------------------------- */}
            {/* PUNCH TYPES                                   */}
            {/* --------------------------------------------- */}
            <section style={cardStyle}>
              <ChartHeader
                title="Accuracy by punch type"
                statLabel="THIS SESSION VS AVERAGE"
                statValue={`${Math.round(
                  punchAccuracyComparison.reduce((s, d) => s + d.current, 0) /
                    punchAccuracyComparison.length
                )}`}
                statUnit="%"
                statColor={percentColor(
                  punchAccuracyComparison.reduce((s, d) => s + d.current, 0) /
                    punchAccuracyComparison.length
                )}
              />
              <ComparisonBars data={punchAccuracyComparison} formatValue={(v) => `${Math.round(v)}%`} />
              <ChartFooter
                items={[
                  { name: "Your average", color: PAST_COLOR },
                  { name: "This session", color: RED_MID },
                ]}
                note="Taller is better"
              />
            </section>

            <section style={cardStyle}>
              <ChartHeader
                title="Reaction time by punch type"
                statLabel="THIS SESSION VS AVERAGE"
                statValue={`${Math.round(
                  reactionComparison.reduce((s, d) => s + d.current, 0) /
                    reactionComparison.length
                )}`}
                statUnit=" ms"
              />
              <ComparisonBars data={reactionComparison} formatValue={(v) => `${Math.round(v)} ms`} />
              <ChartFooter
                items={[
                  { name: "Your average", color: PAST_COLOR },
                  { name: "This session", color: RED_MID },
                ]}
                note="Shorter is better"
              />
            </section>

            {/* --------------------------------------------- */}
            {/* DEFENSE MIX                                   */}
            {/* --------------------------------------------- */}
            <section style={cardStyle}>
              <ChartHeader
                title="Defense mix vs your average"
                statLabel="STOPPED THIS SESSION"
                statValue={`${currentDefense.dodged + currentDefense.blocked}`}
                statUnit="%"
                statColor={percentColor(currentDefense.dodged + currentDefense.blocked)}
              />
              <ResponsiveContainer width="100%" height={280}>
                <BarChart
                  data={defenseComparison}
                  margin={{ top: 20, right: 12, left: 0, bottom: 4 }}
                  barGap={6}
                >
                  <CartesianGrid vertical={false} stroke={GRID} />
                  <XAxis
                    dataKey="name"
                    tickLine={false}
                    axisLine={{ stroke: "#2b2b2b" }}
                    tick={{ fill: INK_MUTED, fontSize: 13 }}
                    dy={8}
                    height={40}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={56}
                    tick={{ fill: INK_FAINT, fontSize: 12 }}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    cursor={{ fill: "#ffffff0a" }}
                    formatter={(value, name) => [`${Math.round(value)}%`, name]}
                  />
                  <Bar dataKey="past" name="Your average" fill={PAST_COLOR} radius={[6, 6, 0, 0]} isAnimationActive={false} />
                  <Bar dataKey="current" name="This session" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                    {defenseComparison.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <ChartFooter
                items={defenseComparison.map((d) => ({ name: d.name, color: d.color }))}
                note="Share of every target faced - grey bars are your average"
              />
            </section>

            {/* --------------------------------------------- */}
            {/* SESSION LOG                                   */}
            {/* --------------------------------------------- */}
            <section style={cardStyle}>
              <ChartHeader
                title="Session history"
                statLabel="SESSIONS"
                statValue={`${historyRows.length}`}
              />
              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    minWidth: "520px",
                    marginTop: "8px",
                  }}
                >
                  <thead>
                    <tr>
                      {["Date", "Accuracy", "Reaction", "Hit rate", "Punches"].map(
                        (head, index) => (
                          <th
                            key={head}
                            style={{
                              ...eyebrowStyle,
                              textAlign: index === 0 ? "left" : "right",
                              padding: "12px 10px",
                              borderBottom: `1px solid ${BORDER_SOFT}`,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {head.toUpperCase()}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {historyRows.map(({ session, isCurrent }) => {
                      const cell = {
                        padding: "13px 10px",
                        textAlign: "right",
                        borderBottom: `1px solid ${BORDER_SOFT}`,
                        color: isCurrent ? INK : INK_SOFT,
                        fontWeight: isCurrent ? "700" : "400",
                        fontSize: "1rem",
                        whiteSpace: "nowrap",
                      };
                      return (
                        <tr
                          key={session.session_id}
                          // The session you came from is tinted so it is easy
                          // to find among the rest.
                          style={{ background: isCurrent ? "#ffffff08" : "transparent" }}
                        >
                          <td style={{ ...cell, textAlign: "left" }}>
                            {formatDate(session.timestamp)}
                            {isCurrent && (
                              <span
                                style={{
                                  marginLeft: "10px",
                                  fontSize: "0.72rem",
                                  letterSpacing: "0.1em",
                                  color: RED_MID,
                                  border: `1px solid ${RED_MID}66`,
                                  borderRadius: "999px",
                                  padding: "2px 8px",
                                }}
                              >
                                THIS ONE
                              </span>
                            )}
                          </td>
                          <td style={cell}>{session.summary?.accuracy ?? 0}%</td>
                          <td style={cell}>
                            {Math.round(session.summary?.avg_reaction_time ?? 0)} ms
                          </td>
                          <td style={cell}>{sessionHitRate(session)}%</td>
                          <td style={cell}>{session.summary?.total_punches ?? 0}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p style={{ color: INK_FAINT, fontSize: "0.9rem", marginTop: "18px" }}>
                Newest first. Only the {pastSessions.length} most recent past sessions
                count toward your average, so old form never drags down a current read.
              </p>
            </section>
          </>
        )}
      </div>
    </main>
  );
};

export default ProgressPage;
