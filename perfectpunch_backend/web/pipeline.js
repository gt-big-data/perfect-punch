// Port of the skeleton → model-input pipeline in main_python_analysis.py.
// Must stay numerically identical to the Python (checked by tools/check_pipeline.mjs).
// A skeleton frame is an array of 33 [x, y, z, visibility].

export const CLIP_FRAMES = 50;
export const TARGET_FPS = 60;
export const VEL_WINDOW = 7;
export const CLASS_NAMES = ["jab", "lead-hook", "rear-uppercut"];
const VELOCITY_LM = [11, 12, 13, 14, 15, 16];
const L_SHOULDER = 11, R_SHOULDER = 12, L_ELBOW = 13, R_ELBOW = 14, L_WRIST = 15, R_WRIST = 16;
const TRACK = [L_ELBOW, R_ELBOW, L_WRIST, R_WRIST];
const SHOULDER = [L_SHOULDER, R_SHOULDER, L_SHOULDER, R_SHOULDER];

const MIRROR_INDEX = [...Array(33).keys()];
for (const [l, r] of [[1, 4], [2, 5], [3, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16],
                      [17, 18], [19, 20], [21, 22], [23, 24], [25, 26], [27, 28], [29, 30], [31, 32]]) {
  MIRROR_INDEX[l] = r;
  MIRROR_INDEX[r] = l;
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (v) => Math.hypot(v[0], v[1], v[2]);

/** Hip-centred, shoulder-width-normalised skeleton from MediaPipe world landmarks. */
export function normalizeSkeleton(lms) {
  const c = lms.map((l) => [l.x, l.y, l.z, l.visibility ?? 0]);
  const hip = [0, 1, 2].map((k) => (c[23][k] + c[24][k]) / 2);
  for (const p of c) for (let k = 0; k < 3; k++) p[k] -= hip[k];
  const d = norm(sub(c[11], c[12]));
  if (d > 1e-6) for (const p of c) for (let k = 0; k < 3; k++) p[k] /= d;
  return c;
}

export function mirrorSkeleton(clip) {
  return clip.map((f) => MIRROR_INDEX.map((i) => [-f[i][0], f[i][1], f[i][2], f[i][3]]));
}

function compoundVelocity(curr, prev) {
  let s = 0;
  for (const lm of VELOCITY_LM) s += norm(sub(curr[lm], prev[lm])) ** 2;
  return Math.sqrt(s / VELOCITY_LM.length);
}

function resampleFrames(frames, srcFps, dstFps = TARGET_FPS) {
  const nSrc = frames.length;
  if (nSrc < 2 || Math.abs(srcFps - dstFps) < 0.5) return frames;
  const nDst = Math.max(2, Math.round((nSrc / srcFps) * dstFps));
  const out = [];
  for (let i = 0; i < nDst; i++) {
    // Same as np.interp over linspace(0, 1, nSrc) → linspace(0, 1, nDst).
    const pos = (i / (nDst - 1)) * (nSrc - 1);
    const j = Math.min(Math.floor(pos), nSrc - 2);
    const f = pos - j;
    out.push(frames[j].map((p, lm) => p.map((v, k) => v + (frames[j + 1][lm][k] - v) * f)));
  }
  return out;
}

/** (CLIP_FRAMES × 33 × 4) clip ending at the smoothed velocity peak, or null. */
export function extractLiveClip(rawFrames, srcFps) {
  if (rawFrames.length < 2) return null;
  const r = resampleFrames(rawFrames, srcFps);
  const n = r.length;
  if (n < CLIP_FRAMES) return null;
  const vels = [0];
  for (let i = 1; i < n; i++) vels.push(compoundVelocity(r[i], r[i - 1]));
  // np.convolve(vels, ones(7)/7, mode='same')
  const half = Math.floor(VEL_WINDOW / 2);
  const smooth = vels.map((_, i) => {
    let s = 0;
    for (let j = i - half; j <= i + half; j++) if (j >= 0 && j < n) s += vels[j];
    return s / VEL_WINDOW;
  });
  let peak = CLIP_FRAMES - 1;
  for (let i = CLIP_FRAMES; i < n; i++) if (smooth[i] > smooth[peak]) peak = i;
  return r.slice(peak + 1 - CLIP_FRAMES, peak + 1);
}

function angleCos(a, b, c) {
  const ba = sub(a, b), bc = sub(c, b);
  return (ba[0] * bc[0] + ba[1] * bc[1] + ba[2] * bc[2]) / (norm(ba) * norm(bc) + 1e-8);
}

/** Float32Array laid out like the Python (7, T, 4, 3) tensor. */
export function buildTensor(clip) {
  const T = clip.length, eps = 1e-8;
  const out = new Float32Array(7 * T * 4 * 3);
  const set = (ch, t, j, k, v) => { out[((ch * T + t) * 4 + j) * 3 + k] = v; };
  const pos = (t, j) => clip[t][TRACK[j]];
  for (let t = 0; t < T; t++) {
    const f = clip[t];
    const la = angleCos(f[L_SHOULDER], f[L_ELBOW], f[L_WRIST]);
    const ra = angleCos(f[R_SHOULDER], f[R_ELBOW], f[R_WRIST]);
    for (let j = 0; j < 4; j++) {
      const p = pos(t, j);
      const v = t > 0 ? sub(p, pos(t - 1, j)) : [0, 0, 0];
      const bone = sub(p, j < 2 ? f[SHOULDER[j]] : f[TRACK[j - 2]]);
      const bl = norm(bone) + 1e-8;
      const lat = v[0] / (Math.hypot(v[0], v[2]) + eps);
      const vert = v[1] / (norm(v) + eps);
      const angle = j % 2 === 0 ? la : ra;
      for (let k = 0; k < 3; k++) {
        set(0, t, j, k, p[k]);
        set(1, t, j, k, v[k]);
        set(2, t, j, k, bone[k] / bl);
        set(3, t, j, k, v[1]);
        set(4, t, j, k, angle);
        set(5, t, j, k, lat);
        set(6, t, j, k, vert);
      }
    }
    set(2, t, 0, 0, la);
    set(2, t, 1, 0, ra);
  }
  return out;
}
