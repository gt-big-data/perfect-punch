# Perfect Punch: web version context

The browser port of the Python game, which is in `main_python_analysis.py`, `defense.py` and `target_utils.py`. It is completely static: there's no backend and no build step. It uses the webcam, MediaPipe pose detection in the browser, and an ONNX punch classifier.

This file covers **only** `perfectpunch_backend/web/`. The rest of `perfectpunch_backend/` (api, celery, db, supabase, game, services and so on) is not used by the web version.

## Running it

Serve the `web` folder itself as the server root. From the repo root:

```powershell
.venv\Scripts\python.exe -m http.server 8000 --directory perfectpunch_backend\web
```

Then open http://localhost:8000. The camera only works on `localhost` or HTTPS. The README's command (`--directory web`) only works from inside `perfectpunch_backend/`. From the repo root it serves a folder that doesn't exist, and every request returns 404.

## Files

### Served to the browser (runtime)

| File | Role |
|---|---|
| `index.html` | Page shell: a hidden `<video>` (frame source), a `<canvas id="canvas">` (960×540 default), and a `#panel` holding `#status` text and a `#start` button. Loads `game.js` as an ES module. |
| `game.js` | Entry point and main loop. Camera setup, model loading, offense (callout → target → grading), defense (attacks to dodge or block), all drawing, HUD and round flow. |
| `pipeline.js` | Converts MediaPipe world landmarks into a model input tensor. Port of the pipeline in `main_python_analysis.py`, and must stay numerically identical to it. |
| `punchDetector.js` | Per-wrist punch start and end detection on image landmarks. Port of `PunchTracker` from `both_hands_tracking.py`. Pure logic with no DOM, so it runs under node. |
| `form.js` | Guard form check and stance calibration: `computeMetrics`, `FormMonitor`, `Calibrator`, and all form thresholds. Pure logic with no DOM, so it runs under node. Web only; there is no Python equivalent. |
| `punch_model.onnx` | The punch CNN (about 22 MB), loaded by `game.js` with a relative URL. |

### Not served (dev only)

| File | Role |
|---|---|
| `tools/export_model.py` | Rebuilds `punch_model.onnx` from `../models/best_punch_model.pt`. It runs the top of `../main_python_analysis.py` (everything before the `# ── Camera backend helpers` line) to get the model class and pipeline functions. Then it checks that the ONNX output matches PyTorch, and writes `tools/fixture.json`. Its paths are relative to `perfectpunch_backend/`, so run it from there: `..\.venv\Scripts\python.exe web\tools\export_model.py`. |
| `tools/check_pipeline.mjs` | `node web/tools/check_pipeline.mjs` checks the `pipeline.js` output against `fixture.json` (max diff below 1e-4). `fixture.json` is not in the repo, so run `export_model.py` first. |
| `tools/check_form.mjs` | `node web/tools/check_form.mjs` tests `form.js` on synthetic poses. Needs no fixture. |
| `perfectpunch_form_check_plan.md` | The design plan `form.js` was built from. The versus parts of it are not implemented, because this repo has no versus mode. |
| `README.md` | Human quick start. |

### External (CDN, versions pinned in `game.js`)

- `@mediapipe/tasks-vision@0.10.14` (ES module plus its `/wasm` folder) from jsdelivr
- `onnxruntime-web@1.20.1` (ES module plus its wasm files) from jsdelivr
- The pose model `pose_landmarker_lite.task` (float16, `latest`) from `storage.googleapis.com`

The game needs internet access on first load. OpenCV.js, mentioned in the README, is not used.

## Module dependencies

```
index.html → game.js ─┬→ pipeline.js        (CLASS_NAMES, CLIP_FRAMES, TARGET_FPS, normalizeSkeleton,
                      │                      extractLiveClip, mirrorSkeleton, buildTensor)
                      ├→ punchDetector.js   (PunchDetector, GUARD_READY_SAMPLES)
                      ├→ form.js            (Calibrator, FormMonitor, MetricsLog, computeMetrics, ...)
                      ├→ CDN: MediaPipe, onnxruntime-web
                      └→ fetch: punch_model.onnx
tools/check_pipeline.mjs → ../pipeline.js
tools/check_form.mjs     → ../form.js
```

## Runtime flow (`game.js`)

1. **`init()`** calls `getUserMedia` (960×540 at 30 fps) and sizes the canvas to the real video size, with scale `S = W / 960`. It then loads the PoseLandmarker (GPU delegate, falling back to CPU) and the ONNX session (wasm) in parallel, and shows the Start button.
2. **Modes:** `loading → ready → calibrate → countdown (3 s) → playing (MAX_RUNTIME = 30 s) → over`. `endRound()` logs stats to the console, stops the camera tracks and draws a summary on the canvas, so you have to reload to play again.
3. **`loop()`** runs on every new video frame:
   - `landmarker.detectForVideo`. Image landmarks (`lms`) drive gameplay. World landmarks are normalized and pushed into `worldBuf` (last 150 frames) for the classifier.
   - `detector.update(now, lms, W, H)` returns punch events. It runs before the round starts too, so the guard and shoulder scale are already learned.
   - Video and shapes are drawn under a mirror transform, in camera coordinates. Text is drawn afterwards at the mirrored x (`mx()`).
   - `stepCalibration()` runs while calibrating, and `stepRound()` while playing.
