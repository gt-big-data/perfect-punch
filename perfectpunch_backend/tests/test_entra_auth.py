"""Tests for perfectpunch_backend/entra_auth.py.

No real Microsoft tenant is involved: we create a throwaway RSA key, sign fake
tokens with it, and replace the "download the signing keys" step with that key.

Run from the repo root:   python -m pytest perfectpunch_backend/tests -v
"""
import time

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from jose import jwk, jwt

from perfectpunch_backend import entra_auth
from perfectpunch_backend.entra_auth import (
    AuthConfigError,
    AuthError,
    CurrentUser,
    get_current_user,
    user_from_token,
    validate_token,
)

# Fake values: none of these are real IDs.
TENANT_ID = "11111111-1111-1111-1111-111111111111"
SUBDOMAIN = "testtenant"
API_CLIENT_ID = "22222222-2222-2222-2222-222222222222"
ISSUER = f"https://{TENANT_ID}.ciamlogin.com/{TENANT_ID}/v2.0"
KID = "test-key-1"


def _make_key():
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = private.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    public_pem = private.public_key().public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()
    public_jwk = jwk.construct(public_pem, "RS256").to_dict()
    public_jwk = {k: (v.decode() if isinstance(v, bytes) else v) for k, v in public_jwk.items()}
    public_jwk.update({"kid": KID, "use": "sig"})
    return private_pem, public_jwk


PRIVATE_PEM, PUBLIC_JWK = _make_key()
OTHER_PRIVATE_PEM, _ = _make_key()  # a different key, for forged-signature tests


def make_token(private_pem=None, kid=KID, **overrides):
    now = int(time.time())
    claims = {
        "iss": ISSUER,
        "aud": API_CLIENT_ID,
        "exp": now + 3600,
        "nbf": now - 10,
        "iat": now - 10,
        "oid": "user-oid-123",
        "sub": "pairwise-sub-456",
        "scp": "Game.Play",
        "name": "Test Player",
        "email": "player@example.com",
    }
    claims.update(overrides)
    claims = {k: v for k, v in claims.items() if v is not None}
    return jwt.encode(claims, private_pem or PRIVATE_PEM, algorithm="RS256", headers={"kid": kid})


@pytest.fixture(autouse=True)
def setup(monkeypatch):
    monkeypatch.setenv("AZURE_TENANT_ID", TENANT_ID)
    monkeypatch.setenv("AZURE_TENANT_SUBDOMAIN", SUBDOMAIN)
    monkeypatch.setenv("AZURE_API_CLIENT_ID", API_CLIENT_ID)
    monkeypatch.delenv("AZURE_REQUIRED_SCOPE", raising=False)
    entra_auth.clear_jwks_cache()
    calls = {"count": 0, "urls": []}

    def fake_fetch(url):
        calls["count"] += 1
        calls["urls"].append(url)
        return {"keys": [PUBLIC_JWK]}

    monkeypatch.setattr(entra_auth, "_fetch_jwks", fake_fetch)
    return calls


# ---- token checks ---------------------------------------------------------
def test_valid_token_is_accepted():
    claims = validate_token(make_token())
    assert claims["oid"] == "user-oid-123"


def test_user_id_is_the_oid_claim():
    user = user_from_token(make_token())
    assert user.id == "user-oid-123"
    assert user.name == "Test Player"
    assert user.email == "player@example.com"


def test_falls_back_to_sub_if_oid_missing():
    assert user_from_token(make_token(oid=None)).id == "pairwise-sub-456"


def test_wrong_issuer_is_rejected():
    old_wrong_issuer = "https://testtenant.ciamlogin.com/testtenant.onmicrosoft.com/v2.0"
    with pytest.raises(AuthError) as e:
        validate_token(make_token(iss=old_wrong_issuer))
    assert e.value.status_code == 401


def test_wrong_audience_is_rejected():
    with pytest.raises(AuthError) as e:
        validate_token(make_token(aud="99999999-9999-9999-9999-999999999999"))
    assert e.value.status_code == 401


def test_expired_token_is_rejected():
    with pytest.raises(AuthError) as e:
        validate_token(make_token(exp=int(time.time()) - 3600))
    assert "expired" in e.value.message.lower()


def test_missing_expiry_is_rejected():
    with pytest.raises(AuthError):
        validate_token(make_token(exp=None))


