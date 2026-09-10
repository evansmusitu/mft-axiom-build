from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
from threading import RLock
from typing import Any
import json

from .analysis import TwinState
from .core import FrontierSafetyError, atomic_write, parse_time, sha256


class TwinStateStore:
    """Append-only, tamper-evident persisted twin state history."""

    SCHEMA = "musitu.axiom.twin-state-store.v1"

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self._lock = RLock()
        self._records: list[dict[str, Any]] = []
        if self.path.exists():
            raw = json.loads(self.path.read_text(encoding="utf-8"))
            if raw.get("schema") != self.SCHEMA:
                raise FrontierSafetyError("unsupported twin store schema")
            self._records = list(raw.get("records", []))
            self.verify()

    def append(self, state: TwinState) -> str:
        with self._lock:
            body = asdict(state)
            state_hash = sha256(body)
            for record in self._records:
                if record["state_sha256"] == state_hash:
                    return state_hash
            envelope = {"sequence": len(self._records), "state": body,
                        "previous_sha256": self._records[-1]["record_sha256"] if self._records else None,
                        "state_sha256": state_hash}
            envelope["record_sha256"] = sha256(envelope)
            self._records.append(envelope)
            self._persist()
            return state_hash

    def _persist(self) -> None:
        atomic_write(self.path, json.dumps({"schema": self.SCHEMA, "records": self._records},
                                          sort_keys=True, separators=(",", ":"), default=str))

    def verify(self) -> bool:
        prev = None
        for i, record in enumerate(self._records):
            body = dict(record)
            actual = body.pop("record_sha256", None)
            if body.get("sequence") != i or body.get("previous_sha256") != prev:
                raise FrontierSafetyError("twin store sequence integrity failure")
            if sha256(body.get("state")) != body.get("state_sha256"):
                raise FrontierSafetyError("twin state content integrity failure")
            if sha256(body) != actual:
                raise FrontierSafetyError("twin store chain integrity failure")
            state = body.get("state", {})
            parse_time(state["as_of"])
            prev = actual
        return True

    def history(self, twin_id: str) -> list[dict[str, Any]]:
        with self._lock:
            return [dict(x) for x in self._records if x.get("state", {}).get("twin_id") == twin_id]

    def as_of(self, twin_id: str, at: str) -> dict[str, Any] | None:
        when = parse_time(at)
        candidates = [r for r in self.history(twin_id) if parse_time(r["state"]["as_of"]) <= when]
        if not candidates:
            return None
        return max(candidates, key=lambda r: parse_time(r["state"]["as_of"]))

    @property
    def fingerprint(self) -> str:
        self.verify()
        return sha256(self._records)
