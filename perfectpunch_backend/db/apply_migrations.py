from pathlib import Path

from dotenv import load_dotenv

from perfectpunch_backend.db.connection import get_connection


MIGRATIONS_DIR = Path(__file__).with_name("migrations")
MIGRATIONS = (
    "001_create_game_sessions.sql",
    "002_create_punches.sql",
    "003_normalize_session_metrics.sql",
    "004_progress_analysis_dashboard.sql",
)


def main() -> None:
    load_dotenv()

    for migration_name in MIGRATIONS:
        migration_path = MIGRATIONS_DIR / migration_name
        statements = [
            statement.strip()
            for statement in migration_path.read_text(encoding="utf-8").split(";")
            if statement.strip()
        ]

        with get_connection() as connection:
            for statement in statements:
                connection.execute(statement)

        print(f"Applied {migration_name}")


if __name__ == "__main__":
    main()
