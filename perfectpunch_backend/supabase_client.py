import os
from functools import lru_cache


class StorageUnavailable(RuntimeError):
    """Persistence is not configured or could not be reached."""


@lru_cache(maxsize=1)
def get_supabase():
    """Connect only when storage is used, not during API import or auth tests."""
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    if not url or not key:
        raise StorageUnavailable("Session storage is not configured")
    try:
        from supabase import create_client
        return create_client(url, key)
    except Exception as exc:
        raise StorageUnavailable("Session storage is unavailable") from exc

