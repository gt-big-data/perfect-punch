from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, Depends
import logging
import psycopg
from typing import Dict, List, Optional
import json
import asyncio
import time
from perfectpunch_backend.db.connection import DatabaseConfigurationError
try:
    from perfectpunch_backend.game import (
        GameManager, CreateSessionRequest, SessionResponse, GameStatsResponse,
        ProcessPunchRequest, ProcessPunchResponse, SpawnTargetRequest,
        GameUpdateMessage, TargetSpawnMessage, PunchResultMessage
    )
except ImportError:
    # Fallback for relative imports
    try:
        from ...game import (
            GameManager, CreateSessionRequest, SessionResponse, GameStatsResponse,
            ProcessPunchRequest, ProcessPunchResponse, SpawnTargetRequest,
            GameUpdateMessage, TargetSpawnMessage, PunchResultMessage
        )
    except ImportError:
        # If game module not available, create dummy classes
        GameManager = None
        CreateSessionRequest = None
        SessionResponse = None
        GameStatsResponse = None
        ProcessPunchRequest = None
        ProcessPunchResponse = None
        SpawnTargetRequest = None
        GameUpdateMessage = None
        TargetSpawnMessage = None
        PunchResultMessage = None
from types import SimpleNamespace

# Initialize router and game manager
router = APIRouter(prefix="/game", tags=["game"])

# Initialize game manager if available
if GameManager:
    game_manager = GameManager()
else:
    game_manager = None
    print("Warning: GameManager not available - game features will be limited")

# WebSocket connection manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, session_id: str):
        await websocket.accept()
        if session_id not in self.active_connections:
            self.active_connections[session_id] = []
        self.active_connections[session_id].append(websocket)

    def disconnect(self, websocket: WebSocket, session_id: str):
        if session_id in self.active_connections:
            if websocket in self.active_connections[session_id]:
                self.active_connections[session_id].remove(websocket)
            if not self.active_connections[session_id]:
                del self.active_connections[session_id]

    async def send_personal_message(self, message: dict, session_id: str):
        if session_id in self.active_connections:
            disconnected = []
            for connection in self.active_connections[session_id]:
                try:
                    await connection.send_text(json.dumps(message))
                except:
                    disconnected.append(connection)
            
            # Clean up disconnected connections
            for connection in disconnected:
                self.disconnect(connection, session_id)

manager = ConnectionManager()


