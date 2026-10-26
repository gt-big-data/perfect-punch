"""Validate Microsoft Entra External ID access tokens for the Perfect Punch API.

How it fits together:
  1. The website signs the user in (MSAL) and gets an access token for this API.
  2. The website sends it on every request:  Authorization: Bearer <token>
  3. FastAPI routes declare  user: CurrentUser = Depends(get_current_user)
     and this module checks the token before the route runs.

Configuration comes from environment variables (App Service settings in
Azure, a local .env file during development). Nothing is hard-coded:

  AZURE_TENANT_ID          tenant GUID (Entra admin center > Overview)
  AZURE_TENANT_SUBDOMAIN   e.g. "perfectpunch" (the part before .ciamlogin.com)
  AZURE_API_CLIENT_ID      client ID of the "Perfect Punch API" app registration
  AZURE_REQUIRED_SCOPE     scope the token must carry (default: Game.Play)

Tokens are never logged.
"""
import logging
import os
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

import requests
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from jose.exceptions import ExpiredSignatureError, JWTClaimsError

logger = logging.getLogger(__name__)

JWKS_TTL_SECONDS = 3600          # re-download signing keys at most hourly...
JWKS_MIN_REFRESH_SECONDS = 60    # ...or once a minute if a token has an unknown key id
JWKS_TIMEOUT_SECONDS = 5         # never let a slow Microsoft response hang the API
CLOCK_SKEW_SECONDS = 30          # tolerate small clock differences on exp/nbf


class AuthConfigError(RuntimeError):
    """The server is missing auth settings. This is OUR bug, not the caller's."""


class AuthError(Exception):
    """The caller's token was rejected. status_code is the HTTP status to return."""

    def __init__(self, message: str, status_code: int = 401):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class AuthSettings:
    tenant_id: str
    tenant_subdomain: str
    api_client_id: str
    required_scope: str = "Game.Play"

    @property
    def issuer(self) -> str:
        # External ID tokens use the tenant GUID in both places (verified
        # against the tenant's openid-configuration page).
        return f"https://{self.tenant_id}.ciamlogin.com/{self.tenant_id}/v2.0"

    @property
    def jwks_url(self) -> str:
        return (
            f"https://{self.tenant_subdomain}.ciamlogin.com/"
            f"{self.tenant_id}/discovery/v2.0/keys"
        )


def load_settings() -> AuthSettings:
    """Read settings from the environment (at call time, so tests can change them)."""
    values = {
        "AZURE_TENANT_ID": os.getenv("AZURE_TENANT_ID", "").strip(),
        "AZURE_TENANT_SUBDOMAIN": os.getenv("AZURE_TENANT_SUBDOMAIN", "").strip(),
        "AZURE_API_CLIENT_ID": os.getenv("AZURE_API_CLIENT_ID", "").strip(),
    }
    missing = [name for name, value in values.items() if not value]
    if missing:
        raise AuthConfigError("Missing auth settings: " + ", ".join(missing))
    return AuthSettings(
        tenant_id=values["AZURE_TENANT_ID"],
        tenant_subdomain=values["AZURE_TENANT_SUBDOMAIN"],
        api_client_id=values["AZURE_API_CLIENT_ID"],
        required_scope=os.getenv("AZURE_REQUIRED_SCOPE", "Game.Play").strip() or "Game.Play",
    )


# ---------------------------------------------------------------------------
# Signing keys (JWKS) with a small cache
# ---------------------------------------------------------------------------
_cache_lock = threading.Lock()
_cache: Dict[str, Any] = {"url": None, "keys": {}, "fetched_at": 0.0}


def _fetch_jwks(url: str) -> Dict[str, Any]:
    """Download the tenant's public signing keys. Tests replace this function."""
    response = requests.get(url, timeout=JWKS_TIMEOUT_SECONDS)
    response.raise_for_status()
    return response.json()


def clear_jwks_cache() -> None:
    with _cache_lock:
        _cache.update({"url": None, "keys": {}, "fetched_at": 0.0})


