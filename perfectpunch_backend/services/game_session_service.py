from typing import Any, Optional

from perfectpunch_backend.db.connection import get_connection


def _number(value: Any) -> Optional[float]:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _metric_rows(metrics: Any) -> list[tuple[str, str, str, Optional[float], Optional[str], Optional[str]]]:
    rows = []
    if not isinstance(metrics, dict):
        return rows

    for category, category_metrics in metrics.items():
        if not isinstance(category_metrics, dict):
            continue
        for metric_name, metric in category_metrics.items():
            if not isinstance(metric, dict):
                continue
            unit = metric.get("unit")
            root_description = metric.get("description")
            descriptions: dict[str, str] = {}

            def collect_descriptions(value: Any, path: str = "") -> None:
                if not isinstance(value, dict):
                    return
                for key, child in value.items():
                    if key.endswith("_description") and isinstance(child, str):
                        described_key = key[:-12]
                        described_path = f"{path}.{described_key}" if path else described_key
                        descriptions[described_path] = child
                    elif isinstance(child, (dict, list)):
                        child_path = f"{path}.{key}" if path else key
                        collect_descriptions(child, child_path)

            collect_descriptions(metric)

            def visit(value: Any, path: str = "") -> None:
                if isinstance(value, dict):
                    for key, child in value.items():
                        if key in {"unit", "description"} or key.endswith("_description"):
                            continue
                        child_path = f"{path}.{key}" if path else key
                        visit(child, child_path)
                elif isinstance(value, list):
                    for index, child in enumerate(value):
                        visit(child, f"{path}[{index}]")
                elif value is None or _number(value) is not None:
                    rows.append((
                        category,
                        metric_name,
                        path or "value",
                        _number(value),
                        unit if isinstance(unit, str) else None,
                        descriptions.get(path, root_description if isinstance(root_description, str) else None),
                    ))

            visit(metric)

    return rows


def _punch_rows(data: dict[str, Any]) -> list[tuple[Any, ...]]:
    metrics = data.get("metrics", {})
    offense = metrics.get("offense", {}) if isinstance(metrics, dict) else {}
    accuracy = offense.get("punch_accuracy", {}).get("types", {})
    reaction = offense.get("punch_reaction_time", {}).get("types", {})
    speed = offense.get("punch_speed", {}).get("types", {})
    timing = offense.get("target_timing", {}).get("types", {})
    accuracy = accuracy if isinstance(accuracy, dict) else {}
    reaction = reaction if isinstance(reaction, dict) else {}
    speed = speed if isinstance(speed, dict) else {}
    timing = timing if isinstance(timing, dict) else {}
    user_id = data.get("user_id") or "anonymous"
    session_id = data["session_id"]

    if any(isinstance(source, dict) and source for source in (accuracy, reaction, speed, timing)):
        punch_types = sorted(set(accuracy) | set(reaction) | set(speed) | set(timing))
        return [
            (
                session_id,
                user_id,
                f"metric:{punch_type}",
                "aggregate",
                punch_type,
                _number(accuracy.get(punch_type)),
                _number(reaction.get(punch_type)),
                _number(speed.get(punch_type)),
                timing.get(punch_type, {}).get("perfect") if isinstance(timing.get(punch_type), dict) else None,
                timing.get(punch_type, {}).get("good") if isinstance(timing.get(punch_type), dict) else None,
                timing.get(punch_type, {}).get("miss") if isinstance(timing.get(punch_type), dict) else None,
                None,
                None,
                None,
                None,
            )
            for punch_type in punch_types
        ]

    attempts = data.get("punch_attempts", [])
    if not isinstance(attempts, list):
        return []
    return [
        (
            session_id,
            user_id,
            f"attempt:{index}",
            "attempt",
            attempt.get("predicted_punch") or "jab",
            None,
            None,
            _number(attempt.get("punch_velocity")),
            None,
            None,
            None,
            _number(attempt.get("confidence")),
            attempt.get("was_correct"),
            attempt.get("hit_target"),
            _number(attempt.get("response_time")),
        )
        for index, attempt in enumerate(attempts)
        if isinstance(attempt, dict)
    ]


