import cv2
import mediapipe as mp
import time
import concurrent.futures
import ctypes
import json
import math
from collections import deque
from datetime import datetime
import sys
import os

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

try:
    from .extractDataPoints import PoseTracker
    from .defense import DefenseGame
    from .target_utils import (
        respawn_target,
        wrists_hit_circle,
        choose_punch_type,
        choose_punch_side,
        callout_text,
        PUNCH_COLORS,
        MISS_GRAY,
        WHITE,
        FloatingText,
        spawn_particles,
        draw_particles,
        draw_floating_texts,
        draw_callout_banner,
        draw_osu_target,
        draw_target_badge,
        draw_pop,
        draw_fading_target,
        draw_hud,
        draw_hit_vignette,
    )
except ImportError:
    from extractDataPoints import PoseTracker
    from defense import DefenseGame
    from target_utils import (
        respawn_target,
        wrists_hit_circle,
        choose_punch_type,
        choose_punch_side,
        callout_text,
        PUNCH_COLORS,
        MISS_GRAY,
        WHITE,
        FloatingText,
        spawn_particles,
        draw_particles,
        draw_floating_texts,
        draw_callout_banner,
        draw_osu_target,
        draw_target_badge,
        draw_pop,
        draw_fading_target,
        draw_hud,
        draw_hit_vignette,
    )

# Show OpenCV window by default; set SHOW_DISPLAY=false to force headless mode.
SHOW_DISPLAY = os.getenv('SHOW_DISPLAY', 'true').strip().lower() in {'1', 'true', 'yes', 'on'}

# ════════════════════════════════════════════════════════════════════════════
# GAME / UI CONFIG — all the tunables for the callout → target → attack flow.
# Attack-specific values (color, flash count, warning/active lengths, sizes)
# live at the top of defense.py.
# ════════════════════════════════════════════════════════════════════════════
STANCE              = "orthodox"   # "orthodox" (lead = left) or "southpaw" (lead = right)
ALLOW_RANDOM_SIDES  = False        # True = random L/R for every punch (needs a model trained on both hands)

CALLOUT_DURATION_S  = 0.4          # "LEFT JAB" banner time before the target appears
APPROACH_DURATION_S = 1.0          # approach ring shrink time; ring touches the edge = ideal hit
PERFECT_WINDOW_S    = 0.10         # ± around the ideal hit time
GOOD_WINDOW_S       = 0.25         # ± around the ideal hit time; outside this = MISS

TARGET_VISUAL_SCALE = 2.5          # drawn radius = TARGET_RADIUS * this
HIT_RADIUS_SCALE    = 3.0          # collision radius = TARGET_RADIUS * this (TODO(tune))
MAX_SAME_TARGET_IN_A_ROW = 2       # never the same punch type + side more than this many times in a row

SCORE_PERFECT        = 300
SCORE_GOOD           = 100
SCORE_DEFENSE_BONUS  = 50          # successful dodge or block
SCORE_HIT_PENALTY    = 50          # getting hit (score never drops below 0)

FLOATING_TEXT_S = 0.6
POP_S           = 0.25
MISS_FADE_S     = 0.3
HIT_VIGNETTE_S  = 0.3
SCHEDULE_MARGIN_S = 0.1            # spacing between attack windows and punch moments

GRADE_COLORS = {
    "PERFECT": (0, 230, 255),      # gold
    "GOOD":    (255, 255, 255),
    "MISS":    MISS_GRAY,
}

# ── Model / pipeline constants (must match training config) ─────────────────
CLIP_FRAMES          = 50
TARGET_FPS           = 60
WORLD_BUFFER_FRAMES  = 150         # raw-FPS rolling buffer (~5 s at 30 fps)
VEL_WINDOW           = 7
VELOCITY_LM          = [11, 12, 13, 14, 15, 16]
MODEL_CONF_THRESHOLD = 0.55
CLASS_NAMES          = ('jab', 'lead-hook', 'rear-uppercut')
N_CLASSES            = len(CLASS_NAMES)

# How many seconds of raw frames to search for the velocity peak at collision.
# 2.5 s at 30 fps = 75 raw frames -> resampled to 150 @ 60 fps, plenty for
# a 50-frame clip.  Short enough that stale punches don't pollute the peak.
LOOK_BACK_SECONDS = 2.5

MODEL_TO_TARGET = {
    'jab':           'jab',
    'lead-hook':     'hook',
    'rear-uppercut': 'uppercut',
}

# ── Landmark indices ─────────────────────────────────────────────────────────
L_SHOULDER, R_SHOULDER = 11, 12
L_ELBOW,    R_ELBOW    = 13, 14
L_WRIST,    R_WRIST    = 15, 16
TRACK    = [L_ELBOW, R_ELBOW, L_WRIST, R_WRIST]
SHOULDER = [L_SHOULDER, R_SHOULDER, L_SHOULDER, R_SHOULDER]

mp_drawing = mp.solutions.drawing_utils
mp_pose    = mp.solutions.pose


# ── Display helpers ──────────────────────────────────────────────────────────

def show_frame(window_name, frame):
    if SHOW_DISPLAY:
        try:
            cv2.imshow(window_name, frame)
        except Exception as e:
            print(f"Warning: Could not display frame: {e}")


def wait_key(delay=1):
    if SHOW_DISPLAY:
        try:
            if cv2.waitKey(delay) & 0xFF == ord('q'):
                return True
        except Exception:
            pass
    return False


# ── Session windowing helpers ────────────────────────────────────────────────

def _get_time_window_index(elapsed_seconds):
    if elapsed_seconds <= 10:
        return 0
    if 10 < elapsed_seconds <= 20:
        return 1
    if 20 < elapsed_seconds <= 30:
        return 2
    return None


def _windows_overlap(a, b, margin=0.0):
    """True if time windows a=(start, end) and b=(start, end) overlap (with margin)."""
    if a is None or b is None:
        return False
    return a[0] < b[1] + margin and a[1] > b[0] - margin


def _pick_next_target(recent):
    """Pick (punch_type, side), never repeating the same pair more than
    MAX_SAME_TARGET_IN_A_ROW times in a row."""
    punch_type, side = None, None
    for _ in range(25):
        punch_type = choose_punch_type()
        side = choose_punch_side(punch_type, STANCE, ALLOW_RANDOM_SIDES)
        if len(recent) < MAX_SAME_TARGET_IN_A_ROW or any(r != (punch_type, side) for r in recent):
            break
    recent.append((punch_type, side))
    return punch_type, side


# ── Speed computation (2-D pixel coords, kept for session metrics) ───────────

def _compute_speed_value(raw_coords, fps_value):
    if not raw_coords or len(raw_coords) < 2:
        return None
    frame_pair_speeds = []
    for i in range(len(raw_coords) - 1):
        lm_a = raw_coords[i].get("landmarks")
        lm_b = raw_coords[i + 1].get("landmarks")
        if not lm_a or not lm_b:
            continue
        pair_disps = []
        for wrist_name in ("RIGHT_WRIST", "LEFT_WRIST"):
            if wrist_name in lm_a and wrist_name in lm_b:
                dx = lm_b[wrist_name]["x"] - lm_a[wrist_name]["x"]
                dy = lm_b[wrist_name]["y"] - lm_a[wrist_name]["y"]
                pair_disps.append(math.hypot(dx, dy))
        if pair_disps:
            frame_pair_speeds.append(max(pair_disps) * fps_value)
    if not frame_pair_speeds:
        return None
    top_speeds = sorted(frame_pair_speeds, reverse=True)[:3]
    return sum(top_speeds) / len(top_speeds)


# ── Skeleton preprocessing (identical to notebook pipeline) ─────────────────

