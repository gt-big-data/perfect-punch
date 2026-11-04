from fastapi import APIRouter

from perfectpunch_backend.services.game_session_service import get_game_sessions

router = APIRouter()

@router.get("/stats")
def get_stats():
    return get_game_sessions()