def save_game_session(data: dict[str, Any]) -> dict[str, Any]:
    """Persist session summaries, metric values, and punch records in PostgreSQL."""
    session_id = data.get("session_id")
    if not session_id:
        raise ValueError("A session_id is required to save a game session.")

    metrics = data.get("metrics", {})
    offense = metrics.get("offense", {}) if isinstance(metrics, dict) else {}
    defense = metrics.get("defense", {}) if isinstance(metrics, dict) else {}
    miscellaneous = metrics.get("miscellaneous", {}) if isinstance(metrics, dict) else {}
    accuracy = offense.get("punch_accuracy", {})
    reaction_time = offense.get("punch_reaction_time", {})
    punch_speed = offense.get("punch_speed", {})
    accuracy = accuracy if isinstance(accuracy, dict) else {}
    reaction_time = reaction_time if isinstance(reaction_time, dict) else {}
    punch_speed = punch_speed if isinstance(punch_speed, dict) else {}
    attempts = data.get("punch_attempts", [])
    total_punches = data.get("punches_thrown", data.get("total_punches"))
    if total_punches is None and isinstance(attempts, list):
        total_punches = len(attempts)
    correct_punches = data.get("correct_punches")
    if correct_punches is None and isinstance(attempts, list):
        correct_punches = sum(
            1 for attempt in attempts
            if isinstance(attempt, dict) and attempt.get("was_correct")
        )
    flying_blocks = miscellaneous.get("flying_blocks_summary", {})
    timing_outcomes = flying_blocks.get("values", {}) if isinstance(flying_blocks, dict) else {}
    punches_avoided = defense.get("punches_avoided", {})
    timing_outcomes = timing_outcomes if isinstance(timing_outcomes, dict) else {}
    punches_avoided = punches_avoided if isinstance(punches_avoided, dict) else {}
    punch_rows = _punch_rows(data)
    metric_rows = _metric_rows(metrics)

    with get_connection() as connection:
        row = connection.execute(
            """
            INSERT INTO game_sessions (
                session_id, user_id, end_time, session_data, fighter_id,
                session_timestamp, punches_thrown, correct_punches, score,
                average_accuracy, average_reaction_time_ms, average_punch_speed,
                punches_avoided_percent, blocked_count, dodged_count, hit_count
            )
            VALUES (%s, %s, %s::timestamptz, NULL, %s, %s::timestamptz,
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (session_id) DO UPDATE SET
                user_id = EXCLUDED.user_id,
                end_time = EXCLUDED.end_time,
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
                hit_count = EXCLUDED.hit_count,
                session_data = NULL
            RETURNING session_id
            """,
            (
                session_id,
                data.get("user_id") or "anonymous",
                data.get("end_time"),
                data.get("fighter_id"),
                data.get("timestamp") or data.get("end_time") or data.get("start_time"),
                total_punches,
                correct_punches,
                data.get("score", correct_punches),
                _number(accuracy.get("derived", {}).get("average")),
                _number(reaction_time.get("derived", {}).get("average")),
                _number(punch_speed.get("derived", {}).get("average")),
                _number(punches_avoided.get("value")),
                timing_outcomes.get("blocked"),
                timing_outcomes.get("dodged"),
                timing_outcomes.get("hit"),
            ),
        ).fetchone()

        connection.execute("DELETE FROM session_metrics WHERE session_id = %s", (session_id,))
        connection.execute("DELETE FROM punches WHERE session_id = %s", (session_id,))

        if metric_rows:
            with connection.cursor() as cursor:
                cursor.executemany(
                    """
                    INSERT INTO session_metrics (
                        session_id, category, metric_name, value_path,
                        numeric_value, unit, description
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """,
                    [(session_id, *metric_row) for metric_row in metric_rows],
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
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    punch_rows,
                )

    return {"session_id": row[0]}


