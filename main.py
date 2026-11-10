from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends
from fastapi.middleware.cors import CORSMiddleware
from src.game.game_manager import game_manager
from src.auth.auth import get_current_user
from pydantic import BaseModel
import os
import json
from dotenv import load_dotenv

from perfectpunch_backend.db.connection import StorageUnavailable
from perfectpunch_backend.services import game_session_service

# Load environment variables from .env file
load_dotenv()


# ----------------------
# FastAPI Setup
# ----------------------
app = FastAPI()

# CORS (keep your existing version if you already had one)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten this later
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ----------------------
# WebSocket Connection Manager
# ----------------------
class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[str, WebSocket] = {}
    
    async def connect(self, session_id: str, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[session_id] = websocket
    
    def disconnect(self, session_id: str):
        if session_id in self.active_connections:
            del self.active_connections[session_id]
    
    async def send_message(self, session_id: str, message: dict):
        if session_id in self.active_connections:
            await self.active_connections[session_id].send_json(message)

manager = ConnectionManager()


# ----------------------
# API ROUTES
# ----------------------

@app.post("/api/game/start")
async def start_game(user = Depends(get_current_user)):
    """Start a new game session"""
    session = game_manager.create_session(user.id)
    
    return {
        "session_id": session.session_id,
        "max_duration": session.max_duration,
        "initial_target": {
            "x": session.current_target.center_x,
            "y": session.current_target.center_y,
            "type": session.current_target.punch_type,
            "radius": session.current_target.radius
        }
    }


@app.websocket("/ws/game/{session_id}")
async def game_websocket(websocket: WebSocket, session_id: str):
    await manager.connect(session_id, websocket)
    
    try:
        while True:
            data = await websocket.receive_json()

            # Handle punch
            if data["type"] == "punch_detected":
                result = await game_manager.validate_punch(
                    session_id,
                    data["landmark_data"],
                    data["detected_punch"]
                )
                await manager.send_message(session_id, {
                    "type": "punch_result",
                    "data": result
                })

            # Handle live stats request
            elif data["type"] == "get_stats":
                stats = game_manager.get_session_stats(session_id)
                await manager.send_message(session_id, {
                    "type": "stats_update",
                    "data": stats
                })

    except WebSocketDisconnect:
        manager.disconnect(session_id)
        game_manager.end_session(session_id)


@app.get("/api/game/{session_id}/stats")
async def get_game_stats(session_id: str, user = Depends(get_current_user)):
    """Return current game statistics (from memory)"""
    stats = game_manager.get_session_stats(session_id)
    if not stats:
        return {"error": "Session not found"}
    return stats


@app.post("/api/game/{session_id}/end")
async def end_game(session_id: str, user = Depends(get_current_user)):
    """
    End game session and return final stats.
    ALSO saves session data to Azure Database for PostgreSQL.
    """
    stats = game_manager.end_session(session_id)
    if not stats:
        return {"error": "Session not found"}

    try:
        game_session_service.save_game_session({
            "session_id": session_id,
            "user_id": user.id,
            "summary": stats if isinstance(stats, dict) else {"score": 0},
            "score": stats.get("score") if isinstance(stats, dict) else None,
        }, user.id)
        print(f"Saved session {session_id} for user {user.id}")
    except (StorageUnavailable, ValueError) as e:
        print("Failed to save session to PostgreSQL:", e)

    return stats


@app.get("/session/latest")
async def get_latest_game(user = Depends(get_current_user)):
    """
    Retrieve the most recent completed session for the current user.
    This is the endpoint your React Dashboard should fetch.
    """
    try:
        latest = game_session_service.get_latest_session(user.id)
    except (StorageUnavailable, ValueError) as e:
        print("Error fetching latest session:", e)
        return {"error": "Could not fetch latest session"}
    if not latest:
        return {"error": "No sessions found"}
    return {
        "session_id": latest["session_id"],
        "data": latest,
        "timestamp": latest.get("timestamp"),
    }
