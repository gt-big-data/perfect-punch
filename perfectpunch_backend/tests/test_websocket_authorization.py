"""Real signed JWTs and real ASGI sockets; no Entra account, DB or ML required."""
import copy
import time

import pytest
from starlette.websockets import WebSocketDisconnect

from perfectpunch_backend import entra_auth, websocket_auth
from perfectpunch_backend.api.routers import game
from perfectpunch_backend.tests.test_api_authorization import api, headers
from perfectpunch_backend.tests.test_entra_auth import make_token, OTHER_PRIVATE_PEM

ORIGIN = {"Origin": "http://localhost:5173"}


def path(session):
    return f"/game/sessions/{session.id}/ws"


def authenticate(ws, **claims):
    ws.send_json({"type": "auth", "token": make_token(oid="alice", **claims)})
    return ws.receive_json()


def test_owner_authenticated_before_data_and_can_request_stats(api):
    client, _, own, *_ = api
    with client.websocket_connect(path(own), headers=ORIGIN) as ws:
        assert game.manager.active_connections == {}
        assert authenticate(ws) == {"type": "auth_ok", "session_id": own.id}
        ws.send_json({"type": "request_stats"})
        stats = ws.receive_json()
        assert stats["type"] == "stats_update"
        assert stats["data"]["session_id"] == own.id
        ws.send_json({"type": "ping"})
        assert ws.receive_json() == {"type": "pong"}
    assert game.manager.active_connections == {}
    assert game.manager.expires_at == {}


@pytest.mark.parametrize("origin", [None, "null", "https://evil.example", "http://localhost:5174", "https://perfectpunch.org.evil.example"])
def test_origin_allowlist_runs_before_accept(api, origin):
    client, _, own, *_ = api
    with pytest.raises(WebSocketDisconnect) as closed:
        with client.websocket_connect(path(own), headers={"Origin": origin} if origin else {}):
            pytest.fail("Disallowed Origin accepted")
    assert closed.value.code == 1008
    assert game.manager.active_connections == {}


def test_production_origin_is_allowed(api):
    client, _, own, *_ = api
    with client.websocket_connect(path(own), headers={"Origin": "https://perfectpunch.org"}) as ws:
        assert authenticate(ws)["type"] == "auth_ok"


def test_query_token_is_not_an_authentication_method(api):
    client, _, own, *_ = api
    with pytest.raises(WebSocketDisconnect) as closed:
        with client.websocket_connect(path(own) + "?token=do-not-send-tokens-in-urls", headers=ORIGIN):
            pytest.fail("Query-string authentication accepted")
    assert closed.value.code == 1008


@pytest.mark.parametrize("frame", [
    {}, [], None, {"type": "pose_data", "data": {}}, {"type": "request_stats"},
    {"type": "auth"}, {"type": "auth", "token": ""}, {"type": "auth", "token": 123},
    {"type": "auth", "token": "nonsense"},
])
def test_no_game_data_or_side_effects_before_authentication(api, frame):
    client, _, own, _, writes, _ = api
    before = copy.deepcopy(own)
    with client.websocket_connect(path(own), headers=ORIGIN) as ws:
        ws.send_json(frame)
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
        assert closed.value.code == 4401
    assert own == before
    assert writes == []
    assert game.manager.active_connections == {}


@pytest.mark.parametrize("kind", ["bad_json", "binary", "oversize"])
def test_invalid_auth_frames_close_without_data(api, kind):
    client, _, own, *_ = api
    with client.websocket_connect(path(own), headers=ORIGIN) as ws:
        if kind == "binary":
            ws.send_bytes(b"auth")
        else:
            ws.send_text("{" if kind == "bad_json" else "x" * (websocket_auth.MAX_AUTH_BYTES + 1))
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
        assert closed.value.code == 4401


@pytest.mark.parametrize("claims,code", [
    ({"exp": int(time.time()) - 3600}, 4401),
    ({"exp": int(time.time()) - 1}, 4401),  # HTTP skew tolerance cannot prolong a socket
    ({"aud": "another-api"}, 4401),
    ({"iss": "https://another-tenant.example"}, 4401),
    ({"nbf": int(time.time()) + 3600}, 4401),
    ({"scp": "Another.Scope"}, 4403),
    ({"private_pem": OTHER_PRIVATE_PEM}, 4401),
])
def test_invalid_token_rejected_before_registration(api, claims, code):
    client, _, own, *_ = api
    with client.websocket_connect(path(own), headers=ORIGIN) as ws:
        ws.send_json({"type": "auth", "token": make_token(oid="alice", **claims)})
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
        assert closed.value.code == code
    assert game.manager.active_connections == {}


