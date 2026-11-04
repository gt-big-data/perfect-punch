import random

import cv2

try:
    from .target_utils import WHITE, blend_draw, draw_chevron
except ImportError:
    from target_utils import WHITE, blend_draw, draw_chevron


# ── Attack config ────────────────────────────────────────────────────────────
ATTACK_COLOR = (0, 165, 255)        # BGR orange — distinct from the red/green/blue punch colors
ATTACK_FLASH_COUNT = 3              # translucent flashes before the attack goes solid
ATTACK_WARNING_S = 0.9              # length of the flashing warning phase
ATTACK_ACTIVE_S = 1.0               # length of the solid phase (the dodge/block window)
ATTACK_WARNING_ALPHA = 0.35         # opacity of the flashing shape
ATTACK_SWEEP_FRACTION = 0.5         # hook/uppercut fill crosses the screen in this share of the active phase

SPAWN_DELAY_RANGE = (3, 7)          # seconds between attacks (uniform)
FIRST_ATTACK_DELAY_S = 2.0          # quiet period at the start of the round
RESERVED_MARGIN_S = 0.1             # extra spacing kept around the main loop's reserved windows
ARM_PADDING = 20

# Probability of each attack type.
ATTACK_WEIGHTS = {"jab": 0.4, "hook": 0.35, "uppercut": 0.25}

# Attack geometry, as multiples of the player's shoulder width at spawn time.
JAB_RADIUS_SW = 0.45                # TODO(tune): bigger = harder to slip
HOOK_BAND_HEIGHT_SW = 0.4           # TODO(tune): bigger = deeper duck needed
UPPERCUT_BAND_WIDTH_SW = 0.8        # TODO(tune): bigger = bigger side step needed

# "Head core" box used for hit tests, relative to the nose, in shoulder widths.
HEAD_HALF_WIDTH_SW = 0.15
HEAD_TOP_SW = 0.35                  # top of head above the nose
HEAD_BOTTOM_SW = 0.15               # chin below the nose
MIN_SHOULDER_PX = 40                # fallback when shoulders are detected too close together

# MediaPipe Pose landmark indices.
NOSE = 0
L_SHOULDER, R_SHOULDER = 11, 12
L_ELBOW, R_ELBOW = 13, 14
L_WRIST, R_WRIST = 15, 16


# ── Geometry helpers ─────────────────────────────────────────────────────────

def rects_overlap(a, b):
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    return not (ax2 < bx1 or ax1 > bx2 or ay2 < by1 or ay1 > by2)


def circle_overlaps_rect(cx, cy, r, rect):
    x1, y1, x2, y2 = rect
    nx = min(max(cx, x1), x2)
    ny = min(max(cy, y1), y2)
    return (cx - nx) ** 2 + (cy - ny) ** 2 <= r * r


def shape_overlaps_rect(shape, rect):
    """shape is ('circle', cx, cy, r) or ('rect', x1, y1, x2, y2)."""
    if shape is None:
        return False
    if shape[0] == "circle":
        _, cx, cy, r = shape
        return circle_overlaps_rect(cx, cy, r, rect)
    return rects_overlap(shape[1:], rect)


def _pose_points(landmarks, w, h):
    """Pixel coords for the landmarks the defense drill needs, plus shoulder width."""

    def px(idx):
        lm = landmarks[idx]
        return int(lm.x * w), int(lm.y * h)

    pts = {
        "nose": px(NOSE),
        "ls": px(L_SHOULDER), "rs": px(R_SHOULDER),
        "le": px(L_ELBOW), "re": px(R_ELBOW),
        "lw": px(L_WRIST), "rw": px(R_WRIST),
    }
    sw = abs(pts["ls"][0] - pts["rs"][0])
    pts["sw"] = max(MIN_SHOULDER_PX, sw)
    pts["body_cx"] = (pts["ls"][0] + pts["rs"][0]) // 2
    return pts


def _head_rect(pts):
    nx, ny = pts["nose"]
    sw = pts["sw"]
    return (
        int(nx - HEAD_HALF_WIDTH_SW * sw), int(ny - HEAD_TOP_SW * sw),
        int(nx + HEAD_HALF_WIDTH_SW * sw), int(ny + HEAD_BOTTOM_SW * sw),
    )


def _forearm_rects(pts):
    """Padded elbow→wrist boxes. Forearms (not the whole arm) decide a block, so
    the shoulder sitting next to the head doesn't count as a guard on its own."""
    rects = []
    for e, wkey in (("le", "lw"), ("re", "rw")):
        (ex, ey), (wx, wy) = pts[e], pts[wkey]
        rects.append((min(ex, wx) - ARM_PADDING, min(ey, wy) - ARM_PADDING,
                      max(ex, wx) + ARM_PADDING, max(ey, wy) + ARM_PADDING))
    return rects


