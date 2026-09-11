from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
from threading import RLock
from typing import Any
import json

from .core import FrontierSafetyError, atomic_write, canonical, sha256
from .evaluation import AdaptationRelease


class PersistentContinualAdaptationRegistry:
    """Durable, replay-verified registry for non-weight continual adaptation.

    This stores verified failure-corpus/calibration/routing/evaluation releases
    and rollback state. It deliberately does not represent persisted memory as
    model-weight continual learning.
    """

    SCHEMA = "musitu.axiom.continual-adaptation-registry.v1"

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self._lock = RLock()
        self.releases: dict[str, AdaptationRelease] = {}
        self.active_version: str | None = None
        self.transitions: list[dict[str, Any]] = []
        if self.path.exists():
            self._load()

    @staticmethod
    def _valid_hash(value: str) -> bool:
        return (
            isinstance(value, str)
            and len(value) == 64
            and all(c in "0123456789abcdef" for c in value.lower())
        )

    @classmethod
    def _validate_release(cls, release: AdaptationRelease) -> None:
        if not release.version:
            raise ValueError("adaptation release version required")
        hashes = (
            release.failure_corpus_hash,
            release.calibration_hash,
            release.routing_policy_hash,
            release.eval_hash,
        )
        if any(not cls._valid_hash(value) for value in hashes):
            raise ValueError("adaptation release evidence hashes must be SHA-256")
        if release.parent_version == release.version:
            raise ValueError("adaptation cannot parent itself")
        if release.rollback_to == release.version:
            raise ValueError("adaptation cannot roll back to itself")

    def _append_transition(
        self,
        kind: str,
        version: str,
        from_version: str | None,
        to_version: str | None,
    ) -> None:
        body = {
            "sequence": len(self.transitions),
            "kind": kind,
            "version": version,
            "from_version": from_version,
            "to_version": to_version,
            "previous_sha256": self.transitions[-1]["transition_sha256"] if self.transitions else None,
        }
        body["transition_sha256"] = sha256(body)
        self.transitions.append(body)

    def _persist(self) -> None:
        payload = {
            "schema": self.SCHEMA,
            "releases": [asdict(self.releases[k]) for k in sorted(self.releases)],
            "active_version": self.active_version,
            "transitions": self.transitions,
        }
        atomic_write(self.path, canonical(payload))

    def _load(self) -> None:
        raw = json.loads(self.path.read_text(encoding="utf-8"))
        if raw.get("schema") != self.SCHEMA:
            raise FrontierSafetyError("unsupported continual adaptation schema")
        self.releases = {}
        for item in raw.get("releases", []):
            release = AdaptationRelease(**item)
            self._validate_release(release)
            if release.version in self.releases:
                raise FrontierSafetyError("duplicate persisted adaptation version")
            self.releases[release.version] = release
        self.active_version = raw.get("active_version")
        self.transitions = list(raw.get("transitions", []))
        self.verify()

    def verify(self) -> bool:
        with self._lock:
            previous = None
            active: str | None = None
            promoted: set[str] = set()
            for index, transition in enumerate(self.transitions):
                body = dict(transition)
                actual = body.pop("transition_sha256", None)
                if (
                    body.get("sequence") != index
                    or body.get("previous_sha256") != previous
                    or sha256(body) != actual
                ):
                    raise FrontierSafetyError("continual adaptation transition integrity failure")

                kind = body.get("kind")
                version = body.get("version")
                if kind == "PROMOTE":
                    release = self.releases.get(version)
                    if (
                        release is None
                        or version in promoted
                        or release.parent_version != active
                        or body.get("from_version") != active
                        or body.get("to_version") != version
                    ):
                        raise FrontierSafetyError("continual adaptation promotion replay failure")
                    promoted.add(version)
                    active = version
                elif kind == "ROLLBACK":
                    if (
                        active != body.get("from_version")
                        or body.get("to_version") not in promoted
                        or version != body.get("from_version")
                    ):
                        raise FrontierSafetyError("continual adaptation rollback replay failure")
                    active = body.get("to_version")
                else:
                    raise FrontierSafetyError("unknown continual adaptation transition")
                previous = actual

            if set(self.releases) != promoted:
                raise FrontierSafetyError("persisted adaptation releases do not match transition history")
            if self.active_version != active:
                raise FrontierSafetyError("persisted active adaptation does not match replayed state")
            return True

    def promote(self, release: AdaptationRelease, *, regression_pass: bool) -> str:
        with self._lock:
            self._validate_release(release)
            if not regression_pass:
                raise FrontierSafetyError("adaptation promotion blocked by regression gate")
            old = self.releases.get(release.version)
            if old is not None:
                if old == release and self.active_version == release.version:
                    return release.version
                raise FrontierSafetyError("adaptation version collision")
            if release.parent_version != self.active_version:
                raise FrontierSafetyError("adaptation parent is not active version")

            previous_active = self.active_version
            self.releases[release.version] = release
            self.active_version = release.version
            self._append_transition("PROMOTE", release.version, previous_active, release.version)
            self.verify()
            self._persist()
            return release.version

    def rollback(self) -> str:
        with self._lock:
            if self.active_version is None:
                raise FrontierSafetyError("no active adaptation")
            current = self.releases[self.active_version]
            target = current.rollback_to or current.parent_version
            if target is None or target not in self.releases:
                raise FrontierSafetyError("no valid rollback target")
            previous_active = self.active_version
            self.active_version = target
            self._append_transition("ROLLBACK", previous_active, previous_active, target)
            self.verify()
            self._persist()
            return target

    @property
    def fingerprint(self) -> str:
        self.verify()
        return sha256({
            "schema": self.SCHEMA,
            "releases": [asdict(self.releases[k]) for k in sorted(self.releases)],
            "active_version": self.active_version,
            "transitions": self.transitions,
        })
