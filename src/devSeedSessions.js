// Dev-only training history generator.
//
// Builds a believable run of past sessions so the dashboard and its trend
// section can be seen the way a user with months of training would see them,
// without having to play dozens of games by hand.
//
// Loaded only in dev (see main.jsx). From the browser console:
//
//   seedSessionHistory()      // 14 sessions over ~6 weeks, improving
//   seedSessionHistory(20)    // 20 sessions
//   seedSessionHistory(10, { trend: 'decline' })  // losing form
//   seedSessionHistory(10, { trend: 'flat' })     // plateau
//   clearSessionHistory()     // remove seeded sessions only
//   clearSessionHistory(true) // remove every stored session
//
// Seeded sessions carry seeded: true so clearing them never touches a real
// session the user actually played.

import { saveSessionLocally, readLocalSessions } from './config/sessionStore'

const SEED_PREFIX = 'demo-seed-'

// Deterministic PRNG so the same call always produces the same history and
// a screenshot can be reproduced later.
const makeRandom = (seed) => {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

const clamp = (v, min, max) => Math.min(max, Math.max(min, v))
const round1 = (v) => Math.round(v * 10) / 10

/**
 * Generate and store a run of past sessions.
 *
 * @param {number} count  how many sessions to create (oldest first)
 * @param {object} options
 * @param {'improve'|'flat'|'decline'} options.trend  shape of the progression
 * @param {number} options.daysApart  spacing between sessions
 * @param {number} options.seed  PRNG seed
 */
export function seedSessionHistory(count = 14, options = {}) {
  const { trend = 'improve', daysApart = 3, seed = 20260112 } = options
  const random = makeRandom(seed)
  // Jitter in both directions, so noise never biases the curve.
  const noise = (spread) => (random() - 0.5) * 2 * spread

  // How far the metrics travel from start to finish.
  const slope = trend === 'improve' ? 1 : trend === 'decline' ? -1 : 0

  const sessions = []

  for (let i = 0; i < count; i += 1) {
    // 0 at the oldest session, 1 at the newest.
    const progress = count > 1 ? i / (count - 1) : 1
    // A declining run starts from the strong end and falls off.
    const p = slope >= 0 ? progress : 1 - progress

    const accuracy = clamp(Math.round(71 + 20 * p + noise(3)), 0, 100)
    const velocity = round1(clamp(4.6 + 1.5 * p + noise(0.18), 3, 12))
    const reaction = Math.round(clamp(342 - 100 * p + noise(14), 120, 600))

    const targetsSpawned = Math.round(92 + noise(12))
    const hitRate = clamp(0.17 + 0.2 * p + noise(0.03), 0.05, 0.95)
    const targetsHit = Math.round(targetsSpawned * hitRate)
    // Everything not landed was either slipped or blocked; dodging leads
    // because that is what the defense insight copy expects to see.
    const notHit = targetsSpawned - targetsHit
    const blocked = Math.round(notHit * clamp(0.35 + noise(0.06), 0.2, 0.6))
    const dodged = notHit - blocked

    const totalPunches = Math.round(targetsSpawned * clamp(0.8 + noise(0.08), 0.5, 1))

    // Sessions run oldest -> newest, with the newest a few hours ago.
    const daysAgo = (count - 1 - i) * daysApart
    const recordedAt = new Date(
      Date.now() - daysAgo * 86400000 - Math.round(random() * 6 * 3600000)
    )

    // Punch types keep a stable pecking order: the jab is cleanest and
    // quickest, the uppercut is the one that lags.
    const punchAccuracy = {
      jab: clamp(Math.round(accuracy + 4 + noise(2)), 0, 100),
      hook: clamp(Math.round(accuracy - 2 + noise(2)), 0, 100),
      uppercut: clamp(Math.round(accuracy - 7 + noise(3)), 0, 100),
    }
    const reactionTimes = {
      jab: Math.round(reaction - 18 + noise(8)),
      hook: Math.round(reaction + 6 + noise(8)),
      uppercut: Math.round(reaction + 24 + noise(10)),
    }

    // Six samples across a ~30s session, drifting down slightly as the
    // round wears on.
    const timeline = Array.from({ length: 6 }, (_, point) => {
      const fatigue = point / 5
      return {
        t: (point + 1) * 5,
        velocity: round1(clamp(velocity + 0.35 - fatigue * 0.7 + noise(0.12), 1, 15)),
        accuracy: clamp(Math.round(accuracy + 3 - fatigue * 6 + noise(2)), 0, 100),
      }
    })

    sessions.push({
      session_id: `${SEED_PREFIX}${String(i + 1).padStart(2, '0')}`,
      timestamp: recordedAt.toISOString(),
      seeded: true,
      summary: {
        score: targetsHit,
        avg_velocity: velocity,
        avg_reaction_time: reaction,
        accuracy,
        critical_prevention: Math.round(hitRate * 100),
        total_punches: totalPunches,
      },
      punch_accuracy: punchAccuracy,
      reaction_times: reactionTimes,
      defense: { blocked, dodged, hit: targetsHit },
      timeline,
    })
  }

  sessions.forEach(saveSessionLocally)

  const newest = sessions[sessions.length - 1]
  console.log(
    `🌱 Seeded ${sessions.length} ${trend} session(s), ` +
      `${new Date(sessions[0].timestamp).toLocaleDateString()} -> ` +
      `${new Date(newest.timestamp).toLocaleDateString()}`
  )
  console.table(
    sessions.map((s) => ({
      session: s.session_id,
      date: new Date(s.timestamp).toLocaleDateString(),
      accuracy: `${s.summary.accuracy}%`,
      speed: `${s.summary.avg_velocity} m/s`,
      reaction: `${s.summary.avg_reaction_time} ms`,
      hitRate: `${s.summary.critical_prevention}%`,
    }))
  )
  console.log('↻ Reload the dashboard to see it.')

  return sessions
}

/**
 * Remove seeded sessions. Pass true to clear real sessions too.
 */
export function clearSessionHistory(includeReal = false) {
  const targets = readLocalSessions().filter(
    (s) => includeReal || s.seeded || s.session_id.startsWith(SEED_PREFIX)
  )

  targets.forEach((s) => localStorage.removeItem(`demo_session_${s.session_id}`))
  console.log(`🧹 Cleared ${targets.length} session(s). Reload to see the change.`)
  return targets.length
}

// Exposed for console use in dev builds.
if (typeof window !== 'undefined') {
  window.seedSessionHistory = seedSessionHistory
  window.clearSessionHistory = clearSessionHistory
}
