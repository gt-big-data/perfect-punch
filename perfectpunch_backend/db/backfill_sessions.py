from dotenv import load_dotenv

from perfectpunch_backend.db.connection import get_connection
from perfectpunch_backend.services.game_session_service import save_game_session


def main() -> None:
    load_dotenv()

    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT session_data
            FROM game_sessions
            WHERE session_data IS NOT NULL
            """
        ).fetchall()

    migrated = 0
    skipped = 0
    for (session_data,) in rows:
        if not isinstance(session_data, dict) or not session_data.get("session_id"):
            skipped += 1
            continue
        user_id = session_data.get("user_id")
        if not isinstance(user_id, str) or not user_id.strip():
            skipped += 1
            continue
        if not isinstance(session_data.get("metrics"), dict) and not isinstance(
            session_data.get("punch_attempts"), list
        ) and not isinstance(session_data.get("summary"), dict):
            skipped += 1
            continue

        save_game_session(session_data, user_id=user_id.strip())
        migrated += 1

    print(f"Backfilled {migrated} session(s); skipped {skipped} unsupported record(s).")


if __name__ == "__main__":
    main()