def _dashboard_session(connection: Any, row: tuple[Any, ...]) -> dict[str, Any]:
    (
        session_id,
        fighter_id,
        session_timestamp,
        punches_thrown,
        correct_punches,
        score,
        average_accuracy,
        average_reaction_time,
        average_punch_speed,
        punches_avoided,
        blocked,
        dodged,
        hit,
        legacy_data,
    ) = row
    if legacy_data is not None:
        return legacy_data

    metrics = connection.execute(
        """
        SELECT category, metric_name, value_path, numeric_value
        FROM session_metrics
        WHERE session_id = %s
        """,
        (session_id,),
    ).fetchall()
    values = {
        (category, metric_name, value_path): value
        for category, metric_name, value_path, value in metrics
    }

    def metric(category: str, name: str, path: str) -> Optional[float]:
        return values.get((category, name, path))

    punch_types = ("jab", "hook", "uppercut")
    punch_accuracy = {
        punch_type: metric("offense", "punch_accuracy", f"types.{punch_type}") or 0
        for punch_type in punch_types
    }
    reaction_times = {
        punch_type: metric("offense", "punch_reaction_time", f"types.{punch_type}") or 250
        for punch_type in punch_types
    }
    punch_speed = {
        punch_type: metric("offense", "punch_speed", f"types.{punch_type}") or 0
        for punch_type in punch_types
    }
    accuracy_points = [
        metric("offense", "punch_accuracy", f"derived.all_points[{index}]")
        for index in range(3)
    ]
    speed_points = [
        metric("offense", "punch_speed", f"derived.all_points[{index}]")
        for index in range(3)
    ]
    timeline = [
        {
            "t": (index + 1) * 10,
            "velocity": (speed_points[index] or 0) / 100,
            "accuracy": accuracy_points[index] or 0,
        }
        for index in range(max(len(accuracy_points), len(speed_points)))
        if accuracy_points[index] is not None or speed_points[index] is not None
    ]
    total_punches = punches_thrown or 0
    correct = correct_punches or 0

    return {
        "session_id": session_id,
        "fighter_id": fighter_id,
        "timestamp": session_timestamp.isoformat() if session_timestamp else None,
        "summary": {
            "score": correct if correct_punches is not None else (score or 0),
            "avg_velocity": (average_punch_speed or 0) / 100,
            "avg_reaction_time": round(
                metric("offense", "punch_reaction_time", "derived.best")
                or average_reaction_time
                or 250
            ),
            "accuracy": (
                round(correct / total_punches * 100, 1)
                if total_punches
                else (average_accuracy or 0)
            ),
            "critical_prevention": punches_avoided or 0,
            "total_punches": total_punches,
        },
        "punch_accuracy": punch_accuracy,
        "reaction_times": reaction_times,
        "punch_speed": punch_speed,
        "defense": {
            "blocked": blocked or 0,
            "dodged": dodged or 0,
            "hit": hit or 0,
        },
        "timeline": timeline,
    }


_SESSION_SELECT = """
    SELECT session_id, fighter_id, session_timestamp, punches_thrown,
           correct_punches, score, average_accuracy, average_reaction_time_ms,
           average_punch_speed, punches_avoided_percent, blocked_count,
           dodged_count, hit_count, session_data
    FROM game_sessions
"""


def _find_session(connection: Any, where: str, params: tuple[Any, ...]) -> Optional[dict[str, Any]]:
    row = connection.execute(
        _SESSION_SELECT + f" WHERE {where} LIMIT 1",
        params,
    ).fetchone()
    return _dashboard_session(connection, row) if row else None


def get_game_session(session_id: str) -> Optional[dict[str, Any]]:
    """Get a saved session in the format expected by the dashboard."""
    with get_connection() as connection:
        return _find_session(connection, "session_id = %s", (session_id,))


def get_latest_session(user_id: Optional[str] = None) -> Optional[dict[str, Any]]:
    """Get the latest saved session, optionally filtered by user."""
    query = _SESSION_SELECT
    params: tuple[Any, ...] = ()
    if user_id:
        query += " WHERE user_id = %s"
        params = (user_id,)
    query += " ORDER BY end_time DESC NULLS LAST, created_at DESC LIMIT 1"

    with get_connection() as connection:
        row = connection.execute(query, params).fetchone()
        return _dashboard_session(connection, row) if row else None


def get_latest_session_record(user_id: str) -> Optional[dict[str, Any]]:
    """Get the latest session and timestamp for an authenticated user."""
    with get_connection() as connection:
        row = connection.execute(
            _SESSION_SELECT + """
            WHERE user_id = %s
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (user_id,),
        ).fetchone()
        if not row:
            return None
        session = _dashboard_session(connection, row)
        return {
            "session_id": session["session_id"],
            "data": session,
            "timestamp": session["timestamp"],
        }


def get_game_sessions() -> list[dict[str, Any]]:
    """Get saved sessions in creation order, newest first."""
    with get_connection() as connection:
        rows = connection.execute(
            _SESSION_SELECT + " ORDER BY created_at DESC"
        ).fetchall()
        return [_dashboard_session(connection, row) for row in rows]
