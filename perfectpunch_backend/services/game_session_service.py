"""User-scoped session storage on Azure Database for PostgreSQL."""
import json
from datetime import datetime, timezone
from typing import Any, Optional

from perfectpunch_backend.db.connection import StorageUnavailable, get_connection


def _require_user_id(user_id):
    if not isinstance(user_id, str) or not user_id.strip():
        raise ValueError("A verified user_id is required for session storage")


def _number(value: Any) -> Optional[float]:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _int(value: Any) -> Optional[int]:
    number = _number(value)
    return int(number) if number is not None else None


def _millis(value: Any) -> Optional[float]:
    number = _number(value)
    if number is None:
        return None
    return number * 1000 if number < 20 else number


def live_session_document(session) -> dict:
    """Dashboard payload for a live game. This is what gets stored and displayed."""
    attempts = [
        {
            "timestamp": attempt.timestamp,
            "predicted_punch": attempt.predicted_punch,
            "confidence": attempt.confidence,
            "was_correct": attempt.was_correct,
            "hit_target": attempt.hit_target,
            "response_time": attempt.response_time,
        }
        for attempt in session.punch_attempts
    ]
    end_time = session.end_time or session.start_time
    stamp = datetime.fromtimestamp(end_time, timezone.utc).isoformat()
    types = ("jab", "hook", "uppercut")
    grouped = {
        punch_type: [
            attempt for attempt in attempts
            if str(attempt.get("predicted_punch") or "").lower() == punch_type
        ]
        for punch_type in types
    }
    punch_accuracy = {}
    reaction_times = {}
    for punch_type, group in grouped.items():
        if not group:
            punch_accuracy[punch_type] = 0
            reaction_times[punch_type] = 250
            continue
        correct = sum(1 for attempt in group if attempt.get("was_correct"))
        punch_accuracy[punch_type] = round(correct / len(group) * 100)
        samples = [ms for attempt in group if (ms := _millis(attempt.get("response_time"))) is not None]
        reaction_times[punch_type] = round(sum(samples) / len(samples)) if samples else 250

    total = len(attempts)
    correct = sum(1 for attempt in attempts if attempt.get("was_correct"))
    samples = [ms for attempt in attempts if (ms := _millis(attempt.get("response_time"))) is not None]
    spawned = session.total_targets_spawned or 0
    hit = session.total_targets_hit or 0
    elapsed = max((session.end_time or session.start_time) - session.start_time, 1)
    bucket = elapsed / 5
    timeline = []
    for index in range(5):
        start = session.start_time + index * bucket
        stop = start + bucket
        window = [attempt for attempt in attempts if start <= (attempt.get("timestamp") or 0) < stop]
        window_correct = sum(1 for attempt in window if attempt.get("was_correct"))
        timeline.append({
            "t": round((index + 1) * bucket, 1),
            "velocity": 0,
            "accuracy": round(window_correct / len(window) * 100) if window else 0,
        })

    return {
        "session_id": session.id,
        "user_id": session.user_id,
        "timestamp": stamp,
        "start_time": datetime.fromtimestamp(session.start_time, timezone.utc).isoformat(),
        "end_time": stamp,
        "duration_seconds": session.duration_seconds,
        "score": session.score,
        "accuracy": round(correct / total * 100, 1) if total else session.accuracy,
        "total_punches": total,
        "correct_punches": correct,
        "targets_hit": hit,
        "targets_spawned": spawned,
        "punch_attempts": attempts,
        "summary": {
            "score": session.score,
            "avg_velocity": 0,
            "avg_reaction_time": round(sum(samples) / len(samples)) if samples else 250,
            "accuracy": round(correct / total * 100, 1) if total else session.accuracy,
            "critical_prevention": round(hit / spawned * 100) if spawned else 0,
            "total_punches": total,
        },
        "punch_accuracy": punch_accuracy,
        "reaction_times": reaction_times,
        "defense": {
            "blocked": 0,
            "dodged": max(spawned - hit, 0),
            "hit": hit,
        },
        "timeline": timeline,
    }


