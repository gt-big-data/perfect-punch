// Tests for web/form.js on synthetic poses. Run: node web/tools/check_form.mjs
import {
  computeMetrics, thresholds, defaultBaseline, FormMonitor, Calibrator,
  HAND_DROP_FLOOR, HAND_DROP_CEIL, CAL_HOLD_S,
} from "../form.js";

const FPS = 30, DT = 1 / FPS;
let failed = 0;
function check(name, cond, detail = "") {
  if (!cond) failed += 1;
  console.log(`${cond ? "OK  " : "FAIL"} ${name}${cond || !detail ? "" : `  (${detail})`}`);
}

/** 33 image landmarks for a guard pose described in body units (the inverse of computeMetrics). */
function makePose({ W = 960, H = 540, sw = 200, cx = W / 2, shY = 0.4 * H, hsRatio = 0.6,
                    handH = {}, flare = {}, lift = {}, vis = {} } = {}) {
  const hs = hsRatio * sw, px = Array.from({ length: 33 }, () => [cx, shY]);
  const noseY = shY - hs;
  px[0] = [cx, noseY];
  px[9] = [cx + 0.08 * sw, noseY + 0.12 * sw];
  px[10] = [cx - 0.08 * sw, noseY + 0.12 * sw];
  for (const [s, sign, si, ei, wi] of [["L", 1, 11, 13, 15], ["R", -1, 12, 14, 16]]) {
    px[si] = [cx + sign * sw / 2, shY];
    px[ei] = [cx + sign * (sw / 2 + (flare[s] ?? 0.05) * sw), shY - (lift[s] ?? -1.2) * hs];
    px[wi] = [cx + sign * 0.4 * sw, shY - (handH[s] ?? 0.75) * hs];
  }
  return px.map(([x, y], i) => ({ x: x / W, y: y / H, z: 0, visibility: vis[i] ?? 1 }));
}

const makeTrackers = () => Object.fromEntries(["L", "R"].map((s) =>
  [s, { state: "idle", lastSpeed: 0, guardReady: true, isIdle() { return this.state === "idle"; } }]));

/** Runs a monitor over segments [{dur, pose, trackers?, events?, defending?}] at 30 fps; returns all its events. */
function run(mon, segments, state = { t: 0 }) {
  const events = [];
  for (const seg of segments) {
    const n = Math.round(seg.dur * FPS);
    for (let i = 0; i < n; i++) {
      const r = mon.update(state.t, makePose(seg.pose), 960, 540,
        { trackers: seg.trackers ?? makeTrackers(), events: i === 0 ? seg.events?.(state.t) ?? [] : [], defending: seg.defending });
      events.push(...r.events);
      state.t += DT;
    }
  }
  return events;
}
const count = (events, kind) => events.filter((e) => e.kind === kind).length;

// 1. Scale invariance: metrics return the generator's inputs at any size and aspect ratio.
{
  const want = { handH: { L: 0.7, R: 0.8 }, flare: { L: 0.1, R: -0.05 }, lift: { L: -1.0, R: -0.9 } };
  let maxDiff = 0;
  for (const [W, H] of [[960, 540], [640, 480]]) for (const sw of [100, 200, 350]) {
    const m = computeMetrics(makePose({ W, H, sw, shY: 0.5 * H, ...want }), W, H);   // sw = 350 needs the room
    for (const k of ["handH", "flare", "lift"]) for (const s of ["L", "R"]) maxDiff = Math.max(maxDiff, Math.abs(m[k][s] - want[k][s]));
    maxDiff = Math.max(maxDiff, Math.abs(m.sw - sw) / sw);
  }
  check("1 metrics are scale invariant", maxDiff < 1e-3, `max diff ${maxDiff.toExponential(2)}`);
}

// 2. Good guard: no faults, 100% form.
{
  const mon = new FormMonitor();
  const ev = run(mon, [{ dur: 3, pose: {} }]);
  const s = mon.summary();
  check("2 good guard has no faults", ev.length === 0 && s.formPct === 1, `events ${ev.length}, formPct ${s.formPct}`);
}

