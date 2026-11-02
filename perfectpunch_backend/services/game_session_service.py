"""User-scoped persistence API. Keep these signatures when migrating to PostgreSQL."""
from perfectpunch_backend.supabase_client import get_supabase, StorageUnavailable


def _require_user_id(user_id):
    if not isinstance(user_id, str) or not user_id.strip():
        raise ValueError("A verified user_id is required for session storage")


def save_game_session(data: dict, user_id: str):
    _require_user_id(user_id)
    # The verified identity supplied by the route always wins over payload data.
    payload = {**data, "user_id": user_id}
    try:
        return get_supabase().table("game_sessions").insert(payload).execute().data
    except Exception as exc:
        raise StorageUnavailable("Could not save the session") from exc


def get_game_session(session_id: str, user_id: str):
    _require_user_id(user_id)
    try:
        rows = (get_supabase().table("game_sessions").select("*")
                .eq("session_id", session_id).eq("user_id", user_id)
                .order("end_time", desc=True).limit(1).execute().data)
    except Exception as exc:
        raise StorageUnavailable("Could not read the session") from exc
    row = rows[0] if rows else None
    return row if row and str(row.get("user_id")) == user_id else None


def get_latest_session(user_id: str):
    _require_user_id(user_id)
    try:
        rows = (get_supabase().table("game_sessions").select("*")
                .eq("user_id", user_id).order("end_time", desc=True)
                .limit(1).execute().data)
    except Exception as exc:
        raise StorageUnavailable("Could not read session history") from exc
    row = rows[0] if rows else None
    return row if row and str(row.get("user_id")) == user_id else None


def list_game_sessions(user_id: str):
    _require_user_id(user_id)
    try:
        rows = (get_supabase().table("game_sessions").select("*")
                .eq("user_id", user_id).order("end_time", desc=True)
                .limit(100).execute().data)
    except Exception as exc:
        raise StorageUnavailable("Could not read session history") from exc
    return [row for row in (rows or []) if str(row.get("user_id")) == user_id]
