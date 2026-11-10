from dataclasses import dataclass
from pathlib import Path
import math
import random
from typing import Callable, List, Optional, Sequence, Tuple

import cv2
import numpy as np

try:
    import mediapipe as mp

    mp_pose = mp.solutions.pose
    MEDIAPIPE_AVAILABLE = True
except (ImportError, AttributeError):
    # MediaPipe is optional for some unit tests / CI environments
    print("Warning: MediaPipe not available in target_utils")
    mp = None
    mp_pose = None
    MEDIAPIPE_AVAILABLE = False


# ── Colors (BGR) ─────────────────────────────────────────────────────────────
PUNCH_COLORS = {
    "jab": (0, 0, 255),        # red
    "hook": (0, 255, 0),       # green
    "uppercut": (255, 0, 0),   # blue
}
PUNCH_LABELS = {
    "jab": "JAB",
    "hook": "HOOK",
    "uppercut": "UPPERCUT",
}
SIDE_LABELS = {"L": "LEFT", "R": "RIGHT"}

WHITE = (255, 255, 255)
BLACK = (0, 0, 0)
MISS_GRAY = (160, 160, 160)
UI_FONT = cv2.FONT_HERSHEY_DUPLEX

PUBLIC_ASSET_DIR = Path(__file__).resolve().parents[1] / "public"
TARGET_GLOVE_ASSETS = {
    "jab_front": "front_punchpad.png",
    "hook_left": "left_punchpad.png",
    "hook_right": "right_punchpad.png",
    "uppercut_up": "up_punchpad.png",
}

# MediaPipe Pose landmark indices (stable across MediaPipe versions). Using the
# raw indices keeps these helpers usable even when MediaPipe isn't installed.
LANDMARK_INDEX = {
    "NOSE": 0,
    "LEFT_SHOULDER": 11,
    "RIGHT_SHOULDER": 12,
    "LEFT_ELBOW": 13,
    "RIGHT_ELBOW": 14,
    "LEFT_WRIST": 15,
    "RIGHT_WRIST": 16,
    "LEFT_PINKY": 17,
    "RIGHT_PINKY": 18,
    "LEFT_INDEX": 19,
    "RIGHT_INDEX": 20,
    "LEFT_THUMB": 21,
    "RIGHT_THUMB": 22,
    "LEFT_HIP": 23,
    "RIGHT_HIP": 24,
}

HAND_CONTACT_LANDMARKS = (
    # Wrists
    "LEFT_WRIST",
    "RIGHT_WRIST",
    # Fingertips / hand edges commonly reaching glove first
    "LEFT_INDEX",
    "RIGHT_INDEX",
    "LEFT_THUMB",
    "RIGHT_THUMB",
    "LEFT_PINKY",
    "RIGHT_PINKY",
)


def _to_px(lm, w: int, h: int) -> Tuple[int, int]:
    """Convert a normalized landmark (with .x and .y in [0,1]) to pixel coords.

    Args:
        lm: landmark object with attributes `x` and `y` (normalized coordinates).
        w: image width in pixels.
        h: image height in pixels.

    Returns:
        (x, y) pixel coordinates as integers.
    """

    return int(lm.x * w), int(lm.y * h)


def _lm(landmarks, name: str):
    return landmarks[LANDMARK_INDEX[name]]