// 3. Minimum duration before a hand drop counts.
{
  const drop = { handH: { L: 0.0 } };
  const short = run(new FormMonitor(), [{ dur: 1, pose: {} }, { dur: 0.3, pose: drop }, { dur: 1, pose: {} }]);
  const long = run(new FormMonitor(), [{ dur: 1, pose: {} }, { dur: 0.5, pose: drop }, { dur: 1, pose: {} }]);
  check("3 drop for 0.3 s is ignored", short.length === 0, `events ${short.length}`);
  check("3 drop for 0.5 s is one hands fault", long.length === 1 && long[0].kind === "hands" && long[0].side === "L", JSON.stringify(long));
}

// 4. Hysteresis: hovering around the threshold after a fault doesn't raise more faults.
{
  const segs = [{ dur: 0.5, pose: { handH: { L: 0.2 } } }];
  for (let i = 0; i < 10; i++) segs.push({ dur: 0.1, pose: { handH: { L: 0.33 } } }, { dur: 0.1, pose: { handH: { L: 0.2 } } });
  for (let i = 0; i < 5; i++) segs.push({ dur: 0.1, pose: { handH: { L: 0.5 } } }, { dur: 0.1, pose: { handH: { L: 0.2 } } });
  const ev = run(new FormMonitor(), segs);
  check("4 oscillation gives one fault", count(ev, "hands") === 1, `hands faults ${count(ev, "hands")}`);
}

// 5. Punch gating and the return-to-guard check.
{
  const busy = (state) => { const tr = makeTrackers(); tr.L.state = state; return tr; };
  const low = { handH: { L: 0.0 } };
  const punchEnd = (t) => [{ type: "punch", side: "L", endT: t }];
  const gatedEv = run(new FormMonitor(), [{ dur: 1, pose: low, trackers: busy("throwing") }, { dur: 1, pose: low, trackers: busy("recovering") }]);
  check("5 no hand faults while punching", gatedEv.length === 0, JSON.stringify(gatedEv));
  const late = run(new FormMonitor(), [{ dur: 0.9, pose: low, trackers: busy("recovering"), events: punchEnd }, { dur: 1, pose: {} }]);
  check("5 hand back after 0.9 s is a late return", count(late, "late_return") === 1 && late.length === 1, JSON.stringify(late));
  const clean = run(new FormMonitor(), [{ dur: 0.4, pose: low, trackers: busy("recovering"), events: punchEnd }, { dur: 1, pose: {} }]);
  check("5 hand back after 0.4 s is clean", clean.length === 0, JSON.stringify(clean));
}

// 6. Stance: the lead hand may sit lower than the rear hand.
{
  for (const [stance, lead, rear] of [["orthodox", "L", "R"], ["southpaw", "R", "L"]]) {
    const leadLow = run(new FormMonitor(defaultBaseline(), { stance }), [{ dur: 2, pose: { handH: { [lead]: 0.3 } } }]);
    const rearLow = run(new FormMonitor(defaultBaseline(), { stance }), [{ dur: 2, pose: { handH: { [rear]: 0.3 } } }]);
    check(`6 ${stance}: lead hand at 0.3 is fine`, count(leadLow, "hands") === 0, JSON.stringify(leadLow));
    check(`6 ${stance}: rear hand at 0.3 is a fault`, count(rearLow, "hands") === 1 && rearLow.find((e) => e.kind === "hands").side === rear, JSON.stringify(rearLow));
  }
}

// 7. Low-visibility frames don't count and don't reset the timers.
{
  const hidden = { vis: { 15: 0.1 } };
  const mon = new FormMonitor();
  run(mon, [{ dur: 1, pose: {} }, { dur: 1, pose: hidden }]);
  const s = mon.summary();
  check("7 hidden frames aren't evaluated", s.evaluatedFrames === FPS && s.formPct === 1, `evaluated ${s.evaluatedFrames}, formPct ${s.formPct}`);
  const low = { handH: { L: 0.0 } }, state = { t: 0 }, mon2 = new FormMonitor();
  const before = run(mon2, [{ dur: 0.3, pose: low }, { dur: 1, pose: { ...low, ...hidden } }], state);
  const after = run(mon2, [{ dur: 0.2, pose: low }], state);
  check("7 timers freeze over hidden frames", count(before, "hands") === 0 && count(after, "hands") === 1,
        `before ${count(before, "hands")}, after ${count(after, "hands")}`);
}

