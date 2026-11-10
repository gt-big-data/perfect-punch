"""HTTP authorization tests: real signed test JWTs, fake storage, no tenant/DB/ML needed."""
import copy
import time

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from perfectpunch_backend import entra_auth
from perfectpunch_backend import main
from perfectpunch_backend.api.routers import game
from perfectpunch_backend.game.game_manager import GameManager
from perfectpunch_backend.services import game_session_service as storage
from perfectpunch_backend.db.connection import StorageUnavailable
from perfectpunch_backend.tests.test_entra_auth import (
    TENANT_ID, SUBDOMAIN, API_CLIENT_ID, PUBLIC_JWK, make_token,
)


def headers(user_id="alice", **claims):
    return {"Authorization": f"Bearer {make_token(oid=user_id, **claims)}"}


@pytest.fixture
def api(monkeypatch):
    monkeypatch.setenv("AZURE_TENANT_ID", TENANT_ID)
    monkeypatch.setenv("AZURE_TENANT_SUBDOMAIN", SUBDOMAIN)
    monkeypatch.setenv("AZURE_API_CLIENT_ID", API_CLIENT_ID)
    monkeypatch.setenv("AZURE_REQUIRED_SCOPE", "Game.Play")
    monkeypatch.setenv("ALLOWED_ORIGINS", "http://localhost:5173,https://perfectpunch.org")
    entra_auth.clear_jwks_cache()
    monkeypatch.setattr(entra_auth, "_fetch_jwks", lambda _: {"keys": [PUBLIC_JWK]})

    # Exercise the real GameManager session methods without loading an ML model.
    manager = GameManager.__new__(GameManager)
    manager.active_sessions = {}
    manager.classifier = None
    manager.mp_pose = None
    monkeypatch.setattr(game, "game_manager", manager)
    game.manager.active_connections.clear()
    own = manager.create_session("alice")
    rows = {
        "saved-alice": {"session_id": "saved-alice", "user_id": "alice", "score": 10},
        "saved-bob": {"session_id": "saved-bob", "user_id": "bob", "score": 20},
    }
    writes = []
    feedback_calls = []

    def read_one(session_id, user_id):
        row = rows.get(session_id)
        return row if row and row["user_id"] == user_id else None

    def latest(user_id):
        return next((row for row in rows.values() if row["user_id"] == user_id), None)

    def save(data, user_id):
        writes.append((copy.deepcopy(data), user_id))
        rows[data["session_id"]] = {**data, "user_id": user_id}
        return [rows[data["session_id"]]]

    def feedback(data):
        feedback_calls.append(data)
        return {"feedback": "Test feedback"}

    monkeypatch.setattr(storage, "get_game_session", read_one)
    monkeypatch.setattr(storage, "get_latest_session", latest)
    monkeypatch.setattr(storage, "list_game_sessions", lambda user_id: [r for r in rows.values() if r["user_id"] == user_id])
    monkeypatch.setattr(storage, "save_game_session", save)
    monkeypatch.setattr(main, "generate_session_feedback", feedback)
    with TestClient(main.create_app()) as client:
        yield client, manager, own, rows, writes, feedback_calls
    entra_auth.clear_jwks_cache()


PRIVATE_REQUESTS = [
    ("POST", "/game/sessions", {"duration_seconds": 30}),
    ("GET", "/game/sessions/{id}", None),
    ("GET", "/game/sessions/{id}/stats", None),
    ("POST", "/game/sessions/{id}/start", None),
    ("POST", "/game/sessions/{id}/pause", None),
    ("POST", "/game/sessions/{id}/resume", None),
    ("POST", "/game/sessions/{id}/end", None),
    ("POST", "/game/sessions/{id}/targets/spawn", {"session_id": "{id}", "landmarks": [], "frame_width": 640, "frame_height": 480}),
    ("POST", "/game/sessions/{id}/punch", {"session_id": "{id}", "landmarks": [], "pose_coordinates": [], "frame_width": 640, "frame_height": 480}),
    ("GET", "/session/latest", None),
    ("GET", "/stats", None),
    ("POST", "/session/feedback", {"session_id": "{id}"}),
    ("POST", "/session/upload", {}),
    ("POST", "/analysis/start", None),
    ("GET", "/analysis/results", None),
]


