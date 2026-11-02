"""Non-secret API configuration shared by HTTP and WebSocket setup."""
import os
from urllib.parse import urlsplit


def allowed_origins():
    value = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,https://perfectpunch.org")
    origins = []
    for entry in value.split(","):
        origin = entry.strip().rstrip("/")
        if not origin:
            continue
        parsed = urlsplit(origin)
        if (parsed.scheme not in {"http", "https"} or not parsed.hostname
                or parsed.username or parsed.password or parsed.path
                or parsed.query or parsed.fragment or "*" in origin):
            raise ValueError("ALLOWED_ORIGINS must contain complete HTTP/HTTPS origins, not wildcards or paths")
        origins.append(origin)
    if not origins:
        raise ValueError("ALLOWED_ORIGINS must contain at least one frontend origin")
    return origins