// 8. Calibration hold.
{
  const feed = (cal, state, dur, pose) => {
    let r;
    for (let i = 0, n = Math.round(dur * FPS); i < n; i++) { r = cal.update(state.t, makePose(pose), 960, 540, { trackers: makeTrackers() }); state.t += DT; }
    return r;
  };
  const good = { handH: { L: 0.7, R: 0.8 }, flare: { L: 0.1, R: 0.05 } }, bad = { handH: { L: 0.1, R: 0.1 } };
  let cal = new Calibrator(), state = { t: 5 };
  cal.reset(state.t);
  const early = feed(cal, state, CAL_HOLD_S - 0.2, good);
  const done = feed(cal, state, 0.3, good);
  check("8 passes after a 1.5 s hold", !early.done && done.done, `early ${early.done}, done ${done.done}, holdFrac ${done.holdFrac}`);
  const b = done.baseline;
  check("8 baseline is the held pose", !!b && Math.abs(b.handH.L - 0.7) < 1e-3 && Math.abs(b.handH.R - 0.8) < 1e-3
        && Math.abs(b.flare.L - 0.1) < 1e-3 && Math.abs(b.sw - 200) < 1e-3 && Math.abs(b.hs - 0.6) < 1e-3, JSON.stringify(b));

  cal = new Calibrator(); state = { t: 0 }; cal.reset(0);
  feed(cal, state, 1.0, good);
  const flicker = feed(cal, state, 0.1, bad);
  check("8 a 0.1 s slip doesn't reset the hold", flicker.holdFrac > 0.6, `holdFrac ${flicker.holdFrac}`);
  check("8 …and the hold still completes", feed(cal, state, 0.6, good).done);

  cal = new Calibrator(); state = { t: 0 }; cal.reset(0);
  feed(cal, state, 1.0, good);
  const reset = feed(cal, state, 0.4, bad);
  check("8 a 0.4 s slip resets the hold", reset.holdFrac === 0 && reset.firstFail?.id === "hands", `holdFrac ${reset.holdFrac}`);

  const notReady = makeTrackers(); notReady.L.guardReady = false;
  cal = new Calibrator(); cal.reset(0);
  let r;
  for (let i = 0; i < 2 * FPS; i++) r = cal.update(i * DT, makePose(good), 960, 540, { trackers: notReady });
  check("8 waits for the detector's guard", !r.done && r.holdFrac === 1 && r.firstFail?.id === "guard");
}

// 9. Personalised thresholds clamp.
{
  const base = (h) => ({ calibrated: true, sw: 200, hs: 0.6, handH: { L: h, R: h }, flare: { L: 0, R: 0.3 }, wristRel: { L: [0.4, 0], R: [-0.4, 0] } });
  const lo = thresholds(base(0.3)), hi = thresholds(base(1.2)), mid = thresholds(base(0.7));
  check("9 hand threshold clamps to the floor", lo.handDropOn.L === HAND_DROP_FLOOR, `${lo.handDropOn.L}`);
  check("9 hand threshold clamps to the ceiling", hi.handDropOn.L === HAND_DROP_CEIL, `${hi.handDropOn.L}`);
  check("9 hand threshold follows the baseline", Math.abs(mid.handDropOn.L - 0.3) < 1e-9, `${mid.handDropOn.L}`);
  check("9 flare threshold follows the baseline", mid.flareOn.L === 0.3 && Math.abs(mid.flareOn.R - 0.5) < 1e-9, `${mid.flareOn.L}, ${mid.flareOn.R}`);
}

console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exit(failed ? 1 : 0);
