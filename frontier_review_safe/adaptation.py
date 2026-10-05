from __future__ import annotations

from contextlib import contextmanager
from dataclasses import asdict
from pathlib import Path
from threading import RLock
from typing import Any, Iterator, Mapping
import json
import os

from .core import FrontierSafetyError, atomic_write, canonical, sha256
from .evaluation import AdaptationRelease


class PersistentContinualAdaptationRegistry:
    """Durable append-only registry for non-weight continual adaptation.

    Version 2 replaces the v1 full-file rewrite on every promotion with a
    hash-chained JSONL journal. Every acknowledged mutation is synchronized
    before returning. Restart state is derived by replaying the journal.
    Existing v1 snapshots remain readable and migrate atomically on the first
    successful mutation.
    """

    SCHEMA = "musitu.axiom.continual-adaptation-registry.v2"
    LEGACY_SCHEMA = "musitu.axiom.continual-adaptation-registry.v1"
    FORMAT = "append-only-jsonl-v1"

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self._lock = RLock()
        self.releases: dict[str, AdaptationRelease] = {}
        self.active_version: str | None = None
        self.transitions: list[dict[str, Any]] = []
        self._storage_format = "empty"
        self._file_signature: tuple[int, int] | None = None
        if self.path.exists():
            with self._file_lock():
                self._load()

    @staticmethod
    def _valid_hash(value: str | None) -> bool:
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

    @property
    def _lock_path(self) -> Path:
        return self.path.with_name(self.path.name + ".lock")

    @contextmanager
    def _file_lock(self) -> Iterator[None]:
        """Serialize writers across registry instances/processes."""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._lock_path.open("a+b") as handle:
            if os.name == "nt":
                import msvcrt
                handle.seek(0, os.SEEK_END)
                if handle.tell() == 0:
                    handle.write(b"\0")
                    handle.flush()
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
                try:
                    yield
                finally:
                    handle.seek(0)
                    msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
                try:
                    yield
                finally:
                    fcntl.flock(handle.fileno(), fcntl.LOCK_UN)

    def _stat_signature(self) -> tuple[int, int] | None:
        try:
            stat = self.path.stat()
        except FileNotFoundError:
            return None
        return (stat.st_size, stat.st_mtime_ns)

    def _refresh_if_changed_locked(self) -> None:
        signature = self._stat_signature()
        if signature == self._file_signature:
            return
        if signature is None:
            self.releases = {}
            self.active_version = None
            self.transitions = []
            self._storage_format = "empty"
            self._file_signature = None
            return
        self._load()

    def _load(self) -> None:
        try:
            text = self.path.read_text(encoding="utf-8")
        except (OSError, UnicodeError) as exc:
            raise FrontierSafetyError("continual adaptation registry cannot be read") from exc
        if not text:
            raise FrontierSafetyError("empty continual adaptation registry")

        # v1 was a single JSON object (pretty-printed or compact). v2 is JSONL,
        # so parsing the complete text cleanly distinguishes the formats.
        parsed_full: Any = None
        full_json = False
        try:
            parsed_full = json.loads(text)
            full_json = True
        except json.JSONDecodeError:
            pass
        if full_json:
            if not isinstance(parsed_full, Mapping):
                raise FrontierSafetyError("continual adaptation snapshot must be an object")
            self._load_legacy_snapshot(parsed_full)
        else:
            self._load_journal(text)
        self._file_signature = self._stat_signature()

    def _load_legacy_snapshot(self, raw: Mapping[str, Any]) -> None:
        if raw.get("schema") != self.LEGACY_SCHEMA:
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
        self._storage_format = "legacy-v1"
        self._verify_legacy_transitions()

    @classmethod
    def _journal_header(cls) -> dict[str, str]:
        return {"schema": cls.SCHEMA, "format": cls.FORMAT}

    def _load_journal(self, text: str) -> None:
        if not text.endswith("\n"):
            raise FrontierSafetyError("continual adaptation journal has an incomplete trailing record")
        lines = text.splitlines()
        if not lines:
            raise FrontierSafetyError("continual adaptation journal missing header")
        try:
            header = json.loads(lines[0])
        except json.JSONDecodeError as exc:
            raise FrontierSafetyError("malformed continual adaptation journal header") from exc
        if header != self._journal_header():
            raise FrontierSafetyError("unsupported continual adaptation journal header")

        self.releases = {}
        self.active_version = None
        self.transitions = []
        previous: str | None = None
        for index, line in enumerate(lines[1:]):
            if not line:
                raise FrontierSafetyError("blank continual adaptation journal record")
            try:
                record = json.loads(line)
            except json.JSONDecodeError as exc:
                raise FrontierSafetyError("malformed continual adaptation journal record") from exc
            if not isinstance(record, Mapping):
                raise FrontierSafetyError("continual adaptation journal record must be an object")
            body = dict(record)
            actual = body.pop("record_sha256", None)
            if (
                body.get("sequence") != index
                or body.get("previous_sha256") != previous
                or not self._valid_hash(actual)
                or sha256(body) != actual
            ):
                raise FrontierSafetyError("continual adaptation journal integrity failure")
            self._replay_record(body, actual)
            previous = actual
        self._storage_format = "journal-v2"
        self._verify_journal_transitions()

    def _replay_record(self, body: Mapping[str, Any], record_sha256: str) -> None:
        kind = body.get("kind")
        version = body.get("version")
        from_version = body.get("from_version")
        to_version = body.get("to_version")
        release_data = body.get("release")

        if kind == "PROMOTE":
            if not isinstance(release_data, Mapping):
                raise FrontierSafetyError("promotion journal record missing release")
            release = AdaptationRelease(**dict(release_data))
            self._validate_release(release)
            if (
                release.version != version
                or version in self.releases
                or release.parent_version != self.active_version
                or from_version != self.active_version
                or to_version != version
            ):
                raise FrontierSafetyError("continual adaptation promotion replay failure")
            self.releases[version] = release
            self.active_version = version
        elif kind == "ROLLBACK":
            if release_data is not None:
                raise FrontierSafetyError("rollback journal record cannot contain a release")
            if (
                self.active_version != from_version
                or version != from_version
                or to_version not in self.releases
            ):
                raise FrontierSafetyError("continual adaptation rollback replay failure")
            self.active_version = to_version
        else:
            raise FrontierSafetyError("unknown continual adaptation journal event")

        self.transitions.append({
            "sequence": body["sequence"],
            "kind": kind,
            "version": version,
            "from_version": from_version,
            "to_version": to_version,
            "previous_sha256": body.get("previous_sha256"),
            "transition_sha256": record_sha256,
        })

    def _verify_legacy_transitions(self) -> bool:
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
        if set(self.releases) != promoted or self.active_version != active:
            raise FrontierSafetyError("persisted continual adaptation state does not match replay")
        return True

    def _verify_journal_transitions(self) -> bool:
        previous = None
        active: str | None = None
        promoted: set[str] = set()
        for index, transition in enumerate(self.transitions):
            kind = transition.get("kind")
            version = transition.get("version")
            release = self.releases.get(version) if kind == "PROMOTE" else None
            body = {
                "sequence": index,
                "kind": kind,
                "version": version,
                "from_version": transition.get("from_version"),
                "to_version": transition.get("to_version"),
                "release": asdict(release) if release is not None else None,
                "previous_sha256": previous,
            }
            actual = transition.get("transition_sha256")
            if (
                transition.get("sequence") != index
                or transition.get("previous_sha256") != previous
                or not self._valid_hash(actual)
                or sha256(body) != actual
            ):
                raise FrontierSafetyError("continual adaptation journal transition integrity failure")
            if kind == "PROMOTE":
                if (
                    release is None
                    or version in promoted
                    or release.parent_version != active
                    or body["from_version"] != active
                    or body["to_version"] != version
                ):
                    raise FrontierSafetyError("continual adaptation promotion replay failure")
                promoted.add(version)
                active = version
            elif kind == "ROLLBACK":
                if (
                    active != body["from_version"]
                    or body["to_version"] not in promoted
                    or version != body["from_version"]
                ):
                    raise FrontierSafetyError("continual adaptation rollback replay failure")
                active = body["to_version"]
            else:
                raise FrontierSafetyError("unknown continual adaptation transition")
            previous = actual
        if set(self.releases) != promoted or self.active_version != active:
            raise FrontierSafetyError("persisted continual adaptation state does not match replay")
        return True

    def verify(self) -> bool:
        with self._lock:
            if self._storage_format == "legacy-v1":
                return self._verify_legacy_transitions()
            return self._verify_journal_transitions()

    def _record_body(
        self,
        *,
        kind: str,
        version: str,
        from_version: str | None,
        to_version: str | None,
        release: AdaptationRelease | None,
    ) -> dict[str, Any]:
        return {
            "sequence": len(self.transitions),
            "kind": kind,
            "version": version,
            "from_version": from_version,
            "to_version": to_version,
            "release": asdict(release) if release is not None else None,
            "previous_sha256": self.transitions[-1]["transition_sha256"] if self.transitions else None,
        }

    def _sync_parent_directory(self) -> None:
        if os.name == "nt" or not hasattr(os, "O_DIRECTORY"):
            return
        fd = os.open(self.path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

    def _append_record_locked(self, body: Mapping[str, Any]) -> str:
        created = self._storage_format == "empty"
        record = dict(body)
        record_sha256 = sha256(record)
        record["record_sha256"] = record_sha256
        header = canonical(self._journal_header()) + "\n" if created else ""
        payload = (header + canonical(record) + "\n").encode("utf-8")
        try:
            with self.path.open("ab", buffering=0) as raw:
                raw.write(payload)
                if hasattr(os, "fdatasync"):
                    os.fdatasync(raw.fileno())
                else:
                    os.fsync(raw.fileno())
            if created:
                self._sync_parent_directory()
        except OSError as exc:
            raise FrontierSafetyError("continual adaptation journal append failed") from exc
        self._storage_format = "journal-v2"
        self._file_signature = self._stat_signature()
        return record_sha256

    def _migrate_legacy_locked(self) -> None:
        self._verify_legacy_transitions()
        previous = None
        lines = [canonical(self._journal_header())]
        for transition in self.transitions:
            version = transition["version"]
            body = {
                "sequence": transition["sequence"],
                "kind": transition["kind"],
                "version": version,
                "from_version": transition.get("from_version"),
                "to_version": transition.get("to_version"),
                "release": asdict(self.releases[version]) if transition["kind"] == "PROMOTE" else None,
                "previous_sha256": previous,
            }
            record_sha256 = sha256(body)
            lines.append(canonical({**body, "record_sha256": record_sha256}))
            previous = record_sha256
        atomic_write(self.path, "\n".join(lines) + "\n")
        self._sync_parent_directory()
        self._load_journal(self.path.read_text(encoding="utf-8"))
        self._file_signature = self._stat_signature()

    def promote(self, release: AdaptationRelease, *, regression_pass: bool) -> str:
        with self._lock:
            self._validate_release(release)
            if not regression_pass:
                raise FrontierSafetyError("adaptation promotion blocked by regression gate")
            with self._file_lock():
                self._refresh_if_changed_locked()
                if self._storage_format == "legacy-v1":
                    self._migrate_legacy_locked()
                old = self.releases.get(release.version)
                if old is not None:
                    if old == release and self.active_version == release.version:
                        return release.version
                    raise FrontierSafetyError("adaptation version collision")
                if release.parent_version != self.active_version:
                    raise FrontierSafetyError("adaptation parent is not active version")

                previous_active = self.active_version
                body = self._record_body(
                    kind="PROMOTE",
                    version=release.version,
                    from_version=previous_active,
                    to_version=release.version,
                    release=release,
                )
                record_sha256 = self._append_record_locked(body)
                self.releases[release.version] = release
                self.active_version = release.version
                self.transitions.append({
                    "sequence": body["sequence"],
                    "kind": "PROMOTE",
                    "version": release.version,
                    "from_version": previous_active,
                    "to_version": release.version,
                    "previous_sha256": body["previous_sha256"],
                    "transition_sha256": record_sha256,
                })
                return release.version

    def rollback(self) -> str:
        with self._lock:
            with self._file_lock():
                self._refresh_if_changed_locked()
                if self._storage_format == "legacy-v1":
                    self._migrate_legacy_locked()
                if self.active_version is None:
                    raise FrontierSafetyError("no active adaptation")
                current = self.releases[self.active_version]
                target = current.rollback_to or current.parent_version
                if target is None or target not in self.releases:
                    raise FrontierSafetyError("no valid rollback target")
                previous_active = self.active_version
                body = self._record_body(
                    kind="ROLLBACK",
                    version=previous_active,
                    from_version=previous_active,
                    to_version=target,
                    release=None,
                )
                record_sha256 = self._append_record_locked(body)
                self.active_version = target
                self.transitions.append({
                    "sequence": body["sequence"],
                    "kind": "ROLLBACK",
                    "version": previous_active,
                    "from_version": previous_active,
                    "to_version": target,
                    "previous_sha256": body["previous_sha256"],
                    "transition_sha256": record_sha256,
                })
                return target

    @property
    def fingerprint(self) -> str:
        with self._lock:
            self.verify()
            return sha256({
                "schema": self.SCHEMA,
                "releases": [asdict(self.releases[k]) for k in sorted(self.releases)],
                "active_version": self.active_version,
                "transitions": self.transitions,
            })