def _metric_rows(metrics: Any):
    rows = []
    if not isinstance(metrics, dict):
        return rows
    for category, category_metrics in metrics.items():
        if not isinstance(category_metrics, dict):
            continue
        for metric_name, metric in category_metrics.items():
            if not isinstance(metric, dict):
                continue
            unit = metric.get("unit") if isinstance(metric.get("unit"), str) else None
            root_description = metric.get("description") if isinstance(metric.get("description"), str) else None
            descriptions = {}

            def collect(value, path=""):
                if not isinstance(value, dict):
                    return
                for key, child in value.items():
                    if key.endswith("_description") and isinstance(child, str):
                        described = key[:-12]
                        descriptions[f"{path}.{described}" if path else described] = child
                    elif isinstance(child, (dict, list)):
                        collect(child, f"{path}.{key}" if path else key)

            def visit(value, path=""):
                if isinstance(value, dict):
                    for key, child in value.items():
                        if key in {"unit", "description"} or key.endswith("_description"):
                            continue
                        visit(child, f"{path}.{key}" if path else key)
                elif isinstance(value, list):
                    for index, child in enumerate(value):
                        visit(child, f"{path}[{index}]")
                elif value is None or _number(value) is not None:
                    rows.append((
                        category, metric_name, path or "value", _number(value), unit,
                        descriptions.get(path, root_description),
                    ))

            collect(metric)
            visit(metric)
    return rows


def _punch_rows(data: dict, user_id: str):
    metrics = data.get("metrics") if isinstance(data.get("metrics"), dict) else {}
    offense = metrics.get("offense") if isinstance(metrics.get("offense"), dict) else {}
    accuracy = offense.get("punch_accuracy", {}).get("types", {}) if isinstance(offense.get("punch_accuracy"), dict) else {}
    reaction = offense.get("punch_reaction_time", {}).get("types", {}) if isinstance(offense.get("punch_reaction_time"), dict) else {}
    speed = offense.get("punch_speed", {}).get("types", {}) if isinstance(offense.get("punch_speed"), dict) else {}
    timing = offense.get("target_timing", {}).get("types", {}) if isinstance(offense.get("target_timing"), dict) else {}
    accuracy = accuracy if isinstance(accuracy, dict) else {}
    reaction = reaction if isinstance(reaction, dict) else {}
    speed = speed if isinstance(speed, dict) else {}
    timing = timing if isinstance(timing, dict) else {}
    session_id = data["session_id"]
    if any(source for source in (accuracy, reaction, speed, timing)):
        rows = []
        for punch_type in sorted(set(accuracy) | set(reaction) | set(speed) | set(timing)):
            bucket = timing.get(punch_type) if isinstance(timing.get(punch_type), dict) else {}
            rows.append((
                session_id, user_id, f"metric:{punch_type}", "aggregate", punch_type,
                _number(accuracy.get(punch_type)), _number(reaction.get(punch_type)),
                _number(speed.get(punch_type)), _int(bucket.get("perfect")),
                _int(bucket.get("good")), _int(bucket.get("miss")), None, None, None, None,
            ))
        return rows
    attempts = data.get("punch_attempts")
    if not isinstance(attempts, list):
        return []
    return [
        (
            session_id, user_id, f"attempt:{index}", "attempt",
            attempt.get("predicted_punch") or "jab", None, None,
            _number(attempt.get("punch_velocity")), None, None, None,
            _number(attempt.get("confidence")), attempt.get("was_correct"),
            attempt.get("hit_target"), _number(attempt.get("response_time")),
        )
        for index, attempt in enumerate(attempts) if isinstance(attempt, dict)
    ]


def _is_dashboard(data: Any) -> bool:
    return isinstance(data, dict) and isinstance(data.get("summary"), dict)


