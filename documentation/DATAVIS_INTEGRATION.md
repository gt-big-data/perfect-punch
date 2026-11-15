# Platform → DataVis contract (PerfectPunch)

Reference branch: `anants-branch` (Nov 15, 2026). This package adds **backend instrumentation, contracts and an integration script**, not DataVis formulas or a deployed change.

## Ownership

- Platform: target ID, requested type, selected hand when known, timeouts, target contact, classifier output, one resolution per target, per-type aggregates, authenticated WebSocket, session JSON persistence.
- DataVis: normalized miss-rate formula, repeat-penalty weights, punch-specific target regions.
- Gameplay team: adjudicate actual `perfect` and `good` timing grades and classify punch segments reliably, then pass those grades to `TargetOutcomeTracker.resolve`.

## Request and response

`landmark_payload` provides frame dimensions and unmirrored MediaPipe-normalized raw image coordinates for nose, both eyes, shoulders, elbows, wrists, and hips. **Do not send relative movement features as landmarks.**

`validate_target_region` accepts DataVis geometry in normalized `[0,1]` image coordinates:

```json
{"min_x":0.2,"max_x":0.5,"min_y":0.3,"max_y":0.7}
```

`choose_punch_with_weights` accepts the full DataVis weight object, e.g. `{"jab":0.45,"hook":0.30,"uppercut":0.25}`. No weighting formula is contained here. In the initial patch these functions are **integration entry points**; gameplay still uses its legacy target selector until the teams connect DataVis outputs.

## Backend target results

On target creation, `target_spawn` retains existing fields and adds `requested_punch`, `requested_hand`, `expires_at_ms`. A completion/timeout emits `target_result` with:

`session_id`, `target_id`, `requested_punch`, `requested_hand`, `status`, `timing_grade`, `hit_target`, `classification_correct`, `detected_punch`, `classifier_confidence`, `reason`, `spawned_at_ms`, `expires_at_ms`, `resolved_at_ms`, `reaction_time_ms`, `target_center`, `target_radius`.

`stats_update` and `/game/sessions/{id}/stats` additionally contain `punch_stats`, `selection_history`, `last_selected_punch`, `consecutive_punch_count`, `totals`.

- `punch_stats.jab|hook|uppercut` contain `perfect`, `good`, `miss`, `target_hits`, `timing_hits`, `ungraded_hits`, `completed_targets`, `pending_targets`, `cancelled_targets`, `correct_type`, `incorrect_type`, `classified_targets`, `timing_accuracy_pct`.
- `perfect` and `good` count as timing hits **only when the gameplay scorer really emitted those grades**.
- The **current FastAPI game manager has a collision check, not a PERFECT/GOOD timing grader**. Its contacts are exported as `timing_grade: null`, `hit_target: true`. This deliberately avoids fabricating grades. To populate timing grades from that path, integrate the actual timing scorer, not a guessed threshold.
- A timeout with no detected punch is `miss`, `classification_correct: null`, `detected_punch: null`.
- `classification_correct` is independent of contact/timing; a wrong jab may physically reach a hook target.
- `timing_accuracy_pct: null` means there are no graded attempts, **not** zero accuracy.
- Target selection history records selected targets, not detected punch segments.

## Storage

`live_session_document()` writes the new `punch_stats`, `target_outcomes`, and streak history alongside existing dashboard metrics into the existing `game_sessions.session_data` JSONB. This does not require a SQL schema migration. The existing dashboard's `punch_accuracy` has a different historical definition and is preserved for compatibility.

## Runtime notes

- The Vite/React page is `src/pages/CameraMirror.jsx` and uses an authenticated FastAPI WebSocket. Demo-mode target generation is separate, not the live backend authority.
- Backend also mounts standalone `/web/game.js`, which uses a **separate JS gameplay engine**. The Python tracker integration does NOT instrument it. If the demonstration uses `/web`, add equivalent JS event emission and persistence before calling the full deployed demo ready.
- React receives `target_result` by target ID and reads new aggregate stats from session API without counting results independently.
- API ownership remains checked by existing session authentication. Do not create a public `/stats` route.
- Platform API target region integration is a *contract*, not a live formula invocation, until the DataVis implementation is connected.

## Apply and verify

From a fresh clone of `anants-branch`:

```bash
python /path/to/unzipped/apply_changes.py /path/to/perfect-punch
cd /path/to/perfect-punch
PYTHONPATH=. python -m unittest discover -s perfectpunch_backend/tests -p 'test_target_tracker.py' -v
PYTHONPATH=. python -m unittest discover -s perfectpunch_backend/tests -p 'test_datavis_contract.py' -v
npm run build
```

Review `git diff`, ensure all existing auth tests still pass, run a live camera session, then open a PR. This package has not been run against a complete repository checkout or production deployment. Before merging, validate all patch anchors on the current branch and confirm the DataVis team agrees on grading semantics.

## Authenticated DataVis integration endpoints (added by patch)

`GET /game/sessions/{session_id}/datavis-inputs` returns the latest raw-pose landmark payload and current per-target/per-type statistics for the session owner. `pose` is `null` until the first pose message.

`POST /game/sessions/{session_id}/datavis-config` accepts a session-scoped payload (same user authorization as the rest of the game API):

```json
{
  "weights": {"jab": 0.45, "hook": 0.30, "uppercut": 0.25},
  "target_regions": {
    "jab:left": {"min_x": 0.2, "max_x": 0.4, "min_y": 0.2, "max_y": 0.6}
  }
}
```

The backend validates probabilities and each supplied normalized region, then uses them for future spawns. Regions are keyed `punch:left|right`, and missing region keys fall back to existing body-relative target placement. The platform **does not calculate** these values or apply the 10% repetition formula. Only a session owner can post configuration; the DataVis code must run in the authorized client context or a properly authenticated integration.

**Remaining gameplay limitation:** the FastAPI path cannot assign PERFECT vs GOOD from its current wrist-collision-only code; it exports `hit_target` plus `timing_grade: null` until the gameplay scorer is integrated. The frontend demo path and standalone `/web` path require separate integration if they are to provide complete data.
