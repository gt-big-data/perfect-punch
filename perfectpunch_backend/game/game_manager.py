import time
import random
import uuid
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass, field
from enum import Enum
from collections import defaultdict

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
    
    def spawn_target(self, session_id: str, landmarks, frame_width: int, frame_height: int) -> Optional[Target]:
        """Spawn a new target based on pose landmarks."""
        session = self.active_sessions.get(session_id)
        if not session or session.state != GameState.ACTIVE:
            return None
            
        # Check if we should spawn a new target
        current_time = time.time()
        if session.targets:
            last_target = session.targets[-1]
            if not last_target.hit and (current_time - last_target.spawn_time) < self.spawn_protection_time:
                return None  # Still in protection period
                
        # Generate target position
        target_center = respawn_target(landmarks, frame_width, frame_height, self.target_radius)
        if not target_center:
            return None
            
        # Choose target type
        target_type_str = choose_punch_type()
        target_type = TargetType(target_type_str)
        
        # Create target
        target = Target(
            id=str(uuid.uuid4()),
            center=target_center,
            radius=self.target_radius,
            target_type=target_type,
            spawn_time=current_time,
            required_punch=target_type_str
        )
        
        session.targets.append(target)
        session.total_targets_spawned += 1
        
        return target
    
    def process_punch(self, session_id: str, pose_coords: List[Dict], landmarks, 
                     frame_width: int, frame_height: int) -> Optional[Dict]:
        """Process a punch attempt and check for target hits."""
        session = self.active_sessions.get(session_id)
        if not session or session.state != GameState.ACTIVE:
            return None
            
        # Get model prediction
        prediction = self.classifier.predict(pose_coords)
        if not prediction:
            return None
            
        current_time = time.time()
        
        # Find active target (most recent unhit target)
        active_target = None
        for target in reversed(session.targets):
            if not target.hit:
                active_target = target
                break
                
        # Check for target collision
        target_hit = False
        if active_target:
            target_hit = wrists_hit_circle(
                landmarks, frame_width, frame_height,
                active_target.center, active_target.radius
            )
            
        # Determine if punch was correct
        was_correct = False
        if target_hit and active_target:
            was_correct = prediction["punch_type"] == active_target.required_punch
            
            # Mark target as hit
            active_target.hit = True
            active_target.hit_time = current_time
            
            if was_correct:
                session.score += 10  # Base score for correct punch
                session.total_targets_hit += 1
                
                # Bonus for quick response
                response_time = current_time - active_target.spawn_time
                if response_time < 2.0:  # Quick response bonus
                    session.score += 5
                    
        # Create punch attempt record
        punch_attempt = PunchAttempt(
            id=str(uuid.uuid4()),
            timestamp=current_time,
            target_id=active_target.id if active_target else None,
            predicted_punch=prediction["punch_type"],
            confidence=prediction["confidence"],
            was_correct=was_correct,
            hit_target=target_hit,
            response_time=current_time - active_target.spawn_time if active_target else None
        )
        
        session.punch_attempts.append(punch_attempt)
        
        return {
            "punch_attempt": punch_attempt,
            "target_hit": target_hit,
            "was_correct": was_correct,
            "prediction": prediction,
            "active_target": active_target
        }
    
    def get_current_target(self, session_id: str) -> Optional[Target]:
        """Get the current active target for a session."""
        session = self.active_sessions.get(session_id)
        if not session:
            return None
            
        # Return the most recent unhit target
        for target in reversed(session.targets):
            if not target.hit:
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