def request(client, method, path, body, session_id, auth=None):
    path = path.replace("{id}", session_id)
    if body is not None:
        body = {k: v.replace("{id}", session_id) if isinstance(v, str) else v for k, v in body.items()}
    return client.request(method, path, json=body, headers=auth or {})


@pytest.mark.parametrize("method,path,body", PRIVATE_REQUESTS)
def test_private_endpoints_reject_missing_token(api, method, path, body):
    client, _, own, *_ = api
    response = request(client, method, path, body, own.id)
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


@pytest.mark.parametrize("method,path,body", PRIVATE_REQUESTS)
def test_private_endpoints_reject_invalid_token(api, method, path, body):
    client, _, own, *_ = api
    response = request(client, method, path, body, own.id, {"Authorization": "Bearer nonsense"})
    assert response.status_code == 401


OWNER_REQUESTS = PRIVATE_REQUESTS[1:9]


@pytest.mark.parametrize("method,path,body", OWNER_REQUESTS)
def test_other_user_cannot_read_or_mutate_session(api, method, path, body):
    client, manager, own, _, writes, _ = api
    before = copy.deepcopy(own)
    response = request(client, method, path, body, own.id, headers("bob"))
    assert response.status_code == 404
    assert response.json()["detail"] == "Session not found"
    assert manager.get_session(own.id) == before
    assert writes == []


def test_create_ignores_spoofed_body_identity(api):
    client, manager, *_ = api
    response = client.post("/game/sessions", json={"user_id": "bob", "duration_seconds": 30}, headers=headers())
    assert response.status_code == 200
    session = manager.get_session(response.json()["session_id"])
    assert session.user_id == "alice"
    assert response.json()["user_id"] == "alice"


def test_owner_can_complete_lifecycle_and_persistence_uses_verified_id(api):
    client, manager, own, _, writes, _ = api
    for action in ["start", "pause", "resume"]:
        assert client.post(f"/game/sessions/{own.id}/{action}", headers=headers()).status_code == 200
    assert client.get(f"/game/sessions/{own.id}", headers=headers()).status_code == 200
    assert client.get(f"/game/sessions/{own.id}/stats", headers=headers()).status_code == 200
    response = client.post(f"/game/sessions/{own.id}/end", headers=headers())
    assert response.status_code == 200
    assert response.json()["persisted"] is True
    assert writes[0][1] == "alice"
    assert writes[0][0]["user_id"] == "alice"
    assert client.get("/session/latest", params={"session_id": own.id}, headers=headers()).json()["session_id"] == own.id


def test_foreign_and_missing_sessions_have_same_response(api):
    client, _, own, *_ = api
    foreign = client.get(f"/game/sessions/{own.id}", headers=headers("bob"))
    missing = client.get("/game/sessions/not-a-session", headers=headers("bob"))
    assert foreign.status_code == missing.status_code == 404
    assert foreign.json() == missing.json()


@pytest.mark.parametrize("claims,status", [
    ({"exp": int(time.time()) - 3600}, 401),
    ({"aud": "another-api"}, 401),
    ({"iss": "https://another-tenant.example"}, 401),
    ({"scp": "Something.Else"}, 403),
])
def test_real_token_checks_run_before_the_routes(api, claims, status):
    client, *_ = api
    response = client.post("/game/sessions", json={"duration_seconds": 30}, headers=headers(**claims))
    assert response.status_code == status


def test_malformed_key_id_is_rejected_instead_of_causing_server_error(api):
    client, *_ = api
    response = client.get("/session/latest", headers={"Authorization": f"Bearer {make_token(kid=['bad'])}"})
    assert response.status_code == 401


@pytest.mark.parametrize("duration", [0, 9, 301])
def test_duration_is_validated(api, duration):
    client, *_ = api
    assert client.post("/game/sessions", json={"duration_seconds": duration}, headers=headers()).status_code == 422


def test_body_session_id_cannot_target_a_different_game(api):
    client, _, own, *_ = api
    body = {"session_id": "someone-else", "landmarks": [], "frame_width": 640, "frame_height": 480}
    assert client.post(f"/game/sessions/{own.id}/targets/spawn", json=body, headers=headers()).status_code == 400


