# Perfect Punch Web: Guard Form Check and Stance Calibration (Plan)

Scope: the static browser app (`web/` in `JWiriadinata/BDBIGrokathon`, which is `perfectpunch_backend/web/` in the original layout). No backend, no build step. Names below come from the current `main` (`game.js`, `punchDetector.js`, `versus.js`). Anything marked **[assumption]** has not been confirmed in the code.

---

## 1. Overview and goals

Add two features:

1. **Form monitoring.** While the user is in guard, detect when (a) the hands drop below chin or cheek level, (b) the elbows flare away from the ribs or lift toward shoulder height, (c) the rear hand stops covering the chin, and (d) a hand isn't brought back to guard after a punch. Give clear on-canvas cues, a small form meter, and a form summary after the round.
2. **Start calibration.** Add a new `calibrate` mode before `countdown`. The user holds a correct guard stance for 1.5 s to continue. The pass records per-user baselines that personalize the form thresholds, and the same still hold also gives `PunchDetector` its guard.

Goals:
- Thresholds are body-relative and scale-invariant, so they work at any camera distance and for adults or kids.
- No flicker: hysteresis on the thresholds, minimum durations before a fault counts, and frames during a punch are ignored.
- Pure logic lives in `web/form.js` and runs under node, like `punchDetector.js`.
- Zero behavior change to scoring unless it's switched on in config. Versus keeps working unchanged.

Non-goals for v1: foot or stance-width checks, head-movement coaching, and sending form data over the network.

---

## 2. Boxing-form rules being checked (plain language)

| Rule | What a coach says | Why |
|---|---|---|
| **Hands up** | "Gloves at your cheekbones / chin." | Hands that drop leave the head open. This is the most common beginner fault. |
| **Elbows in** | "Elbows down, tucked to your ribs." | A flared elbow ("chicken wing") opens the body and telegraphs hooks. |
| **Chin covered** | "Rear hand by your chin." | The rear hand protects the chin. The lead hand can sit a little lower and further forward. |
| **Bring it back** | "Punch and return to guard." | A hand left out after a jab or hook is the classic way to get countered. |
| **Guard while defending** | "Hands up when they throw." | During an incoming attack, a dropped hand turns a block into a hit. |

The lead hand gets a looser height threshold than the rear hand, because the lead hand normally sits a little lower and further forward.

---

## 3. Landmarks used (MediaPipe Pose, image landmarks `lms`)

These are the indices already defined in `game.js`: `NOSE=0, LS=11, RS=12, LE=13, RE=14, LW=15, RW=16, LHIP=23, RHIP=24`. The new code also adds `MOUTH_L=9, MOUTH_R=10`.

- **Required:** 0, 11, 12, 13, 14, 15, 16. If any of these has `visibility < VIS_MIN` or lies outside [0,1], the frame is "unknown".
- **Optional:** 9 and 10 (mouth, used for a better chin estimate) and 23 and 24 (hips, used for torso height in calibration only. Hips are often off-frame on close laptop cameras).
- **Units:** every point is converted to square pixels, `P = [x*W, y*H]`. This avoids aspect distortion; the detector's own scale uses normalized coordinates, which is fine because it is used independently. y points down.
- **Left and right:** MediaPipe's `LW`, `LE` and so on are the user's *anatomical* left side, and mirroring only affects drawing. Stance decides the lead and rear sides: orthodox (`STANCE = "orthodox"`, the existing constant) has lead = L and rear = R; southpaw swaps them. Form logic never uses `mx()`. Only the drawing does.

---

## 4. Calibration flow and state machine changes

### 4.1 Modes

```
loading → ready ──solo click──→ calibrate ──pass/skip──→ countdown → playing → over
                └─versus Ready click (not yet calibrated)→ calibrate ──pass──→ ready (localReady=true sent)
```

- **Solo:** `soloBtn` sets `mode = "calibrate"` (it currently goes straight to `"countdown"`). On a pass it sets `mode = "countdown"; modeStart = now`, so the countdown is unchanged.
- **Skip:** `?skipcal=1` (read like `BOT_MODE`) skips calibration and uses default baselines. A **Skip** button appears after `CAL_SKIP_AFTER_S`, and pressing **S** also skips (dev). A skipped round has form checks with default thresholds, and the summary says "not calibrated".
- **Calibrated once per page load:** keep `calib = {done, baseline}` at module level. A second round or rematch doesn't recalibrate unless `RECAL_IF_SCALE_CHANGE`: the median shoulder width (`sw`) moves more than 30% from the baseline, which means the user moved closer or further away.