def save_game_session(data: dict, user_id: str):
    _require_user_id(user_id)
    session_id = data.get("session_id") if isinstance(data, dict) else None
    if not isinstance(session_id, str) or not session_id.strip():
        raise ValueError("A session_id is required to save a game session.")
    user_id = user_id.strip()
    payload = {**data, "user_id": user_id, "session_id": session_id}
    metrics = payload.get("metrics") if isinstance(payload.get("metrics"), dict) else {}
    offense = metrics.get("offense") if isinstance(metrics.get("offense"), dict) else {}
    defense = metrics.get("defense") if isinstance(metrics.get("defense"), dict) else {}
    miscellaneous = metrics.get("miscellaneous") if isinstance(metrics.get("miscellaneous"), dict) else {}
    summary = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
    defense_doc = payload.get("defense") if isinstance(payload.get("defense"), dict) else {}
    accuracy = offense.get("punch_accuracy") if isinstance(offense.get("punch_accuracy"), dict) else {}
    reaction_time = offense.get("punch_reaction_time") if isinstance(offense.get("punch_reaction_time"), dict) else {}
    punch_speed = offense.get("punch_speed") if isinstance(offense.get("punch_speed"), dict) else {}
    attempts = payload.get("punch_attempts") if isinstance(payload.get("punch_attempts"), list) else []
    total_punches = payload.get("punches_thrown", payload.get("total_punches", summary.get("total_punches")))
    if total_punches is None:
        total_punches = len(attempts)
    correct_punches = payload.get("correct_punches")
    if correct_punches is None:
        correct_punches = sum(1 for attempt in attempts if isinstance(attempt, dict) and attempt.get("was_correct"))
    flying = miscellaneous.get("flying_blocks_summary") if isinstance(miscellaneous.get("flying_blocks_summary"), dict) else {}
    timing_outcomes = flying.get("values") if isinstance(flying.get("values"), dict) else {}
    punches_avoided = defense.get("punches_avoided") if isinstance(defense.get("punches_avoided"), dict) else {}
    stored = payload if _is_dashboard(payload) else None
    try:
        with get_connection() as connection:
            row = connection.execute(
                """
                INSERT INTO game_sessions (
                    session_id, user_id, end_time, session_data, fighter_id,
                    session_timestamp, punches_thrown, correct_punches, score,
                    average_accuracy, average_reaction_time_ms, average_punch_speed,
                    punches_avoided_percent, blocked_count, dodged_count, hit_count
                )
                VALUES (%s, %s, %s::timestamptz, %s::jsonb, %s, %s::timestamptz,
                        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (session_id) DO UPDATE SET
                    end_time = EXCLUDED.end_time,
                    session_data = EXCLUDED.session_data,
                    fighter_id = EXCLUDED.fighter_id,
                    session_timestamp = EXCLUDED.session_timestamp,
                    punches_thrown = EXCLUDED.punches_thrown,
                    correct_punches = EXCLUDED.correct_punches,
                    score = EXCLUDED.score,
                    average_accuracy = EXCLUDED.average_accuracy,
                    average_reaction_time_ms = EXCLUDED.average_reaction_time_ms,
                    average_punch_speed = EXCLUDED.average_punch_speed,
                    punches_avoided_percent = EXCLUDED.punches_avoided_percent,
                    blocked_count = EXCLUDED.blocked_count,
                    dodged_count = EXCLUDED.dodged_count,
                    hit_count = EXCLUDED.hit_count
                WHERE game_sessions.user_id = EXCLUDED.user_id
                RETURNING session_id
                """,
                (
                    session_id, user_id, payload.get("end_time"),
                    json.dumps(stored) if stored is not None else None,
                    payload.get("fighter_id"),
                    payload.get("timestamp") or payload.get("end_time") or payload.get("start_time"),
                    _int(total_punches), _int(correct_punches),
                    _int(payload.get("score", summary.get("score", correct_punches))),
                    _number(accuracy.get("derived", {}).get("average")) or _number(summary.get("accuracy", payload.get("accuracy"))),
                    _number(reaction_time.get("derived", {}).get("average")) or _number(summary.get("avg_reaction_time")),
                    _number(punch_speed.get("derived", {}).get("average")) or _number(summary.get("avg_velocity")),
                    _number(punches_avoided.get("value")) if punches_avoided else _number(summary.get("critical_prevention")),
                    _int(timing_outcomes.get("blocked", defense_doc.get("blocked"))),
                    _int(timing_outcomes.get("dodged", defense_doc.get("dodged"))),
                    _int(timing_outcomes.get("hit", defense_doc.get("hit"))),
                ),
            ).fetchone()
            if not row:
                raise StorageUnavailable("Could not save the session")
            connection.execute("DELETE FROM session_metrics WHERE session_id = %s", (session_id,))
            connection.execute("DELETE FROM punches WHERE session_id = %s", (session_id,))
            metric_rows = _metric_rows(metrics)
            punch_rows = _punch_rows(payload, user_id)
            if metric_rows:
                with connection.cursor() as cursor:
                    cursor.executemany(
                        """
                        INSERT INTO session_metrics (
                            session_id, category, metric_name, value_path,
                            numeric_value, unit, description
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                        """,
                        [(session_id, *metric) for metric in metric_rows],
                    )
            if punch_rows:
                with connection.cursor() as cursor:
                    cursor.executemany(
                        """
                        INSERT INTO punches (
                            session_id, user_id, record_key, record_kind, punch_type,
                            punch_accuracy, reaction_time_ms, punch_speed,
                            timing_perfect, timing_good, timing_miss, confidence,
                            was_correct, hit_target, response_time
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        punch_rows,
                    )
            return [payload]
    except StorageUnavailable:
        raise
    except ValueError:
        raise
    except Exception as exc:
        raise StorageUnavailable("Could not save the session") from exc


_SESSION_SELECT = """
    SELECT session_id, user_id, fighter_id, session_timestamp, punches_thrown,
           correct_punches, score, average_accuracy, average_reaction_time_ms,
           average_punch_speed, punches_avoided_percent, blocked_count,
           dodged_count, hit_count, session_data
    FROM game_sessions
"""


def _owned(row, user_id: str):
    if not row or str(row[1]) != user_id:
        return None
    data = row[14]
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except ValueError:
            data = None
    if _is_dashboard(data):
        return {**data, "session_id": row[0], "user_id": user_id}
    return _dashboard_from_columns(row, user_id)


def _dashboard_from_columns(row, user_id: str):
    (
        session_id, _user_id, fighter_id, session_timestamp, punches_thrown,
        correct_punches, score, average_accuracy, average_reaction_time,
        average_punch_speed, punches_avoided, blocked, dodged, hit, _legacy,
    ) = row
    # Column-only rows still have to be readable. Metric lookups happen in the caller
    # when a connection is available; without one, summary columns are enough.
    total = punches_thrown or 0
    correct = correct_punches or 0
    stamp = session_timestamp.isoformat() if hasattr(session_timestamp, "isoformat") else session_timestamp
    return {
        "session_id": session_id,
        "user_id": user_id,
        "fighter_id": fighter_id,
        "timestamp": stamp,
        "summary": {
            "score": correct if correct_punches is not None else (score or 0),
            "avg_velocity": (average_punch_speed or 0) / 100 if average_punch_speed else 0,
            "avg_reaction_time": round(average_reaction_time or 250),
            "accuracy": round(correct / total * 100, 1) if total else (average_accuracy or 0),
            "critical_prevention": punches_avoided or 0,
            "total_punches": total,
        },
        "punch_accuracy": {"jab": 0, "hook": 0, "uppercut": 0},
        "reaction_times": {"jab": 250, "hook": 250, "uppercut": 250},
        "defense": {"blocked": blocked or 0, "dodged": dodged or 0, "hit": hit or 0},
        "timeline": [],
    }


def _read(connection, sql, params, user_id: str):
    rows = connection.execute(sql, params).fetchall()
    owned = []
    for row in rows:
        document = _owned(row, user_id)
        if document is not None:
            owned.append(document)
    return owned


def get_game_session(session_id: str, user_id: str):
    _require_user_id(user_id)
    user_id = user_id.strip()
    try:
        with get_connection() as connection:
            rows = _read(
                connection,
                _SESSION_SELECT + " WHERE session_id = %s AND user_id = %s ORDER BY end_time DESC NULLS LAST LIMIT 1",
                (session_id, user_id),
                user_id,
            )
    except StorageUnavailable:
        raise
    except Exception as exc:
        raise StorageUnavailable("Could not read the session") from exc
    return rows[0] if rows else None


def get_latest_session(user_id: str):
    _require_user_id(user_id)
    user_id = user_id.strip()
    try:
        with get_connection() as connection:
            rows = _read(
                connection,
                _SESSION_SELECT + " WHERE user_id = %s ORDER BY end_time DESC NULLS LAST, created_at DESC LIMIT 1",
                (user_id,),
                user_id,
            )
    except StorageUnavailable:
        raise
    except Exception as exc:
        raise StorageUnavailable("Could not read session history") from exc
    return rows[0] if rows else None


def list_game_sessions(user_id: str):
    _require_user_id(user_id)
    user_id = user_id.strip()
    try:
        with get_connection() as connection:
            return _read(
                connection,
                _SESSION_SELECT + " WHERE user_id = %s ORDER BY end_time DESC NULLS LAST, created_at DESC LIMIT 100",
                (user_id,),
                user_id,
            )
    except StorageUnavailable:
        raise
    except Exception as exc:
        raise StorageUnavailable("Could not read session history") from exc
