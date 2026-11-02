from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from enum import Enum
import time


class GameState(str, Enum):
    """Game session states."""
    WAITING = "waiting"
    ACTIVE = "active"
    PAUSED = "paused"
    FINISHED = "finished"


class TargetType(str, Enum):
    """Types of targets."""
    JAB = "jab"
    HOOK = "hook"
    UPPERCUT = "uppercut"


class CreateSessionRequest(BaseModel):
    """Request to create a new game session."""
    duration_seconds: int = Field(default=30, ge=10, le=300)


class SessionResponse(BaseModel):
    """Response containing session information."""
    session_id: str
    user_id: Optional[str]
    state: GameState
    start_time: float
    end_time: Optional[float] = None
    duration_seconds: int
    score: int = 0
    accuracy: float = 0.0
    targets_hit: int = 0
    targets_spawned: int = 0


class TargetResponse(BaseModel):
    """Response containing target information."""
    id: str
    center_x: int
    center_y: int
    radius: int
    target_type: TargetType
    spawn_time: float
    hit: bool = False
    hit_time: Optional[float] = None


class PunchPrediction(BaseModel):
    """Punch prediction from ML model."""
    punch_type: str
    confidence: float
    class_id: int
    probabilities: Dict[str, float]


class PunchAttemptResponse(BaseModel):
    """Response containing punch attempt information."""
    id: str
    timestamp: float
    target_id: Optional[str]
    predicted_punch: str
    confidence: float
    was_correct: bool
    hit_target: bool
    response_time: Optional[float] = None


class GameStatsResponse(BaseModel):
    """Response containing game statistics."""
    session_id: str
    score: int
    accuracy: float
    targets_hit: int
    targets_spawned: int
    total_punches: int
    correct_punches: int
    elapsed_time: float
    remaining_time: float
    punch_distribution: Dict[str, int]
    state: GameState


class ProcessPunchRequest(BaseModel):
    """Request to process a punch with pose data."""
    session_id: str
    pose_coordinates: List[Dict[str, Any]]
    frame_width: int
    frame_height: int
    landmarks: List[Dict[str, Any]]  # MediaPipe landmarks


class ProcessPunchResponse(BaseModel):
    """Response from punch processing."""
    punch_attempt: PunchAttemptResponse
    target_hit: bool
    was_correct: bool
    prediction: PunchPrediction
    active_target: Optional[TargetResponse] = None


class SpawnTargetRequest(BaseModel):
    """Request to spawn a new target."""
    session_id: str
    landmarks: List[Dict[str, Any]]
    frame_width: int
    frame_height: int


class WebSocketMessage(BaseModel):
    """Base WebSocket message structure."""
    type: str
    session_id: str
    data: Dict[str, Any]


class GameUpdateMessage(WebSocketMessage):
    """WebSocket message for game updates."""
    type: str = "game_update"
    data: GameStatsResponse


class TargetSpawnMessage(WebSocketMessage):
    """WebSocket message for target spawning."""
    type: str = "target_spawn"
    data: TargetResponse


class PunchResultMessage(WebSocketMessage):
    """WebSocket message for punch results."""
    type: str = "punch_result"
    data: ProcessPunchResponse
