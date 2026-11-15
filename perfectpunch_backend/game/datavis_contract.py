"""DataVis input contract for live target geometry; no target-placement formula here.

Coordinates use unmirrored MediaPipe image space and normalized [0,1] x/y.
Video/canvas mirroring is a presentation concern handled by the consumer.
"""
from __future__ import annotations
from typing import Any

REQUIRED_LANDMARKS = {
    'nose': 0, 'left_eye': 2, 'right_eye': 5,
    'left_shoulder': 11, 'right_shoulder': 12,
    'left_elbow': 13, 'right_elbow': 14,
    'left_wrist': 15, 'right_wrist': 16,
    'left_hip': 23, 'right_hip': 24,
}


def landmark_payload(landmarks: list[Any], frame_width: int, frame_height: int, *,
                     requested_punch: str | None = None,
                     requested_hand: str | None = None) -> dict:
    """Collect existing MediaPipe landmarks into a stable JSON-ready shape.

    Accepts MediaPipe landmark objects or serialized dictionaries; does not
    perform pose inference or compute target regions.
    """
    if frame_width <= 0 or frame_height <= 0:
        raise ValueError('Frame dimensions must be positive')
    if len(landmarks) <= max(REQUIRED_LANDMARKS.values()):
        raise ValueError('Missing landmarks')
    if requested_punch not in (None, 'jab', 'hook', 'uppercut'):
        raise ValueError('Unknown requested punch')
    if requested_hand not in (None, 'left', 'right'):
        raise ValueError('Unknown requested hand')
    result = {}
    for key, idx in REQUIRED_LANDMARKS.items():
        lm = landmarks[idx]
        val = lambda name, default=None: (lm.get(name, default) if isinstance(lm, dict)
                                          else getattr(lm, name, default))
        x, y = val('x'), val('y')
        visibility = val('visibility', 1)
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool)
                   for v in (x, y, visibility)):
            raise ValueError(f'Invalid landmark {key}')
        result[key] = {'x': float(x), 'y': float(y), 'visibility': float(visibility)}
    return {
        'coordinate_space': 'unmirrored_image_normalized',
        'frame_width': frame_width,
        'frame_height': frame_height,
        'requested_punch': requested_punch,
        'requested_hand': requested_hand,
        'landmarks': result,
    }


def validate_target_region(region: dict) -> dict:
    """Validate geometry returned by DataVis before gameplay uses it."""
    if not isinstance(region, dict):
        raise ValueError('Target region must be an object')
    keys = ('min_x', 'max_x', 'min_y', 'max_y')
    if any(k not in region for k in keys):
        raise ValueError('Target region requires min_x/max_x/min_y/max_y')
    values = [region[k] for k in keys]
    if any(not isinstance(v, (int, float)) or isinstance(v, bool) or not (0 <= v <= 1) for v in values):
        raise ValueError('Target bounds must be normalized numbers in [0, 1]')
    if not region['min_x'] < region['max_x'] or not region['min_y'] < region['max_y']:
        raise ValueError('Target region must have positive width and height')
    return {k: float(region[k]) for k in keys}
