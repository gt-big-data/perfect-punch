// Port of PunchTracker from both_hands_tracking.py: finds when each wrist starts and finishes a punch.
// Works on MediaPipe *image* landmarks (result.landmarks[0], normalized x/y/z), the same as the Python
// thresholds were tuned on. Pure logic (no canvas, no DOM) so it can be run under node.
//
// Per wrist: idle → throwing → recovering → idle. Positions are the wrist relative to its shoulder, in
// shoulder widths. "Extension" = distance from the learned guard position; "speed" = slope of a linear
// fit over the last few samples (shoulder widths / second).

export const MIN_EXT = 0.8;               // extension from guard needed to start a punch
export const MIN_THROWING_SPEED = 7;      // wrist speed needed to start a punch
export const GUARD_MAX_SPEED = 3;         // wrist must be slower than this to update the guard
export const GUARD_WINDOW = 150;          // guard samples kept (5 s at 30 fps)
// Not in the Python (which only started once you were in place). The first still frames seed the guard, and
// samples far from it are rejected, so a guard learned at the keyboard stayed there forever ("learning guard").
export const GUARD_READY_SAMPLES = 30;    // guard samples needed before punches are detected (~1 s); Python: GUARD_WINDOW
export const GUARD_RELEARN_S = 1.0;       // a hand resting this long away from the guard means the guard moved: relearn
export const SCALE_WINDOW = 150;          // shoulder-width samples kept
export const WRIST_POS_WINDOW = 5;        // samples used for the velocity fit
export const RECOVER_T = 0.1;             // min seconds after the peak before returning to idle
export const THROWING_TIMEOUT = 1;        // seconds before a stuck throw is dropped
export const RECOVER_TIMEOUT = 2;         // seconds before a stuck recovery is forced to idle

const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm3 = (v) => Math.hypot(v[0], v[1], v[2]);
const lmArray = (l) => [l.x, l.y, l.z ?? 0];

