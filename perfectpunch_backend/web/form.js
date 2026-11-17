// Guard form check and stance calibration. Pure logic (no canvas, no DOM) so it runs under node
// (tools/check_form.mjs), like punchDetector.js.
//
// Works on MediaPipe *image* landmarks converted to square pixels (x * W, y * H; y points down).
// Everything is measured in body units so it holds at any camera distance:
//   sw = shoulder width (horizontal unit), hs = shoulder line → nose height (vertical unit).
// L / R are the user's anatomical sides; stance decides which is the lead and which the rear hand.

// ── Config ───────────────────────────────────────────────────────────────────
export const VIS_MIN = 0.5;               // same as the shown() filter in game.js
export const HAND_DROP_MARGIN = 0.40;     // personal drop threshold = calibrated hand height − this (hs)
export const HAND_DROP_FLOOR = 0.10, HAND_DROP_CEIL = 0.45;
export const HAND_DROP_ON_LEAD = 0.25, HAND_DROP_ON_REAR = 0.35;   // uncalibrated defaults
export const HYST_HAND = 0.12;            // a dropped hand must come back above on + this
export const FLARE_ON_DEFAULT = 0.30;     // elbow this far (sw) outside the shoulder line
export const FLARE_MARGIN = 0.20, HYST_FLARE = 0.08;
export const LIFT_ON = -0.10;             // elbow within 0.1 hs of the shoulder line counts as lifted
export const HYST_LIFT = 0.08;
export const CHIN_X_MAX = 0.55;           // rear wrist at most this far (sw) sideways from the nose
export const CHIN_Y_TOL = 0.15;           // …and at most this far (hs) below the chin
export const CHIN_X_MARGIN = 0.20, CHIN_Y_MARGIN = 0.20, HYST_CHIN = 0.08;
export const FAULT_MIN_ON_S = 0.40, FAULT_MIN_OFF_S = 0.25;   // anti-flicker
export const DEFENSE_MIN_ON_S = 0.15;     // faster cue while an attack is incoming
export const DEFENSE_ELBOW_FACTOR = 1.5;  // dodging makes elbows noisy: slower elbow faults while defending
export const POST_PUNCH_GRACE_S = 0.25;
export const RETURN_LATE_S = 0.70;        // from the end of a punch
export const FORM_EMA_TAU_S = 1.0;        // meter smoothing
export const CUE_MIN_S = 0.8, CUE_REPEAT_S = 2.0, CUE_STALE_S = 1.0;
export const VIS_WINDOW_S = 2.0, VIS_BAD_FRACTION = 0.5;

export const CAL_HOLD_S = 1.5, CAL_FLICKER_GRACE_S = 0.2;
export const CAL_HAND_MIN_LEAD = 0.45, CAL_HAND_MIN_REAR = 0.55;
export const CAL_FLARE_MAX = 0.20, CAL_LIFT_MAX = -0.15;
export const CAL_SW_MIN = 0.12, CAL_SW_MAX = 0.45;   // shoulder width as a fraction of the frame width
export const CAL_CENTER_FRAC = 0.60;      // shoulder midpoint must be in the middle 60% of the frame
export const CAL_STILL_MAX_SPEED = 3;     // same as GUARD_MAX_SPEED in punchDetector.js
export const CAL_HINT_AFTER_S = 8, CAL_SKIP_AFTER_S = 20;

const BASE_W = 960, MIN_SHOULDER_PX = 40;   // same shoulder-width floor as posePoints() in game.js
const MAX_DT = 0.1;                         // a stalled frame can't count as a long hold
const NOSE = 0, MOUTH_L = 9, MOUTH_R = 10;
const IDX = { L: { s: 11, e: 13, w: 15 }, R: { s: 12, e: 14, w: 16 } };
export const SIDES = ["L", "R"];
export const leadSide = (stance) => (stance === "southpaw" ? "R" : "L");
export const rearSide = (stance) => (stance === "southpaw" ? "L" : "R");

