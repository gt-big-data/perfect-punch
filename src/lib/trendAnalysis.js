import { GRADE_GREEN, GRADE_GREEN_SOFT, GRADE_YELLOW, GRADE_RED } from '../pages/analysisTheme'

// The one place that decides whether a boxer is improving. Both the dashboard
// summary and the progress page read from here so they can never disagree.

// How many of the account's most recent past sessions count as "your
// average". Older sessions stop being representative of current form.
export const TREND_WINDOW = 10

/**
 * Share of incoming targets that actually landed on the user.
 * Taken from the defense split so the count and the percentage beside it can
 * never disagree; critical_prevention is only a fallback when it is empty.
 */
export const sessionHitRate = (session) => {
  const d = session?.defense || {}
  const total = (d.hit || 0) + (d.dodged || 0) + (d.blocked || 0)
  return total > 0
    ? Math.round(((d.hit || 0) / total) * 100)
    : Math.round(session?.summary?.critical_prevention ?? 0)
}

const isUsable = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0

/**
 * The three metrics every comparison is built from. `pick` works on any
 * session object, current or past, so one definition drives both sides.
 */
export const METRIC_DEFS = [
  {
    key: 'accuracy',
    label: 'Accuracy',
    short: 'Accuracy',
    unit: '%',
    pick: (s) => s?.summary?.accuracy,
    format: (v) => `${Math.round(v)}%`,
    axisFormat: (v) => `${Math.round(v)}`,
    description: 'Share of your punches that were the correct punch, thrown clean.',
  },
  {
    key: 'reaction',
    label: 'Reaction time',
    short: 'Reaction',
    unit: 'ms',
    lowerIsBetter: true,
    pick: (s) => s?.summary?.avg_reaction_time,
    format: (v) => `${Math.round(v)} ms`,
    axisFormat: (v) => `${Math.round(v)}`,
    description: 'Time from a target appearing to your punch landing. Lower is better.',
  },
  {
    key: 'hitRate',
    label: 'Target hit rate',
    short: 'Hit rate',
    unit: '%',
    pick: sessionHitRate,
    format: (v) => `${Math.round(v)}%`,
    axisFormat: (v) => `${Math.round(v)}`,
    description: 'Share of incoming targets you landed on rather than missing.',
  },
]

export const TREND_TIERS = [
  {
    min: 8,
    headline: 'Improving!',
    color: GRADE_GREEN,
    note: 'Clear gains across the board - whatever you changed is working.',
  },
  {
    min: 2.5,
    headline: 'Slightly improving',
    color: GRADE_GREEN_SOFT,
    note: 'Moving the right way. Small, steady gains compound fast.',
  },
  {
    min: -2.5,
    headline: 'About the same',
    color: GRADE_YELLOW,
    note: "You're holding your level. Push the pace to break the plateau.",
  },
  {
    min: -Infinity,
    headline: 'Slowing down',
    color: GRADE_RED,
    note: 'Down on your average - check your rest, guard and footwork.',
  },
]

/**
 * Compare one session against a run of past sessions.
 *
 * Every metric is converted to "percent better than the past average" so the
 * three can be averaged into a single verdict. Reaction time is inverted on
 * the way in because a lower number is the better result.
 *
 * @returns {{ metrics, comparedMetrics, trendScore, trend, sessionsLabel }}
 *   trend and trendScore are null when there is no history to compare against.
 */
export const buildTrend = (current, pastSessions = []) => {
  // Average of a metric across past sessions, ignoring sessions that never
  // recorded it (a missing value would otherwise drag the average down).
  const pastAverage = (pick) => {
    const values = pastSessions.map(pick).filter(isUsable)
    return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null
  }

  const best = (def) => {
    const values = pastSessions.concat(current ? [current] : []).map(def.pick).filter(isUsable)
    if (!values.length) return null
    return def.lowerIsBetter ? Math.min(...values) : Math.max(...values)
  }

  const metrics = METRIC_DEFS.map((def) => ({
    ...def,
    current: def.pick(current),
    past: pastAverage(def.pick),
    best: best(def),
  }))

  const comparedMetrics = metrics
    .filter((m) => m.past != null && isUsable(m.current))
    .map((m) => {
      const rawChange = ((m.current - m.past) / m.past) * 100
      return {
        ...m,
        rawChange, // signed movement of the raw number
        change: m.lowerIsBetter ? -rawChange : rawChange, // positive = better
      }
    })

  const trendScore = comparedMetrics.length
    ? comparedMetrics.reduce((sum, m) => sum + m.change, 0) / comparedMetrics.length
    : null

  const trend = trendScore == null ? null : TREND_TIERS.find((t) => trendScore >= t.min)

  const sessionsLabel =
    pastSessions.length === 1
      ? 'vs your previous session'
      : `vs your last ${pastSessions.length} sessions`

  return { metrics, comparedMetrics, trendScore, trend, sessionsLabel }
}

/**
 * Sessions laid out oldest -> newest for charting, with the current session
 * appended as the final point so the line ends on "today".
 */
export const buildSeries = (current, pastSessions = []) => {
  const ordered = [...pastSessions].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  )
  const all = current ? [...ordered, current] : ordered

  return all.map((session, index) => {
    const point = {
      index,
      sessionId: session.session_id,
      isCurrent: current ? index === all.length - 1 : false,
      label: session.timestamp
        ? new Date(session.timestamp).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          })
        : `#${index + 1}`,
    }
    for (const def of METRIC_DEFS) {
      const value = def.pick(session)
      point[def.key] = isUsable(value) ? value : null
    }
    return point
  })
}