### 4.2 Checklist (all must be true in the same frame)

1. **Upper body visible:** all required landmarks are valid. Message: "Step back so your head, shoulders and hands are in view."
2. **Size and centered:** `sw` is between `0.12·W` and `0.45·W`, and the shoulder midpoint x is within the middle 60% of the frame. Messages: "Step closer" / "Step back" / "Move to the center".
3. **Hands up:** `handH(rear) ≥ CAL_HAND_MIN_REAR` and `handH(lead) ≥ CAL_HAND_MIN_LEAD`.
4. **Elbows tucked:** `flare(side) ≤ CAL_FLARE_MAX` and `elbowLift(side) ≤ CAL_LIFT_MAX` for both sides.
5. **Still:** both trackers are `isIdle()` and `tr.lastSpeed < GUARD_MAX_SPEED` (reusing the detector's own measures).
6. **Detector guard ready:** both `detector.trackers[s].guardReady`. Because the 1.5 s hold is about 45 frames at 30 fps, and `GUARD_READY_SAMPLES = 30`, this is normally met during the hold.
7. *(Optional, off by default)* **Side-on stance:** the lead shoulder is closer to the camera (`lms[leadShoulder].z < lms[rearShoulder].z - CAL_STANCE_DZ`). MediaPipe's image z is noisy **[assumption: needs testing]**.

**Hold logic:** `holdT` accumulates while all checks pass. A single failing frame inside `CAL_FLICKER_GRACE_S` (0.2 s) doesn't reset it, but a longer failure sets it to 0. The pass happens at `holdT ≥ CAL_HOLD_S` (1.5 s).

**Timeout help:** after `CAL_HINT_AFTER_S` (8 s), the first failing item's message is shown in a larger font, along with "Tip: make fists by your cheeks, elbows touching your sides". After `CAL_SKIP_AFTER_S` (20 s) the Skip button appears.

### 4.3 Baselines recorded (medians over the hold window)

`baseline = { sw, hs, handH:{L,R}, flare:{L,R}, lift:{L,R}, elbowAng:{L,R}, wristRel:{L,R} }`, all in body units (§5). An optional `localStorage["pp.formBaseline"]` stores it so later visits start personalized. It's still re-validated with a short 0.5 s hold.

### 4.4 Seeding PunchDetector

- Add `PunchDetector.resetGuards()` (JS-only, like `GUARD_READY_SAMPLES`; Python parity isn't affected). It clears `guardBuf`, `guardPos` and `awayStart` on both trackers and is called when entering `calibrate`. The guard is then learned from the calibrated pose instead of from the user at the keyboard. The existing still/near-guard rule in `PunchTracker.update` does the learning, so no new thresholds are needed.
- Check 6 guarantees `guardReady` at countdown, so the "learning guard n/30" phase disappears from play.

---

## 5. Form metric math

Per frame, in square pixels (`P[i] = [lms[i].x*W, lms[i].y*H]`):

```
sw     = max(MIN_SHOULDER_PX*S, |P[LS].x - P[RS].x|)          // same floor as posePoints()
shY    = (P[LS].y + P[RS].y) / 2
midX   = (P[LS].x + P[RS].x) / 2
chinY  = mouth valid ? mouthY + 0.6*(mouthY - P[NOSE].y) : P[NOSE].y + 0.25*sw   // [assumption] chin estimate
hs     = max(0.35*sw, shY - P[NOSE].y)                         // head-to-shoulder span (vertical body unit)

handH(s)    = (shY - P[W_s].y) / hs        // 0 = shoulder line, 1 = nose height, ~0.6–0.8 = chin/cheek
flare(s)    = (|P[E_s].x - midX| - |P[S_s].x - midX|) / sw   // >0 = elbow outside the shoulder line
elbowLift(s)= (shY - P[E_s].y) / hs        // ≥0 = elbow at/above shoulder height (bad)
elbowAng(s) = angle(P[S_s]-P[E_s], P[W_s]-P[E_s]) in degrees  // 2-D, foreshortened: secondary only
chinCover   = |P[W_rear].x - P[NOSE].x| / sw ≤ CHIN_X_MAX  &&  P[W_rear].y ≤ chinY + CHIN_Y_TOL*hs
```

**Personalized thresholds** (falling back to defaults when uncalibrated):

```
handDropOn(s)  = clamp(baseline.handH[s] - HAND_DROP_MARGIN, HAND_DROP_FLOOR, HAND_DROP_CEIL)
handDropOff(s) = handDropOn(s) + HYST_HAND
flareOn(s)     = max(FLARE_ON_DEFAULT, baseline.flare[s] + FLARE_MARGIN);  flareOff = flareOn - HYST_FLARE
```

**Per-side fault state machine** (one for each of `hands`, `elbow` and `chin`):

```
function stepFault(f, bad, good, t, minOn, minOff):
  if f.state == "ok":
     if bad:  f.badSince ??= t;  if t - f.badSince ≥ minOn: f.state = "fault"; f.count++; emit("fault", f.kind, side)
     else:    f.badSince = null
  else: // fault
     if good: f.goodSince ??= t; if t - f.goodSince ≥ minOff: f.state = "ok"; f.goodSince = null
     else:    f.goodSince = null
```

Here `bad = handH < handDropOn`, `good = handH > handDropOff`. Between the two thresholds the state is held (hysteresis).

**Gating, in order:**
1. If the frame is unknown (visibility or frame check fails), skip and don't count it. Fault timers freeze; they don't reset.
2. If `detector.trackers[s].state !== "idle"` (throwing or recovering), skip that side's hands and elbow checks, because punches legitimately lower or extend the arm. Also skip for `POST_PUNCH_GRACE_S` after it returns to idle.
3. **Return check:** when a `punch` or `dropped` event for side `s` arrives, start `ret[s] = {t0: event.endT ?? event.t}`. If that side's `handH ≥ handDropOff(s)` *and* the tracker is idle within `RETURN_LATE_S`, it's a clean return. Otherwise emit `"late_return"` once ("BRING IT BACK") and count it.
4. **Defending:** while `defense.attack` is in `warning` or `active` (versus: the incoming head circle), use `minOn = DEFENSE_MIN_ON_S` (faster cue) and tag faults as `duringDefense`. No new rules are added: a dropped guard during an attack is exactly what costs a block.

**Form meter and percentage:**
```
frameGood = all evaluated sides ok (sides skipped by gating don't count against)
formEMA   = formEMA + (frameGood - formEMA) * (1 - exp(-dt / FORM_EMA_TAU_S))
formPct   = goodFrames / evaluatedFrames            // only while mode === "playing"
```

---

## 6. Config constants (starting values)

| Constant | Start | Notes / tuning |
|---|---|---|
| `VIS_MIN` | 0.5 | Matches the existing `shown()` filter in `loop()`. |
| `HAND_DROP_MARGIN` | 0.40 | Personal drop = baseline height − 0.40 hs. |
| `HAND_DROP_FLOOR` / `CEIL` | 0.10 / 0.45 | Clamp for the personalized value. |
| Default `handDropOn` lead / rear | 0.25 / 0.35 | Used when uncalibrated. |
| `HYST_HAND` | 0.12 | Recovery must clear on + 0.12. |
| `FLARE_ON_DEFAULT` | 0.30 sw | Elbow 0.3 shoulder widths outside the shoulder line. |
| `FLARE_MARGIN` / `HYST_FLARE` | 0.20 / 0.08 | |
| `LIFT_ON` | −0.10 hs | Elbow within 0.1 hs of the shoulder line counts as lifted. |
| `ELBOW_ANG_OPEN` | 120° | Secondary signal: only counts with a hand drop ("arm hanging"). |
| `CHIN_X_MAX` / `CHIN_Y_TOL` | 0.55 sw / 0.15 hs | Rear-hand cover. |
| `FAULT_MIN_ON_S` / `MIN_OFF_S` | 0.40 / 0.25 | Anti-flicker. |
| `DEFENSE_MIN_ON_S` | 0.15 | Faster during attacks. |
| `POST_PUNCH_GRACE_S` | 0.25 | |
| `RETURN_LATE_S` | 0.70 | Measured from the punch `endT`. |
| `FORM_EMA_TAU_S` | 1.0 | Meter smoothing. |
| `CAL_HOLD_S` / `CAL_FLICKER_GRACE_S` | 1.5 / 0.2 | |
| `CAL_HAND_MIN_LEAD` / `REAR` | 0.45 / 0.55 | |
| `CAL_FLARE_MAX` / `CAL_LIFT_MAX` | 0.20 / −0.15 | |
| `CAL_HINT_AFTER_S` / `CAL_SKIP_AFTER_S` | 8 / 20 | |
| `FORM_SCORING` | `"off"` | `"off"`, `"bonus"` or `"bonus+penalty"`. |
| `FORM_BONUS_MAX` | 300 | End bonus = round(formPct × 300) (solo only). |
| `FORM_FAULT_PENALTY` | 10 | Per fault event, only with `"bonus+penalty"`. |
| `SHOW_FORM_DEBUG` | false | Or `?formdebug=1`. |

**How to tune:** with `?formdebug=1`, `form.js` keeps a ring buffer of per-frame metrics, and `window.ppForm.dumpCSV()` downloads it. Record about 30 s of good guard and about 30 s of each deliberate fault, for 3 or more people at 2 camera distances. Set each `_ON` threshold near the midpoint between the "good" 10th percentile and the "fault" 90th percentile, and set hysteresis to roughly the jitter (the standard deviation of a still guard). Change one constant at a time.

---

## 7. UI/UX drawing spec

Everything follows the existing convention. Shapes are drawn in camera coordinates under `ctx.setTransform(-1,0,0,1,W,0)`. Body-anchored text is drawn after the reset at `mx(x)`. Fixed HUD text is drawn in screen coordinates. Every pixel constant is multiplied by `S`.

**Calibration screen** (local camera full screen, in both solo and versus):
- **Ghost guard silhouette** under the mirror transform, anchored to the live shoulders: target wrist circles at `(S_s.x ± 0.1sw toward the midline, chinY)`, radius `0.22·sw`; target elbow circles at `(S_s.x, shY + 0.9·hs)`. Each is drawn white at 0.35 alpha, turning green when that part passes. When no pose is detected, a centered default silhouette sized for `sw = 0.25·W` is shown.
- **Checklist** at the top left (screen coordinates, `20*S` margin, `18*S` bold): ✓ green or • grey for each item. The first failing item's message is shown below it.
- **Hold ring:** a ring around the shoulder midpoint fills over `holdFrac`. When it completes, "READY!" flashes for 0.4 s.

**During play:**
- **Cue banner:** "HANDS UP", "ELBOWS IN", "CHIN DOWN / COVER UP" or "BRING IT BACK", drawn with `fitFont` and `textCentered` at `(W/2, H*0.12)`, in an amber `[255,165,0]` outline style. Only one cue shows at a time. Priority: return > hands > chin > elbow. Each cue shows for at least 0.8 s, and the same cue repeats at most every 2 s. Cues don't cover the callout area (`drawCallout`); place them above it **[assumption: callout is mid-screen; check positions]**.
- **Offending joint:** a pulsing red ring (`radius 14*S`, `lineWidth 3*S`) around the bad wrist or elbow, under the mirror transform.
- **Form meter:** a small vertical pill at the right edge (`12*S × 120*S`) filled to `formEMA`, colored green above 0.8, amber from 0.5 to 0.8 and red below. Labeled "FORM".
- **Post-round summary:** solo shows it on the cleared canvas in `endRound()` (and logs it like the existing stats): `Form 82% · hands dropped 4 · elbows flared 2 · late returns 3 · during defense 1`, plus one top tip based on the most frequent fault. In versus it's an extra line on the result card (`versus.drawResult`) or below it.
- `SHOW_FORM_DEBUG` prints `handH` / `flare` / `lift` per side and the thresholds under `drawPunchState()`.

---

## 8. Integration points (file by file)

**`web/form.js` (new, pure logic, no DOM):**
- Exports the constants in §6, `computeMetrics(lms, W, H, {stance})`, `defaultBaseline()` and `class Calibrator { reset(t); update(t, lms, W, H, {trackers}) → {checks, firstFail, holdFrac, done, baseline} }`.
- Also exports `class FormMonitor { constructor(baseline, {stance}); update(t, lms, W, H, {trackers, events, defending}) → {valid, faults, cue, formEMA}; summary() }`, plus `stepFault` and the stance helpers `leadSide(stance)` / `rearSide(stance)`.
- `trackers` is passed in (duck-typed `{state, lastSpeed, guardReady, isIdle()}`) so the module doesn't import `punchDetector.js`.

**`web/punchDetector.js`:** add `resetGuards()` only. No threshold changes.

**`web/game.js`:**
- `import { Calibrator, FormMonitor, ... } from "./form.js"`. Add the module state `calib`, `calibrator` and `form`, and `SKIP_CAL = URLSearchParams…get("skipcal") === "1"`.
- `soloBtn` handler: `mode = SKIP_CAL || calib.done ? "countdown" : "calibrate"`. On entering calibrate, call `detector.resetGuards(); calibrator.reset(now)`.
- `loop()`: after `detector.update`, add `if (mode === "calibrate") { stepCalibration(lms, now); return-or-continue; }`. Solo draws the camera as usual plus `drawCalibration()` (a new function). In the versus branch, insert `if (mode === "calibrate") { drawCalibrationLocal(lms, now); return; }` *after* `versus.tick(...)` and `net.sendPose(...)`, so the heartbeat and pose stream continue, and *before* `drawVersusFrame`.
- `newRound(now)`: `form = new FormMonitor(calib.baseline ?? defaultBaseline(), {stance: STANCE})`.
- `stepRound()` and `stepVersus()`: call `form.update(now, lms, W, H, {trackers: detector.trackers, events: punchEvents, defending: !!defense.attack})` **[assumption: `defense.attack` is the active attack in both modes, which `beginVersusCountdown` suggests]**. Then draw the cues and meter (`drawFormCues()`, `drawFormMeter()`).
- `endRound()`: compute `form.summary()`, `console.log` it, apply `FORM_SCORING` (solo only), and draw the summary before the canvas clears. Solo currently calls `ctx.clearRect`, so the summary must be drawn after that clear (the loop has stopped, so it stays on screen).
- `teardownVersus()`: add `"calibrate"` to the modes that reset to `"ready"`.

**`web/index.html`:** add a hidden `#skip-cal` button inside `#panel` that is shown after `CAL_SKIP_AFTER_S`. During versus calibration, hide `#room` and restore it afterwards.

**Versus (`versus.js` / `net.js`): unchanged in v1.**
- Each client calibrates locally before it can be Ready. `readyBtn`: if `!calib.done && !SKIP_CAL`, enter `calibrate`. On a pass, set `versus.localReady = true`, call `net.sendEvent("ready", {ready:true})` and `updateRoom()`, and go back to `mode = "ready"`.
- The host's Start still requires both ready, so both players are calibrated before the shared `t0` countdown. The `beginVersusCountdown` timing is untouched.
- Rematch (`onBothRematch` → `beginVersusCountdown`) doesn't recalibrate.
- `BotOpponent` auto-readies; only the local player calibrates.
- Form is advisory in versus (`FORM_SCORING` is ignored) so the HP and damage rules stay symmetric. Cues are drawn near the local PiP (`pipRect(W,H)`), because the opponent fills the screen.
- Later (optional): add `formPct` to the existing state message so the result card shows both players' form.

**`web/tools/check_form.mjs` (new):** node tests (§10).

---

## 9. Edge cases

- **Occlusion:** gloves or hands in front of the face can hide the nose or mouth, and crossed arms can swap wrists. Unknown frames freeze the timers. If the nose is invisible but the shoulders are visible, use `chinY ≈ shY − 0.55·baseline.hs·(sw/baseline.sw)` **[assumption]**.
- **Low visibility or lighting:** if more than 50% of frames over 2 s are unknown, show "Need more light / step into view" once, instead of form cues.
- **Partial frame:** hips are never required. If wrists go off the bottom edge, that is itself a hand drop, but it's off-frame, so treat it as unknown and show "Hands out of view" once.
- **Camera angle:** a high laptop camera shrinks `hs`. The `0.35·sw` floor and the personalized baselines absorb this. A strongly side-on stance shrinks `sw`, so use `max(sw, baseline.sw·0.6)` during play.
- **Kids or short users:** every measure is a ratio, so these hold up. Calibration size limits allow small `sw`. Kids may hold the guard higher, and personalization handles that.
- **Southpaw:** only the lead and rear assignments change (`STANCE`). Tests cover both.
- **Throwing from the guard during calibration:** the still check fails and the hold resets. That's acceptable.
- **The guard moves mid-round:** the detector already relearns (`GUARD_RELEARN_S`). Form uses landmark geometry, not `guardPos`, so it doesn't depend on that.
- **Dodges:** leaning shifts the nose and shoulders together. Ratios stay stable, but expect more `elbow` noise, so elbow faults use `minOn × 1.5` while defending.

---

## 10. Testing plan

**Node unit tests (`node web/tools/check_form.mjs`)**, using a synthetic pose generator `makePose({sw, cx, handH:{L,R}, flare:{L,R}, lift:{L,R}, vis, stance})` that returns 33 landmarks (unused points filled at visibility 1):
1. `computeMetrics` returns the generator's inputs within 1e-3 at three scales (`sw` = 100, 200 and 350 px) and two aspect ratios: scale invariance.
2. Good guard for 3 s gives zero faults and `formPct = 1`.
3. A hand drop held 0.3 s gives no fault, and held 0.5 s gives exactly one fault (min-on).
4. A value oscillating between on and off gives one fault, not many (hysteresis).
5. A tracker in `throwing` or `recovering` suppresses that side's faults. After a `punch` event, a late return (0.9 s) gives `late_return`, and a 0.4 s return gives none.
6. Southpaw: dropping the lead hand to 0.3 triggers nothing; dropping the rear hand to 0.3 triggers a fault (and the reverse holds for orthodox).
7. Low-visibility frames neither count against `formPct` nor reset timers.
8. Calibrator: 1.5 s of passing frames gives `done`, and a 0.1 s fail mid-hold doesn't reset (grace). A 0.4 s fail resets. The baseline equals the medians.
9. Personalized thresholds clamp to the floor and ceiling.

**Manual checklist:** laptop camera at 1 m and 2.5 m; external camera; dim room; both stances; a child or short user if available; intentionally drop each hand, flare each elbow, and leave a jab out; the cue appears within about 0.5 s and clears on fix; no cue spam during fast combinations; calibration passes within 3 s for a correct guard and gives helpful hints otherwise; `?skipcal=1` works; versus with `?bot=1`: Ready triggers calibration, then the room shows Ready, Start, countdown and rematch with no recalibration; two real machines: one slow calibrator doesn't block the other's heartbeat; Leave during calibration returns to ready; existing `tools/check_net.mjs` and `check_pipeline.mjs` still pass; 30 fps is held (form code runs in under 0.2 ms per frame).

---

## 11. Phased rollout

1. **M1 (metrics and debug):** `form.js` `computeMetrics`, `?formdebug=1` overlay and CSV dump, node tests 1 and 7. Collect tuning data.
2. **M2 (form monitor in solo):** fault state machines, gating, cues, joint highlight, meter, end summary. Scoring stays `"off"`.
3. **M3 (calibration):** `calibrate` mode, checklist UI, baselines, `resetGuards()`, skip and timeout, personalized thresholds.
4. **M4 (versus):** gate Ready on calibration, PiP-placed cues, result-card form line.
5. **M5 (optional):** `FORM_SCORING` bonus, localStorage baseline, `formPct` over the network, Grok-written post-round coaching tip from `summary()`.

---

## 12. Open questions

- Should form ever affect versus damage? For example, a dropped guard could turn a "block" into a "hit" (it already partly does, via the forearm block rule).
- Can a front camera reliably check chin tuck (head tilt)? It's deferred; image z and nose-to-shoulder ratios may be too noisy.
- Is a side-on stance check worth enabling, given z noise?
- Should calibration be required on every page load, or remembered in localStorage with a quick re-check?
- Is the default `FORM_BONUS_MAX` of 300 (equal to one PERFECT) the right weight, if bonus is turned on?
- For a sharper silhouette, should the ghost guard be an image asset rather than drawn circles?