# ── Attack ───────────────────────────────────────────────────────────────────

class Attack:
    '''
    A telegraphed incoming attack.

    Parameters:
        - kind (str): 'jab' (circle), 'hook' (horizontal band) or 'uppercut' (vertical band)
        - spawn_ts (float): when the warning phase starts
        - w, h (int): frame size
        - anchor (tuple): (x, y) where feedback text should appear (camera coords)
        - circle (tuple | None): (cx, cy, r) for jab attacks
        - band (tuple | None): (x1, y1, x2, y2) full band rect for hook/uppercut attacks
        - direction (int): hooks: +1 sweeps toward larger camera x, -1 toward smaller.
                           uppercuts are always bottom → top.

    Notes:
        - All coordinates are in the camera orientation (before the display flip).
          The display mirrors the shape, the arrows and the sweep together, so
          they always agree on screen.
    '''

    def __init__(self, kind, spawn_ts, w, h, anchor, circle=None, band=None, direction=1):
        self.kind = kind
        self.spawn_ts = spawn_ts
        self.active_start_ts = spawn_ts + ATTACK_WARNING_S
        self.active_end_ts = self.active_start_ts + ATTACK_ACTIVE_S
        self.w = w
        self.h = h
        self.anchor = anchor
        self.circle = circle
        self.band = band
        self.direction = direction
        self.color = ATTACK_COLOR

    def phase(self, now):
        if now < self.active_start_ts:
            return "warning"
        if now < self.active_end_ts:
            return "active"
        return "done"

    def sweep_progress(self, now):
        sweep_s = max(1e-3, ATTACK_ACTIVE_S * ATTACK_SWEEP_FRACTION)
        return max(0.0, min(1.0, (now - self.active_start_ts) / sweep_s))

    def swept_rect(self, now):
        """The part of a hook/uppercut band that the sweep has covered so far."""
        x1, y1, x2, y2 = self.band
        p = self.sweep_progress(now)
        if self.kind == "hook":
            span = int((x2 - x1) * p)
            if self.direction > 0:
                return (x1, y1, x1 + span, y2)
            return (x2 - span, y1, x2, y2)
        # uppercut: bottom → top
        span = int((y2 - y1) * p)
        return (x1, y2 - span, x2, y2)

    def danger_shape(self, now):
        """Shape that can hit the player right now (None outside the active phase)."""
        if self.phase(now) != "active":
            return None
        if self.kind == "jab":
            cx, cy, r = self.circle
            return ("circle", cx, cy, r)
        rect = self.swept_rect(now)
        if rect[0] >= rect[2] or rect[1] >= rect[3]:
            return None
        return ("rect",) + tuple(rect)

    # -- drawing ------------------------------------------------------------

    def _flash_on(self, now):
        period = ATTACK_WARNING_S / max(1, ATTACK_FLASH_COUNT)
        return ((now - self.spawn_ts) % period) < period * 0.55

    def _chevron_positions(self):
        x1, y1, x2, y2 = self.band
        if self.kind == "hook":
            size = (y2 - y1) * 0.6
            n = 5
            cy = (y1 + y2) / 2
            return [((x1 + (x2 - x1) * (i + 0.5) / n), cy) for i in range(n)], size, (float(self.direction), 0.0)
        size = (x2 - x1) * 0.45
        n = 4
        cx = (x1 + x2) / 2
        return [(cx, y1 + (y2 - y1) * (i + 0.5) / n) for i in range(n)], size, (0.0, -1.0)

    def _draw_chevrons(self, frame, alpha):
        positions, size, direction = self._chevron_positions()
        thickness = max(3, int(size * 0.14))

        def _draw(f):
            for c in positions:
                draw_chevron(f, c, size, direction, WHITE, thickness)

        blend_draw(frame, _draw, alpha, self.band)

    def draw(self, frame, now):
        phase = self.phase(now)
        if phase == "done":
            return frame

        if self.kind == "jab":
            cx, cy, r = self.circle
            bbox = (cx - r - 6, cy - r - 6, cx + r + 7, cy + r + 7)
            if phase == "warning":
                if self._flash_on(now):
                    blend_draw(frame, lambda f: cv2.circle(f, (cx, cy), r, self.color, -1, cv2.LINE_AA),
                               ATTACK_WARNING_ALPHA, bbox)
                # A faint outline stays visible between flashes so the player can see where it lands.
                blend_draw(frame, lambda f: cv2.circle(f, (cx, cy), r, WHITE, 2, cv2.LINE_AA), 0.5, bbox)
            else:
                def _solid(f):
                    cv2.circle(f, (cx, cy), r, self.color, -1, cv2.LINE_AA)
                    cv2.circle(f, (cx, cy), int(r * 0.55), WHITE, 3, cv2.LINE_AA)
                    cv2.circle(f, (cx, cy), r, WHITE, 4, cv2.LINE_AA)
                blend_draw(frame, _solid, 0.9, bbox)
            return frame

        # hook / uppercut bands
        x1, y1, x2, y2 = self.band
        if phase == "warning":
            if self._flash_on(now):
                blend_draw(frame, lambda f: cv2.rectangle(f, (x1, y1), (x2, y2), self.color, -1),
                           ATTACK_WARNING_ALPHA, self.band)
                self._draw_chevrons(frame, 0.85)
            else:
                self._draw_chevrons(frame, 0.35)
        else:
            blend_draw(frame, lambda f: cv2.rectangle(f, (x1, y1), (x2, y2), self.color, -1),
                       ATTACK_WARNING_ALPHA, self.band)
            sx1, sy1, sx2, sy2 = self.swept_rect(now)
            if sx2 > sx1 and sy2 > sy1:
                blend_draw(frame, lambda f: cv2.rectangle(f, (sx1, sy1), (sx2, sy2), self.color, -1),
                           0.95, (sx1, sy1, sx2, sy2))
            self._draw_chevrons(frame, 1.0)
        # Crisp edges in both phases.
        if self.kind == "hook":
            cv2.line(frame, (x1, y1), (x2, y1), WHITE, 2, cv2.LINE_AA)
            cv2.line(frame, (x1, y2), (x2, y2), WHITE, 2, cv2.LINE_AA)
        else:
            cv2.line(frame, (x1, y1), (x1, y2), WHITE, 2, cv2.LINE_AA)
            cv2.line(frame, (x2, y1), (x2, y2), WHITE, 2, cv2.LINE_AA)
        return frame


