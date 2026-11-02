"""First-message Entra authentication for browser game sockets. Never log tokens."""
import asyncio
import json
import math
import time

from fastapi import WebSocket, WebSocketDisconnect

from perfectpunch_backend.config import allowed_origins
from perfectpunch_backend.entra_auth import AuthConfigError, AuthError, user_from_token

AUTH_TIMEOUT_SECONDS = 5
MAX_AUTH_BYTES = 16 * 1024
MAX_GAME_BYTES = 256 * 1024


async def authenticate_game_socket(websocket: WebSocket, session_id: str, get_session):
    # CORS middleware does not protect WebSockets. Check the browser Origin here.
    # Tokens are accepted only in the first frame, never in a URL or cookie.
    if (websocket.headers.get("origin") not in allowed_origins()
            or websocket.scope.get("query_string")):
        await websocket.close(code=1008, reason="Connection not allowed")
        return None
    await websocket.accept()
    try:
        frame = await asyncio.wait_for(websocket.receive(), AUTH_TIMEOUT_SECONDS)
        if frame["type"] == "websocket.disconnect":
            return None
        text = frame.get("text")
        if not isinstance(text, str) or len(text.encode("utf-8")) > MAX_AUTH_BYTES:
            raise ValueError()
        message = json.loads(text)
        if (not isinstance(message, dict) or message.get("type") != "auth"
                or not isinstance(message.get("token"), str) or not message["token"].strip()):
            raise ValueError()
        # JWKS download is blocking; keep it off the async game loop.
        user = await asyncio.wait_for(
            asyncio.to_thread(user_from_token, message["token"]), AUTH_TIMEOUT_SECONDS
        )
        expiry = float(user.claims["exp"])
        if not math.isfinite(expiry) or expiry <= time.time():
            raise AuthError("Token has expired")
    except (asyncio.TimeoutError, ValueError, TypeError, KeyError):
        await websocket.close(code=4401, reason="Authentication required")
        return None
    except AuthError as error:
        code = 4403 if error.status_code == 403 else 4401
        if error.status_code >= 500:
            code = 1011
        await websocket.close(code=code, reason="Authentication failed")
        return None
    except AuthConfigError:
        await websocket.close(code=1011, reason="Authentication unavailable")
        return None
    except WebSocketDisconnect:
        return None

    session = get_session(session_id)
    if session is None or session.user_id != user.id:
        # Do not reveal whether another person's session exists.
        await websocket.close(code=4403, reason="Session not available")
        return None
    return user