#Respawn target within the area defined by shoulders, hips, and nose
def respawn_target(
    landmarks,
    w: int,
    h: int,
    target_radius: int,
    side: Optional[str] = None,
    margin: Optional[int] = None,
    avoid_hands_px: int = 0,
) -> Optional[Tuple[int, int]]:
    """Choose a random target position constrained to the player's upper body.

    The spawn area is computed from shoulders, hips, and nose landmarks to keep
    targets around the chest/upper torso region.

    Args:
        landmarks: sequence of MediaPipe landmarks (indexable by landmark index).
        w: frame width in pixels.
        h: frame height in pixels.
        target_radius: radius of the logical target in pixels.
        side: optional 'L' or 'R'. Restricts the target to the half of the
            body on the user's own left/right (which is the same side of the
            mirrored display the user sees). None = anywhere.
        margin: optional distance to keep from the frame edges (use the visual
            radius so the drawn target stays fully on screen). Defaults to
            target_radius.
        avoid_hands_px: if > 0, try to keep the target at least this far from
            both wrists, so the target never spawns on top of the resting guard
            and the player has to reach for it.

    Returns:
        (x, y) pixel coordinates (camera orientation, i.e. before the display
        flip) for the respawn position, or None when a valid spawn region
        cannot be computed.
    """

    if landmarks is None:
        return None

    edge = max(target_radius, margin or 0)

    lsx, lsy = _to_px(_lm(landmarks, "LEFT_SHOULDER"), w, h)
    rsx, rsy = _to_px(_lm(landmarks, "RIGHT_SHOULDER"), w, h)
    lhy = _to_px(_lm(landmarks, "LEFT_HIP"), w, h)[1]
    rhy = _to_px(_lm(landmarks, "RIGHT_HIP"), w, h)[1]
    nx, ny = _to_px(_lm(landmarks, "NOSE"), w, h)

    shoulder_width = abs(rsx - lsx)

    full_xmin = max(edge, min(lsx, rsx) - shoulder_width)
    full_xmax = min(w - edge, max(lsx, rsx) + shoulder_width)
    xmin, xmax = full_xmin, full_xmax

    if side in ("L", "R"):
        # Split at the body's center line. The user's left shoulder can be on
        # either side of the camera image, so compare against it directly.
        body_cx = (lsx + rsx) // 2
        hand_shoulder_x = lsx if side == "L" else rsx
        gap = target_radius
        if hand_shoulder_x >= body_cx:
            xmin = max(xmin, body_cx + gap)
        else:
            xmax = min(xmax, body_cx - gap)
        if xmax <= xmin:
            # Player is pressed against a frame edge; fall back to the full range.
            xmin, xmax = full_xmin, full_xmax

    shoulder_y = (lsy + rsy) // 2
    waist_y = (lhy + rhy) // 2

    # Keep targets in the upper body: do not allow spawns lower than mid-chest.
    mid_chest_floor_y = shoulder_y + ((waist_y - shoulder_y) // 2)
    ymin = max(edge, min(ny, shoulder_y))
    ymax = min(h - edge, max(ny, mid_chest_floor_y))

    if xmax <= xmin or ymax <= ymin:
        return None

    if avoid_hands_px <= 0:
        return (random.randint(xmin, xmax), random.randint(ymin, ymax))

    hands = [_to_px(_lm(landmarks, "LEFT_WRIST"), w, h), _to_px(_lm(landmarks, "RIGHT_WRIST"), w, h)]
    best, best_d = None, -1.0
    for _ in range(20):
        cand = (random.randint(xmin, xmax), random.randint(ymin, ymax))
        d = min(math.hypot(cand[0] - hx, cand[1] - hy) for hx, hy in hands)
        if d >= avoid_hands_px:
            return cand
        if d > best_d:
            best, best_d = cand, d
    # No spot far enough from both hands: use the farthest one we found.
    return best

# Detect if hand landmarks intersect target area.
# The rendered target is visually larger than the logical spawn circle,
# so we expand the collision radius for a more intuitive "what you see is what hits" feel.
def wrists_hit_circle(
    landmarks,
    w: int,
    h: int,
    center: Optional[Tuple[int, int]],
    radius: int,
    hit_radius_scale: float = 3.0,
    min_visibility: float = 0.35,
    side: Optional[str] = None,
) -> bool:
    """Return True if a hand landmark intersects the target circle.

    Args:
        landmarks: sequence of MediaPipe landmarks.
        w: image width.
        h: image height.
        center: (x, y) center of the target in pixels.
        radius: logical target radius in pixels.
        hit_radius_scale: visual expansion factor for collision detection.
        min_visibility: minimum landmark visibility to consider it valid.
        side: optional 'L' or 'R'; when given only that hand's landmarks count.

    Returns:
        True if a hand landmark lies within the (expanded) target radius.
    """

    if center is None or landmarks is None:
        return False

    prefix = None
    if side == "L":
        prefix = "LEFT_"
    elif side == "R":
        prefix = "RIGHT_"

    cx, cy = center
    effective_radius = max(1, int(radius * hit_radius_scale))

    for landmark_name in HAND_CONTACT_LANDMARKS:
        if prefix is not None and not landmark_name.startswith(prefix):
            continue
        lm = _lm(landmarks, landmark_name)
        if getattr(lm, "visibility", 1.0) < min_visibility:
            continue

        x, y = _to_px(lm, w, h)
        dx, dy = x - cx, y - cy
        if dx * dx + dy * dy <= effective_radius * effective_radius:
            return True

    return False

#Randomly choose a punch type based on defined probabilities (Will update to use coach agent to determine probabilities)
def choose_punch_type() -> str:
    """Randomly pick a punch type using predefined probabilities.

    Probabilities (empirical):
      - jab: 62.5%
      - hook: 25%
      - uppercut: 12.5%
    """

    r = random.random()
    if r < 0.625:
        return "jab"
    if r < 0.625 + 0.25:
        return "hook"
    return "uppercut"


def choose_punch_side(punch_type: str, stance: str = "orthodox", allow_random: bool = False) -> str:
    """Return 'L' or 'R' for the hand that should throw `punch_type`.

    The classifier only knows 'jab', 'lead-hook' and 'rear-uppercut', so by
    default the side follows the stance: jab and hook use the lead hand,
    uppercut uses the rear hand (orthodox lead = left, southpaw lead = right).
    Set allow_random=True once the model is trained on both hands.
    """

    if allow_random:
        return random.choice(("L", "R"))
    lead = "R" if str(stance).lower() == "southpaw" else "L"
    rear = "L" if lead == "R" else "R"
    return rear if punch_type == "uppercut" else lead


def callout_text(punch_type: str, side: str) -> str:
    return f"{SIDE_LABELS.get(side, '')} {PUNCH_LABELS.get(punch_type, punch_type.upper())}".strip()


def choose_target_glove_key(punch_type: Optional[str] = None) -> str:
    """Return the glove asset key appropriate for the given `punch_type`.

    Args:
        punch_type: one of 'jab', 'hook', 'uppercut' or None.

    Returns:
        Key for `TARGET_GLOVE_ASSETS` to load an image.
    """

    if punch_type == "jab":
        return "jab_front"
    if punch_type == "hook":
        return random.choice(["hook_left", "hook_right"])
    if punch_type == "uppercut":
        return "uppercut_up"
    # Fallback
    return random.choice(list(TARGET_GLOVE_ASSETS.keys()))


def load_target_glove_image(glove_key: str) -> Optional[np.ndarray]:
    """Load the glove image for a given asset key.

    Args:
        glove_key: key from `TARGET_GLOVE_ASSETS`.

    Returns:
        BGR(A) image as a numpy array, or None if the file is missing.
    """

    filename = TARGET_GLOVE_ASSETS.get(glove_key)
    if not filename:
        return None

    image_path = PUBLIC_ASSET_DIR / filename
    if not image_path.exists():
        return None

    return cv2.imread(str(image_path), cv2.IMREAD_UNCHANGED)


def draw_target_glove(
    frame: np.ndarray,
    center: Optional[Tuple[int, int]],
    radius: int,
    glove_image: Optional[np.ndarray],
    glove_key: Optional[str] = None,
) -> np.ndarray:
    """Draw a glove image centered on `center` onto `frame`.

    No longer used by the main loop (targets are drawn osu!-style now), but
    kept so the punch-pad art can be brought back easily.

    Args:
        frame: HxWx3 BGR image that will be modified in-place.
        center: (x, y) center position in pixels.
        radius: logical target radius in pixels (controls visual size).
        glove_image: loaded glove image (BGR or BGRA).
        glove_key: optional key used for debug/selection (unused here).

    Returns:
        The modified `frame` (same object passed in).
    """

    if frame is None or center is None or glove_image is None:
        return frame

    cx, cy = center
    glove_size = max(int(radius * 10), 1)
    resized = cv2.resize(glove_image, (glove_size, glove_size), interpolation=cv2.INTER_AREA)

    glove_size = resized.shape[0]

    x1 = cx - glove_size // 2
    y1 = cy - glove_size // 2
    x2 = x1 + glove_size
    y2 = y1 + glove_size

    frame_h, frame_w = frame.shape[:2]
    src_x1 = max(0, -x1)
    src_y1 = max(0, -y1)
    src_x2 = glove_size - max(0, x2 - frame_w)
    src_y2 = glove_size - max(0, y2 - frame_h)

    dst_x1 = max(0, x1)
    dst_y1 = max(0, y1)
    dst_x2 = min(frame_w, x2)
    dst_y2 = min(frame_h, y2)

    if dst_x1 >= dst_x2 or dst_y1 >= dst_y2:
        return frame

    overlay = resized[src_y1:src_y2, src_x1:src_x2]
    if overlay.shape[2] == 4:
        overlay_rgb = overlay[:, :, :3].astype(np.float32)
        alpha = overlay[:, :, 3].astype(np.float32) / 255.0
        alpha = alpha[:, :, np.newaxis]
        base = frame[dst_y1:dst_y2, dst_x1:dst_x2].astype(np.float32)
        blended = overlay_rgb * alpha + base * (1.0 - alpha)
        frame[dst_y1:dst_y2, dst_x1:dst_x2] = blended.astype(np.uint8)
    else:
        frame[dst_y1:dst_y2, dst_x1:dst_x2] = overlay[:, :, :3]

    return frame


# ═════════════════════════════════════════════════════════════════════════════
# Drawing helpers for the new UI
# ═════════════════════════════════════════════════════════════════════════════

def blend_draw(
    frame: np.ndarray,
    draw_fn: Callable[[np.ndarray], None],
    alpha: float,
    bbox: Optional[Tuple[int, int, int, int]] = None,
) -> np.ndarray:
    """Run `draw_fn(frame)` and blend the result in at `alpha` opacity.

    Only the `bbox` region (x1, y1, x2, y2) is blended, which keeps this cheap
    for small shapes. `draw_fn` must not draw outside `bbox`, or those pixels
    will end up fully opaque. bbox=None blends the whole frame.
    """

    if frame is None or alpha <= 0.0:
        return frame
    h, w = frame.shape[:2]
    if bbox is None:
        x1, y1, x2, y2 = 0, 0, w, h
    else:
        x1, y1, x2, y2 = (int(v) for v in bbox)
        x1, x2 = max(0, x1), min(w, x2)
        y1, y2 = max(0, y1), min(h, y2)
    if x1 >= x2 or y1 >= y2:
        return frame
    if alpha >= 1.0:
        draw_fn(frame)
        return frame

    original = frame[y1:y2, x1:x2].copy()
    draw_fn(frame)
    frame[y1:y2, x1:x2] = cv2.addWeighted(frame[y1:y2, x1:x2], alpha, original, 1.0 - alpha, 0)
    return frame


def fit_font_scale(text: str, max_w: float, max_h: float, thickness_ratio: float = 2.2,
                   font=UI_FONT) -> Tuple[float, int]:
    """Largest font scale (and matching thickness) so `text` fits in max_w x max_h."""
    (tw, th), _ = cv2.getTextSize(text, font, 1.0, 2)
    scale = max(0.3, min(max_w / max(tw, 1), max_h / max(th, 1)))
    thickness = max(1, int(round(scale * thickness_ratio)))
    return scale, thickness


def draw_text_centered(
    frame: np.ndarray,
    text: str,
    center: Tuple[int, int],
    font_scale: float,
    color=WHITE,
    thickness: int = 2,
    outline_color=BLACK,
    outline_extra: Optional[int] = None,
    alpha: float = 1.0,
    font=UI_FONT,
) -> np.ndarray:
    """Draw `text` centered on `center` with an outline for readability."""

    if not text or alpha <= 0:
        return frame
    (tw, th), baseline = cv2.getTextSize(text, font, font_scale, thickness)
    cx, cy = int(center[0]), int(center[1])
    org = (cx - tw // 2, cy + th // 2)
    if outline_extra is None:
        outline_extra = max(2, thickness)
    pad = thickness + outline_extra + 4

    def _draw(f):
        if outline_color is not None:
            cv2.putText(f, text, org, font, font_scale, outline_color,
                        thickness + outline_extra, cv2.LINE_AA)
        cv2.putText(f, text, org, font, font_scale, color, thickness, cv2.LINE_AA)

    bbox = (org[0] - pad, org[1] - th - pad, org[0] + tw + pad, org[1] + baseline + pad)
    return blend_draw(frame, _draw, alpha, bbox)


def draw_callout_banner(
    frame: np.ndarray,
    text: str,
    color,
    elapsed_s: float,
    duration_s: float,
    fade_s: float = 0.1,
    max_opacity: float = 0.85,
) -> np.ndarray:
    """Full-width punch callout ("LEFT JAB") with a scale-in / fade-out.

    Draw this on the display (already-flipped) frame.
    """

    if elapsed_s < 0 or elapsed_s > duration_s:
        return frame
    h, w = frame.shape[:2]

    if elapsed_s < fade_s:
        k = elapsed_s / fade_s
        scale = 0.8 + 0.2 * k
    elif elapsed_s > duration_s - fade_s:
        k = (duration_s - elapsed_s) / fade_s
        scale = 1.0
    else:
        k, scale = 1.0, 1.0
    k = max(0.0, min(1.0, k))

    band_h = max(20, int(h * 0.22 * scale))
    cy = h // 2
    y1, y2 = cy - band_h // 2, cy + band_h // 2

    def _band(f):
        cv2.rectangle(f, (0, y1), (w, y2), color, -1)
        cv2.line(f, (0, y1), (w, y1), WHITE, 3, cv2.LINE_AA)
        cv2.line(f, (0, y2), (w, y2), WHITE, 3, cv2.LINE_AA)

    blend_draw(frame, _band, max_opacity * k, (0, y1 - 3, w, y2 + 4))

    font_scale, thickness = fit_font_scale(text, w * 0.88, band_h * 0.55, thickness_ratio=2.4)
    draw_text_centered(frame, text, (w // 2, cy), font_scale, WHITE, thickness,
                       outline_color=(30, 30, 30), outline_extra=max(2, thickness // 2),
                       alpha=k)
    return frame


def draw_osu_target(
    frame: np.ndarray,
    center: Tuple[int, int],
    visual_radius: int,
    color,
    approach_progress: float,
    approach_scale: float = 3.0,
) -> np.ndarray:
    """Draw an osu!-style hit circle plus its shrinking approach ring.

    approach_progress: 0.0 when the target appears, 1.0 at the ideal hit
    moment (ring touches the target edge). Values > 1 keep the ring on the edge.
    Draw on the camera-orientation frame (before the display flip).
    """

    if center is None:
        return frame
    cx, cy = int(center[0]), int(center[1])
    r = int(visual_radius)
    p = max(0.0, min(1.0, approach_progress))

    # Soft glow + fade-in over the first part of the approach.
    appear = min(1.0, approach_progress / 0.15) if approach_progress < 0.15 else 1.0
    glow_r = int(r * 1.25)
    blend_draw(frame, lambda f: cv2.circle(f, (cx, cy), glow_r, color, -1, cv2.LINE_AA),
               0.30 * appear, (cx - glow_r - 2, cy - glow_r - 2, cx + glow_r + 3, cy + glow_r + 3))

    def _body(f):
        cv2.circle(f, (cx, cy), r, color, -1, cv2.LINE_AA)
        # Slightly darker inner disc gives the circle some depth.
        inner = tuple(int(c * 0.75) for c in color)
        cv2.circle(f, (cx, cy), int(r * 0.72), inner, -1, cv2.LINE_AA)
        cv2.circle(f, (cx, cy), r, WHITE, max(3, r // 12), cv2.LINE_AA)

    blend_draw(frame, _body, 0.92 * appear, (cx - r - 8, cy - r - 8, cx + r + 9, cy + r + 9))

    ring_r = int(r + (approach_scale * r - r) * (1.0 - p))
    ring_t = max(3, r // 14)
    cv2.circle(frame, (cx, cy), ring_r, WHITE, ring_t, cv2.LINE_AA)
    if approach_progress >= 1.0:
        # Hit window is open past the ideal moment: pulse the edge.
        cv2.circle(frame, (cx, cy), r + ring_t + 2, color, 2, cv2.LINE_AA)
    return frame


def draw_target_badge(frame: np.ndarray, center_display: Tuple[int, int], visual_radius: int,
                      side: str) -> np.ndarray:
    """Draw the big 'L' / 'R' in the middle of a target (display frame, after flip)."""
    letter = "L" if side == "L" else "R"
    scale, thickness = fit_font_scale(letter, visual_radius * 1.1, visual_radius * 0.95,
                                      thickness_ratio=2.8)
    return draw_text_centered(frame, letter, center_display, scale, WHITE, thickness,
                              outline_color=(20, 20, 20), outline_extra=max(2, thickness // 2))


def draw_pop(frame: np.ndarray, center: Tuple[int, int], visual_radius: int, color,
             t: float, duration: float) -> np.ndarray:
    """Target 'pop' on a successful hit: grows ~20% and fades out."""
    if t < 0 or t > duration:
        return frame
    k = t / duration
    r = int(visual_radius * (1.0 + 0.2 * k))
    cx, cy = int(center[0]), int(center[1])

    def _draw(f):
        cv2.circle(f, (cx, cy), r, color, -1, cv2.LINE_AA)
        cv2.circle(f, (cx, cy), r, WHITE, 4, cv2.LINE_AA)

    return blend_draw(frame, _draw, 0.85 * (1.0 - k), (cx - r - 4, cy - r - 4, cx + r + 5, cy + r + 5))


def draw_fading_target(frame: np.ndarray, center: Tuple[int, int], visual_radius: int,
                       t: float, duration: float) -> np.ndarray:
    """Grayed-out target that fades away after a MISS."""
    if t < 0 or t > duration:
        return frame
    k = t / duration
    r = int(visual_radius * (1.0 - 0.15 * k))
    cx, cy = int(center[0]), int(center[1])

    def _draw(f):
        cv2.circle(f, (cx, cy), r, MISS_GRAY, -1, cv2.LINE_AA)
        cv2.circle(f, (cx, cy), r, (90, 90, 90), 3, cv2.LINE_AA)

    return blend_draw(frame, _draw, 0.8 * (1.0 - k), (cx - r - 3, cy - r - 3, cx + r + 4, cy + r + 4))


@dataclass
class Particle:
    x: float
    y: float
    vx: float
    vy: float
    color: Tuple[int, int, int]
    born: float
    life: float
    radius: float


def spawn_particles(center: Tuple[int, int], color, now: float, count: int = 10,
                    speed_range=(250.0, 520.0), life: float = 0.3) -> List[Particle]:
    """Burst of small circles flying outward from `center`."""
    particles = []
    for i in range(count):
        angle = (2 * math.pi * i / count) + random.uniform(-0.3, 0.3)
        speed = random.uniform(*speed_range)
        particles.append(Particle(
            x=float(center[0]), y=float(center[1]),
            vx=math.cos(angle) * speed, vy=math.sin(angle) * speed,
            color=color, born=now, life=life * random.uniform(0.8, 1.2),
            radius=random.uniform(5, 9),
        ))
    return particles


def draw_particles(frame: np.ndarray, particles: List[Particle], now: float) -> List[Particle]:
    """Draw live particles; returns the ones still alive."""
    alive = []
    for p in particles:
        t = now - p.born
        if t < 0 or t > p.life:
            continue
        k = t / p.life
        # Ease-out motion so the burst slows as it fades.
        travel = t * (1.0 - 0.5 * k)
        x = int(p.x + p.vx * travel)
        y = int(p.y + p.vy * travel)
        r = max(1, int(p.radius * (1.0 - k)))
        cv2.circle(frame, (x, y), r, p.color, -1, cv2.LINE_AA)
        cv2.circle(frame, (x, y), r, WHITE, 1, cv2.LINE_AA)
        alive.append(p)
    return alive


@dataclass
class FloatingText:
    text: str
    pos: Tuple[int, int]          # camera-orientation pixel coords (pre-flip)
    color: Tuple[int, int, int]
    born: float
    duration: float = 0.6
    scale: float = 1.2
    rise: float = 60.0


def draw_floating_texts(display_frame: np.ndarray, texts: List[FloatingText], now: float) -> List[FloatingText]:
    """Draw rising/fading labels on the display (flipped) frame. Returns live ones."""
    h, w = display_frame.shape[:2]
    alive = []
    for ft in texts:
        t = now - ft.born
        if t < 0 or t > ft.duration:
            continue
        k = t / ft.duration
        x = (w - 1) - int(ft.pos[0])          # mirror into display coords
        y = int(ft.pos[1] - ft.rise * k)
        pop = 1.0 + 0.25 * max(0.0, 1.0 - k / 0.2)   # tiny scale punch at start
        alpha = 1.0 - k * k
        thickness = max(2, int(ft.scale * 2.2))
        draw_text_centered(display_frame, ft.text, (x, y), ft.scale * pop, ft.color, thickness,
                           outline_color=(20, 20, 20), outline_extra=3, alpha=alpha)
        alive.append(ft)
    return alive


def _draw_pill(frame: np.ndarray, x1: int, y1: int, x2: int, y2: int, alpha: float = 0.6):
    r = (y2 - y1) // 2

    def _draw(f):
        cv2.rectangle(f, (x1 + r, y1), (x2 - r, y2), (20, 20, 20), -1)
        cv2.circle(f, (x1 + r, y1 + r), r, (20, 20, 20), -1, cv2.LINE_AA)
        cv2.circle(f, (x2 - r, y1 + r), r, (20, 20, 20), -1, cv2.LINE_AA)

    blend_draw(frame, _draw, alpha, (x1 - 2, y1 - 2, x2 + 3, y2 + 3))


def format_time_remaining(seconds: float) -> str:
    s = max(0, int(math.ceil(seconds)))
    return f"{s // 60}:{s % 60:02d}"


def draw_hud(display_frame: np.ndarray, score: int, time_remaining_s: float) -> np.ndarray:
    """Score (top-right) and time remaining (top-left) on the display frame."""
    h, w = display_frame.shape[:2]
    margin = max(12, w // 60)
    pill_h = max(40, h // 12)
    font_scale, thickness = fit_font_scale("SCORE 00000", w * 0.22, pill_h * 0.5)

    time_text = format_time_remaining(time_remaining_s)
    (tw, _), _ = cv2.getTextSize(time_text, UI_FONT, font_scale, thickness)
    tx2 = margin + tw + pill_h
    _draw_pill(display_frame, margin, margin, tx2, margin + pill_h)
    time_color = (80, 80, 255) if time_remaining_s <= 5 else WHITE
    draw_text_centered(display_frame, time_text, ((margin + tx2) // 2, margin + pill_h // 2),
                       font_scale, time_color, thickness, outline_color=None)

    score_text = f"SCORE {int(score)}"
    (sw, _), _ = cv2.getTextSize(score_text, UI_FONT, font_scale, thickness)
    sx1 = w - margin - sw - pill_h
    _draw_pill(display_frame, sx1, margin, w - margin, margin + pill_h)
    draw_text_centered(display_frame, score_text, ((sx1 + w - margin) // 2, margin + pill_h // 2),
                       font_scale, WHITE, thickness, outline_color=None)
    return display_frame


_VIGNETTE_CACHE = {}


def _vignette_mask(h: int, w: int) -> np.ndarray:
    key = (h, w)
    mask = _VIGNETTE_CACHE.get(key)
    if mask is None:
        ys = np.arange(h, dtype=np.float32)
        xs = np.arange(w, dtype=np.float32)
        dy = np.minimum(ys, h - 1 - ys)[:, None]
        dx = np.minimum(xs, w - 1 - xs)[None, :]
        d = np.minimum(dy, dx)
        edge = 0.2 * min(h, w)
        mask = np.clip(1.0 - d / edge, 0.0, 1.0) ** 1.6
        mask = mask[:, :, None].astype(np.float32)
        _VIGNETTE_CACHE[key] = mask
    return mask


def draw_hit_vignette(display_frame: np.ndarray, strength: float, color=(0, 0, 255)) -> np.ndarray:
    """Red glow around the screen edges when the player gets hit (strength 0..1)."""
    if strength <= 0:
        return display_frame
    h, w = display_frame.shape[:2]
    m = _vignette_mask(h, w) * (0.8 * min(1.0, strength))
    f = display_frame.astype(np.float32)
    f = f * (1.0 - m) + np.array(color, dtype=np.float32) * m
    display_frame[:] = np.clip(f, 0, 255).astype(np.uint8)
    return display_frame


def draw_chevron(frame: np.ndarray, center: Tuple[float, float], size: float,
                 direction: Tuple[float, float], color, thickness: int) -> np.ndarray:
    """Draw a '>'-style chevron pointing along `direction` (unit vector)."""
    dx, dy = direction
    px, py = -dy, dx
    cx, cy = center
    half = size * 0.5
    tip = (cx + dx * half * 0.6, cy + dy * half * 0.6)
    back1 = (cx - dx * half * 0.6 + px * half, cy - dy * half * 0.6 + py * half)
    back2 = (cx - dx * half * 0.6 - px * half, cy - dy * half * 0.6 - py * half)
    pts = np.array([back1, tip, back2], dtype=np.int32).reshape(-1, 1, 2)
    cv2.polylines(frame, [pts], False, color, thickness, cv2.LINE_AA)
    return frame