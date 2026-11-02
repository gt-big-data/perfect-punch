"""Verify the real storage adapter always includes the owner in its queries."""
from types import SimpleNamespace

import pytest

from perfectpunch_backend.services import game_session_service as storage
from perfectpunch_backend.supabase_client import StorageUnavailable, get_supabase
from perfectpunch_backend.config import allowed_origins


class FakeDatabase:
    def __init__(self, rows=None, failure=False):
        self.rows = rows or []
        self.calls = []
        self.failure = failure

    def table(self, name):
        self.calls.append(("table", name))
        return self

    def select(self, value):
        self.calls.append(("select", value))
        return self

    def eq(self, key, value):
        self.calls.append(("eq", key, value))
        return self

    def order(self, key, **kwargs):
        self.calls.append(("order", key))
        return self

    def limit(self, count):
        self.calls.append(("limit", count))
        return self

    def insert(self, value):
        self.calls.append(("insert", value))
        return self

    def execute(self):
        if self.failure:
            raise RuntimeError("Test storage outage")
        return SimpleNamespace(data=self.rows)


@pytest.mark.parametrize("operation,args", [
    (storage.get_game_session, ("session-1", "alice")),
    (storage.get_latest_session, ("alice",)),
    (storage.list_game_sessions, ("alice",)),
])
def test_every_read_includes_user_filter(monkeypatch, operation, args):
    db = FakeDatabase([{"session_id": "session-1", "user_id": "alice"}])
    monkeypatch.setattr(storage, "get_supabase", lambda: db)
    operation(*args)
    assert ("eq", "user_id", "alice") in db.calls
    if operation is storage.get_game_session:
        assert ("eq", "session_id", "session-1") in db.calls


def test_insert_overrides_untrusted_identity(monkeypatch):
    db = FakeDatabase()
    monkeypatch.setattr(storage, "get_supabase", lambda: db)
    storage.save_game_session({"session_id": "session-1", "user_id": "bob"}, "alice")
    inserted = next(call[1] for call in db.calls if call[0] == "insert")
    assert inserted["user_id"] == "alice"


@pytest.mark.parametrize("operation,args", [
    (storage.get_game_session, ("session-1", "alice")),
    (storage.get_latest_session, ("alice",)),
])
def test_unexpected_foreign_record_is_not_returned(monkeypatch, operation, args):
    db = FakeDatabase([{"session_id": "session-1", "user_id": "bob"}])
    monkeypatch.setattr(storage, "get_supabase", lambda: db)
    assert operation(*args) is None


def test_list_rechecks_owner_on_returned_rows(monkeypatch):
    db = FakeDatabase([{"user_id": "bob"}, {"user_id": "alice"}, {}])
    monkeypatch.setattr(storage, "get_supabase", lambda: db)
    assert storage.list_game_sessions("alice") == [{"user_id": "alice"}]


@pytest.mark.parametrize("operation,args", [
    (storage.get_game_session, ("session-1", "")),
    (storage.get_latest_session, (None,)),
    (storage.list_game_sessions, ("  ",)),
    (storage.save_game_session, ({}, "")),
])
def test_owner_is_mandatory_before_any_database_call(monkeypatch, operation, args):
    def unexpected():
        pytest.fail("Database was called without a verified identity")
    monkeypatch.setattr(storage, "get_supabase", unexpected)
    with pytest.raises(ValueError):
        operation(*args)


@pytest.mark.parametrize("operation,args", [
    (storage.get_game_session, ("session-1", "alice")),
    (storage.get_latest_session, ("alice",)),
    (storage.list_game_sessions, ("alice",)),
    (storage.save_game_session, ({"session_id": "session-1"}, "alice")),
])
def test_storage_failure_is_explicit_not_an_empty_success(monkeypatch, operation, args):
    monkeypatch.setattr(storage, "get_supabase", lambda: FakeDatabase(failure=True))
    with pytest.raises(StorageUnavailable):
        operation(*args)


def test_missing_storage_settings_do_not_require_the_database_package(monkeypatch):
    get_supabase.cache_clear()
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_KEY", raising=False)
    with pytest.raises(StorageUnavailable):
        get_supabase()
    get_supabase.cache_clear()


@pytest.mark.parametrize("value", ["*", "", "https://app.example/path", "https://user:pass@app.example", "https://*.example"])
def test_invalid_cors_configuration_is_rejected(monkeypatch, value):
    monkeypatch.setenv("ALLOWED_ORIGINS", value)
    with pytest.raises(ValueError):
        allowed_origins()


def test_origin_list_is_normalized_without_allowing_all_origins(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", " http://localhost:5173/, https://perfectpunch.org/ ")
    assert allowed_origins() == ["http://localhost:5173", "https://perfectpunch.org"]