export const CUE_TEXT = {
  late_return: "BRING IT BACK", hands: "HANDS UP", chin: "COVER UP", elbow: "ELBOWS IN",
  hands_out: "HANDS OUT OF VIEW", low_vis: "NEED MORE LIGHT / STEP INTO VIEW",
};
const CUE_PRIORITY = ["late_return", "hands", "chin", "elbow", "hands_out", "low_vis"];
const TIPS = {
  hands: "Keep your gloves at cheek height between punches.",
  elbow: "Keep your elbows tucked to your ribs.",
  chin: "Keep your rear hand glued to your chin.",
  late_return: "Snap your hand straight back to guard after every punch.",
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
function median(values) {
  const s = [...values].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ── Metrics ──────────────────────────────────────────────────────────────────
/**
 * One frame of form measurements, or {valid: false, reason} when the upper body can't be measured
 * (reason: "no_pose" | "hands_out" | "low_vis").
 * `baseline` (calibrated) lets a hidden nose be estimated from the shoulders; `swFloor` (px) keeps the
 * unit sane when the user turns side-on.
 */
export function computeMetrics(lms, W, H, { stance = "orthodox", baseline = null, swFloor = 0 } = {}) {
  if (!lms) return { valid: false, reason: "no_pose" };
  const ok = (i) => {
    const l = lms[i];
    return !!l && (l.visibility ?? 1) >= VIS_MIN && l.x >= 0 && l.x <= 1 && l.y >= 0 && l.y <= 1;
  };
  const P = (i) => [lms[i].x * W, lms[i].y * H];
  if (!SIDES.every((s) => ok(IDX[s].s))) return { valid: false, reason: "low_vis" };
  // Wrists off the bottom edge are a dropped guard we can't measure: reported separately.
  for (const s of SIDES) if (!ok(IDX[s].w)) return { valid: false, reason: lms[IDX[s].w]?.y > 1 ? "hands_out" : "low_vis" };
  if (!SIDES.every((s) => ok(IDX[s].e))) return { valid: false, reason: "low_vis" };

  const pts = {};
  for (const s of SIDES) pts[s] = { s: P(IDX[s].s), e: P(IDX[s].e), w: P(IDX[s].w) };
  const sw = Math.max(MIN_SHOULDER_PX * W / BASE_W, Math.abs(pts.L.s[0] - pts.R.s[0]), swFloor);
  const shY = (pts.L.s[1] + pts.R.s[1]) / 2, midX = (pts.L.s[0] + pts.R.s[0]) / 2;

  let nose, hs, chinY;
  if (ok(NOSE)) {
    nose = P(NOSE);
    hs = Math.max(0.35 * sw, shY - nose[1]);
    const mouthY = ok(MOUTH_L) && ok(MOUTH_R) ? (P(MOUTH_L)[1] + P(MOUTH_R)[1]) / 2 : null;
    chinY = mouthY !== null && mouthY > nose[1] ? mouthY + 0.6 * (mouthY - nose[1]) : nose[1] + 0.25 * sw;
  } else if (baseline?.calibrated) {
    // Gloves in front of the face hide the nose: place the head from the shoulders and the calibrated size.
    hs = baseline.hs * sw;
    nose = [midX, shY - hs];
    chinY = shY - 0.55 * hs;
  } else {
    return { valid: false, reason: "low_vis" };
  }

  const rear = rearSide(stance);
  const m = { valid: true, sw, hs, shY, midX, chinY, nose, pts, handH: {}, flare: {}, lift: {}, elbowAng: {}, wristRel: {} };
  for (const s of SIDES) {
    const { s: sh, e, w } = pts[s];
    m.handH[s] = (shY - w[1]) / hs;                                         // 0 = shoulder line, 1 = nose height
    m.flare[s] = (Math.abs(e[0] - midX) - Math.abs(sh[0] - midX)) / sw;    // > 0 = elbow outside the shoulder
    m.lift[s] = (shY - e[1]) / hs;                                          // ≥ 0 = elbow at or above the shoulders
    const a = [sh[0] - e[0], sh[1] - e[1]], b = [w[0] - e[0], w[1] - e[1]];
    const cos = (a[0] * b[0] + a[1] * b[1]) / (Math.hypot(...a) * Math.hypot(...b) + 1e-8);
    m.elbowAng[s] = Math.acos(clamp(cos, -1, 1)) * 180 / Math.PI;           // 2-D, foreshortened: informational
    m.wristRel[s] = [(w[0] - nose[0]) / sw, (w[1] - chinY) / hs];
  }
  m.chinDx = Math.abs(m.wristRel[rear][0]);
  m.chinDy = m.wristRel[rear][1];
  m.chinCover = m.chinDx <= CHIN_X_MAX && m.chinDy <= CHIN_Y_TOL;
  return m;
}

export function defaultBaseline() {
  return { calibrated: false, sw: null, hs: null, handH: null, flare: null, lift: null, elbowAng: null, wristRel: null };
}

/** Fault thresholds, personalised from a calibrated baseline or the defaults. */
export function thresholds(baseline, stance = "orthodox") {
  const lead = leadSide(stance), rear = rearSide(stance), b = baseline?.calibrated ? baseline : null;
  const th = { handDropOn: {}, handDropOff: {}, flareOn: {}, flareOff: {} };
  for (const s of SIDES) {
    th.handDropOn[s] = b ? clamp(b.handH[s] - HAND_DROP_MARGIN, HAND_DROP_FLOOR, HAND_DROP_CEIL)
                         : s === lead ? HAND_DROP_ON_LEAD : HAND_DROP_ON_REAR;
    th.handDropOff[s] = th.handDropOn[s] + HYST_HAND;
    th.flareOn[s] = b ? Math.max(FLARE_ON_DEFAULT, b.flare[s] + FLARE_MARGIN) : FLARE_ON_DEFAULT;
    th.flareOff[s] = th.flareOn[s] - HYST_FLARE;
  }
  // A guard held a little wide or low at calibration is that user's normal: don't cue it all round.
  th.chinXOn = b ? Math.max(CHIN_X_MAX, Math.abs(b.wristRel[rear][0]) + CHIN_X_MARGIN) : CHIN_X_MAX;
  th.chinYOn = b ? Math.max(CHIN_Y_TOL, b.wristRel[rear][1] + CHIN_Y_MARGIN) : CHIN_Y_TOL;
  return th;
}

// ── Fault state machine ──────────────────────────────────────────────────────
export const newFault = (kind, side) => ({ kind, side, state: "ok", badT: null, goodT: null, count: 0 });

/**
 * ok → fault after `bad` held for minOn seconds; fault → ok after `good` held for minOff seconds.
 * `bad` and `good` use different thresholds, so between them the state is held (hysteresis).
 * Time only advances on frames where this is called: skipped frames freeze the timers.
 * Returns true on the frame a fault starts.
 */
export function stepFault(f, bad, good, dt, minOn, minOff) {
  if (f.state === "ok") {
    if (!bad) { f.badT = null; return false; }
    f.badT = f.badT === null ? 0 : f.badT + dt;
    if (f.badT < minOn) return false;
    f.state = "fault"; f.badT = null; f.goodT = null; f.count += 1;
    return true;
  }
  if (!good) { f.goodT = null; return false; }
  f.goodT = f.goodT === null ? 0 : f.goodT + dt;
  if (f.goodT >= minOff) { f.state = "ok"; f.goodT = null; }
  return false;
}

// ── Form monitor (during a round) ────────────────────────────────────────────
export class FormMonitor {
  constructor(baseline = defaultBaseline(), { stance = "orthodox" } = {}) {
    this.baseline = baseline;
    this.stance = stance;
    this.lead = leadSide(stance);
    this.rear = rearSide(stance);
    this.th = thresholds(baseline, stance);
    this.swFloor = baseline.calibrated ? baseline.sw * 0.6 : 0;
    this.faults = { chin: newFault("chin", this.rear) };
    for (const s of SIDES) { this.faults[`hands${s}`] = newFault("hands", s); this.faults[`elbow${s}`] = newFault("elbow", s); }
    this.grace = { L: 0, R: 0 };      // seconds left of the post-punch grace per side
    this.ret = {};                    // side → {elapsed} while waiting for a hand to come back after a punch
    this.counts = { hands: 0, elbow: 0, chin: 0, late_return: 0 };
    this.duringDefense = 0;
    this.goodFrames = 0; this.evaluatedFrames = 0;
    this.formEMA = 1;
    this.lastT = null;
    this.visBuf = []; this.visArmed = true;
    this.cue = null; this.cueQueue = []; this.lastCue = {};
  }

  /**
   * Feed one frame. `trackers` = PunchDetector.trackers (only `state` is read), `events` = this frame's
   * punch events, `defending` = an attack is incoming.
   * Returns {valid, reason, metrics, faults: [{kind, side}], events: [{type, kind, side}], cue, formEMA}.
   */
  update(t, lms, W, H, { trackers = null, events = [], defending = false } = {}) {
    const dt = this.lastT === null ? 0 : clamp(t - this.lastT, 0, MAX_DT);
    this.lastT = t;
    const m = computeMetrics(lms, W, H, { stance: this.stance, baseline: this.baseline, swFloor: this.swFloor });
    const out = [], oneShots = [];

    for (const e of events) {
      if (e.type === "start") delete this.ret[e.side];   // doubling up: judged when that punch ends
      else if (e.type === "punch" || e.type === "dropped") this.ret[e.side] = { elapsed: Math.max(0, t - (e.endT ?? e.t)) };
    }
    // A punch legitimately lowers and extends the arm: skip that side while it's busy and just after.
    const gated = {};
    for (const s of SIDES) {
      if (trackers?.[s] && trackers[s].state !== "idle") this.grace[s] = POST_PUNCH_GRACE_S;
      else this.grace[s] = Math.max(0, this.grace[s] - dt);
      gated[s] = this.grace[s] > 0;
    }

    this.visBuf.push({ t, reason: m.valid ? null : m.reason });
    while (t - this.visBuf[0].t > VIS_WINDOW_S) this.visBuf.shift();
    const unknown = this.visBuf.filter((v) => v.reason), frac = unknown.length / this.visBuf.length;
    if (this.visArmed && frac > VIS_BAD_FRACTION && t - this.visBuf[0].t >= VIS_WINDOW_S * 0.75) {
      const handsOut = unknown.filter((v) => v.reason === "hands_out").length * 2 > unknown.length;
      oneShots.push({ kind: handsOut ? "hands_out" : "low_vis", side: null });
      this.visArmed = false;
    } else if (frac < VIS_BAD_FRACTION / 2) {
      this.visArmed = true;
    }

    if (!m.valid) {   // unknown frame: nothing counts, timers stay frozen
      return { valid: false, reason: m.reason, metrics: m, faults: [], events: out, cue: this.#pickCue(t, [], oneShots), formEMA: this.formEMA };
    }

    const th = this.th, evaluated = [];
    const minOn = defending ? DEFENSE_MIN_ON_S : FAULT_MIN_ON_S;
    const step = (f, bad, good, on) => {
      evaluated.push(f);
      if (!stepFault(f, bad, good, dt, on, FAULT_MIN_OFF_S)) return;
      this.counts[f.kind] += 1;
      if (defending) this.duringDefense += 1;
      out.push({ type: "fault", kind: f.kind, side: f.side, duringDefense: defending });
    };
    for (const s of SIDES) {
      if (gated[s]) continue;
      step(this.faults[`hands${s}`], m.handH[s] < th.handDropOn[s], m.handH[s] > th.handDropOff[s], minOn);
      step(this.faults[`elbow${s}`], m.flare[s] > th.flareOn[s] || m.lift[s] > LIFT_ON,
           m.flare[s] < th.flareOff[s] && m.lift[s] < LIFT_ON - HYST_LIFT, defending ? minOn * DEFENSE_ELBOW_FACTOR : minOn);
    }
    if (!gated[this.rear]) {
      // A fully dropped rear hand is already a "hands" fault; "chin" is the hand up but away from the chin.
      const dropped = m.handH[this.rear] < th.handDropOn[this.rear];
      step(this.faults.chin, !dropped && (m.chinDx > th.chinXOn || m.chinDy > th.chinYOn),
           m.chinDx < th.chinXOn - HYST_CHIN && m.chinDy < th.chinYOn - HYST_CHIN, minOn);
    }

    for (const s of SIDES) {
      const r = this.ret[s];
      if (!r) continue;
      r.elapsed += dt;
      const idle = !trackers?.[s] || trackers[s].state === "idle";
      if (idle && m.handH[s] >= th.handDropOff[s]) delete this.ret[s];
      else if (r.elapsed > RETURN_LATE_S) {
        delete this.ret[s];
        this.counts.late_return += 1;
        out.push({ type: "fault", kind: "late_return", side: s, duringDefense: defending });
        oneShots.push({ kind: "late_return", side: s });
      }
    }

    if (evaluated.length) {
      const good = evaluated.every((f) => f.state === "ok") ? 1 : 0;
      this.evaluatedFrames += 1;
      this.goodFrames += good;
      this.formEMA += (good - this.formEMA) * (1 - Math.exp(-dt / FORM_EMA_TAU_S));
    }
    const active = evaluated.filter((f) => f.state === "fault").map((f) => ({ kind: f.kind, side: f.side }));
    return { valid: true, reason: null, metrics: m, faults: active, events: out, cue: this.#pickCue(t, active, oneShots), formEMA: this.formEMA };
  }

  /** One cue at a time, each for at least CUE_MIN_S; the same cue again only after CUE_REPEAT_S. */
  #pickCue(t, active, oneShots) {
    for (const o of oneShots) this.cueQueue.push({ ...o, t });
    this.cueQueue = this.cueQueue.filter((q) => t - q.t <= CUE_STALE_S);
    if (this.cue && t - this.cue.since < CUE_MIN_S) return this.cue;
    this.cue = null;
    const next = [...this.cueQueue, ...active]
      .filter((c) => t - (this.lastCue[c.kind] ?? -Infinity) >= CUE_REPEAT_S)
      .sort((a, b) => CUE_PRIORITY.indexOf(a.kind) - CUE_PRIORITY.indexOf(b.kind))[0];
    if (next) {
      this.cue = { kind: next.kind, side: next.side, text: CUE_TEXT[next.kind], since: t };
      this.lastCue[next.kind] = t;
      this.cueQueue = this.cueQueue.filter((q) => q.kind !== next.kind);
    }
    return this.cue;
  }

  summary() {
    const top = Object.keys(this.counts).reduce((a, k) => (this.counts[k] > (a ? this.counts[a] : 0) ? k : a), null);
    return {
      calibrated: !!this.baseline.calibrated,
      formPct: this.evaluatedFrames ? this.goodFrames / this.evaluatedFrames : null,
      evaluatedFrames: this.evaluatedFrames,
      counts: { ...this.counts },
      duringDefense: this.duringDefense,
      top,
      tip: top ? TIPS[top] : null,
    };
  }
}

export function formSummaryText(s) {
  const pct = s.formPct === null ? "n/a" : `${Math.round(s.formPct * 100)}%`, c = s.counts;
  return `Form ${pct} · hands dropped ${c.hands} · elbows flared ${c.elbow} · chin uncovered ${c.chin}`
       + ` · late returns ${c.late_return} · during defense ${s.duringDefense}${s.calibrated ? "" : " · not calibrated"}`;
}

// ── Calibration (before the countdown) ───────────────────────────────────────
export class Calibrator {
  constructor({ stance = "orthodox" } = {}) {
    this.stance = stance;
    this.reset(0);
  }

  reset(t) {
    this.startT = t; this.lastT = t;
    this.holdT = 0; this.failT = 0; this.holding = false;
    this.samples = [];
    this.done = false; this.baseline = null; this.last = null;
  }

  /**
   * Feed one frame. `trackers` = PunchDetector.trackers ({isIdle(), lastSpeed, guardReady}); when omitted the
   * "still" and "guard" checks pass.
   * Returns {checks: [{id, label, ok, message}], firstFail, parts: {wrist: {L, R}, elbow: {L, R}}, holdFrac,
   *          holdStarted, hint, canSkip, done, baseline, metrics}.
   * The hold runs on the pose checks; passing also needs the detector's guard to be learned.
   */
  update(t, lms, W, H, { trackers = null } = {}) {
    if (this.done) return this.last;
    const dt = clamp(t - this.lastT, 0, MAX_DT);
    this.lastT = t;
    const m = computeMetrics(lms, W, H, { stance: this.stance });
    const lead = leadSide(this.stance), tr = Object.values(trackers ?? {});
    const parts = { wrist: {}, elbow: {} };
    for (const s of SIDES) {
      parts.wrist[s] = m.valid && m.handH[s] >= (s === lead ? CAL_HAND_MIN_LEAD : CAL_HAND_MIN_REAR);
      parts.elbow[s] = m.valid && m.flare[s] <= CAL_FLARE_MAX && m.lift[s] <= CAL_LIFT_MAX;
    }
    const framing = !m.valid ? "Step back so your head, shoulders and hands are in view"
                  : m.sw < CAL_SW_MIN * W ? "Step closer" : m.sw > CAL_SW_MAX * W ? "Step back"
                  : Math.abs(m.midX - W / 2) > CAL_CENTER_FRAC / 2 * W ? "Move to the center" : null;
    const checks = [
      { id: "visible", label: "Upper body in view", ok: m.valid, message: "Step back so your head, shoulders and hands are in view" },
      { id: "framing", label: "Right distance, centered", ok: m.valid && !framing, message: framing },
      { id: "hands", label: "Hands up", ok: parts.wrist.L && parts.wrist.R, message: "Raise your fists to your cheeks" },
      { id: "elbows", label: "Elbows tucked", ok: parts.elbow.L && parts.elbow.R, message: "Tuck your elbows in to your ribs" },
      { id: "still", label: "Holding still", ok: tr.every((x) => x.isIdle() && x.lastSpeed < CAL_STILL_MAX_SPEED), message: "Hold still" },
      { id: "guard", label: "Guard learned", ok: tr.every((x) => x.guardReady), message: "Keep holding…" },
    ];

    const poseOk = checks.slice(0, 5).every((c) => c.ok);
    let holdStarted = false;
    if (poseOk) {
      holdStarted = !this.holding;
      this.holding = true;
      this.failT = 0;
      this.holdT += dt;
      this.samples.push(m);
    } else {
      this.failT += dt;
      if (this.failT > CAL_FLICKER_GRACE_S) { this.holdT = 0; this.samples = []; this.holding = false; }   // a flicker shorter than this is forgiven
    }
    if (this.holdT >= CAL_HOLD_S && checks[5].ok) {
      this.done = true;
      this.baseline = this.#baseline();
    }
    const elapsed = t - this.startT;
    this.last = {
      checks, firstFail: checks.find((c) => !c.ok) ?? null, parts, metrics: m, holdStarted,
      holdFrac: Math.min(1, this.holdT / CAL_HOLD_S),
      hint: elapsed > CAL_HINT_AFTER_S, canSkip: elapsed > CAL_SKIP_AFTER_S,
      done: this.done, baseline: this.baseline,
    };
    return this.last;
  }

  /** Medians over the hold window. sw is in pixels; everything else in body units (hs as a fraction of sw). */
  #baseline() {
    const med = (get) => median(this.samples.map(get));
    const perSide = (get) => Object.fromEntries(SIDES.map((s) => [s, med((m) => get(m, s))]));
    return {
      calibrated: true,
      sw: med((m) => m.sw),
      hs: med((m) => m.hs / m.sw),
      handH: perSide((m, s) => m.handH[s]),
      flare: perSide((m, s) => m.flare[s]),
      lift: perSide((m, s) => m.lift[s]),
      elbowAng: perSide((m, s) => m.elbowAng[s]),
      wristRel: Object.fromEntries(SIDES.map((s) => [s, [med((m) => m.wristRel[s][0]), med((m) => m.wristRel[s][1])]])),
    };
  }
}

// ── Tuning log (?formdebug=1) ────────────────────────────────────────────────
/** Ring buffer of per-frame metrics, for tuning the thresholds from recorded sessions. */
export class MetricsLog {
  constructor(maxRows = 5400) {   // 3 minutes at 30 fps
    this.maxRows = maxRows;
    this.rows = [];
  }
  push(t, m) {
    const f = (v) => v.toFixed(4);
    this.rows.push(m.valid
      ? [f(t), 1, f(m.sw), f(m.hs), ...SIDES.flatMap((s) => [f(m.handH[s]), f(m.flare[s]), f(m.lift[s]), f(m.elbowAng[s])]), f(m.chinDx), f(m.chinDy)]
      : [f(t), 0, m.reason]);
    if (this.rows.length > this.maxRows) this.rows.shift();
  }
  toCSV() {
    const head = ["t", "valid", "sw", "hs", ...SIDES.flatMap((s) => [`handH_${s}`, `flare_${s}`, `lift_${s}`, `elbowAng_${s}`]), "chinDx", "chinDy"];
    return [head, ...this.rows].map((r) => r.join(",")).join("\n") + "\n";
  }
}
