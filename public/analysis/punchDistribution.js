// Punch type distribution: types the user misses more often are prompted more often.
// Weights come from the user's RECENT_SESSIONS most recent saved sessions (as returned by GET /stats).

export const PUNCH_TYPES = ["jab", "hook", "uppercut"];
export const DEFAULT_WEIGHTS = { jab: 0.625, hook: 0.25, uppercut: 0.125 };   // no history / not signed in
export const RECENT_SESSIONS = 10;
export const MIN_WEIGHT = 0.1;       // every type keeps at least this share of the base distribution
export const REPEAT_DECAY = 0.9;     // a type picked again in a row keeps this fraction of its weight

// Total punches thrown and hit per type across the most recent sessions. Counting punches (rather than
// averaging per-session accuracy) makes sessions with more punches count more.
// `sessions` is newest first; sessions without an attempt list (old or non-browser rows) are skipped.
export function punchTotals(sessions, limit = RECENT_SESSIONS) {
  const totals = Object.fromEntries(PUNCH_TYPES.map((t) => [t, { thrown: 0, correct: 0 }]));
  const recent = (Array.isArray(sessions) ? sessions : [])
    .filter((s) => s && Array.isArray(s.punch_attempts))
    .slice(0, limit);
  for (const session of recent) {
    for (const attempt of session.punch_attempts) {
      const type = String(attempt?.predicted_punch ?? "").toLowerCase();   // the prompted target's type
      if (!totals[type]) continue;
      totals[type].thrown += 1;
      if (attempt.hit_target === true) totals[type].correct += 1;
    }
  }
  return totals;
}

// Base distribution: each type's miss rate divided by the sum of miss rates. Miss rates are smoothed
// ((misses + 1) / (thrown + 2)) so a type with no misses or no data still gets a share, then every type
// is raised to at least MIN_WEIGHT. Returns DEFAULT_WEIGHTS when there is no history at all.
export function baseWeights(totals) {
  const thrownAll = PUNCH_TYPES.reduce((n, t) => n + (totals?.[t]?.thrown ?? 0), 0);
  if (!thrownAll) return { ...DEFAULT_WEIGHTS };
  const rate = Object.fromEntries(PUNCH_TYPES.map((t) => {
    const { thrown = 0, correct = 0 } = totals[t] ?? {};
    return [t, (thrown - correct + 1) / (thrown + 2)];
  }));
  return applyFloor(normalize(rate), MIN_WEIGHT);
}

function normalize(w) {
  const sum = PUNCH_TYPES.reduce((n, t) => n + w[t], 0);
  return Object.fromEntries(PUNCH_TYPES.map((t) => [t, sum > 0 ? w[t] / sum : 1 / PUNCH_TYPES.length]));
}

// Pin types below `floor` to it and rescale the rest to share what is left; repeat until nothing is below.
function applyFloor(w, floor) {
  const pinned = new Set();
  for (;;) {
    const free = PUNCH_TYPES.filter((t) => !pinned.has(t));
    const freeSum = free.reduce((n, t) => n + w[t], 0), left = 1 - floor * pinned.size;
    const out = Object.fromEntries(PUNCH_TYPES.map((t) => [t, pinned.has(t) ? floor : w[t] / freeSum * left]));
    const low = free.filter((t) => out[t] < floor);
    if (!low.length) return out;
    low.forEach((t) => pinned.add(t));
  }
}

// Picks punch types. Picking the same type again in a row multiplies its weight by REPEAT_DECAY and shares
// the removed weight among the other types in proportion to their current weights. Picking a different
// type resets to the base distribution.
export class PunchPicker {
  constructor(base = DEFAULT_WEIGHTS) {
    this.base = { ...base };
    this.weights = { ...base };
    this.last = null;
  }

  next(random = Math.random) {
    const type = sample(this.weights, random());
    if (type === this.last) this.decay(type);
    else this.weights = { ...this.base };
    this.last = type;
    return type;
  }

  decay(type) {
    const removed = this.weights[type] * (1 - REPEAT_DECAY);
    const others = PUNCH_TYPES.filter((t) => t !== type);
    const othersSum = others.reduce((n, t) => n + this.weights[t], 0);
    this.weights[type] -= removed;
    for (const t of others) {
      this.weights[t] += othersSum > 0 ? removed * this.weights[t] / othersSum : removed / others.length;
    }
  }
}

function sample(weights, r) {
  let acc = 0;
  for (const t of PUNCH_TYPES) {
    acc += weights[t];
    if (r < acc) return t;
  }
  return PUNCH_TYPES[PUNCH_TYPES.length - 1];
}
