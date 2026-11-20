const NOSE = 0, LS = 11, RS = 12, LW = 15, RW = 16, LHIP = 23, RHIP = 24;

// Per-punch spawn boxes, in shoulder widths (sw). Y is measured on screen, so "up" is a smaller y.
// "Head level" = 0.75 sw above the shoulder midpoint.
const HEAD_LEVEL_SW = 0.75;
const JAB_OUT_SW = 1.0;             // jab box reaches this far past the punching shoulder
const JAB_CHEST_DROP_SW = 0.5;      // jab box bottom: below the shoulder midpoint (mid-chest)
const HOOK_REACH_SW = 0.25;         // hook box: this far either side of the OPPOSITE shoulder
const HOOK_DROP_SW = 1.0;           // hook box bottom: below the shoulder midpoint
const UPPERCUT_OUT_SW = 0.2;        // uppercut box reaches this far past the punching shoulder
const UPPERCUT_TOP_SW = 1.5;        // uppercut box top: above the shoulder midpoint by this much

export function respawnTarget(lms, { width, height, radius, side, type, margin, avoidHandsPx }) {
  const toPx = (lm) => [Math.trunc(lm.x * width), Math.trunc(lm.y * height)];
  const randint = (a, b) => Math.floor(a + Math.random() * (b + 1 - a));
  const edge = Math.max(radius, margin);
  const [lsx, lsy] = toPx(lms[LS]), [rsx, rsy] = toPx(lms[RS]);
  const lhy = toPx(lms[LHIP])[1], rhy = toPx(lms[RHIP])[1];
  const ny = toPx(lms[NOSE])[1];
  const sw = Math.abs(rsx - lsx);
  const bodyCx = Math.floor((lsx + rsx) / 2), handShoulderX = side === "L" ? lsx : rsx;
  const oppShoulderX = side === "L" ? rsx : lsx;
  const shoulderY = Math.floor((lsy + rsy) / 2), waistY = Math.floor((lhy + rhy) / 2);
  const out = handShoulderX >= bodyCx ? 1 : -1;   // camera-x direction of the punching hand's side

  // Box for this punch type, clamped to the screen. Null if it is empty or the type is unknown.
  const typeBox = () => {
    const headY = shoulderY - HEAD_LEVEL_SW * sw;
    let x1, x2, y1, y2;
    if (type === "jab") {
      [x1, x2] = [bodyCx, handShoulderX + out * JAB_OUT_SW * sw];
      [y1, y2] = [headY, shoulderY + JAB_CHEST_DROP_SW * sw];
    } else if (type === "hook") {
      [x1, x2] = [oppShoulderX - HOOK_REACH_SW * sw, oppShoulderX + HOOK_REACH_SW * sw];
      [y1, y2] = [headY, shoulderY + HOOK_DROP_SW * sw];
    } else if (type === "uppercut") {
      [x1, x2] = [bodyCx, handShoulderX + out * UPPERCUT_OUT_SW * sw];
      [y1, y2] = [shoulderY - UPPERCUT_TOP_SW * sw, shoulderY];
    } else return null;
    const xmin = Math.ceil(Math.max(edge, Math.min(x1, x2))), xmax = Math.floor(Math.min(width - edge, Math.max(x1, x2)));
    const ymin = Math.ceil(Math.max(edge, Math.min(y1, y2))), ymax = Math.floor(Math.min(height - edge, Math.max(y1, y2)));
    return xmax > xmin && ymax > ymin ? [xmin, xmax, ymin, ymax] : null;
  };

  // The original type-agnostic box: head-to-mid-torso, one shoulder width either side of the shoulders,
  // on the punching hand's half of the body. Used when the per-punch box is unusable.
  const fallbackBox = () => {
    const fullMin = Math.max(edge, Math.min(lsx, rsx) - sw), fullMax = Math.min(width - edge, Math.max(lsx, rsx) + sw);
    let xmin = fullMin, xmax = fullMax;
    if (handShoulderX >= bodyCx) xmin = Math.max(xmin, bodyCx + radius);
    else xmax = Math.min(xmax, bodyCx - radius);
    if (xmax <= xmin) [xmin, xmax] = [fullMin, fullMax];
    const ymin = Math.max(edge, Math.min(ny, shoulderY));
    const ymax = Math.min(height - edge, Math.max(ny, shoulderY + Math.floor((waistY - shoulderY) / 2)));
    return xmax > xmin && ymax > ymin ? [xmin, xmax, ymin, ymax] : null;
  };

  const box = typeBox() ?? fallbackBox();
  if (!box) return null;
  const [xmin, xmax, ymin, ymax] = box;
  const hands = [toPx(lms[LW]), toPx(lms[RW])];
  let best = null, bestD = -1;
  for (let i = 0; i < 20; i++) {
    const c = [randint(xmin, xmax), randint(ymin, ymax)];
    const d = Math.min(...hands.map(([hx, hy]) => Math.hypot(c[0] - hx, c[1] - hy)));
    if (d >= avoidHandsPx) return c;
    if (d > bestD) [best, bestD] = [c, d];
  }
  return best;
}
