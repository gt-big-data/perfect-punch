from fastapi import APIRouter, Depends, HTTPException
from perfectpunch_backend.entra_auth import CurrentUser, get_current_user
from perfectpunch_backend.services import game_session_service
from perfectpunch_backend.supabase_client import StorageUnavailable

router = APIRouter()


@router.get("/stats")
def get_stats(user: CurrentUser = Depends(get_current_user)):
    try:
        return game_session_service.list_game_sessions(user.id)
    except StorageUnavailable:
        raise HTTPException(status_code=503, detail="Session storage is unavailable")