def normalize_skeleton(lm_list):
    """Hip-centred, shoulder-width-normalised. Returns (33, 4)."""
    coords = np.array([[l.x, l.y, l.z, l.visibility] for l in lm_list], dtype=np.float32)
    hip_c = (coords[23][:3] + coords[24][:3]) / 2
    coords[:, :3] -= hip_c
    dist = np.linalg.norm(coords[11][:3] - coords[12][:3])
    if dist > 1e-6:
        coords[:, :3] /= dist
    return coords


def compound_velocity(curr, prev):
    diffs = [np.linalg.norm(curr[lm][:3] - prev[lm][:3]) for lm in VELOCITY_LM]
    return float(np.sqrt(np.mean(np.array(diffs) ** 2)))


def resample_frames(frames, src_fps, dst_fps=TARGET_FPS):
    """Temporally resample skeleton frames from src_fps to dst_fps."""
    n_src = len(frames)
    if n_src < 2 or abs(src_fps - dst_fps) < 0.5:
        return np.array(frames, dtype=np.float32)
    arr   = np.array(frames, dtype=np.float32)       # (N, 33, 4)
    dur   = n_src / src_fps
    n_dst = max(2, int(round(dur * dst_fps)))
    t_src = np.linspace(0, 1, n_src)
    t_dst = np.linspace(0, 1, n_dst)
    out   = np.zeros((n_dst, arr.shape[1], arr.shape[2]), dtype=np.float32)
    for j in range(arr.shape[1]):
        for c in range(arr.shape[2]):
            out[:, j, c] = np.interp(t_dst, t_src, arr[:, j, c])
    return out


def angle_cos(a, b, c):
    ba = a - b
    bc = c - b
    return float(np.dot(ba, bc) / (np.linalg.norm(ba) * np.linalg.norm(bc) + 1e-8))


def build_tensor(clip):
    """
    clip : (T, 33, 4)
    Returns float32 tensor of shape (7, T, 4, 3).

    ch0 -- position xyz
    ch1 -- velocity xyz (frame-to-frame displacement)
    ch2 -- geometry (bone unit vectors + elbow flexion angle)
    ch3 -- y-velocity (vertical motion per joint)
    ch4 -- elbow flexion angle broadcast to all joints
    ch5 -- lateral dominance (x_vel / horizontal_vel)
    ch6 -- vertical dominance (y_vel / total_vel)
    """
    T   = clip.shape[0]
    xyz = clip[:, :, :3].astype(np.float32)       # (T, 33, 3)
    tracked = xyz[:, TRACK, :]                     # (T, 4, 3)

    # ch0: position
    ch0 = tracked.copy()

    # ch1: velocity
    ch1     = np.zeros_like(tracked)
    ch1[1:] = tracked[1:] - tracked[:-1]

    # ch2: bone unit vectors + elbow angle override
    ch2 = np.zeros_like(tracked)
    for t in range(T):
        f = xyz[t]
        for i in range(4):
            if i < 2:   # elbows: shoulder → elbow
                v = f[TRACK[i]] - f[SHOULDER[i]]
            else:       # wrists: elbow → wrist
                v = f[TRACK[i]] - f[TRACK[i - 2]]
            ch2[t, i] = v / (np.linalg.norm(v) + 1e-8)
        ch2[t, 0, 0] = angle_cos(f[L_SHOULDER], f[L_ELBOW], f[L_WRIST])
        ch2[t, 1, 0] = angle_cos(f[R_SHOULDER], f[R_ELBOW], f[R_WRIST])

    # ch3: y-velocity
    ch3   = np.zeros_like(tracked)
    y_vel = np.zeros((T, 4), dtype=np.float32)
    for i, lm in enumerate(TRACK):
        y_vel[1:, i] = xyz[1:, lm, 1] - xyz[:-1, lm, 1]
    ch3[:, :, :] = y_vel[:, :, np.newaxis]

    # ch4: elbow flexion angle broadcast
    ch4 = np.zeros_like(tracked)
    for t in range(T):
        f = xyz[t]
        l_angle = angle_cos(f[L_SHOULDER], f[L_ELBOW], f[L_WRIST])
        r_angle = angle_cos(f[R_SHOULDER], f[R_ELBOW], f[R_WRIST])
        ch4[t, 0, :] = l_angle
        ch4[t, 1, :] = r_angle
        ch4[t, 2, :] = l_angle
        ch4[t, 3, :] = r_angle

    # ch5: lateral dominance (x_vel / sqrt(x²+z²))
    ch5 = np.zeros_like(tracked)
    eps = 1e-8
    elbow_vel   = ch1[:, :2, :]
    elbow_speed = np.sqrt(elbow_vel[:, :, 0:1]**2 + elbow_vel[:, :, 2:3]**2) + eps
    elbow_lat   = elbow_vel[:, :, 0:1] / elbow_speed
    ch5[:, 0, :] = elbow_lat[:, 0, 0, np.newaxis]
    ch5[:, 1, :] = elbow_lat[:, 1, 0, np.newaxis]
    wrist_vel   = ch1[:, 2:, :]
    wrist_speed = np.sqrt(wrist_vel[:, :, 0:1]**2 + wrist_vel[:, :, 2:3]**2) + eps
    wrist_lat   = wrist_vel[:, :, 0:1] / wrist_speed
    ch5[:, 2, :] = wrist_lat[:, 0, 0, np.newaxis]
    ch5[:, 3, :] = wrist_lat[:, 1, 0, np.newaxis]

    # ch6: vertical dominance (y_vel / total_vel)
    total_speed = np.linalg.norm(ch1, axis=-1, keepdims=True) + eps
    vert_dom    = ch1[:, :, 1:2] / total_speed
    ch6         = np.broadcast_to(vert_dom, tracked.shape).copy()

    return np.stack([ch0, ch1, ch2, ch3, ch4, ch5, ch6], axis=0).astype(np.float32)


def extract_live_clip(raw_frames, src_fps):
    """
    Matches extract_best_clip from the notebook exactly.

    raw_frames must already be pre-sliced to only the frames captured since
    the current target spawned (see spawn_buf_len logic in the main loop).
    This ensures the velocity peak search covers only the current punch,
    the same way the notebook processes one video per punch.

    Returns (CLIP_FRAMES, 33, 4) float32, or None if not enough data.
    """
    if len(raw_frames) < 2:
        return None

    # Step 1: resample to TARGET_FPS
    resampled = resample_frames(raw_frames, src_fps, TARGET_FPS)
    n = len(resampled)

    if n < CLIP_FRAMES:
        return None

    # Step 2: compute smoothed compound velocity on the resampled sequence
    all_vels = [0.0]
    for i in range(1, n):
        all_vels.append(compound_velocity(resampled[i], resampled[i - 1]))
    vels   = np.array(all_vels, dtype=np.float32)
    kernel = np.ones(VEL_WINDOW) / VEL_WINDOW
    smooth = np.convolve(vels, kernel, mode='same')

    # Step 3: find velocity peak — window must fit fully in bounds
    min_peak = CLIP_FRAMES - 1
    max_peak = n - 1

    if min_peak > max_peak:
        peak = max_peak
    else:
        peak = int(np.argmax(smooth[min_peak:max_peak + 1])) + min_peak

    end   = peak + 1
    start = end - CLIP_FRAMES
    return resampled[start:end]   # (CLIP_FRAMES, 33, 4)


# ── Model architecture ───────────────────────────────────────────────────────

