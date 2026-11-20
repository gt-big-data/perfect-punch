import time
import random
import uuid
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass, field
from enum import Enum
from collections import defaultdict
from perfectpunch_backend.game.target_tracker import TargetOutcomeTracker
from perfectpunch_backend.target_utils import choose_punch_side, choose_punch_with_weights, choose_point_from_datavis_region

try:
    import mediapipe as mp
    MEDIAPIPE_AVAILABLE = True
except ImportError:
    print("Warning: MediaPipe not available, some features will be limited")
    MEDIAPIPE_AVAILABLE = False
    mp = None

try:
    from perfectpunch_backend.models.punch_classifier import PunchClassifier
    from perfectpunch_backend.target_utils import respawn_target, wrists_hit_circle, choose_punch_type, PUNCH_COLORS
except ImportError:
    try:
        from ..models.punch_classifier import PunchClassifier
        from ..target_utils import respawn_target, wrists_hit_circle, choose_punch_type, PUNCH_COLORS
    except ImportError:
        # Fallback if imports fail
        PunchClassifier = None
        respawn_target = None
        wrists_hit_circle = None
        choose_punch_type = None
        PUNCH_COLORS = {}


class GameState(Enum):
    """Game session states."""
    WAITING = "waiting"
    ACTIVE = "active" 
    PAUSED = "paused"
    FINISHED = "finished"


class TargetType(Enum):
    """Types of targets."""
    JAB = "jab"
    HOOK = "hook"
    UPPERCUT = "uppercut"


@dataclass
class Target:
    """Represents a target in the game."""
    id: str
    center: Tuple[int, int]  # (x, y) pixel coordinates
    radius: int
    target_type: TargetType
    spawn_time: float
    hit: bool = False
    hit_time: Optional[float] = None
    required_punch: Optional[str] = None
    expires_at: Optional[float] = None
    required_hand: Optional[str] = None


@dataclass
class PunchAttempt:
    """Represents a punch attempt by the player."""
    id: str
    timestamp: float
    target_id: Optional[str]
    predicted_punch: str
    confidence: float
    was_correct: bool
    hit_target: bool
    response_time: Optional[float] = None  # Time from target spawn to hit


@dataclass
class GameSession:
    """Represents a complete game session."""
    id: str
    user_id: Optional[str]
    start_time: float
    end_time: Optional[float] = None
    state: GameState = GameState.WAITING
    duration_seconds: int = 30
    targets: List[Target] = field(default_factory=list)
    punch_attempts: List[PunchAttempt] = field(default_factory=list)
    score: int = 0
    accuracy: float = 0.0
    total_targets_hit: int = 0
    total_targets_spawned: int = 0
    tracker: Optional[TargetOutcomeTracker] = None
    pending_target_events: List[Dict] = field(default_factory=list)
    datavis_weights: Optional[Dict[str, float]] = None
    datavis_regions: Dict[str, Dict[str, float]] = field(default_factory=dict)
    latest_datavis_landmarks: Optional[Dict] = None