def _refresh_keys(url: str) -> None:
    """Caller must hold _cache_lock."""
    try:
        data = _fetch_jwks(url)
    except Exception as exc:  # network error, bad status, bad JSON
        logger.warning("Could not download signing keys: %s", type(exc).__name__)
        if _cache["url"] == url and _cache["keys"]:
            return  # keep using the old keys rather than failing every request
        raise AuthError("Could not load signing keys", status_code=503)
    keys = {k["kid"]: k for k in data.get("keys", []) if "kid" in k}
    _cache.update({"url": url, "keys": keys, "fetched_at": time.monotonic()})


def _get_signing_key(kid: str, settings: AuthSettings) -> Dict[str, Any]:
    url = settings.jwks_url
    with _cache_lock:
        age = time.monotonic() - _cache["fetched_at"]
        if _cache["url"] != url or not _cache["keys"] or age > JWKS_TTL_SECONDS:
            _refresh_keys(url)
        elif kid not in _cache["keys"] and age >= JWKS_MIN_REFRESH_SECONDS:
            _refresh_keys(url)  # Microsoft may have rotated keys
        key = _cache["keys"].get(kid)
    if key is None:
        raise AuthError("Token signed with an unknown key")
    return key


# ---------------------------------------------------------------------------
# Token validation
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class CurrentUser:
    id: str                       # stable per-person ID: the token's "oid" claim
    email: Optional[str] = None
    name: Optional[str] = None
    claims: Dict[str, Any] = field(default_factory=dict, repr=False)


def validate_token(token: str, settings: Optional[AuthSettings] = None) -> Dict[str, Any]:
    """Return the token's claims if it is valid, otherwise raise AuthError."""
    settings = settings or load_settings()

    try:
        header = jwt.get_unverified_header(token)
    except JWTError:
        raise AuthError("Malformed token")
    kid = header.get("kid")
    if not kid:
        raise AuthError("Malformed token")

    key = _get_signing_key(kid, settings)

    try:
        claims = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            audience=settings.api_client_id,
            issuer=settings.issuer,
            options={
                "require_exp": True,
                "require_iss": True,
                "require_aud": True,
                "leeway": CLOCK_SKEW_SECONDS,
            },
        )
    except ExpiredSignatureError:
        raise AuthError("Token has expired")
    except JWTClaimsError:
        raise AuthError("Token is not valid for this API")  # wrong audience/issuer
    except JWTError:
        raise AuthError("Invalid token")

    scopes = str(claims.get("scp", "")).split()
    if settings.required_scope not in scopes:
        raise AuthError("Token is missing the required scope", status_code=403)
    return claims


def user_from_token(token: str, settings: Optional[AuthSettings] = None) -> CurrentUser:
    """Validate a token and turn its claims into a CurrentUser.

    Also used by the game WebSocket (which cannot use the Depends() helper).
    """
    claims = validate_token(token, settings)
    user_id = claims.get("oid") or claims.get("sub")
    if not user_id:
        raise AuthError("Token has no user identifier")
    return CurrentUser(
        id=str(user_id),
        email=claims.get("email") or claims.get("preferred_username"),
        name=claims.get("name"),
        claims=claims,
    )


# ---------------------------------------------------------------------------
# FastAPI dependency
# ---------------------------------------------------------------------------
_bearer = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> CurrentUser:
    """Use in a route:  user: CurrentUser = Depends(get_current_user)"""
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=401,
            detail="Missing bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        return user_from_token(credentials.credentials)
    except AuthError as exc:
        logger.info("Rejected token: %s", exc.message)
        headers = {"WWW-Authenticate": "Bearer"} if exc.status_code == 401 else None
        raise HTTPException(status_code=exc.status_code, detail=exc.message, headers=headers)
    except AuthConfigError as exc:
        logger.error("Auth is not configured: %s", exc)
        raise HTTPException(status_code=500, detail="Authentication is not configured on the server")