function median(values) {
  const s = [...values].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Per-axis slope of a least-squares line through [{t, p:[x,y,z]}] (np.polyfit(t, p, 1)[0]). */
function averageVelocity(samples) {
  const n = samples.length, t0 = samples[0].t;
  const ts = samples.map((s) => s.t - t0), tMean = ts.reduce((a, b) => a + b, 0) / n;
  const denom = ts.reduce((a, t) => a + (t - tMean) ** 2, 0);
  if (denom < 1e-12) return [0, 0, 0];
  return [0, 1, 2].map((k) => {
    const pMean = samples.reduce((a, s) => a + s.p[k], 0) / n;
    return samples.reduce((a, s, i) => a + (ts[i] - tMean) * (s.p[k] - pMean), 0) / denom;
  });
}

class PunchTracker {
  /** @param side "L" | "R"; wrist/shoulder = landmark indices; contact = landmark indices of the fist. */
  constructor(side, { wrist, shoulder, contact }) {
    Object.assign(this, { side, wristId: wrist, shoulderId: shoulder, contactIds: contact });
    this.state = "idle";
    this.guardPos = null;
    this.guardBuf = [];
    this.awayStart = null;            // when the hand started resting away from the guard (for relearning)
    this.recent = [];                 // {t, p} wrist-relative samples for the velocity fit
    this.maxExt = 0; this.maxSpeed = 0;
    this.startT = 0; this.peakT = 0; this.recoverStart = 0;
    this.peakPts = []; this.peakPos = null;
    this.lastExt = 0; this.lastSpeed = 0;
    this.punchPeaks = [];             // {t, pos} of finished punches; for the debug overlay to draw and prune
  }

  get guardReady() { return this.guardBuf.length >= GUARD_READY_SAMPLES; }
  isIdle() { return this.state === "idle"; }

  /** Landmark positions of the fist right now, kept so the game can test where the punch landed. */
  #snapshot(lms) {
    this.peakPts = this.contactIds.map((i) => ({ x: lms[i].x, y: lms[i].y, visibility: lms[i].visibility ?? 1 }));
    this.peakPos = { x: lms[this.wristId].x, y: lms[this.wristId].y };
  }

  /**
   * Feed one frame. Returns an event or null:
   *  {type:"start", side, t}
   *  {type:"punch", side, startT, peakT, endT, peakPts, peakPos}   punch finished (arm starts to come back)
   *  {type:"dropped", side, t}                                     throw timed out without a clear peak
   */
  update(t, lms, scale, raw = lms) {   // `raw` = the original normalized landmarks, for the snapshot returned to the game
    const wrist = lmArray(lms[this.wristId]);
    const wristRel = sub3(wrist, lmArray(lms[this.shoulderId])).map((v) => v / scale);

    this.recent.push({ t, p: wristRel });
    if (this.recent.length > WRIST_POS_WINDOW) this.recent.shift();

    const extension = this.guardPos ? norm3(sub3(wristRel, this.guardPos)) : 0;
    const speed = this.recent.length === WRIST_POS_WINDOW ? norm3(averageVelocity(this.recent)) : 0;
    this.lastExt = extension;
    this.lastSpeed = speed;

    if (this.state === "idle") {
      if (extension > MIN_EXT && speed > MIN_THROWING_SPEED && this.guardReady) {
        this.state = "throwing";
        this.maxExt = extension;
        this.maxSpeed = speed;
        this.startT = this.peakT = t;   // peak initialised so a quick drop-off can't emit a stale peak
        this.awayStart = null;
        this.#snapshot(raw);
        return { type: "start", side: this.side, t };
      }
      const still = speed < GUARD_MAX_SPEED;
      if (still && extension < MIN_EXT * 0.5) {
        this.awayStart = null;
        this.guardBuf.push(wristRel);
        if (this.guardBuf.length > GUARD_WINDOW) this.guardBuf.shift();
        this.guardPos = [0, 1, 2].map((k) => median(this.guardBuf.map((p) => p[k])));
      } else if (still) {
        // Resting, but away from the guard: after GUARD_RELEARN_S the old guard is stale; start over from here.
        this.awayStart ??= t;
        if (t - this.awayStart >= GUARD_RELEARN_S) {
          this.guardBuf = [];
          this.guardPos = null;
          this.awayStart = null;
        }
      } else {
        this.awayStart = null;
      }
    } else if (this.state === "throwing") {
      if (extension > this.maxExt) {
        this.maxExt = extension;
        this.peakT = t;
        this.#snapshot(raw);
      }
      this.maxSpeed = Math.max(this.maxSpeed, speed);

      if (extension < this.maxExt * 0.9 && speed < this.maxSpeed * 0.75) {
        this.state = "recovering";
        this.recoverStart = t;
        this.punchPeaks.push({ t: this.peakT, pos: this.peakPos });
        return { type: "punch", side: this.side, startT: this.startT, peakT: this.peakT, endT: t,
                 peakPts: this.peakPts, peakPos: this.peakPos };
      }
      if (t - this.startT > THROWING_TIMEOUT) {   // break out of a stale throw
        this.state = "recovering";
        this.recoverStart = t;
        return { type: "dropped", side: this.side, t };
      }
    } else if (this.state === "recovering") {
      if ((extension < MIN_EXT * 0.75 && t - this.peakT > RECOVER_T) || t - this.recoverStart > RECOVER_TIMEOUT) {
        this.state = "idle";
      }
    }
    return null;
  }
}

export class PunchDetector {
  /** @param hands {L: {wrist, shoulder, contact}, R: {...}} landmark indices per hand */
  constructor(hands) {
    this.trackers = Object.fromEntries(Object.entries(hands).map(([side, h]) => [side, new PunchTracker(side, h)]));
    this.scaleBuf = [];
  }

  /**
   * Feed one frame of landmarks at time t (seconds). Returns this frame's events.
   * `width`/`height` are the camera frame size in pixels. MediaPipe's image landmarks are fractions of the frame
   * (x of the width, y of the height, z on the x scale), so on a non-square frame the axes have different units.
   * The Python thresholds were tuned on a 480x480 frame, where they happened to agree; converting to square
   * pixel units here keeps them meaning the same thing at any resolution or aspect ratio.
   */
  update(t, lms, width = 1, height = 1) {
    const raw = lms;
    if (width !== height) lms = lms.map((l) => ({ x: l.x * width, y: l.y * height, z: (l.z ?? 0) * width, visibility: l.visibility }));
    const trackers = Object.values(this.trackers);
    // Shoulder width is the scale; only learn it while nobody is mid-punch so punching can't distort it.
    if (trackers.every((tr) => tr.isIdle())) {
      const [a, b] = trackers.map((tr) => tr.shoulderId);
      this.scaleBuf.push(norm3(sub3(lmArray(lms[a]), lmArray(lms[b]))));
      if (this.scaleBuf.length > SCALE_WINDOW) this.scaleBuf.shift();
    }
    const events = [];
    if (this.scaleBuf.length > 0) {
      const scale = median(this.scaleBuf);
      if (scale > 1e-6) for (const tr of trackers) { const e = tr.update(t, lms, scale, raw); if (e) events.push(e); }
    }
    return events;
  }
}