'''
Create a new telegraphed attack positioned relative to the player

Parameters:
    - landmarks: MediaPipe pose landmarks (normalized)
    - w, h (int): frame size in pixels
    - now (float): current timestamp; the warning phase starts now
    - kind (str | None): force an attack type, or None to pick by ATTACK_WEIGHTS

Returns:
    - Attack, or None when the pose can't be used
'''
def spawn_attack(landmarks, w, h, now, kind=None):
    if landmarks is None:
        return None
    try:
        pts = _pose_points(landmarks, w, h)
    except (AttributeError, IndexError, TypeError):
        return None

    if kind is None:
        kinds = list(ATTACK_WEIGHTS.keys())
        kind = random.choices(kinds, weights=[ATTACK_WEIGHTS[k] for k in kinds])[0]

    sw = pts["sw"]
    nx, ny = pts["nose"]

    if kind == "jab":
        r = int(JAB_RADIUS_SW * sw)
        cx = min(max(nx, r), w - r)
        cy = min(max(ny, r), h - r)
        return Attack("jab", now, w, h, anchor=(cx, cy), circle=(cx, cy, r))

    if kind == "hook":
        half = int(HOOK_BAND_HEIGHT_SW * sw / 2)
        y1 = max(0, ny - half)
        y2 = min(h - 1, ny + half)
        direction = random.choice((-1, 1))
        return Attack("hook", now, w, h, anchor=(nx, ny), band=(0, y1, w - 1, y2), direction=direction)

    # uppercut
    half = int(UPPERCUT_BAND_WIDTH_SW * sw / 2)
    bx = pts["body_cx"]
    x1 = max(0, bx - half)
    x2 = min(w - 1, bx + half)
    return Attack("uppercut", now, w, h, anchor=(bx, ny), band=(x1, 0, x2, h - 1), direction=-1)


'''
Classify interaction between an attack and the player pose during the active phase

Parameters:
    - landmarks: normalized MediaPipe landmarks
    - w, h (int): frame size
    - attack (Attack): the active attack
    - now (float): current timestamp

Returns:
    - "Block" | "Hit" | None   (a "Dodge" is decided when the active phase ends untouched)

Behavior:
    - Only the dangerous part of the attack counts (the whole circle for a jab, the
      swept part of the band for hooks/uppercuts)
    - If it reaches the head and a forearm is raised over the head AND inside the
      danger area -> "Block"; otherwise -> "Hit"
    - Intended defenses: jab -> slip sideways or guard up; hook -> duck under the
      band or guard up; uppercut -> step sideways out of the column or guard up
'''
def check_collision(landmarks, w, h, attack, now):
    if attack is None or landmarks is None:
        return None
    danger = attack.danger_shape(now)
    if danger is None:
        return None
    try:
        pts = _pose_points(landmarks, w, h)
    except (AttributeError, IndexError, TypeError):
        return None

    head = _head_rect(pts)
    if not shape_overlaps_rect(danger, head):
        return None

    guard_zone = (head[0] - ARM_PADDING, head[1] - ARM_PADDING,
                  head[2] + ARM_PADDING, head[3] + ARM_PADDING)
    for forearm in _forearm_rects(pts):
        if rects_overlap(forearm, guard_zone) and shape_overlaps_rect(danger, forearm):
            return "Block"
    # TODO(tune): leaning back from an uppercut can't be seen in 2D landmarks;
    # only a side step or a guard counts for now.
    return "Hit"