class Conv2Plus1DBlock(nn.Module):
    def __init__(self, in_ch, out_ch, kt=3, kj=3, kc=3, stride_t=1, dropout=0.1):
        super().__init__()
        mid = max(in_ch, out_ch) // 2 if in_ch != out_ch else in_ch
        self.spatial = nn.Sequential(
            nn.Conv3d(in_ch, mid, kernel_size=(1, kj, kc),
                      padding=(0, kj // 2, kc // 2), bias=False),
            nn.BatchNorm3d(mid),
            nn.ReLU(inplace=True),
        )
        self.temporal = nn.Sequential(
            nn.Conv3d(mid, out_ch, kernel_size=(kt, 1, 1),
                      stride=(stride_t, 1, 1), padding=(kt // 2, 0, 0), bias=False),
            nn.BatchNorm3d(out_ch),
            nn.ReLU(inplace=True),
        )
        self.drop = nn.Dropout3d(dropout)
        self.residual = (
            nn.Identity()
            if (in_ch == out_ch and stride_t == 1)
            else nn.Sequential(
                nn.Conv3d(in_ch, out_ch, 1, stride=(stride_t, 1, 1), bias=False),
                nn.BatchNorm3d(out_ch),
            )
        )

    def forward(self, x):
        return F.relu(
            self.drop(self.temporal(self.spatial(x))) + self.residual(x),
            inplace=True,
        )


class PerfectPunchCNN(nn.Module):
    """
    6-block (2+1)D CNN for skeleton punch classification.
    Input:  (B, 7, T, 4, 3)
    Output: (B, num_classes)
    """
    def __init__(self, num_classes=N_CLASSES, in_channels=7, base_ch=32, dropout=0.4):
        super().__init__()
        self.stem = nn.Sequential(
            nn.Conv3d(in_channels, base_ch, kernel_size=(3, 3, 3),
                      padding=(1, 1, 1), bias=False),
            nn.BatchNorm3d(base_ch),
            nn.ReLU(inplace=True),
        )
        self.layer1 = Conv2Plus1DBlock(base_ch,      base_ch * 2,  kt=3, dropout=0.10)
        self.layer2 = Conv2Plus1DBlock(base_ch * 2,  base_ch * 4,  kt=3, stride_t=2, dropout=0.10)
        self.layer3 = Conv2Plus1DBlock(base_ch * 4,  base_ch * 8,  kt=3, stride_t=2, dropout=0.15)
        self.layer4 = Conv2Plus1DBlock(base_ch * 8,  base_ch * 8,  kt=3, dropout=0.15)
        self.layer5 = Conv2Plus1DBlock(base_ch * 8,  base_ch * 16, kt=3, stride_t=2, dropout=0.20)
        self.layer6 = Conv2Plus1DBlock(base_ch * 16, base_ch * 16, kt=3, dropout=0.20)
        self.pool = nn.AdaptiveAvgPool3d((1, 1, 1))
        self.classifier = nn.Sequential(
            nn.Flatten(),
            nn.Dropout(dropout),
            nn.Linear(base_ch * 16, base_ch * 8),
            nn.GELU(),
            nn.Dropout(dropout / 2),
            nn.Linear(base_ch * 8, num_classes),
        )

    def forward(self, x):
        x = self.stem(x)
        x = self.layer1(x)
        x = self.layer2(x)
        x = self.layer3(x)
        x = self.layer4(x)
        x = self.layer5(x)
        x = self.layer6(x)
        x = self.pool(x)
        return self.classifier(x)


# ── Camera backend helpers ───────────────────────────────────────────────────

def _camera_backend_candidates():
    if sys.platform == "win32":
        return [
            getattr(cv2, "CAP_DSHOW", cv2.CAP_ANY),
            getattr(cv2, "CAP_MSMF", cv2.CAP_ANY),
            cv2.CAP_ANY,
        ]
    if sys.platform == "darwin":
        return [
            getattr(cv2, "CAP_AVFOUNDATION", cv2.CAP_ANY),
            cv2.CAP_ANY,
        ]
    return [
        getattr(cv2, "CAP_V4L2", cv2.CAP_ANY),
        cv2.CAP_ANY,
    ]


def _load_camera():
    attempted = set()
    backend_names = {
        getattr(cv2, "CAP_DSHOW", -1):        "CAP_DSHOW",
        getattr(cv2, "CAP_MSMF", -1):         "CAP_MSMF",
        getattr(cv2, "CAP_AVFOUNDATION", -1):  "CAP_AVFOUNDATION",
        getattr(cv2, "CAP_V4L2", -1):          "CAP_V4L2",
        cv2.CAP_ANY:                            "CAP_ANY",
    }
    for backend in _camera_backend_candidates():
        if backend in attempted:
            continue
        attempted.add(backend)
        cap = cv2.VideoCapture(0) if backend == cv2.CAP_ANY else cv2.VideoCapture(0, backend)
        if not cap or not cap.isOpened():
            if cap:
                cap.release()
            continue
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 960)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 540)
        cap.set(cv2.CAP_PROP_FPS, 30)
        cap.read()
        print(f"Camera initialized with backend: {backend_names.get(backend, str(backend))}")
        return cap
    return None


def _load_torch_model():
    m = PerfectPunchCNN(num_classes=N_CLASSES)
    model_path = os.path.join(os.path.dirname(__file__), "models", "best_punch_model.pt")
    torch.load(model_path, map_location="cpu")
    m.load_state_dict(
        torch.load(model_path, map_location="cpu")
    )
    m.eval()
    return m


def _load_mediapipe_pose():
    return mp_pose.Pose(
        model_complexity=0,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    )


# ── Parallel initialisation ──────────────────────────────────────────────────
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
    cap_future   = executor.submit(_load_camera)
    model_future = executor.submit(_load_torch_model)
    pose_future  = executor.submit(_load_mediapipe_pose)

    cap         = cap_future.result()
    model       = model_future.result()
    shared_pose = pose_future.result()

if not cap or not cap.isOpened():
    print("FATAL: Camera failed to initialize.")
    exit(1)

actual_fps = cap.get(cv2.CAP_PROP_FPS)
if not actual_fps or actual_fps <= 0:
    actual_fps = 30.0
print(f"Camera FPS: {actual_fps:.1f}")

# ── Tracker and world-landmark buffer ───────────────────────────────────────
tracker = PoseTracker(max_frames=WORLD_BUFFER_FRAMES, pose=shared_pose)
world_frame_buffer: deque = deque(maxlen=WORLD_BUFFER_FRAMES)

TARGET_CENTER    = None
CURRENT_TYPE     = None
CURRENT_SIDE     = None
TARGET_RADIUS    = 25
TARGET_VISUAL_RADIUS = int(TARGET_RADIUS * TARGET_VISUAL_SCALE)
TARGET_RESPAWN_DELAY_S = 2.0
circle_spawn_ts  = None          # when the target appeared (reaction time reference)
ideal_hit_ts     = None          # when the approach ring meets the target edge
hand_inside_prev = True          # was the punching hand inside the target last frame?
next_target_spawn_ts = 0.0
# Target flow: "idle" -> "callout" (banner) -> "active" (osu! target) -> "idle"
target_phase     = "idle"
callout_start_ts = None
recent_targets   = deque(maxlen=MAX_SAME_TARGET_IN_A_ROW)
# Time windows (start, end) when attacks must not be in their active phase.
reserved_windows = []

# Score and on-screen effects
score            = 0
floating_texts   = []            # FloatingText list (drawn after the flip)
particles        = []            # hit particle bursts (camera coords)
pops             = []            # (center, color, start_ts) for hit pops
fading_targets   = []            # (center, start_ts) for missed targets
hit_vignette_until = 0.0
# Tracks how many frames were in world_frame_buffer when the current target
# spawned.  At collision we slice [spawn_buf_len:] so only frames from the
# current punch are fed to extract_live_clip — matching the notebook which
# processes exactly one video (one punch) per clip.
spawn_buf_len    = 0

MAX_RUNTIME                 = 30
PRESTART_COUNTDOWN_SECONDS  = 3
PREDICTION_OVERLAY_SECONDS  = 1.8
prediction_overlay_text     = None
prediction_overlay_color    = (220, 220, 220)
prediction_overlay_until    = 0.0

reaction_time_punch    = {"jab": [], "hook": [], "uppercut": []}
reaction_time_windows  = [{k: [] for k in reaction_time_punch} for _ in range(3)]
correct_punches_thrown = 0
punches_thrown         = 0
attempts_by_type       = {k: 0 for k in reaction_time_punch}
correct_by_type        = {k: 0 for k in reaction_time_punch}
accuracy_windows       = [{"correct": 0, "attempts": 0} for _ in range(3)]
reaction_window_combined = [[] for _ in range(3)]
speed_by_type          = {k: [] for k in reaction_time_punch}
speed_windows          = [{k: [] for k in reaction_time_punch} for _ in range(3)]
speed_window_combined  = [[] for _ in range(3)]
target_timing          = {k: {"perfect": 0, "good": 0, "miss": 0} for k in reaction_time_punch}
coverage_tracker = {
    "head": {"covered": 0, "total": 0},
    "body": {"covered": 0, "total": 0},
}
exposure_tracker = {
    "left_shoulder":  {"covered": 0, "total": 0},
    "right_shoulder": {"covered": 0, "total": 0},
    "chest":          {"covered": 0, "total": 0},
    "abdomen":        {"covered": 0, "total": 0},
    "hips":           {"covered": 0, "total": 0},
}
defense_game = DefenseGame()


def _rects_overlap(a_x1, a_y1, a_x2, a_y2, b_x1, b_y1, b_x2, b_y2):
    return not (a_x2 < b_x1 or a_x1 > b_x2 or a_y2 < b_y1 or a_y1 > b_y2)


def _clamp_rect(x1, y1, x2, y2, max_w, max_h):
    return (
        max(0, min(x1, max_w)),
        max(0, min(y1, max_h)),
        max(0, min(x2, max_w)),
        max(0, min(y2, max_h)),
    )


def update_coverage_metrics(landmarks, w, h):
    if landmarks is None:
        return

    def get_coords(lm_enum_or_index):
        lm = landmarks[lm_enum_or_index if isinstance(lm_enum_or_index, int) else lm_enum_or_index.value]
        return int(lm.x * w), int(lm.y * h)

    rw_x, rw_y = get_coords(mp_pose.PoseLandmark.RIGHT_WRIST)
    lw_x, lw_y = get_coords(mp_pose.PoseLandmark.LEFT_WRIST)
    re_x, re_y = get_coords(mp_pose.PoseLandmark.RIGHT_ELBOW)
    le_x, le_y = get_coords(mp_pose.PoseLandmark.LEFT_ELBOW)
    rs_x, rs_y = get_coords(mp_pose.PoseLandmark.RIGHT_SHOULDER)
    ls_x, ls_y = get_coords(mp_pose.PoseLandmark.LEFT_SHOULDER)
    lh_x, lh_y = get_coords(mp_pose.PoseLandmark.LEFT_HIP)
    rh_x, rh_y = get_coords(mp_pose.PoseLandmark.RIGHT_HIP)
    nose_x, nose_y = get_coords(mp_pose.PoseLandmark.NOSE)

    arm_padding = 20
    right_arm_rect = _clamp_rect(
        min(rs_x, re_x, rw_x) - arm_padding, min(rs_y, re_y, rw_y) - arm_padding,
        max(rs_x, re_x, rw_x) + arm_padding, max(rs_y, re_y, rw_y) + arm_padding, w, h)
    left_arm_rect = _clamp_rect(
        min(ls_x, le_x, lw_x) - arm_padding, min(ls_y, le_y, lw_y) - arm_padding,
        max(ls_x, le_x, lw_x) + arm_padding, max(ls_y, le_y, lw_y) + arm_padding, w, h)

    def is_region_guarded(region_rect):
        x1, y1, x2, y2 = region_rect
        return (_rects_overlap(x1, y1, x2, y2, *right_arm_rect) or
                _rects_overlap(x1, y1, x2, y2, *left_arm_rect))

    head_padding = 30
    head_rect = _clamp_rect(
        min(ls_x, rs_x) - head_padding, min(nose_y, ls_y, rs_y) - head_padding,
        max(ls_x, rs_x) + head_padding, max(nose_y, ls_y, rs_y) + head_padding, w, h)
    coverage_tracker["head"]["total"] += 1
    if is_region_guarded(head_rect):
        coverage_tracker["head"]["covered"] += 1

    body_padding = 25
    body_rect = _clamp_rect(
        min(ls_x, rs_x, lh_x, rh_x) - body_padding, min(ls_y, rs_y) - body_padding,
        max(ls_x, rs_x, lh_x, rh_x) + body_padding, max(lh_y, rh_y) + body_padding, w, h)
    coverage_tracker["body"]["total"] += 1
    if is_region_guarded(body_rect):
        coverage_tracker["body"]["covered"] += 1

    area_half = 45
    area_definitions = {
        "left_shoulder":  (ls_x, ls_y),
        "right_shoulder": (rs_x, rs_y),
        "chest":          ((ls_x + rs_x) // 2, (ls_y + rs_y) // 2),
        "abdomen":        ((lh_x + rh_x) // 2, (lh_y + rh_y) // 2),
        "hips":           ((lh_x + rh_x) // 2, max(lh_y, rh_y)),
    }
    for area_key, (cx, cy) in area_definitions.items():
        area_rect = _clamp_rect(cx - area_half, cy - area_half,
                                cx + area_half, cy + area_half, w, h)
        exposure_tracker[area_key]["total"] += 1
        if is_region_guarded(area_rect):
            exposure_tracker[area_key]["covered"] += 1


WINDOW_NAME = "Mediapipe Feed (Press q to quit)"
if SHOW_DISPLAY:
    cv2.namedWindow(WINDOW_NAME, cv2.WINDOW_NORMAL)
    cv2.waitKey(1)

if SHOW_DISPLAY and sys.platform == "win32":
    GWL_STYLE    = -16
    WS_CAPTION      = 0x00C00000
    WS_THICKFRAME   = 0x00040000
    WS_MINIMIZEBOX  = 0x00020000
    WS_MAXIMIZEBOX  = 0x00010000
    WS_SYSMENU      = 0x00080000

    hwnd = ctypes.windll.user32.FindWindowW(None, WINDOW_NAME)
    if hwnd:
        try:
            ctypes.windll.user32.SetProcessDPIAware()
        except Exception:
            pass
        screen_w = ctypes.windll.user32.GetSystemMetrics(0)
        screen_h = ctypes.windll.user32.GetSystemMetrics(1)
        style = ctypes.windll.user32.GetWindowLongW(hwnd, GWL_STYLE)
        style &= ~(WS_CAPTION | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_SYSMENU)
        ctypes.windll.user32.SetWindowLongW(hwnd, GWL_STYLE, style)
        SWP_FRAMECHANGED = 0x0020
        SWP_NOZORDER     = 0x0004
        SWP_SHOWWINDOW   = 0x0040
        ctypes.windll.user32.SetWindowPos(
            hwnd, None, 0, 0, screen_w, screen_h,
            SWP_FRAMECHANGED | SWP_NOZORDER | SWP_SHOWWINDOW)
        cv2.moveWindow(WINDOW_NAME, 0, 0)
        cv2.resizeWindow(WINDOW_NAME, screen_w, screen_h)
        cv2.setWindowProperty(WINDOW_NAME, cv2.WND_PROP_FULLSCREEN, cv2.WINDOW_FULLSCREEN)


def get_frame():
    ret, frame = cap.read()
    return frame if ret else None


def update_tracker_from_landmarks(tracker_obj, landmarks, frame_w, frame_h):
    tracker_obj.frame_index += 1
    if landmarks is None:
        return
    coords = {}
    selected = (
        mp_pose.PoseLandmark.RIGHT_ELBOW,
        mp_pose.PoseLandmark.RIGHT_WRIST,
        mp_pose.PoseLandmark.LEFT_ELBOW,
        mp_pose.PoseLandmark.LEFT_WRIST,
    )
    for landmark_id in selected:
        lm = landmarks[landmark_id.value]
        coords[landmark_id.name] = {
            "x": int(lm.x * frame_w),
            "y": int(lm.y * frame_h),
        }
    tracker_obj.coord_buffer.append({"frame": tracker_obj.frame_index, "landmarks": coords})


def render_countdown_frame(frame, countdown_value):
    h, w = frame.shape[:2]
    overlay = frame.copy()
    cv2.rectangle(overlay, (0, 0), (w, h), (0, 0, 0), thickness=-1)
    dimmed = cv2.addWeighted(overlay, 0.45, frame, 0.55, 0)
    countdown_text = str(countdown_value)
    font       = cv2.FONT_HERSHEY_DUPLEX
    font_scale = max(2.0, min(w, h) / 180.0)
    thickness  = max(4, int(font_scale * 2))
    text_size, _ = cv2.getTextSize(countdown_text, font, font_scale, thickness)
    text_x = (w - text_size[0]) // 2
    text_y = (h + text_size[1]) // 2
    cv2.putText(dimmed, countdown_text, (text_x, text_y), font, font_scale,
                (255, 255, 255), thickness, cv2.LINE_AA)
    return dimmed


def calibration_checker(frame, landmarks, w, h):
    if landmarks is None:
        return frame, None, 0, "", (128, 128, 128)
    try:
        left_shoulder  = landmarks[mp_pose.PoseLandmark.LEFT_SHOULDER.value]
        right_shoulder = landmarks[mp_pose.PoseLandmark.RIGHT_SHOULDER.value]
        left_x  = int(left_shoulder.x  * w)
        right_x = int(right_shoulder.x * w)
        shoulder_ratio = abs(right_x - left_x) / w if w > 0 else 0
        if shoulder_ratio > 0.30:
            return frame, "TOO CLOSE", shoulder_ratio, "Step back",    (0, 0, 255)
        if shoulder_ratio < 0.15:
            return frame, "TOO FAR",   shoulder_ratio, "Step closer",  (0, 165, 255)
        return frame, "CORRECT POSITION", shoulder_ratio, "Stay still", (0, 255, 0)
    except (AttributeError, IndexError):
        return frame, None, 0, "", (128, 128, 128)


def draw_calibration_frame(frame, status, shoulder_ratio, feedback, color):
    h, w = frame.shape[:2]
    overlay = frame.copy()
    cv2.rectangle(overlay, (0, 0), (w, h), (0, 0, 0), thickness=-1)
    frame = cv2.addWeighted(overlay, 0.2, frame, 0.8, 0)
    font       = cv2.FONT_HERSHEY_DUPLEX
    font_scale = 1.5
    thickness  = 3
    if status:
        s_size, _ = cv2.getTextSize(status, font, font_scale, thickness)
        cv2.putText(frame, status, ((w - s_size[0]) // 2, h // 3),
                    font, font_scale, color, thickness, cv2.LINE_AA)
    if feedback:
        f_size, _ = cv2.getTextSize(feedback, font, 1.2, thickness)
        cv2.putText(frame, feedback, ((w - f_size[0]) // 2, h // 2),
                    font, 1.2, color, thickness, cv2.LINE_AA)
    for txt, y_frac, c in [
        (f"Optimal: 0.15 - 0.30", 2/3,       (200, 200, 200)),
        (f"Current: {shoulder_ratio:.3f}",  2/3, color),
    ]:
        s, _ = cv2.getTextSize(txt, font, 0.8, 2)
        cv2.putText(frame, txt, ((w - s[0]) // 2, int(h * y_frac) + (40 if 'Current' in txt else 0)),
                    font, 0.8, c, 2, cv2.LINE_AA)
    return frame


# ── CALIBRATION LOOP ─────────────────────────────────────────────────────────
correct_position_start = None
calibration_complete   = False

while cap.isOpened() and not calibration_complete:
    ret, frame = cap.read()
    if not ret or frame is None:
        continue
    frame = cv2.flip(frame, 1)
    h, w  = frame.shape[:2]
    image = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    image.flags.writeable = False
    results = shared_pose.process(image)
    image.flags.writeable = True
    try:
        landmarks = results.pose_landmarks.landmark
    except AttributeError:
        landmarks = None
    _, status, shoulder_ratio, feedback, color = calibration_checker(frame, landmarks, w, h)
    mp_drawing.draw_landmarks(frame, results.pose_landmarks, mp_pose.POSE_CONNECTIONS)
    if status == "CORRECT POSITION":
        if correct_position_start is None:
            correct_position_start = time.time()
        time_in_position = time.time() - correct_position_start
        if time_in_position >= 2.0:
            calibration_complete = True
            break
    else:
        correct_position_start = None
        time_in_position = 0
    display_frame = draw_calibration_frame(frame.copy(), status, shoulder_ratio, feedback, color)
    if correct_position_start is not None:
        timer_text = f"Get ready: {2.0 - time_in_position:.1f}s"
        ts, _ = cv2.getTextSize(timer_text, cv2.FONT_HERSHEY_DUPLEX, 1.0, 2)
        cv2.putText(display_frame, timer_text, ((w - ts[0]) // 2, h - 50),
                    cv2.FONT_HERSHEY_DUPLEX, 1.0, (0, 255, 0), 2, cv2.LINE_AA)
    show_frame(WINDOW_NAME, display_frame)
    if wait_key(1):
        cap.release()
        cv2.destroyAllWindows()
        quit()

# ── COUNTDOWN LOOP ───────────────────────────────────────────────────────────
countdown_start = time.time()
while cap.isOpened():
    ret, frame = cap.read()
    if not ret or frame is None:
        continue
    elapsed_countdown = time.time() - countdown_start
    remaining = PRESTART_COUNTDOWN_SECONDS - int(elapsed_countdown)
    if remaining <= 0:
        break
    show_frame(WINDOW_NAME, render_countdown_frame(cv2.flip(frame, 1), remaining))
    if wait_key(1):
        cap.release()
        cv2.destroyAllWindows()
        quit()

start_time = time.time()

# ── MAIN GAME LOOP ───────────────────────────────────────────────────────────
while cap.isOpened():
    # --- Frame capture ----------------------------------------------------
    ret, frame = cap.read()
    if not ret or frame is None:
        continue

    now     = time.time()
    elapsed = now - start_time

    # --- Pose estimation (MediaPipe) -------------------------------------
    image = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    image.flags.writeable = False
    results = shared_pose.process(image)
    image.flags.writeable = True
    image = cv2.cvtColor(image, cv2.COLOR_RGB2BGR)

    # Draw skeleton for visualization (does not affect logic)
    mp_drawing.draw_landmarks(image, results.pose_landmarks, mp_pose.POSE_CONNECTIONS)
    h, w = image.shape[:2]

    # Extract landmark list (or None if detection failed)
    try:
        landmarks = results.pose_landmarks.landmark
    except AttributeError:
        landmarks = None

    # --- World-space skeleton buffering ----------------------------------
    # Keep a rolling buffer of normalized world-space skeletons for clip
    # extraction and velocity analysis used by the model.
    try:
        world_norm = normalize_skeleton(results.pose_world_landmarks.landmark)
        world_frame_buffer.append(world_norm)
    except AttributeError:
        pass

    # --- 2D tracker update (pixel-space coords) ---------------------------
    # Update the lightweight per-frame tracker used for UI metrics and
    # quick pixel-based speed calculations.
    update_tracker_from_landmarks(tracker, landmarks, w, h)

    # Drop reserved windows that are already over.
    reserved_windows = [win for win in reserved_windows if win[1] > now]

    # --- Target flow step 1: start a callout ------------------------------
    # When the respawn timer allows it, pick the next punch and flash its
    # name. The target itself only appears once the banner is gone.
    if target_phase == "idle" and landmarks is not None and now >= next_target_spawn_ts:
        callout_end    = now + CALLOUT_DURATION_S
        planned_hit    = callout_end + APPROACH_DURATION_S
        planned_window = (planned_hit - GOOD_WINDOW_S, planned_hit + GOOD_WINDOW_S)
        attack_window  = defense_game.get_active_window()
        # Never ask for a punch while an attack is in its solid (dodge) phase.
        if not (_windows_overlap(attack_window, (now, callout_end), SCHEDULE_MARGIN_S)
                or _windows_overlap(attack_window, planned_window, SCHEDULE_MARGIN_S)):
            CURRENT_TYPE, CURRENT_SIDE = _pick_next_target(recent_targets)
            target_phase     = "callout"
            callout_start_ts = now
            reserved_windows.append((now, callout_end))
            reserved_windows.append(planned_window)
            print(f"Callout: {callout_text(CURRENT_TYPE, CURRENT_SIDE)}")

    # --- Target flow step 2: callout over -> spawn the osu! target --------
    if target_phase == "callout" and now >= callout_start_ts + CALLOUT_DURATION_S and landmarks is not None:
        center = respawn_target(landmarks, w, h, TARGET_RADIUS,
                                side=CURRENT_SIDE, margin=TARGET_VISUAL_RADIUS + 6,
                                avoid_hands_px=int(TARGET_RADIUS * HIT_RADIUS_SCALE) + 20)
        if center is not None:
            TARGET_CENTER   = center
            circle_spawn_ts = now
            ideal_hit_ts    = now + APPROACH_DURATION_S
            target_phase    = "active"
            hand_inside_prev = True     # a hand already on the target at spawn doesn't count
            # Keep the real hit window reserved (it shifts if the spawn was delayed).
            reserved_windows.append((ideal_hit_ts - GOOD_WINDOW_S, ideal_hit_ts + GOOD_WINDOW_S))
            # Record the world buffer length at spawn so inference later uses
            # only frames captured since this spawn (one punch per clip).
            spawn_buf_len = len(world_frame_buffer)

    # --- Collision detection + timing grade ------------------------------
    # Contacts before the hit window opens are ignored (the guard naturally
    # sits near the targets); no hit by the end of the window is a MISS.
    # A hit must be the hand ENTERING the target inside the window: a guard
    # that is already resting on the target doesn't count, so the player has
    # to actually throw the punch.
    collide    = False
    hit_grade  = None
    if target_phase == "active":
        window_open  = now >= ideal_hit_ts - GOOD_WINDOW_S
        window_close = ideal_hit_ts + GOOD_WINDOW_S
        if landmarks is not None:
            hand_inside = wrists_hit_circle(landmarks, w, h, TARGET_CENTER, TARGET_RADIUS,
                                            hit_radius_scale=HIT_RADIUS_SCALE, side=CURRENT_SIDE)
            if window_open and now <= window_close and hand_inside and not hand_inside_prev:
                collide = True
            hand_inside_prev = hand_inside
        if collide:
            hit_grade = "PERFECT" if abs(now - ideal_hit_ts) <= PERFECT_WINDOW_S else "GOOD"
        elif now > window_close:
            # --- MISS: target expires, no model inference ---------------
            target_timing[CURRENT_TYPE]["miss"] += 1
            fading_targets.append((TARGET_CENTER, now))
            floating_texts.append(FloatingText("MISS", TARGET_CENTER, GRADE_COLORS["MISS"], now,
                                               duration=FLOATING_TEXT_S, scale=1.1))
            print(f"MISS ({callout_text(CURRENT_TYPE, CURRENT_SIDE)})")
            TARGET_CENTER   = None
            CURRENT_TYPE    = None
            CURRENT_SIDE    = None
            ideal_hit_ts    = None
            spawn_buf_len   = 0
            target_phase    = "idle"
            next_target_spawn_ts = now + TARGET_RESPAWN_DELAY_S

    # --- On-collision: metrics collection + prepare inference ------------
    if collide:
        # Reaction time relative to when the target appeared
        reference_time = circle_spawn_ts
        reaction_time  = now - reference_time

        # Record reaction time globally and per time-window
        reaction_time_punch[CURRENT_TYPE].append(reaction_time)
        window_idx = _get_time_window_index(elapsed)
        if window_idx is not None:
            reaction_time_windows[window_idx][CURRENT_TYPE].append(reaction_time)
            reaction_window_combined[window_idx].append(reaction_time)

        # Compute a simple pixel-space speed estimate for diagnostics
        raw_coords  = tracker.get_last_fifteen_coords()
        speed_value = _compute_speed_value(raw_coords, actual_fps)
        if speed_value is not None:
            speed_by_type[CURRENT_TYPE].append(speed_value)
            if window_idx is not None:
                speed_windows[window_idx][CURRENT_TYPE].append(speed_value)
                speed_window_combined[window_idx].append(speed_value)

        # --- Model inference (classify the punch) ------------------------
        predicted_punch = None
        confidence      = None
        is_confident    = False

        # Prepare a sequence of world-space frames that correspond to the
        # current punch. This mirrors the offline notebook: one punch -> one clip.
        _buf = list(world_frame_buffer)
        punch_frames = _buf[spawn_buf_len:]

        # Fallback: if we don't have enough spawn-tracked frames, use a
        # fixed look-back window sized by LOOK_BACK_SECONDS.
        min_raw = max(2, int(round(LOOK_BACK_SECONDS * actual_fps)))
        if len(punch_frames) < min_raw:
            punch_frames = _buf[-min_raw:]

        # Extract the model clip (resample, smooth, pick peak velocity)
        clip = extract_live_clip(punch_frames, actual_fps)

        if clip is not None:
            # Build model input tensor and run the CNN to get class probabilities
            tensor = build_tensor(clip)                       # (7, CLIP_FRAMES, 4, 3)
            inp    = torch.tensor(tensor, dtype=torch.float32).unsqueeze(0)
            with torch.no_grad():
                logits = model(inp)
                probs  = torch.softmax(logits, dim=1)[0]
                pred_class = int(probs.argmax().item())
                confidence = float(probs[pred_class].item())

            # Update session stats and accuracy metrics
            predicted_punch = CLASS_NAMES[pred_class]
            attempts_by_type[CURRENT_TYPE] += 1
            punches_thrown += 1
            if window_idx is not None:
                accuracy_windows[window_idx]["attempts"] += 1

            is_confident = confidence >= MODEL_CONF_THRESHOLD
            mapped_punch = MODEL_TO_TARGET.get(predicted_punch, predicted_punch)
            if is_confident and mapped_punch == CURRENT_TYPE:
                correct_punches_thrown += 1
                correct_by_type[CURRENT_TYPE] += 1
                if window_idx is not None:
                    accuracy_windows[window_idx]["correct"] += 1

            probs_dict      = {CLASS_NAMES[i]: round(float(probs[i].item()), 3)
                               for i in range(N_CLASSES)}
            confidence_flag = "" if is_confident else "low-conf"
            print(f"Model Logits: {logits}")
            print(f"Predicted Punch: {predicted_punch} ({confidence:.1%}){confidence_flag}")
            print(f"All probs: {probs_dict}")
        else:
            needed_raw = max(2, int(round(CLIP_FRAMES / TARGET_FPS * actual_fps)))
            print(f"Warming up — {len(world_frame_buffer)}/{needed_raw} raw frames buffered "
                  f"(need {CLIP_FRAMES} frames at {TARGET_FPS} fps after resampling)")

        # --- Build overlay text and reset target state -------------------
        if predicted_punch is not None and confidence is not None:
            # Hershey fonts can't draw emoji, so flag low confidence in plain text.
            confidence_flag = "" if is_confident else " (low)"
            prediction_overlay_text  = (f"Predicted: {predicted_punch.title()} "
                                        f"({confidence:.0%}){confidence_flag}")
            prediction_overlay_color = (0, 255, 0) if is_confident else (0, 165, 255)
        else:
            needed_raw = max(2, int(round(CLIP_FRAMES / TARGET_FPS * actual_fps)))
            prediction_overlay_text  = f"Warming up ({len(world_frame_buffer)}/{needed_raw} frames)"
            prediction_overlay_color = (220, 220, 220)
        prediction_overlay_until = now + PREDICTION_OVERLAY_SECONDS

        # --- Timing grade, score and hit effects --------------------------
        grade_key = hit_grade.lower()
        target_timing[CURRENT_TYPE][grade_key] += 1
        score += SCORE_PERFECT if hit_grade == "PERFECT" else SCORE_GOOD
        punch_color = PUNCH_COLORS.get(CURRENT_TYPE, WHITE)
        floating_texts.append(FloatingText(hit_grade, TARGET_CENTER, GRADE_COLORS[hit_grade], now,
                                           duration=FLOATING_TEXT_S,
                                           scale=1.4 if hit_grade == "PERFECT" else 1.2))
        pops.append((TARGET_CENTER, punch_color, now))
        particles.extend(spawn_particles(TARGET_CENTER, punch_color, now, count=12))
        print(f"{hit_grade} ({callout_text(CURRENT_TYPE, CURRENT_SIDE)}) "
              f"{(now - ideal_hit_ts) * 1000:+.0f} ms from ideal")

        # Clear the current target and schedule next spawn
        TARGET_CENTER    = None
        CURRENT_TYPE     = None
        CURRENT_SIDE     = None
        ideal_hit_ts     = None
        target_phase     = "idle"
        spawn_buf_len    = 0
        next_target_spawn_ts = now + TARGET_RESPAWN_DELAY_S
        print(f"Next target in {TARGET_RESPAWN_DELAY_S:.1f}s")
        print(correct_by_type)
        print(attempts_by_type)

    # --- Defense drill update (telegraphed attacks: visual + stats) -----
    # Drawn first so the punch target stays on top of an attack band.
    defense_outcome = defense_game.update(image, landmarks, now, reserved_windows=reserved_windows)
    if defense_outcome is not None and defense_game.last_event is not None:
        event_pos = defense_game.last_event["pos"]
        if defense_outcome == "Hit":
            score = max(0, score - SCORE_HIT_PENALTY)
            hit_vignette_until = now + HIT_VIGNETTE_S
            floating_texts.append(FloatingText("HIT!", event_pos, (60, 60, 255), now,
                                               duration=FLOATING_TEXT_S, scale=1.2))
        else:
            score += SCORE_DEFENSE_BONUS
            label = "DODGED!" if defense_outcome == "Dodge" else "BLOCKED!"
            floating_texts.append(FloatingText(label, event_pos, WHITE, now,
                                               duration=FLOATING_TEXT_S, scale=1.2))
        print(f"Defense: {defense_outcome}")

    # --- Render target effects (camera orientation, before the flip) -----
    fading_targets = [(c, t0) for (c, t0) in fading_targets if now - t0 <= MISS_FADE_S]
    for center, t0 in fading_targets:
        draw_fading_target(image, center, TARGET_VISUAL_RADIUS, now - t0, MISS_FADE_S)

    pops = [(c, col, t0) for (c, col, t0) in pops if now - t0 <= POP_S]
    for center, col, t0 in pops:
        draw_pop(image, center, TARGET_VISUAL_RADIUS, col, now - t0, POP_S)

    particles = draw_particles(image, particles, now)

    # --- Render the active osu!-style target ----------------------------
    if target_phase == "active" and TARGET_CENTER is not None:
        approach_progress = (now - circle_spawn_ts) / APPROACH_DURATION_S
        draw_osu_target(image, TARGET_CENTER, TARGET_VISUAL_RADIUS,
                        PUNCH_COLORS.get(CURRENT_TYPE, WHITE), approach_progress)

    # --- Display preparation (mirror for user-facing view) ------------
    display_image = cv2.flip(image, 1)
    disp_h, disp_w = display_image.shape[:2]

    # All text is drawn after the flip so it reads correctly.
    if target_phase == "active" and TARGET_CENTER is not None:
        badge_center = ((disp_w - 1) - TARGET_CENTER[0], TARGET_CENTER[1])
        draw_target_badge(display_image, badge_center, TARGET_VISUAL_RADIUS, CURRENT_SIDE)

    if target_phase == "callout" and callout_start_ts is not None:
        draw_callout_banner(display_image, callout_text(CURRENT_TYPE, CURRENT_SIDE),
                            PUNCH_COLORS.get(CURRENT_TYPE, WHITE),
                            now - callout_start_ts, CALLOUT_DURATION_S)

    floating_texts = draw_floating_texts(display_image, floating_texts, now)

    if now < hit_vignette_until:
        draw_hit_vignette(display_image, (hit_vignette_until - now) / HIT_VIGNETTE_S)

    # --- Prediction overlay: show recent model result on-screen --------
    if prediction_overlay_text and now <= prediction_overlay_until:
        overlay_font      = cv2.FONT_HERSHEY_DUPLEX
        overlay_scale     = 1.0
        overlay_thickness = 2
        text_size, _ = cv2.getTextSize(prediction_overlay_text,
                                       overlay_font, overlay_scale, overlay_thickness)
        text_x = max((display_image.shape[1] - text_size[0]) // 2, 10)
        text_y = max(int(display_image.shape[0] * 0.1), text_size[1] + 16)
        pad = 12
        cv2.rectangle(display_image,
                      (text_x - pad, text_y - text_size[1] - pad),
                      (text_x + text_size[0] + pad, text_y + pad),
                      (0, 0, 0), -1)
        cv2.rectangle(display_image,
                      (text_x - pad, text_y - text_size[1] - pad),
                      (text_x + text_size[0] + pad, text_y + pad),
                      prediction_overlay_color, 2)
        cv2.putText(display_image, prediction_overlay_text, (text_x, text_y),
                    overlay_font, overlay_scale, prediction_overlay_color,
                    overlay_thickness, cv2.LINE_AA)

    # --- HUD: time remaining (top-left) and score (top-right) -----------
    draw_hud(display_image, score, MAX_RUNTIME - elapsed)

    # --- Show frame and handle quit / runtime limit --------------------
    show_frame(WINDOW_NAME, display_image)
    if wait_key(1):
        break
    if elapsed >= MAX_RUNTIME:
        break


# ── Session metrics ──────────────────────────────────────────────────────────
# Flatten all recorded reaction times (in seconds).
all_reaction_times = [t for times in reaction_time_punch.values() for t in times]


def round_or_none(value, digits=2):
    return round(value, digits) if value is not None else None


# Per-punch-type mean reaction time (converted to milliseconds), None if no samples.
reaction_types_ms = {}
for punch_type, times in reaction_time_punch.items():
    reaction_types_ms[punch_type] = (
        round_or_none((sum(times) / len(times)) * 1000) if times else None
    )

# Per-window (10s segment) mean reaction times in ms.
reaction_all_points_ms = []
for window_times in reaction_window_combined:
    reaction_all_points_ms.append(
        round_or_none((sum(window_times) / len(window_times)) * 1000)
        if window_times else None
    )

# Overall reaction time statistics (mean / best / worst) in milliseconds.
if all_reaction_times:
    reaction_average_ms = round_or_none((sum(all_reaction_times) / len(all_reaction_times)) * 1000)
    reaction_best_ms    = round_or_none(min(all_reaction_times) * 1000)
    reaction_worst_ms   = round_or_none(max(all_reaction_times) * 1000)
else:
    reaction_average_ms = reaction_best_ms = reaction_worst_ms = None

# Per-punch-type accuracy percentage (None when there were no attempts).
accuracy_types = {}
for punch_type in reaction_time_punch:
    attempts = attempts_by_type[punch_type]
    correct  = correct_by_type[punch_type]
    accuracy_types[punch_type] = (
        round_or_none((correct / attempts) * 100) if attempts else None
    )

# Per-window (10s) accuracy percentages; None for windows with no attempts.
window_accuracy_points = []
for window in accuracy_windows:
    window_accuracy_points.append(
        round_or_none((window["correct"] / window["attempts"]) * 100)
        if window["attempts"] else None
    )

# Overall session accuracy as percent (None if no punches thrown).
overall_accuracy_percent = (
    round_or_none((correct_punches_thrown / punches_thrown) * 100)
    if punches_thrown else None
)

valid_accuracy_points = [pt for pt in window_accuracy_points if pt is not None]
accuracy_best  = max(valid_accuracy_points) if valid_accuracy_points else None
accuracy_worst = min(valid_accuracy_points) if valid_accuracy_points else None

# Flattened list of punch speed estimates (px/s) collected during the session.
all_speeds = [s for values in speed_by_type.values() for s in values]

# Average speed per punch type (px/s), None if absent.
speed_types = {}
for punch_type, values in speed_by_type.items():
    speed_types[punch_type] = (
        round_or_none(sum(values) / len(values)) if values else None
    )

# Average speed per time-window (px/s); one value per 10s segment.
speed_all_points = []
for window_values in speed_window_combined:
    speed_all_points.append(
        round_or_none(sum(window_values) / len(window_values))
        if window_values else None
    )

# Overall speed statistics (average, best, worst) in px/s.
if all_speeds:
    speed_average = round_or_none(sum(all_speeds) / len(all_speeds))
    speed_best    = round_or_none(max(all_speeds))
    speed_worst   = round_or_none(min(all_speeds))
else:
    speed_average = speed_best = speed_worst = None

# Map session thirds to speed-segment averages.
speed_segments = {
    "first_third":  speed_all_points[0],
    "second_third": speed_all_points[1],
    "final_third":  speed_all_points[2],
}

# Flying-blocks drill event counts (blocked/dodged/hit).
defense_totals       = defense_game.get_stats()
defense_total_events = sum(defense_totals.values())
# Percentage of incoming targets avoided (blocked + dodged), None if no events.
punches_avoided_percent = (
    round_or_none(
        ((defense_totals["blocked"] + defense_totals["dodged"]) / defense_total_events) * 100
    ) if defense_total_events else None
)

# Percentage of each body area that was exposed (uncovered) expressed as %.
critical_hit_percentages = {}
for area_key, stats in coverage_tracker.items():
    critical_hit_percentages[area_key] = (
        round_or_none(((stats["total"] - stats["covered"]) / stats["total"]) * 100)
        if stats["total"] else None
    )

# Relative exposure weights per body area (0..1), higher means more exposed.
exposure_weights_values = {}
for area_key, stats in exposure_tracker.items():
    exposure_weights_values[area_key] = (
        round_or_none((stats["total"] - stats["covered"]) / stats["total"])
        if stats["total"] else None
    )

# Accuracy per third of session to capture endurance trends.
endurance_segments = {
    "first_third":  round_or_none(window_accuracy_points[0]) if len(window_accuracy_points) > 0 else None,
    "second_third": round_or_none(window_accuracy_points[1]) if len(window_accuracy_points) > 1 else None,
    "final_third":  round_or_none(window_accuracy_points[2]) if len(window_accuracy_points) > 2 else None,
}

# Timing-grade totals across all punch types.
timing_totals = {
    grade: sum(type_counts[grade] for type_counts in target_timing.values())
    for grade in ("perfect", "good", "miss")
}

# Session identifiers and ISO timestamp for traceability.
fighter_id    = "fighter_sample_001"
session_id    = f"session_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}"
timestamp_iso = datetime.utcnow().replace(microsecond=0).isoformat() + "Z"

# Build the structured session payload for JSON export.
session_payload = [{
    "fighter_id":      fighter_id,
    "session_id":      session_id,
    "timestamp":       timestamp_iso,
    "punches_thrown":  punches_thrown,
    "correct_punches": correct_punches_thrown,
    "score":           score,
    "metrics": {
        "offense": {
            "target_timing": {
                "unit":        "count",
                "types":       target_timing,
                "totals":      timing_totals,
                "description": "PERFECT / GOOD / MISS timing grades per punch type, judged against the approach ring.",
            },
            "punch_accuracy": {
                "unit":  "%",
                "types": accuracy_types,
                "derived": {
                    "average":             overall_accuracy_percent,
                    "average_description": "Average of all recorded punch accuracies across the session.",
                    "best":                accuracy_best,
                    "worst":               accuracy_worst,
                    "all_points":          window_accuracy_points,
                },
            },
            "punch_reaction_time": {
                "unit":  "ms",
                "types": reaction_types_ms,
                "derived": {
                    "average":             reaction_average_ms,
                    "average_description": "Average reaction time, in milliseconds, measured across all punches.",
                    "best":                reaction_best_ms,
                    "worst":              reaction_worst_ms,
                    "all_points":          reaction_all_points_ms,
                    "all_points_description": "Reaction time averages for each 10-second segment of the session.",
                },
            },
            "punch_speed": {
                "unit":  "px/s",
                "types": speed_types,
                "derived": {
                    "average":             speed_average,
                    "average_description": "Mean punch speed across all punch types during the session.",
                    "best":                speed_best,
                    "worst":               speed_worst,
                    "all_points":          speed_all_points,
                    "combo_tempo": {
                        "unit":        "px/s",
                        "segments":    speed_segments,
                        "description": "Average punch speed per 10-second segment of the session.",
                    },
                },
            },
        },
        "defense": {
            "critical_hit_opportunities": {
                "unit":  "% of body",
                "areas": {
                    "head": critical_hit_percentages.get("head"),
                    "body": critical_hit_percentages.get("body"),
                },
            },
            "exposure_weights": {
                "unit":        "relative_weight_0_to_1",
                "description": "Relative weighting (0–1) showing how exposed each body area was.",
                "areas":       exposure_weights_values,
            },
            "endurance": {
                "unit":        "%",
                "description": "Average accuracy over each third of the session.",
                "segments":    endurance_segments,
            },
            "punches_avoided": {
                "unit":        "%",
                "value":       punches_avoided_percent,
                "description": "Percentage of incoming targets that were blocked or dodged.",
            },
        },
        "miscellaneous": {
            "flying_blocks_summary": {
                "unit":        "count",
                "values":      defense_totals,
                "description": "Counts of block, dodge, and hit outcomes from the flying blocks drill.",
            },
        },
    },
}]

with open("session_metrics.json", "w", encoding="utf-8") as metric_file:
    json.dump(session_payload, metric_file, indent=2)

print("Session metrics written to session_metrics.json")
print(f"Final score: {score}  |  Timing - Perfect: {timing_totals['perfect']}, "
      f"Good: {timing_totals['good']}, Miss: {timing_totals['miss']}")
print(
    "Defense stats - Blocked: {blocked}, Dodged: {dodged}, Hit: {hit}".format(
        **defense_totals
    )
)

tracker.stop()
cap.release()
cv2.destroyAllWindows()
quit()