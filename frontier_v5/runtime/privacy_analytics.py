"""Privacy-compliant, repository-local product analytics for Frontier v5.

REV-011 scope is intentionally narrow: this module proves deterministic internal
analytics behavior without exporting customer data or using any production
analytics provider. Raw subject identifiers are pseudonymized before persistence;
event taxonomy and dimensions are allowlisted; consent, deletion, retention,
idempotency, tenant isolation, and aggregate-only funnels fail closed.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json
from pathlib import Path
import re
import sqlite3
from typing import Mapping, Sequence

UTC = timezone.utc
_SAFE_ID = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")


class PrivacyAnalyticsError(RuntimeError):
    """Base error for privacy-analytics policy or storage violations."""


class ConsentRequiredError(PrivacyAnalyticsError):
    """Raised when analytics collection is attempted without active consent."""


@dataclass(frozen=True)
class AnalyticsPolicy:
    retention_days: int
    funnel_window_hours: int
    allowed_events: tuple[str, ...]
    allowed_dimensions: Mapping[str, tuple[str, ...]]

    def __post_init__(self) -> None:
        if not isinstance(self.retention_days, int) or self.retention_days <= 0:
            raise ValueError("retention_days must be a positive integer")
        if not isinstance(self.funnel_window_hours, int) or self.funnel_window_hours <= 0:
            raise ValueError("funnel_window_hours must be a positive integer")
        events = tuple(str(event) for event in self.allowed_events)
        if not events or len(events) != len(set(events)):
            raise ValueError("allowed_events must be non-empty and unique")
        if any(_SAFE_ID.fullmatch(event) is None for event in events):
            raise ValueError("allowed event names must use stable safe identifiers")

        dimensions: dict[str, tuple[str, ...]] = {}
        for key, values in dict(self.allowed_dimensions).items():
            key = str(key)
            normalized = tuple(str(value) for value in values)
            if _SAFE_ID.fullmatch(key) is None or not normalized:
                raise ValueError("analytics dimensions must have safe names and values")
            if len(normalized) != len(set(normalized)):
                raise ValueError("analytics dimension values must be unique")
            if any(_SAFE_ID.fullmatch(value) is None for value in normalized):
                raise ValueError("analytics dimension values must be bounded identifiers")
            dimensions[key] = normalized

        object.__setattr__(self, "allowed_events", events)
        object.__setattr__(self, "allowed_dimensions", dimensions)


@dataclass(frozen=True)
class EventReceipt:
    event_id: str
    subject_pseudonym: str
    created: bool


@dataclass(frozen=True)
class FunnelMetrics:
    steps: tuple[str, ...]
    step_counts: tuple[int, ...]
    entered: int
    completed: int
    conversion_rate: float


class PrivacyAnalyticsStore:
    """SQLite-backed privacy boundary for aggregate product analytics."""

    def __init__(
        self,
        db_path: str | Path,
        *,
        pseudonym_key: bytes,
        policy: AnalyticsPolicy,
    ) -> None:
        if not isinstance(pseudonym_key, (bytes, bytearray)) or len(pseudonym_key) < 16:
            raise ValueError("pseudonym_key must contain at least 16 bytes")
        self._key = bytes(pseudonym_key)
        self.policy = policy
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = DELETE")
        return conn

    def _initialize(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS analytics_consent (
                    tenant_id TEXT NOT NULL,
                    subject_pseudonym TEXT NOT NULL,
                    granted INTEGER NOT NULL CHECK (granted IN (0, 1)),
                    decided_at TEXT NOT NULL,
                    PRIMARY KEY (tenant_id, subject_pseudonym)
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS analytics_events (
                    tenant_id TEXT NOT NULL,
                    subject_pseudonym TEXT NOT NULL,
                    event_id TEXT NOT NULL,
                    event_name TEXT NOT NULL,
                    occurred_at TEXT NOT NULL,
                    dimensions_json TEXT NOT NULL,
                    event_fingerprint TEXT NOT NULL,
                    PRIMARY KEY (tenant_id, event_id)
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_analytics_events_funnel "
                "ON analytics_events (tenant_id, subject_pseudonym, occurred_at, event_name)"
            )

    @staticmethod
    def _validate_id(value: str, label: str) -> str:
        if not isinstance(value, str) or _SAFE_ID.fullmatch(value) is None:
            raise PrivacyAnalyticsError(f"{label} must be a stable safe identifier")
        return value

    @staticmethod
    def _utc(value: datetime, label: str) -> datetime:
        if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
            raise PrivacyAnalyticsError(f"{label} must be timezone-aware")
        return value.astimezone(UTC)

    @staticmethod
    def _iso(value: datetime) -> str:
        return value.astimezone(UTC).isoformat(timespec="microseconds")

    def _pseudonym(self, tenant_id: str, subject_id: str) -> str:
        self._validate_id(tenant_id, "tenant_id")
        if not isinstance(subject_id, str) or not subject_id or len(subject_id) > 1024:
            raise PrivacyAnalyticsError("subject identifier is invalid")
        message = tenant_id.encode("utf-8") + b"\x00" + subject_id.encode("utf-8")
        return hmac.new(self._key, message, hashlib.sha256).hexdigest()

    def _dimensions(self, dimensions: Mapping[str, str]) -> dict[str, str]:
        if not isinstance(dimensions, Mapping):
            raise PrivacyAnalyticsError("dimensions must be a mapping")
        normalized: dict[str, str] = {}
        for raw_key, raw_value in dimensions.items():
            if not isinstance(raw_key, str) or not isinstance(raw_value, str):
                raise PrivacyAnalyticsError("analytics dimensions must be strings")
            allowed = self.policy.allowed_dimensions.get(raw_key)
            if allowed is None or raw_value not in allowed:
                raise PrivacyAnalyticsError("analytics dimension is not allowlisted")
            normalized[raw_key] = raw_value
        return dict(sorted(normalized.items()))

    def set_consent(
        self,
        tenant_id: str,
        subject_id: str,
        *,
        granted: bool,
        at: datetime,
    ) -> int:
        tenant_id = self._validate_id(tenant_id, "tenant_id")
        if not isinstance(granted, bool):
            raise PrivacyAnalyticsError("granted must be boolean")
        decided_at = self._iso(self._utc(at, "consent timestamp"))
        pseudonym = self._pseudonym(tenant_id, subject_id)

        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO analytics_consent
                    (tenant_id, subject_pseudonym, granted, decided_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(tenant_id, subject_pseudonym) DO UPDATE SET
                    granted = excluded.granted,
                    decided_at = excluded.decided_at
                """,
                (tenant_id, pseudonym, int(granted), decided_at),
            )
            deleted = 0
            if not granted:
                cursor = conn.execute(
                    "DELETE FROM analytics_events WHERE tenant_id = ? AND subject_pseudonym = ?",
                    (tenant_id, pseudonym),
                )
                deleted = max(0, int(cursor.rowcount))
        return deleted

    def _require_consent(self, conn: sqlite3.Connection, tenant_id: str, pseudonym: str) -> None:
        row = conn.execute(
            "SELECT granted FROM analytics_consent "
            "WHERE tenant_id = ? AND subject_pseudonym = ?",
            (tenant_id, pseudonym),
        ).fetchone()
        if row is None or int(row[0]) != 1:
            raise ConsentRequiredError("analytics consent is required")

    def record_event(
        self,
        *,
        tenant_id: str,
        subject_id: str,
        event_id: str,
        event_name: str,
        occurred_at: datetime,
        dimensions: Mapping[str, str],
    ) -> EventReceipt:
        tenant_id = self._validate_id(tenant_id, "tenant_id")
        event_id = self._validate_id(event_id, "event_id")
        event_name = self._validate_id(event_name, "event_name")
        if event_name not in self.policy.allowed_events:
            raise PrivacyAnalyticsError("event name is not allowlisted")
        event_time = self._utc(occurred_at, "event timestamp")
        normalized_dimensions = self._dimensions(dimensions)
        pseudonym = self._pseudonym(tenant_id, subject_id)
        dimensions_json = json.dumps(
            normalized_dimensions, sort_keys=True, separators=(",", ":"), ensure_ascii=True
        )
        canonical = json.dumps(
            {
                "tenant_id": tenant_id,
                "subject_pseudonym": pseudonym,
                "event_id": event_id,
                "event_name": event_name,
                "occurred_at": self._iso(event_time),
                "dimensions": normalized_dimensions,
            },
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
        )
        fingerprint = hashlib.sha256(canonical.encode("utf-8")).hexdigest()

        with self._connect() as conn:
            self._require_consent(conn, tenant_id, pseudonym)
            existing = conn.execute(
                "SELECT subject_pseudonym, event_fingerprint FROM analytics_events "
                "WHERE tenant_id = ? AND event_id = ?",
                (tenant_id, event_id),
            ).fetchone()
            if existing is not None:
                if existing[0] == pseudonym and hmac.compare_digest(existing[1], fingerprint):
                    return EventReceipt(event_id=event_id, subject_pseudonym=pseudonym, created=False)
                raise PrivacyAnalyticsError("conflicting analytics event replay")

            conn.execute(
                """
                INSERT INTO analytics_events
                    (tenant_id, subject_pseudonym, event_id, event_name,
                     occurred_at, dimensions_json, event_fingerprint)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    tenant_id,
                    pseudonym,
                    event_id,
                    event_name,
                    self._iso(event_time),
                    dimensions_json,
                    fingerprint,
                ),
            )
        return EventReceipt(event_id=event_id, subject_pseudonym=pseudonym, created=True)

    def purge_expired(self, *, now: datetime) -> int:
        current = self._utc(now, "purge timestamp")
        cutoff = current - timedelta(days=self.policy.retention_days)
        with self._connect() as conn:
            cursor = conn.execute(
                "DELETE FROM analytics_events WHERE occurred_at < ?",
                (self._iso(cutoff),),
            )
            return max(0, int(cursor.rowcount))

    def funnel(
        self,
        *,
        tenant_id: str,
        steps: Sequence[str],
        start: datetime,
        end: datetime,
    ) -> FunnelMetrics:
        tenant_id = self._validate_id(tenant_id, "tenant_id")
        normalized_steps = tuple(str(step) for step in steps)
        if not normalized_steps or any(step not in self.policy.allowed_events for step in normalized_steps):
            raise PrivacyAnalyticsError("funnel steps must be allowlisted events")
        if len(normalized_steps) != len(set(normalized_steps)):
            raise PrivacyAnalyticsError("funnel steps must be unique")
        start_utc = self._utc(start, "funnel start")
        end_utc = self._utc(end, "funnel end")
        if end_utc < start_utc:
            raise PrivacyAnalyticsError("funnel end precedes start")

        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT subject_pseudonym, event_name, occurred_at, event_id
                FROM analytics_events
                WHERE tenant_id = ? AND occurred_at >= ? AND occurred_at <= ?
                ORDER BY subject_pseudonym, occurred_at, event_id
                """,
                (tenant_id, self._iso(start_utc), self._iso(end_utc)),
            ).fetchall()

        per_subject: dict[str, list[tuple[str, datetime, str]]] = {}
        for pseudonym, event_name, occurred_at, event_id in rows:
            if event_name not in normalized_steps:
                continue
            event_time = datetime.fromisoformat(occurred_at).astimezone(UTC)
            per_subject.setdefault(pseudonym, []).append((event_name, event_time, event_id))

        step_counts = [0 for _ in normalized_steps]
        window = timedelta(hours=self.policy.funnel_window_hours)
        for events in per_subject.values():
            cursor_time: datetime | None = None
            first_time: datetime | None = None
            search_index = 0
            reached = 0
            for step in normalized_steps:
                match_time: datetime | None = None
                match_index: int | None = None
                for index in range(search_index, len(events)):
                    event_name, event_time, _event_id = events[index]
                    if event_name != step:
                        continue
                    if cursor_time is not None and event_time < cursor_time:
                        continue
                    candidate_first = first_time or event_time
                    if event_time - candidate_first > window:
                        continue
                    match_time = event_time
                    match_index = index
                    break
                if match_time is None or match_index is None:
                    break
                if first_time is None:
                    first_time = match_time
                cursor_time = match_time
                search_index = match_index + 1
                reached += 1
            for index in range(reached):
                step_counts[index] += 1

        entered = step_counts[0] if step_counts else 0
        completed = step_counts[-1] if step_counts else 0
        conversion_rate = (completed / entered) if entered else 0.0
        return FunnelMetrics(
            steps=normalized_steps,
            step_counts=tuple(step_counts),
            entered=entered,
            completed=completed,
            conversion_rate=conversion_rate,
        )