4. **`stepRound()`**:
   - **Callout:** `pickNextTarget()` (at most 2 of the same type and side in a row) shows "LEFT JAB" and similar for 0.4 s. It is only scheduled if it doesn't overlap an attack's active window.
   - **Target:** `respawnTarget()` places it on the calling hand's half of the body, between head and waist, away from the hands. The ring closes over 1.0 s to the ideal time.
   - **Hit:** either the called hand *entering* the circle inside the ±0.25 s window, or a detected punch from that hand that peaks on the target within the window. PERFECT is ±0.10 s and scores 300; GOOD scores 100. A punch from the called hand outside these rules, or the window closing, counts as a MISS. The other hand is ignored.
   - **Classification** (display only, doesn't affect the score): `segmentClip(startT, endT)`, falling back to `snapshotClip()`, then `classify()`. The clip is mirrored if the called hand isn't the stance default. The ONNX output is shown as softmax probabilities, for example "Predicted: Jab (87%)", marked "(low)" below 0.55.
   - **Defense:** an attack spawns 3–7 s after the previous one, but never overlapping reserved punch windows. Each attack warns for 0.9 s and is active for 1.0 s. Types: jab is a circle on the head; hook is a horizontal band sweeping left or right; uppercut is a vertical band sweeping upward. If a forearm near the head overlaps the danger area it's a Block (+50). If the head is touched otherwise it's a Hit (−50 and a red vignette). If neither happens by the end it's a Dodge (+50).

## Form check and calibration (`form.js`)

- **Units:** landmarks are converted to square pixels, then measured in body units. `sw` is the shoulder width and `hs` is the height from the shoulder line to the nose. `handH` is the wrist height (0 = shoulder line, 1 = nose). `flare` is how far the elbow is outside the shoulder, in `sw`. `lift` is the elbow height relative to the shoulders, in `hs` (negative = below).
- **Calibration (`calibrate` mode):** Start resets the detector's guards and runs `Calibrator`. The user holds a guard for 1.5 s (`CAL_HOLD_S`) with all pose checks passing: in view, right distance and centered, hands up, elbows tucked, still. Passing also needs both trackers' `guardReady`. The result is a baseline of medians, kept in `calib.baseline` for the page load. `?skipcal=1`, the **S** key, or the Skip button (shown after 20 s) skips it, and the round then uses default thresholds.
- **During play:** `stepForm()` calls `FormMonitor.update()` each frame. Faults are `hands` (dropped), `elbow` (flared or lifted), `chin` (rear hand up but away from the chin) and `late_return` (hand not back within 0.7 s of a punch ending). A fault needs 0.4 s to start (0.15 s while an attack is incoming) and uses separate on and off thresholds, so it doesn't flicker. A side is skipped while its tracker is not idle, and for 0.25 s after. Frames where the upper body can't be measured don't count and freeze the timers.
- **UI:** a red ring on the offending joint, an amber cue banner (one at a time, at least 0.8 s, repeating at most every 2 s), a form meter at the right edge, and a summary line plus a tip on the end screen.
- **Scoring:** `FORM_SCORING` in `game.js` is `"off"` by default, so form doesn't change the score. `"bonus"` adds up to `FORM_BONUS_MAX` at the end, and `"bonus+penalty"` also takes `FORM_FAULT_PENALTY` per fault.
- **Tuning:** `?formdebug=1` shows the live metrics and thresholds, and `window.ppForm.dumpCSV()` downloads the last 3 minutes of metrics.

## Model contract

- Input name `input`, float32 of shape `[1, 7, 50, 4, 3]`. That's 7 feature channels × 50 frames (resampled to 60 fps) × 4 joints (L/R elbow, L/R wrist) × xyz. `buildTensor()` fills it as position, velocity, bone direction (channel 2 [j=0,1][x] overwritten with the elbow angle cosines), vertical velocity, elbow angle, lateral and vertical direction.
- Output `logits` with 3 classes: `["jab", "lead-hook", "rear-uppercut"]`, mapped to the game types jab, hook and uppercut.
- The clip is the 50 frames ending at the smoothed peak of wrist and elbow velocity (`extractLiveClip`).

## Keep in sync with Python

| JS | Python source |
|---|---|
| `pipeline.js` | Pipeline functions in `main_python_analysis.py`. Verify with `check_pipeline.mjs`. |
| `punchDetector.js` | `PunchTracker` in `both_hands_tracking.py`. The JS adds `GUARD_READY_SAMPLES` and `GUARD_RELEARN_S`, and converts to square pixel units for non-square frames. |
| `game.js` config | `main_python_analysis.py` (offense), `defense.py` (attacks), `target_utils.py` (placement and hit test) |
| `punchDetector.js` `resetGuards()` | JS only, used by calibration. |
| `punch_model.onnx` | `models/best_punch_model.pt`. Re-export with `tools/export_model.py` whenever the model changes. |

## Gotchas

- Pixel sizes were tuned for 960×540 and are scaled by `S`. Use `* S` for any new pixel constant.
- `SHOW_PUNCH_DEBUG = true` draws per-hand detector state and peak circles. Turn it off for a clean UI.
- Each tracker needs about 1 s of still guard (30 samples) before punches register ("learning guard n/30"). Calibration normally covers this; a skipped calibration doesn't.
- The browser requests `favicon.ico`, but there isn't one. The 404 for it is harmless.
