"""Platform-owned target lifecycle and Data Visualization handoff contract.

This module is deliberately independent of FastAPI, MediaPipe and database drivers.
Integrate one TargetOutcomeTracker per gameplay session. It does NOT implement
adaptive punch weights or punch target region formulas.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Literal, Optional

PUNCH_TYPES = ("jab", "hook", "uppercut")
GRADES = ("perfect", "good", "miss")


def _assert_punch_type(punch_type: str) -> None:
    if punch_type not in PUNCH_TYPES:
        raise ValueError(f"Invalid punch type: {punch_type!r}")


@dataclass
class TargetRecord:
    target_id: str
    requested_punch: str
    requested_hand: Optional[str]
    spawned_at_ms: int
    expires_at_ms: int
    center: Optional[Dict[str, float]] = None
    radius: Optional[float] = None
    status: Literal["pending", "resolved", "cancelled"] = "pending"
    timing_grade: Optional[Literal["perfect", "good", "miss"]] = None
    contact_hit: Optional[bool] = None
    reason: Optional[str] = None
    resolved_at_ms: Optional[int] = None
    detected_punch: Optional[str] = None
    classifier_confidence: Optional[float] = None
    classification_correct: Optional[bool] = None
    reaction_time_ms: Optional[int] = None

    def as_event(self, session_id: str) -> Dict[str, Any]:
        return {
            "event_type": "target_result" if self.status == "resolved" else "target_cancelled",
            "session_id": session_id,
            "target_id": self.target_id,
            "requested_punch": self.requested_punch,
            "requested_hand": self.requested_hand,
            "spawned_at_ms": self.spawned_at_ms,
            "expires_at_ms": self.expires_at_ms,
            "resolved_at_ms": self.resolved_at_ms,
            "status": self.status,
            "timing_grade": self.timing_grade,
            # Timing hit and correct punch classification are *not* interchangeable.
            "timing_hit": self.timing_grade in ("perfect", "good"),
            "hit_target": self.contact_hit if self.contact_hit is not None else self.timing_grade in ("perfect", "good"),
            "classification_correct": self.classification_correct,
            "detected_punch": self.detected_punch,
            "classifier_confidence": self.classifier_confidence,
            "reason": self.reason,
            "reaction_time_ms": self.reaction_time_ms,
            "target_center": self.center,
            "target_radius": self.radius,
        }


@dataclass
class TargetOutcomeTracker:
    session_id: str
    targets: Dict[str, TargetRecord] = field(default_factory=dict)
    selected_punches: list[str] = field(default_factory=list)
    # Deliberately no adaptive formula; Data Visualization owns it.

    def spawn(
        self, *, target_id: str, requested_punch: str, spawned_at_ms: int,
        expires_at_ms: int, requested_hand: Optional[str] = None,
        center: Optional[Dict[str, float]] = None, radius: Optional[float] = None,
    ) -> TargetRecord:
        _assert_punch_type(requested_punch)
        if not target_id:
            raise ValueError("target_id must not be empty")
        if target_id in self.targets:
            raise ValueError(f"Duplicate target ID: {target_id}")
        if expires_at_ms <= spawned_at_ms:
            raise ValueError("Target expiration must be after spawn")
        if requested_hand not in (None, "left", "right"):
            raise ValueError("requested_hand must be left/right/None")
        record = TargetRecord(
            target_id=target_id, requested_punch=requested_punch,
            spawned_at_ms=spawned_at_ms, expires_at_ms=expires_at_ms,
            requested_hand=requested_hand, center=center, radius=radius,
        )
        self.targets[target_id] = record
        self.selected_punches.append(requested_punch)
        return record

    def resolve(
        self, *, target_id: str, timing_grade: Optional[str], resolved_at_ms: int,
        reason: Optional[str] = None, detected_punch: Optional[str] = None,
        classifier_confidence: Optional[float] = None,
        classification_correct: Optional[bool] = None,
        hit_target: Optional[bool] = None,
    ) -> Optional[Dict[str, Any]]:
        """Finalize once. Returns event, or None if already finalized (idempotent)."""
        if timing_grade is not None and timing_grade not in GRADES:
            raise ValueError(f"Invalid grade: {timing_grade}")
        record = self.targets[target_id]
        if record.status != "pending":
            return None
        if resolved_at_ms < record.spawned_at_ms:
            raise ValueError("Outcome cannot precede target spawn")
        if classifier_confidence is not None and not 0 <= classifier_confidence <= 1:
            raise ValueError("classifier_confidence must be in [0,1]")
        record.status = "resolved"
        record.timing_grade = timing_grade
        record.contact_hit = hit_target if hit_target is not None else timing_grade in ("perfect", "good")
        record.resolved_at_ms = resolved_at_ms
        record.reason = reason
        record.detected_punch = detected_punch
        record.classifier_confidence = classifier_confidence
        record.classification_correct = classification_correct
        record.reaction_time_ms = resolved_at_ms - record.spawned_at_ms
        return record.as_event(self.session_id)

    def expire(self, *, now_ms: int) -> list[Dict[str, Any]]:
        """Expire all overdue targets, even when camera frames stop arriving."""
        emitted = []
        for record in self.targets.values():
            if record.status == "pending" and now_ms >= record.expires_at_ms:
                emitted_event = self.resolve(
                    target_id=record.target_id, timing_grade="miss",
                    resolved_at_ms=record.expires_at_ms, reason="timeout",
                )
                if emitted_event is not None:
                    emitted.append(emitted_event)
        return emitted

    def cancel_pending(self, *, now_ms: int, reason: str = "session_ended") -> list[Dict[str, Any]]:
        """Cancel an unfinished target without counting it as a miss."""
        emitted = []
        for record in self.targets.values():
            if record.status != "pending":
                continue
            record.status = "cancelled"
            record.reason = reason
            record.resolved_at_ms = now_ms
            emitted.append(record.as_event(self.session_id))
        return emitted

    def snapshot(self) -> Dict[str, Any]:
        stats: Dict[str, Dict[str, Any]] = {}
        for punch in PUNCH_TYPES:
            entries = [r for r in self.targets.values() if r.requested_punch == punch]
            perfect = sum(r.timing_grade == "perfect" for r in entries)
            good = sum(r.timing_grade == "good" for r in entries)
            misses = sum(r.timing_grade == "miss" for r in entries)
            ungraded_hits = sum(r.status == "resolved" and r.timing_grade is None and r.contact_hit is True for r in entries)
            completed = perfect + good + misses + ungraded_hits
            classified = [r for r in entries if r.classification_correct is not None]
            correct = sum(r.classification_correct is True for r in classified)
            stats[punch] = {
                "correct_type": correct,
                "incorrect_type": len(classified) - correct,
                "classified_targets": len(classified),
                "perfect": perfect,
                "good": good,
                "miss": misses,
                "timing_hits": perfect + good,
                "ungraded_hits": ungraded_hits,
                "target_hits": perfect + good + ungraded_hits,
                "completed_targets": completed,
                "pending_targets": sum(r.status == "pending" for r in entries),
                "cancelled_targets": sum(r.status == "cancelled" for r in entries),
                # Null = no evidence, not 0% accuracy.
                "timing_accuracy_pct": round(100 * (perfect + good) / (perfect + good + misses), 2) if (perfect + good + misses) else None,
            }
        last_punch = self.selected_punches[-1] if self.selected_punches else None
        streak = 0
        if last_punch is not None:
            for punch in reversed(self.selected_punches):
                if punch != last_punch:
                    break
                streak += 1
        return {
            "session_id": self.session_id,
            "selection_history": list(self.selected_punches),
            "last_selected_punch": last_punch,
            "consecutive_punch_count": streak,
            "metric_definition": "timing: perfect + good = hit; miss = unsuccessful target",
            "punch_stats": stats,
            "totals": {
                "targets_spawned": len(self.targets),
                "completed_targets": sum(v["completed_targets"] for v in stats.values()),
                "timing_hits": sum(v["timing_hits"] for v in stats.values()),
                "target_hits": sum(v["target_hits"] for v in stats.values()),
                "misses": sum(v["miss"] for v in stats.values()),
                "pending_targets": sum(v["pending_targets"] for v in stats.values()),
                "cancelled_targets": sum(v["cancelled_targets"] for v in stats.values()),
            },
        }

    def export(self) -> Dict[str, Any]:
        """Session JSON suitable for PostgreSQL game_sessions.session_data."""
        return {**self.snapshot(), "target_outcomes": [
            record.as_event(self.session_id)
            for record in self.targets.values() if record.status != "pending"
        ]}