class DefenseGame:
    """Stateful manager for the telegraphed-attack defense drill."""


    '''
    Initialize the defense game manager

    Parameters:
        - spawn_delay_range (tuple[float, float]): min/max seconds between attacks
        - first_attack_delay (float): seconds before the first attack of the round

    Behavior:
        - Sets configuration and calls reset() to clear state and stats
    '''
    def __init__(self, spawn_delay_range=SPAWN_DELAY_RANGE, first_attack_delay=FIRST_ATTACK_DELAY_S):
        self.spawn_delay_range = spawn_delay_range
        self.first_attack_delay = first_attack_delay
        self.reset()


    '''
    Reset game state and stats
    '''
    def reset(self):
        self.current_attack = None
        self.next_spawn_ts = None
        self.reserved_windows = []
        self.last_event = None
        self.stats = {
            "blocked": 0,
            "dodged": 0,
            "hit": 0,
        }


    def set_reserved_windows(self, windows):
        '''Time windows (start_ts, end_ts) in which no attack may be in its active phase.'''
        self.reserved_windows = list(windows or [])


    def get_active_window(self):
        '''(active_start_ts, active_end_ts) of the current attack (even while it is
        still warning), or None when no attack is on screen.'''
        if self.current_attack is None:
            return None
        return (self.current_attack.active_start_ts, self.current_attack.active_end_ts)


    def _overlaps_reserved(self, start, end):
        for r_start, r_end in self.reserved_windows:
            if start < r_end + RESERVED_MARGIN_S and end > r_start - RESERVED_MARGIN_S:
                return True
        return False


    def _schedule_respawn(self, now):
        self.next_spawn_ts = now + random.uniform(*self.spawn_delay_range)
        self.current_attack = None


    '''
    Advance game state for one frame, draw the attack, and return any outcome

    Parameters:
        - frame (numpy.ndarray): HxWx3 image in camera orientation; drawn onto in-place
        - landmarks: pose landmarks used for collision checks
        - now (float): current timestamp (seconds)
        - reserved_windows (list | None): optional (start_ts, end_ts) windows to keep free
          of active attacks (punch callouts and target hit windows)

    Returns:
        - "Block" | "Hit" | "Dodge" | None

    Notes:
        - After an outcome, self.last_event holds {"outcome", "ts", "pos"} where pos is the
          camera-orientation pixel position to show feedback at
    '''
    def update(self, frame, landmarks, now, reserved_windows=None):
        if frame is None:
            return None
        if reserved_windows is not None:
            self.set_reserved_windows(reserved_windows)

        h, w = frame.shape[:2]

        if self.next_spawn_ts is None:
            self.next_spawn_ts = now + self.first_attack_delay

        if self.current_attack is None and landmarks is not None and now >= self.next_spawn_ts:
            active_start = now + ATTACK_WARNING_S
            active_end = active_start + ATTACK_ACTIVE_S
            # If this would collide with a punch moment, just try again next frame.
            if not self._overlaps_reserved(active_start, active_end):
                self.current_attack = spawn_attack(landmarks, w, h, now)

        outcome = None
        attack = self.current_attack
        if attack is not None:
            if attack.phase(now) == "active" and landmarks is not None:
                outcome = check_collision(landmarks, w, h, attack, now)
            if outcome is None and now >= attack.active_end_ts:
                outcome = "Dodge"

            if outcome is not None:
                key = {"Block": "blocked", "Hit": "hit", "Dodge": "dodged"}[outcome]
                self.stats[key] += 1
                self.last_event = {"outcome": outcome, "ts": now, "pos": attack.anchor}
                self._schedule_respawn(now)

        if self.current_attack is not None:
            self.current_attack.draw(frame, now)

        return outcome

    '''
    Return a snapshot of game statistics

    Returns:
        - dict: copy of stats with keys 'blocked', 'dodged', and 'hit'
    '''
    def get_stats(self):
        return dict(self.stats)