@router.post("/sessions")
async def create_session(request: dict):
    """Create a new game session."""
    if not game_manager:
        raise HTTPException(status_code=503, detail="Game manager not available")
    
    # Extract from request dict (FastAPI automatically parses JSON to dict)
    user_id = request.get("user_id")
    duration = request.get("duration_seconds", 30)
    
    try:
        session = game_manager.create_session(
            user_id=user_id,
            duration=duration
        )
        
        if SessionResponse:
            return SessionResponse(
                session_id=session.id,
                user_id=session.user_id,
                state=session.state,
                start_time=session.start_time,
                end_time=session.end_time,
                duration_seconds=session.duration_seconds,
                score=session.score,
                accuracy=session.accuracy,
                targets_hit=session.total_targets_hit,
                targets_spawned=session.total_targets_spawned
            )
        else:
            return {
                "session_id": session.id,
                "user_id": session.user_id,
                "state": str(session.state),
                "start_time": session.start_time,
                "end_time": session.end_time,
                "duration_seconds": session.duration_seconds,
                "score": session.score,
                "accuracy": session.accuracy,
                "targets_hit": session.total_targets_hit,
                "targets_spawned": session.total_targets_spawned
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create session: {str(e)}")


@router.post("/sessions/{session_id}/start")
async def start_session(session_id: str):
    """Start a game session."""
    if not game_manager:
        raise HTTPException(status_code=503, detail="Game manager not available")
    success = game_manager.start_session(session_id)
    if not success:
        raise HTTPException(
            status_code=404, 
            detail="Session not found or cannot be started"
        )
    
    # Notify WebSocket clients
    session = game_manager.get_session(session_id)
    if session:
        stats = game_manager.get_session_stats(session_id)
        if stats:
            await manager.send_personal_message(
                {"type": "session_started", "data": stats}, 
                session_id
            )
    
    return {"message": "Session started successfully", "session_id": session_id}


@router.post("/sessions/{session_id}/pause")
async def pause_session(session_id: str):
    """Pause a game session."""
    success = game_manager.pause_session(session_id)
    if not success:
        raise HTTPException(
            status_code=404, 
            detail="Session not found or cannot be paused"
        )
    
    # Notify WebSocket clients
    stats = game_manager.get_session_stats(session_id)
    if stats:
        await manager.send_personal_message(
            {"type": "session_paused", "data": stats}, 
            session_id
        )
    
    return {"message": "Session paused successfully", "session_id": session_id}


@router.post("/sessions/{session_id}/resume")
async def resume_session(session_id: str):
    """Resume a paused game session."""
    success = game_manager.resume_session(session_id)
    if not success:
        raise HTTPException(
            status_code=404, 
            detail="Session not found or cannot be resumed"
        )
    
    # Notify WebSocket clients
    stats = game_manager.get_session_stats(session_id)
    if stats:
        await manager.send_personal_message(
            {"type": "session_resumed", "data": stats}, 
            session_id
        )
    
    return {"message": "Session resumed successfully", "session_id": session_id}


@router.post("/sessions/{session_id}/end")
async def end_session(session_id: str):
    """End a game session and get final results."""
    if not game_manager:
        raise HTTPException(status_code=503, detail="Game manager not available")
    session = game_manager.end_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    # Get final stats
    final_stats = game_manager.get_session_stats(session_id)
    
    # Save session to PostgreSQL
    try:
        from perfectpunch_backend.services.game_session_service import save_game_session
        from datetime import datetime
        
        # Format session data for PostgreSQL
        session_data = {
            "session_id": session_id,
            "user_id": session.user_id or "anonymous",
            "start_time": datetime.fromtimestamp(session.start_time).isoformat(),
            "end_time": datetime.fromtimestamp(session.end_time or time.time()).isoformat() if session.end_time else None,
            "duration_seconds": session.duration_seconds,
            "score": session.score,
            "accuracy": session.accuracy,
            "total_punches": len(session.punch_attempts),
            "targets_hit": session.total_targets_hit,
            "targets_spawned": session.total_targets_spawned,
            "punch_attempts": [
                {
                    "timestamp": attempt.timestamp,
                    "predicted_punch": attempt.predicted_punch,
                    "confidence": attempt.confidence,
                    "was_correct": attempt.was_correct,
                    "hit_target": attempt.hit_target,
                    "response_time": attempt.response_time
                }
                for attempt in session.punch_attempts
            ]
        }
        
        save_game_session(session_data)
    except (DatabaseConfigurationError, psycopg.Error) as error:
        logging.exception("Failed to save game session to PostgreSQL")
        raise HTTPException(
            status_code=503,
            detail="Game session could not be saved to the configured PostgreSQL database.",
        ) from error
    
    # Notify WebSocket clients
    if final_stats:
        await manager.send_personal_message(
            {"type": "session_ended", "data": final_stats}, 
            session_id
        )
    
    # Clean up session after a delay
    asyncio.create_task(cleanup_session_delayed(session_id, delay=30))
    
    return {
        "message": "Session ended successfully",
        "session_id": session_id,
        "final_stats": final_stats
    }


@router.get("/sessions/{session_id}/stats", response_model=GameStatsResponse)
async def get_session_stats(session_id: str):
    """Get current statistics for a game session."""
    stats = game_manager.get_session_stats(session_id)
    if not stats:
        raise HTTPException(status_code=404, detail="Session not found")
    
    return GameStatsResponse(**stats)


@router.get("/sessions/{session_id}")
async def get_session(session_id: str):
    """Get session information."""
    session = game_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    return SessionResponse(
        session_id=session.id,
        user_id=session.user_id,
        state=session.state,
        start_time=session.start_time,
        end_time=session.end_time,
        duration_seconds=session.duration_seconds,
        score=session.score,
        accuracy=session.accuracy,
        targets_hit=session.total_targets_hit,
        targets_spawned=session.total_targets_spawned
    )


@router.post("/sessions/{session_id}/targets/spawn")
async def spawn_target(session_id: str, request: SpawnTargetRequest):
    """Manually spawn a target (primarily for testing)."""
    session = game_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    # This would require MediaPipe landmarks processing
    # For now, return a placeholder response
    return {"message": "Target spawning requires WebSocket connection with pose data"}


@router.post("/sessions/{session_id}/punch")
async def process_punch(session_id: str, request: ProcessPunchRequest):
    """Process a punch attempt (primarily for testing without WebSocket)."""
    session = game_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    try:
        # This would require proper pose coordinate processing
        # For now, return a placeholder response
        return {"message": "Punch processing requires WebSocket connection with real-time pose data"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process punch: {str(e)}")


@router.websocket("/sessions/{session_id}/ws")
async def game_websocket(websocket: WebSocket, session_id: str):
    """WebSocket endpoint for real-time game communication."""
    await manager.connect(websocket, session_id)
    
    session = game_manager.get_session(session_id)
    if not session:
        await websocket.close(code=4004, reason="Session not found")
        return
    
    try:
        # Send initial session state
        stats = game_manager.get_session_stats(session_id)
        if stats:
            await websocket.send_text(json.dumps({
                "type": "session_state",
                "data": stats
            }))
        
        # Main game loop
        while True:
            # Receive message from client
            data = await websocket.receive_text()
            message = json.loads(data)
            
            message_type = message.get("type")
            message_data = message.get("data", {})
            
            if message_type == "pose_data":
                # Process pose landmarks and detect punches
                await handle_pose_data(websocket, session_id, message_data)
                
            elif message_type == "heartbeat":
                # Respond to client heartbeat
                await websocket.send_text(json.dumps({"type": "heartbeat_ack"}))
                
            elif message_type == "request_stats":
                # Send current stats
                stats = game_manager.get_session_stats(session_id)
                if stats:
                    await websocket.send_text(json.dumps({
                        "type": "stats_update",
                        "data": stats
                    }))
            
            # Check if session has expired
            if game_manager.is_session_expired(session_id):
                await end_session_via_websocket(websocket, session_id)
                break
                
    except WebSocketDisconnect:
        manager.disconnect(websocket, session_id)
    except Exception as e:
        print(f"WebSocket error: {e}")
        await websocket.close(code=4000, reason="Internal error")
        manager.disconnect(websocket, session_id)


async def handle_pose_data(websocket: WebSocket, session_id: str, pose_data: dict):
    """Handle incoming pose data from client."""
    try:
        # Extract required data
        landmarks = pose_data.get("landmarks")
        frame_width = pose_data.get("frame_width", 640)
        frame_height = pose_data.get("frame_height", 480)
        pose_coordinates = pose_data.get("pose_coordinates", [])

        if landmarks:
            landmarks = [
                lm if not isinstance(lm, dict) else SimpleNamespace(
                    x=lm.get("x", 0.0),
                    y=lm.get("y", 0.0),
                    z=lm.get("z", 0.0),
                    visibility=lm.get("visibility", 1.0),
                )
                for lm in landmarks
            ]
        else:
            return

        # Check for new target spawning
        current_target = game_manager.get_current_target(session_id)
        if not current_target:
            # Try to spawn a new target
            target = game_manager.spawn_target(session_id, landmarks, frame_width, frame_height)
            if target:
                # Notify client of new target
                await websocket.send_text(json.dumps({
                    "type": "target_spawn",
                    "data": {
                        "id": target.id,
                        "center_x": target.center[0],
                        "center_y": target.center[1],
                        "radius": target.radius,
                        "target_type": target.target_type.value,
                        "spawn_time": target.spawn_time
                    }
                }))
                current_target = target

        # Process potential punch
        if pose_coordinates and current_target:
            result = game_manager.process_punch(
                session_id, pose_coordinates, landmarks, frame_width, frame_height
            )
            
            if result and result["target_hit"]:
                # Send punch result
                await websocket.send_text(json.dumps({
                    "type": "punch_result",
                    "data": {
                        "target_hit": result["target_hit"],
                        "was_correct": result["was_correct"],
                        "predicted_punch": result["prediction"]["punch_type"],
                        "confidence": result["prediction"]["confidence"],
                        "score_gained": 10 if result["was_correct"] else 0
                    }
                }))
                
                # Send updated stats
                stats = game_manager.get_session_stats(session_id)
                if stats:
                    await websocket.send_text(json.dumps({
                        "type": "stats_update",
                        "data": stats
                    }))
        
    except Exception as e:
        print(f"Error handling pose data: {e}")
        await websocket.send_text(json.dumps({
            "type": "error",
            "data": {"message": "Failed to process pose data"}
        }))


async def end_session_via_websocket(websocket: WebSocket, session_id: str):
    """End session and notify via WebSocket."""
    session = game_manager.end_session(session_id)
    if session:
        final_stats = game_manager.get_session_stats(session_id)
        await websocket.send_text(json.dumps({
            "type": "session_ended",
            "data": final_stats
        }))


async def cleanup_session_delayed(session_id: str, delay: int = 30):
    """Clean up session after delay."""
    await asyncio.sleep(delay)
    game_manager.remove_session(session_id)


@router.get("/health")
async def game_health():
    """Health check for game service."""
    model_loaded = game_manager.is_model_loaded()
    return {
        "status": "healthy" if model_loaded else "degraded",
        "model_loaded": model_loaded,
        "active_sessions": len(game_manager.active_sessions)
    }


# Background task to clean up expired sessions
@router.on_event("startup")
async def startup_event():
    """Start background tasks."""
    asyncio.create_task(cleanup_expired_sessions_task())


async def cleanup_expired_sessions_task():
    """Background task to clean up expired sessions."""
    while True:
        try:
            expired_sessions = game_manager.cleanup_expired_sessions()
            for session_id in expired_sessions:
                # Notify WebSocket clients that session has ended
                final_stats = game_manager.get_session_stats(session_id)
                if final_stats:
                    await manager.send_personal_message(
                        {"type": "session_expired", "data": final_stats},
                        session_id
                    )
        except Exception as e:
            print(f"Error in cleanup task: {e}")
        
        await asyncio.sleep(5)  # Check every 5 seconds