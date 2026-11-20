const NOSE = 0, LS = 11, RS = 12, LW = 15, RW = 16, LHIP = 23, RHIP = 24;

export function respawnTarget(lms, { width, height, radius, side, type, margin, avoidHandsPx }) {
  const toPx = (lm) => [Math.trunc(lm.x * width), Math.trunc(lm.y * height)];
  const randint = (a, b) => Math.floor(a + Math.random() * (b + 1 - a));
  const edge = Math.max(radius, margin);
  const [lsx, lsy] = toPx(lms[LS]), [rsx, rsy] = toPx(lms[RS]);
  const lhy = toPx(lms[LHIP])[1], rhy = toPx(lms[RHIP])[1];
  const ny = toPx(lms[NOSE])[1];
  const sw = Math.abs(rsx - lsx);
  const bodyCx = Math.floor((lsx + rsx) / 2), handShoulderX = side === "L" ? lsx : rsx;
  let fullMin = Math.max(edge, Math.min(lsx, rsx) - sw);
  let fullMax = Math.min(width - edge, Math.max(lsx, rsx) + sw);
  if (type === "hook") {
    const halfWidth = Math.max(radius + 1, sw / 2);
    fullMin = Math.max(fullMin, bodyCx - halfWidth);
    fullMax = Math.min(fullMax, bodyCx + halfWidth);
  }
  let xmin = fullMin, xmax = fullMax;
  if (handShoulderX >= bodyCx) xmin = Math.max(xmin, bodyCx + radius);
  else xmax = Math.min(xmax, bodyCx - radius);
  if (xmax <= xmin) [xmin, xmax] = [fullMin, fullMax];
  const shoulderY = Math.floor((lsy + rsy) / 2), waistY = Math.floor((lhy + rhy) / 2);
  const ymin = Math.max(edge, Math.min(ny, shoulderY));
  let ymax = Math.min(height - edge, Math.max(ny, shoulderY + Math.floor((waistY - shoulderY) / 2)));
  if (type === "hook") {
    const hookMaxY = Math.min(height - edge, Math.max(ny, shoulderY));
    if (hookMaxY > ymin) ymax = hookMaxY;
  } else if (type === "uppercut") {
    const uppercutMaxY = Math.min(ymax, Math.max(ny, shoulderY + Math.floor((waistY - shoulderY) / 4)));
    if (uppercutMaxY > ymin) ymax = uppercutMaxY;
  }
  if (xmax <= xmin || ymax <= ymin) return null;
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