class GameManager:
    """Manages game sessions, target spawning, and punch validation."""
    
    def __init__(self, model_path: Optional[str] = None):
        if PunchClassifier:
            self.classifier = PunchClassifier(model_path)
        else:
            self.classifier = None
            print("Warning: PunchClassifier not available - punch detection will be limited")
        self.active_sessions: Dict[str, GameSession] = {}
        if MEDIAPIPE_AVAILABLE:
            self.mp_pose = mp.solutions.pose
        else:
            self.mp_pose = None
        
        # Game configuration
        self.default_duration = 30  # seconds
        self.target_radius = 25
        self.spawn_protection_time = 0.5  # seconds
        self.min_confidence_threshold = 0.6
        self.target_lifetime_seconds = 3.0
        
    def create_session(self, user_id: Optional[str] = None, duration: int = 30) -> GameSession:
        """Create a new game session."""
        session_id = str(uuid.uuid4())
        session = GameSession(
            id=session_id,
            user_id=user_id,
            start_time=time.time(),
            duration_seconds=duration,
            state=GameState.WAITING
        )
        session.tracker = TargetOutcomeTracker(session_id)
        self.active_sessions[session_id] = session
        return session
    
    def start_session(self, session_id: str) -> bool:
        """Start an existing game session."""
        session = self.active_sessions.get(session_id)
        if not session or session.state != GameState.WAITING:
            return False
            
        session.state = GameState.ACTIVE
        session.start_time = time.time()
        return True
    
    def pause_session(self, session_id: str) -> bool:
        """Pause an active game session."""
        session = self.active_sessions.get(session_id)
        if not session or session.state != GameState.ACTIVE:
            return False
            
        session.state = GameState.PAUSED
        return True
    
    def resume_session(self, session_id: str) -> bool:
        """Resume a paused game session."""
        session = self.active_sessions.get(session_id)
        if not session or session.state != GameState.PAUSED:
            return False
            
        session.state = GameState.ACTIVE
        return True
    
    def end_session(self, session_id: str) -> Optional[GameSession]:
        """End a game session and calculate final statistics."""
        session = self.active_sessions.get(session_id)
        if not session:
            return None
            
        session.state = GameState.FINISHED
        session.end_time = time.time()
        if session.tracker:
            session.pending_target_events.extend(session.tracker.expire(now_ms=int(session.end_time * 1000)))
            session.pending_target_events.extend(session.tracker.cancel_pending(now_ms=int(session.end_time * 1000)))
        
        # Calculate final statistics
        self._calculate_session_stats(session)
        
        return session
    
    def get_session(self, session_id: str) -> Optional[GameSession]:
        """Get session by ID."""
        return self.active_sessions.get(session_id)
    
    def is_session_expired(self, session_id: str) -> bool:
        """Check if a session has exceeded its duration."""
        session = self.active_sessions.get(session_id)
        if not session or session.state != GameState.ACTIVE:
            return False
            
        elapsed = time.time() - session.start_time
        return elapsed >= session.duration_seconds
    
    def expire_targets(self, session_id: str, now_ms: Optional[int] = None) -> List[Dict]:
        session = self.active_sessions.get(session_id)
        if not session or session.state != GameState.ACTIVE or not session.tracker:
            return []
        events = session.tracker.expire(now_ms=now_ms or int(time.time() * 1000))
        session.pending_target_events.extend(events)
        return events

    def drain_target_events(self, session_id: str) -> List[Dict]:
        session = self.active_sessions.get(session_id)
        if not session:
            return []
        events = list(session.pending_target_events)
        session.pending_target_events.clear()
        return events

    def set_datavis_config(self, session_id: str, weights: Dict[str, float],
                           target_regions: Optional[Dict[str, Dict[str, float]]] = None) -> None:
        """Session-scoped DataVis output. No formulas are computed by platform."""
        from perfectpunch_backend.game.datavis_contract import validate_target_region
        session = self.active_sessions.get(session_id)
        if not session:
            raise ValueError('Unknown game session')
        # Validate before changing state.
        import math
        if set(weights) != {'jab', 'hook', 'uppercut'} or any(
            isinstance(w, bool) or not isinstance(w, (float, int)) or
            not math.isfinite(w) or w < 0 for w in weights.values()
        ) or abs(sum(weights.values()) - 1) > 0.001:
            raise ValueError('Expected finite jab/hook/uppercut weights summing to 1')
        regions = target_regions or {}
        if any(k not in {f'{p}:{h}' for p in ('jab', 'hook', 'uppercut')
                            for h in ('left', 'right')} for k in regions):
            raise ValueError('Target region keys must look like jab:left or hook:right')
        validated = {k: validate_target_region(v) for k, v in regions.items()}
        session.datavis_weights = dict(weights)
        session.datavis_regions = validated

    def spawn_target(self, session_id: str, landmarks, frame_width: int, frame_height: int) -> Optional[Target]:
        """Create at most one pending requested target; DataVis supplies selection later."""
        session = self.active_sessions.get(session_id)
        if not session or session.state != GameState.ACTIVE:
            return None
        now = time.time()
        self.expire_targets(session_id, int(now * 1000))
        if session.tracker and any(r.status == 'pending' for r in session.tracker.targets.values()):
            return None
        # Choose type before target placement to support punch-specific DataVis geometry.
        punch_type = (choose_punch_with_weights(session.datavis_weights)
                      if session.datavis_weights else choose_punch_type())
        chosen_side = choose_punch_side(punch_type)
        requested_hand = 'left' if chosen_side == 'L' else 'right'
        region = session.datavis_regions.get(f'{punch_type}:{requested_hand}')
        if region:
            center = choose_point_from_datavis_region(
                region, frame_width, frame_height, self.target_radius)
        else:
            center = respawn_target(landmarks, frame_width, frame_height,
                                    self.target_radius, side=chosen_side)
        if center is None:
            return None
        target_id = str(uuid.uuid4())
        target = Target(
            id=target_id, center=center, radius=self.target_radius,
            target_type=TargetType(punch_type), spawn_time=now,
            required_punch=punch_type, expires_at=now + self.target_lifetime_seconds,
            required_hand=requested_hand,
        )
        session.targets.append(target)
        session.total_targets_spawned += 1
        if session.tracker:
            session.tracker.spawn(
                target_id=target_id, requested_punch=punch_type,
                spawned_at_ms=int(now * 1000),
                expires_at_ms=int(target.expires_at * 1000),
                center={'x': center[0], 'y': center[1]}, radius=self.target_radius,
                requested_hand=requested_hand,
            )
        return target

    def process_punch(self, session_id: str, pose_coords: List[Dict], landmarks,
                      frame_width: int, frame_height: int) -> Optional[Dict]:
        session = self.active_sessions.get(session_id)
        if not session or session.state != GameState.ACTIVE or not self.classifier:
            return None
        self.expire_targets(session_id)
        current = self.get_current_target(session_id)
        if not current:
            return None
        prediction = self.classifier.predict(pose_coords)
        if not prediction:
            return None
        # Preserve one attempt per confirmed target contact, not per camera frame.
        hit = wrists_hit_circle(landmarks, frame_width, frame_height, current.center, current.radius)
        if not hit:
            return None
        now = time.time()
        matches = prediction['punch_type'] == current.required_punch
        current.hit = True
        current.hit_time = now
        if matches:
            session.score += 10
            session.total_targets_hit += 1
            if now - current.spawn_time < 2.0:
                session.score += 5
        attempt = PunchAttempt(
            id=str(uuid.uuid4()), timestamp=now, target_id=current.id,
            predicted_punch=prediction['punch_type'],
            confidence=prediction['confidence'], was_correct=matches,
            hit_target=True, response_time=now-current.spawn_time,
        )
        session.punch_attempts.append(attempt)
        if session.tracker:
            event = session.tracker.resolve(
                target_id=current.id, timing_grade=None, hit_target=True,
                resolved_at_ms=int(now * 1000), detected_punch=prediction['punch_type'],
                classification_correct=matches,
                classifier_confidence=prediction['confidence'],
            )
            if event:
                session.pending_target_events.append(event)
        # No PERFECT/GOOD label is fabricated here: the backend has only collision evidence.
        return {'punch_attempt': attempt, 'target_hit': True, 'was_correct': matches,
                'prediction': prediction, 'active_target': current}

    def get_current_target(self, session_id: str) -> Optional[Target]:
        """Get the current active target for a session."""
        session = self.active_sessions.get(session_id)
        if not session:
            return None
            
        # Return the most recent unhit target
        for target in reversed(session.targets):
            if not target.hit and (not session.tracker or
                    session.tracker.targets.get(target.id, None) is None or
                    session.tracker.targets[target.id].status == 'pending'):
                return target
                
        return None
    
    def get_session_stats(self, session_id: str) -> Optional[Dict]:
        """Get real-time statistics for a session."""
        session = self.active_sessions.get(session_id)
        if not session:
            return None
            
        current_time = time.time()
        elapsed_time = current_time - session.start_time
        remaining_time = max(0, session.duration_seconds - elapsed_time)
        
        # Calculate accuracy
        total_attempts = len(session.punch_attempts)
        correct_punches = sum(1 for attempt in session.punch_attempts if attempt.was_correct)
        accuracy = (correct_punches / total_attempts * 100) if total_attempts > 0 else 0
        
        # Calculate punch type distribution
        punch_stats = defaultdict(int)
        for attempt in session.punch_attempts:
            punch_stats[attempt.predicted_punch] += 1
            
        return {
            "session_id": session_id,
            "score": session.score,
            "accuracy": accuracy,
            "targets_hit": session.total_targets_hit,
            "targets_spawned": session.total_targets_spawned,
            "total_punches": total_attempts,
            "correct_punches": correct_punches,
            "elapsed_time": elapsed_time,
            "remaining_time": remaining_time,
            "punch_distribution": dict(punch_stats),
            **(session.tracker.snapshot() if session.tracker else {}),
            "state": session.state.value
        }
    
    def _calculate_session_stats(self, session: GameSession) -> None:
        """Calculate final session statistics."""
        total_attempts = len(session.punch_attempts)
        if total_attempts == 0:
            session.accuracy = 0.0
            return
            
        correct_punches = sum(1 for attempt in session.punch_attempts if attempt.was_correct)
        session.accuracy = (correct_punches / total_attempts) * 100
        
    def cleanup_expired_sessions(self) -> List[str]:
        """Clean up expired sessions and return their IDs."""
        current_time = time.time()
        expired_sessions = []
        
        for session_id, session in list(self.active_sessions.items()):
            if session.state == GameState.ACTIVE:
                elapsed = current_time - session.start_time
                if elapsed >= session.duration_seconds:
                    self.end_session(session_id)
                    expired_sessions.append(session_id)
                    
        return expired_sessions
    
    def remove_session(self, session_id: str) -> bool:
        """Remove a session from active sessions."""
        if session_id in self.active_sessions:
            del self.active_sessions[session_id]
            return True
        return False
    
    def get_target_color(self, target_type: str) -> Tuple[int, int, int]:
        """Get the color for a target type."""
        return PUNCH_COLORS.get(target_type, (0, 0, 255))
    
    def is_model_loaded(self) -> bool:
        """Check if the punch classification model is loaded."""
        return self.classifier is not None and self.classifier.is_loaded()