def test_missing_scope_is_403():
    with pytest.raises(AuthError) as e:
        validate_token(make_token(scp="Something.Else"))
    assert e.value.status_code == 403


def test_scope_can_be_one_of_several():
    assert validate_token(make_token(scp="openid Game.Play profile"))


def test_forged_signature_is_rejected():
    with pytest.raises(AuthError):
        validate_token(make_token(private_pem=OTHER_PRIVATE_PEM))


def test_unknown_key_id_is_rejected():
    with pytest.raises(AuthError):
        validate_token(make_token(kid="not-a-real-key"))


def test_garbage_token_is_rejected():
    with pytest.raises(AuthError):
        validate_token("not.a.jwt")


# ---- key cache ------------------------------------------------------------
def test_signing_keys_are_cached(setup):
    validate_token(make_token())
    validate_token(make_token())
    validate_token(make_token())
    assert setup["count"] == 1


def test_keys_downloaded_from_the_correct_url(setup):
    validate_token(make_token())
    assert setup["urls"] == [
        f"https://{SUBDOMAIN}.ciamlogin.com/{TENANT_ID}/discovery/v2.0/keys"
    ]


def test_unknown_kid_does_not_hammer_microsoft(setup):
    for _ in range(5):
        with pytest.raises(AuthError):
            validate_token(make_token(kid="bogus"))
    assert setup["count"] == 1  # refresh is rate limited


def test_key_download_failure_returns_503(monkeypatch):
    def boom(url):
        raise ConnectionError("network down")

    monkeypatch.setattr(entra_auth, "_fetch_jwks", boom)
    with pytest.raises(AuthError) as e:
        validate_token(make_token())
    assert e.value.status_code == 503


def test_stale_keys_are_used_if_refresh_fails(monkeypatch):
    validate_token(make_token())  # fills the cache

    def boom(url):
        raise ConnectionError("network down")

    monkeypatch.setattr(entra_auth, "_fetch_jwks", boom)
    monkeypatch.setattr(entra_auth, "JWKS_TTL_SECONDS", -1)  # force a refresh attempt
    assert validate_token(make_token())


# ---- configuration --------------------------------------------------------
def test_missing_settings_are_reported_by_name(monkeypatch):
    monkeypatch.delenv("AZURE_TENANT_ID")
    monkeypatch.delenv("AZURE_API_CLIENT_ID")
    with pytest.raises(AuthConfigError) as e:
        validate_token(make_token())
    assert "AZURE_TENANT_ID" in str(e.value)
    assert "AZURE_API_CLIENT_ID" in str(e.value)


def test_required_scope_is_configurable(monkeypatch):
    monkeypatch.setenv("AZURE_REQUIRED_SCOPE", "Admin.All")
    with pytest.raises(AuthError):
        validate_token(make_token())  # carries Game.Play only
    assert validate_token(make_token(scp="Admin.All"))


# ---- the FastAPI dependency ----------------------------------------------
@pytest.fixture
def client():
    app = FastAPI()

    @app.get("/me")
    def me(user: CurrentUser = Depends(get_current_user)):
        return {"id": user.id, "name": user.name}

    return TestClient(app)


def test_route_without_token_is_401(client):
    r = client.get("/me")
    assert r.status_code == 401
    assert r.headers["www-authenticate"] == "Bearer"


def test_route_with_bad_token_is_401(client):
    assert client.get("/me", headers={"Authorization": "Bearer nonsense"}).status_code == 401


def test_route_with_wrong_scheme_is_401(client):
    assert client.get("/me", headers={"Authorization": f"Basic {make_token()}"}).status_code == 401


def test_route_with_valid_token_returns_the_user(client):
    r = client.get("/me", headers={"Authorization": f"Bearer {make_token()}"})
    assert r.status_code == 200
    assert r.json() == {"id": "user-oid-123", "name": "Test Player"}


def test_route_with_missing_scope_is_403(client):
    r = client.get("/me", headers={"Authorization": f"Bearer {make_token(scp='x')}"})
    assert r.status_code == 403


def test_unconfigured_server_returns_500_not_a_crash(client, monkeypatch):
    monkeypatch.delenv("AZURE_API_CLIENT_ID")
    r = client.get("/me", headers={"Authorization": f"Bearer {make_token()}"})
    assert r.status_code == 500
