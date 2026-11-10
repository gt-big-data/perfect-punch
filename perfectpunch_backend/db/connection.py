import os
from urllib.parse import quote


class StorageUnavailable(RuntimeError):
    """Persistence is not configured or could not be reached."""


class DatabaseConfigurationError(StorageUnavailable):
    pass


def _normalize_database_url(database_url: str) -> str:
    """Percent-encode a password that contains @ or # so the host still parses."""
    if "://" not in database_url or "@" not in database_url:
        return database_url
    scheme, rest = database_url.split("://", 1)
    userinfo, hostpart = rest.rsplit("@", 1)
    user, sep, password = userinfo.partition(":")
    if not sep or not any(char in password for char in "@#?/: "):
        return database_url
    return f"{scheme}://{quote(user, safe='')}:{quote(password, safe='')}@{hostpart}"


def get_connection():
    """Open Azure Database for PostgreSQL. psycopg is imported only after config is present."""
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise DatabaseConfigurationError(
            "DATABASE_URL must be set to connect to Azure Database for PostgreSQL."
        )
    database_url = _normalize_database_url(database_url)
    try:
        import psycopg
    except ImportError as exc:
        raise StorageUnavailable("Session storage is unavailable") from exc
    try:
        # The server requires TLS. A URL that already sets sslmode keeps that value.
        if "sslmode=" in database_url:
            return psycopg.connect(database_url, connect_timeout=15)
        return psycopg.connect(database_url, sslmode="require", connect_timeout=15)
    except Exception as exc:
        raise StorageUnavailable("Session storage is unavailable") from exc