def test_missing_and_foreign_session_indistinguishable(api):
    client, _, own, _, writes, _ = api
    before = copy.deepcopy(own)
    responses = []
    for target in [path(own), "/game/sessions/unknown/ws"]:
        with client.websocket_connect(target, headers=ORIGIN) as ws:
            ws.send_json({"type": "auth", "token": make_token(oid="bob")})
            with pytest.raises(WebSocketDisconnect) as closed:
                ws.receive_json()
            responses.append((closed.value.code, closed.value.reason))
    assert responses[0] == responses[1] == (4403, "Session not available")
    assert own == before
    assert writes == []


def test_authentication_timeout_rejects_silent_socket(api, monkeypatch):
    client, _, own, *_ = api
    monkeypatch.setattr(websocket_auth, "AUTH_TIMEOUT_SECONDS", 0.02)
    with client.websocket_connect(path(own), headers=ORIGIN) as ws:
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
        assert closed.value.code == 4401
    assert game.manager.active_connections == {}


def test_authenticated_socket_expires_while_idle(api, monkeypatch):
    client, _, own, *_ = api
    original = websocket_auth.user_from_token

    def short_lived(token):
        user = original(token)
        user.claims["exp"] = time.time() + 0.05
        return user

    monkeypatch.setattr(websocket_auth, "user_from_token", short_lived)
    with client.websocket_connect(path(own), headers=ORIGIN) as ws:
        assert authenticate(ws)["type"] == "auth_ok"
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
        assert closed.value.code == 4401
    assert game.manager.active_connections == {}


def test_removed_session_is_checked_again_before_processing(api):
    client, manager, own, *_ = api
    with client.websocket_connect(path(own), headers=ORIGIN) as ws:
        authenticate(ws)
        manager.remove_session(own.id)
        ws.send_json({"type": "request_stats"})
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
        assert closed.value.code == 4403


def test_owner_pose_reaches_model_handler_with_path_session_only(api, monkeypatch):
    client, _, own, *_ = api
    calls = []

    async def pose(ws, session_id, data):
        calls.append((session_id, data))
        await ws.send_json({"type": "pose_received"})

    monkeypatch.setattr(game, "handle_pose_data", pose)
    with client.websocket_connect(path(own), headers=ORIGIN) as ws:
        authenticate(ws)
        ws.send_json({"type": "pose_data", "session_id": "somebody-else", "data": {"landmarks": []}})
        assert ws.receive_json()["type"] == "pose_received"
    assert calls == [(own.id, {"landmarks": []})]


def test_websocket_end_uses_same_owner_scoped_persistence(api):
    client, _, own, _, writes, _ = api
    with client.websocket_connect(path(own), headers=ORIGIN) as ws:
        authenticate(ws)
        client.post(f"/game/sessions/{own.id}/start", headers=headers())
        assert ws.receive_json()["type"] == "session_started"
        ws.send_json({"type": "end_session"})
        assert ws.receive_json()["type"] == "session_ended"
    assert writes[0][1] == "alice"
    assert writes[0][0]["user_id"] == "alice"


@pytest.mark.parametrize("frame,code", [
    ("{", 1008), ("[]", 1008), ('{"type":"auth","token":"again"}', 1008),
    ('{"type":"pose_data","data":null}', 1008),
    ("x" * (websocket_auth.MAX_GAME_BYTES + 1), 1009),
])
def test_bad_post_auth_frames_close_and_unregister(api, frame, code):
    client, _, own, *_ = api
    with client.websocket_connect(path(own), headers=ORIGIN) as ws:
        authenticate(ws)
        ws.send_text(frame)
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
        assert closed.value.code == code
    assert game.manager.active_connections == {}


def test_jwks_outage_is_service_error_and_never_leaks_token(api, monkeypatch):
    client, _, own, *_ = api
    entra_auth.clear_jwks_cache()

    def offline(_):
        raise OSError("offline")

    monkeypatch.setattr(entra_auth, "_fetch_jwks", offline)
    with client.websocket_connect(path(own), headers=ORIGIN) as ws:
        ws.send_json({"type": "auth", "token": make_token(oid="alice")})
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
        assert closed.value.code == 1011
        assert closed.value.reason == "Authentication failed"