def test_latest_memory_session_is_scoped_to_user(api):
    client, manager, own, *_ = api
    other = manager.create_session("bob")
    own.start_time -= 100
    response = client.get("/session/latest", headers=headers())
    assert response.status_code == 200
    assert response.json()["session_id"] == own.id
    assert response.json()["session_id"] != other.id


def test_latest_cannot_read_another_users_in_memory_session(api):
    client, _, own, *_ = api
    response = client.get("/session/latest", params={"session_id": own.id}, headers=headers("bob"))
    assert response.status_code == 404


def test_persisted_session_lookup_also_checks_owner(api):
    client, manager, *_ = api
    manager.active_sessions.clear()
    assert client.get("/session/latest?session_id=saved-alice", headers=headers()).status_code == 200
    assert client.get("/session/latest?session_id=saved-bob", headers=headers()).status_code == 404
    assert client.get("/session/latest", headers=headers()).json()["session_id"] == "saved-alice"


def test_missing_session_never_returns_static_demo_or_global_files(api, monkeypatch):
    client, manager, _, rows, *_ = api
    manager.active_sessions.clear()
    rows.clear()
    monkeypatch.setattr("builtins.open", lambda *a, **k: pytest.fail("Shared local files were read"))
    assert client.get("/session/latest", headers=headers()).status_code == 404


def test_storage_outage_is_reported_without_cross_user_fallback(api, monkeypatch):
    client, manager, *_ = api
    manager.active_sessions.clear()
    def unavailable(*args):
        raise StorageUnavailable("Test outage")
    monkeypatch.setattr(storage, "get_latest_session", unavailable)
    assert client.get("/session/latest", headers=headers()).status_code == 503


def test_end_reports_failed_persistence_honestly_and_retains_memory_copy(api, monkeypatch):
    client, manager, own, *_ = api
    def unavailable(*args, **kwargs):
        raise StorageUnavailable("Test outage")
    monkeypatch.setattr(storage, "save_game_session", unavailable)
    response = client.post(f"/game/sessions/{own.id}/end", headers=headers())
    assert response.status_code == 200
    assert response.json()["persisted"] is False
    assert manager.get_session(own.id) is not None


def test_stats_only_contains_requesting_users_rows(api):
    client, *_ = api
    rows = client.get("/stats", headers=headers()).json()
    assert rows and all(row["user_id"] == "alice" for row in rows)


def test_feedback_requires_session_owner_before_spending_any_money(api):
    client, _, own, _, _, calls = api
    assert client.post("/session/feedback", json={"session_id": own.id}, headers=headers("bob")).status_code == 404
    assert calls == []
    assert client.post("/session/feedback", json={"session_id": own.id}, headers=headers()).status_code == 200
    assert calls[0]["user_id"] == "alice"


def test_feedback_does_not_accept_arbitrary_client_metrics(api):
    client, _, _, _, _, calls = api
    assert client.post("/session/feedback", json={"summary": {}, "punches": []}, headers=headers()).status_code == 422
    assert calls == []


@pytest.mark.parametrize("method,path", [("POST", "/session/upload"), ("POST", "/analysis/start"), ("GET", "/analysis/results")])
def test_legacy_shared_file_endpoints_are_closed(api, method, path):
    client, *_ = api
    assert client.request(method, path, headers=headers()).status_code == 410


def test_websocket_rejects_missing_browser_origin(api):
    client, _, own, *_ = api
    with pytest.raises(WebSocketDisconnect) as result:
        with client.websocket_connect(f"/game/sessions/{own.id}/ws"):
            pytest.fail("Unauthenticated WebSocket was accepted")
    assert result.value.code == 1008
    assert game.manager.active_connections == {}


def test_health_remains_public(api):
    client, *_ = api
    assert client.get("/").status_code == 200
    assert client.get("/game/health").status_code == 200


def test_cors_allows_exact_frontend_with_authorization_header(api):
    client, *_ = api
    response = client.options("/game/sessions", headers={
        "Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Authorization, Content-Type",
    })
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert "authorization" in response.headers["access-control-allow-headers"].lower()


def test_cors_rejects_unlisted_origin(api):
    client, *_ = api
    response = client.options("/game/sessions", headers={
        "Origin": "https://unlisted.example", "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Authorization",
    })
    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


def test_wildcard_origin_configuration_fails_closed(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "*")
    with pytest.raises(ValueError):
        main.create_app()
