"""Verify the PostgreSQL storage adapter always includes the owner in its queries."""
import pytest

from perfectpunch_backend.db.connection import StorageUnavailable, get_connection
from perfectpunch_backend.services import game_session_service as storage
from perfectpunch_backend.config import allowed_origins


def owned_row(user_id, session_id="session-1", data=None):
    return (
        session_id, user_id, None, None, None, None, None, None,
        None, None, None, None, None, None, data,
    )


class FakeCursor:
    def __init__(self, db):
        self.db = db

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def executemany(self, sql, rows):
        self.db.calls.append((sql, rows))


class FakeConnection:
    def __init__(self, rows=None, failure=False):
        self.rows = rows or []
        self.failure = failure
        self.calls = []
        self.last_sql = ""
        self.last_params = None

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, sql, params=None):
        if self.failure:
            raise RuntimeError("Test storage outage")
        self.calls.append((sql, params))
        self.last_sql = sql
        self.last_params = params
        return self

    def fetchone(self):
        if self.last_sql.lstrip().upper().startswith("INSERT"):
            return (self.last_params[0],)
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return list(self.rows)

    def cursor(self):
        return FakeCursor(self)


def connect(db):
    return lambda: db


@pytest.mark.parametrize("operation,args", [
    (storage.get_game_session, ("session-1", "alice")),
    (storage.get_latest_session, ("alice",)),
    (storage.list_game_sessions, ("alice",)),
])
def test_every_read_includes_user_filter(monkeypatch, operation, args):
    db = FakeConnection()
    monkeypatch.setattr(storage, "get_connection", connect(db))
    operation(*args)
    assert db.calls
    assert all("user_id = %s" in sql and "alice" in params for sql, params in db.calls)
    if operation is storage.get_game_session:
        assert any("session-1" in params for _sql, params in db.calls)


def test_insert_overrides_untrusted_identity(monkeypatch):
    db = FakeConnection()
    monkeypatch.setattr(storage, "get_connection", connect(db))
    storage.save_game_session({"session_id": "session-1", "user_id": "bob"}, "alice")
    insert = next(params for sql, params in db.calls if sql.lstrip().upper().startswith("INSERT INTO GAME_SESSIONS"))
    assert insert[0] == "session-1"
    assert insert[1] == "alice"


@pytest.mark.parametrize("operation,args", [
    (storage.get_game_session, ("session-1", "alice")),
    (storage.get_latest_session, ("alice",)),
])
def test_unexpected_foreign_record_is_not_returned(monkeypatch, operation, args):
    db = FakeConnection([owned_row("bob")])
    monkeypatch.setattr(storage, "get_connection", connect(db))
    assert operation(*args) is None


def test_list_rechecks_owner_on_returned_rows(monkeypatch):
    db = FakeConnection([
        owned_row("bob"),
        owned_row("alice", data={"summary": {"score": 1}, "user_id": "alice"}),
        owned_row(""),
    ])
    monkeypatch.setattr(storage, "get_connection", connect(db))
    rows = storage.list_game_sessions("alice")
    assert [row["user_id"] for row in rows] == ["alice"]


@pytest.mark.parametrize("operation,args", [
    (storage.get_game_session, ("session-1", "")),
    (storage.get_latest_session, (None,)),
    (storage.list_game_sessions, ("  ",)),
    (storage.save_game_session, ({}, "")),
])
def test_owner_is_mandatory_before_any_database_call(monkeypatch, operation, args):
    def unexpected():
        pytest.fail("Database was called without a verified identity")
    monkeypatch.setattr(storage, "get_connection", unexpected)
    with pytest.raises(ValueError):
        operation(*args)


@pytest.mark.parametrize("operation,args", [
    (storage.get_game_session, ("session-1", "alice")),
    (storage.get_latest_session, ("alice",)),
    (storage.list_game_sessions, ("alice",)),
    (storage.save_game_session, ({"session_id": "session-1"}, "alice")),
])
def test_storage_failure_is_explicit_not_an_empty_success(monkeypatch, operation, args):
    monkeypatch.setattr(storage, "get_connection", connect(FakeConnection(failure=True)))
    with pytest.raises(StorageUnavailable):
        operation(*args)


def test_missing_storage_settings_do_not_require_the_database_package(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(StorageUnavailable):
        get_connection()


@pytest.mark.parametrize("value", ["*", "", "https://app.example/path", "https://user:pass@app.example", "https://*.example"])
def test_invalid_cors_configuration_is_rejected(monkeypatch, value):
    monkeypatch.setenv("ALLOWED_ORIGINS", value)
    with pytest.raises(ValueError):
        allowed_origins()


def test_origin_list_is_normalized_without_allowing_all_origins(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", " http://localhost:5173/, https://perfectpunch.org/ ")
    assert allowed_origins() == ["http://localhost:5173", "https://perfectpunch.org"]
