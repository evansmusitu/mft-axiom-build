"""Governed permanent failure corpus for MUSITU Axiom Frontier v5.

DEF-008 turns material failures into immutable, normalized regression records.
Each record carries an integrity digest, deterministic recurrence identity,
root-cause and generalized-test linkage, and explicit closure evidence. Fixed
failures can be replayed from the corpus so historical regressions cannot be
silently dropped from verification.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, replace
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
from typing import Iterable


class FailureCorpusError(RuntimeError):
    """Raised when failure-corpus governance or integrity validation fails."""


_SHA40 = re.compile(r"^[0-9a-f]{40}$")
_SHA64 = re.compile(r"^[0-9a-f]{64}$")
_FAILURE_ID = re.compile(r"^[A-Z0-9][A-Z0-9._-]{4,127}$")
_MARKER = re.compile(r"^MUSITU_AXIOM_[A-Z0-9_]{4,192}$")
_ALLOWED_STATUS = frozenset({"open", "fixed"})


def _canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _sha256(value: object) -> str:
    return hashlib.sha256(_canonical(value)).hexdigest()


def _clean_text(value: object, field: str, *, maximum: int = 4096) -> str:
    text = " ".join(str(value).split())
    if not text:
        raise FailureCorpusError(f"{field} is required")
    if len(text) > maximum:
        raise FailureCorpusError(f"{field} exceeds length limit")
    return text


def _validate_time(value: str) -> str:
    text = _clean_text(value, "occurred_at", maximum=80)
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as exc:
        raise FailureCorpusError("occurred_at must be ISO-8601") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise FailureCorpusError("occurred_at must be timezone-aware")
    return text


def _validate_sha40(value: str, field: str) -> str:
    text = str(value).strip()
    if not _SHA40.fullmatch(text):
        raise FailureCorpusError(f"{field} must be a 40-character lowercase git SHA")
    return text


def _validate_test_path(value: str) -> str:
    text = str(value).replace("\\", "/").strip()
    path = PurePosixPath(text)
    if path.is_absolute() or not text.startswith("frontier_v5/tests/") or path.suffix != ".py":
        raise FailureCorpusError("generalized_test must be a Python test under frontier_v5/tests")
    if any(part in {"", ".", ".."} for part in path.parts):
        raise FailureCorpusError("generalized_test path traversal prohibited")
    return path.as_posix()


def _recurrence_key(category: str, root_cause: str, generalized_test: str, pass_marker: str) -> str:
    normalized = {
        "category": category.casefold(),
        "root_cause": " ".join(root_cause.casefold().split()),
        "generalized_test": generalized_test,
        "pass_marker": pass_marker,
    }
    return _sha256(normalized)


@dataclass(frozen=True)
class FailureRecord:
    failure_id: str
    occurred_at: str
    category: str
    source_kind: str
    source_ref: str
    summary: str
    root_cause: str
    generalized_test: str
    pass_marker: str
    introduced_version: str
    status: str
    fixed_version: str | None
    resolution_ref: str | None
    recurrence_key: str
    recurs_from: str | None
    record_sha256: str

    def unsigned(self) -> dict[str, object]:
        data = asdict(self)
        data.pop("record_sha256", None)
        return data


class FailureCorpus:
    """Persistent normalized failure registry with executable regressions."""

    SCHEMA_VERSION = "1.0"

    def __init__(self, path: Path, records: Iterable[FailureRecord], schema_version: str = SCHEMA_VERSION) -> None:
        self.path = Path(path)
        self.schema_version = str(schema_version)
        self.records = tuple(records)
        self._validate_state()

    @classmethod
    def create(cls, path: str | Path) -> "FailureCorpus":
        corpus = cls(Path(path), ())
        corpus._write()
        return corpus

    @classmethod
    def load(cls, path: str | Path) -> "FailureCorpus":
        target = Path(path)
        try:
            raw = json.loads(target.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise FailureCorpusError("failure corpus is unreadable") from exc
        if not isinstance(raw, dict):
            raise FailureCorpusError("failure corpus root must be an object")
        if set(raw) != {"schema_version", "records"}:
            raise FailureCorpusError("failure corpus contains unknown or missing top-level fields")
        if raw.get("schema_version") != cls.SCHEMA_VERSION:
            raise FailureCorpusError("unsupported failure corpus schema_version")
        rows = raw.get("records")
        if not isinstance(rows, list):
            raise FailureCorpusError("failure corpus records must be a list")
        records = tuple(cls._record_from_mapping(row) for row in rows)
        return cls(target, records, raw["schema_version"])

    @staticmethod
    def _record_from_mapping(raw: object) -> FailureRecord:
        if not isinstance(raw, dict):
            raise FailureCorpusError("failure record must be an object")
        required = {field.name for field in FailureRecord.__dataclass_fields__.values()}
        if set(raw) != required:
            raise FailureCorpusError("failure record contains unknown or missing fields")
        try:
            record = FailureRecord(**raw)
        except TypeError as exc:
            raise FailureCorpusError("failure record schema is invalid") from exc
        FailureCorpus._validate_record(record, verify_integrity=True)
        return record

    @staticmethod
    def _validate_record(record: FailureRecord, *, verify_integrity: bool) -> None:
        if not _FAILURE_ID.fullmatch(record.failure_id):
            raise FailureCorpusError("failure_id format is invalid")
        _validate_time(record.occurred_at)
        _clean_text(record.category, "category", maximum=80)
        _clean_text(record.source_kind, "source_kind", maximum=80)
        _clean_text(record.source_ref, "source_ref", maximum=512)
        _clean_text(record.summary, "summary")
        _clean_text(record.root_cause, "root_cause")
        test_path = _validate_test_path(record.generalized_test)
        if not _MARKER.fullmatch(record.pass_marker):
            raise FailureCorpusError("pass_marker format is invalid")
        _validate_sha40(record.introduced_version, "introduced_version")
        if record.status not in _ALLOWED_STATUS:
            raise FailureCorpusError("failure status is invalid")
        if not _SHA64.fullmatch(record.recurrence_key):
            raise FailureCorpusError("recurrence_key format is invalid")
        expected_key = _recurrence_key(record.category, record.root_cause, test_path, record.pass_marker)
        if record.recurrence_key != expected_key:
            raise FailureCorpusError("failure recurrence identity mismatch")
        if record.recurs_from is not None and not _FAILURE_ID.fullmatch(record.recurs_from):
            raise FailureCorpusError("recurs_from format is invalid")
        if record.status == "open":
            if record.fixed_version is not None or record.resolution_ref is not None:
                raise FailureCorpusError("open failure cannot contain closure evidence")
        else:
            if record.fixed_version is None:
                raise FailureCorpusError("fixed failure requires fixed_version")
            _validate_sha40(record.fixed_version, "fixed_version")
            if record.resolution_ref is None:
                raise FailureCorpusError("fixed failure requires resolution_ref")
            _clean_text(record.resolution_ref, "resolution_ref", maximum=512)
        if not _SHA64.fullmatch(record.record_sha256):
            raise FailureCorpusError("record_sha256 format is invalid")
        if verify_integrity and record.record_sha256 != _sha256(record.unsigned()):
            raise FailureCorpusError("failure record integrity mismatch")

    def _validate_state(self) -> None:
        if self.schema_version != self.SCHEMA_VERSION:
            raise FailureCorpusError("unsupported failure corpus schema_version")
        ids: dict[str, FailureRecord] = {}
        previous_by_key: dict[str, FailureRecord] = {}
        for record in self.records:
            self._validate_record(record, verify_integrity=True)
            if record.failure_id in ids:
                raise FailureCorpusError("duplicate failure_id")
            if record.recurs_from is not None:
                prior = ids.get(record.recurs_from)
                if prior is None:
                    raise FailureCorpusError("recurs_from must reference an earlier failure record")
                if prior.recurrence_key != record.recurrence_key:
                    raise FailureCorpusError("recurs_from recurrence identity mismatch")
            elif record.recurrence_key in previous_by_key:
                raise FailureCorpusError("recurring failure requires recurs_from lineage")
            ids[record.failure_id] = record
            previous_by_key[record.recurrence_key] = record

    def _write(self) -> None:
        self._validate_state()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "schema_version": self.schema_version,
            "records": [asdict(record) for record in self.records],
        }
        text = json.dumps(payload, sort_keys=True, indent=2, ensure_ascii=False) + "\n"
        tmp = self.path.with_name(self.path.name + ".tmp")
        try:
            tmp.write_text(text, encoding="utf-8")
            os.replace(tmp, self.path)
        except OSError as exc:
            try:
                tmp.unlink(missing_ok=True)
            except OSError:
                pass
            raise FailureCorpusError("failure corpus write failed") from exc

    def by_id(self, failure_id: str) -> FailureRecord:
        for record in self.records:
            if record.failure_id == failure_id:
                return record
        raise FailureCorpusError("failure_id not found")

    def record_failure(
        self,
        *,
        failure_id: str,
        occurred_at: str,
        category: str,
        source_kind: str,
        source_ref: str,
        summary: str,
        root_cause: str,
        generalized_test: str,
        pass_marker: str,
        introduced_version: str,
        recurs_from: str | None = None,
    ) -> FailureRecord:
        if any(record.failure_id == failure_id for record in self.records):
            raise FailureCorpusError("duplicate failure_id")
        failure_id = str(failure_id).strip()
        occurred_at = _validate_time(occurred_at)
        category = _clean_text(category, "category", maximum=80)
        source_kind = _clean_text(source_kind, "source_kind", maximum=80)
        source_ref = _clean_text(source_ref, "source_ref", maximum=512)
        summary = _clean_text(summary, "summary")
        root_cause = _clean_text(root_cause, "root_cause")
        generalized_test = _validate_test_path(generalized_test)
        pass_marker = str(pass_marker).strip()
        if not _MARKER.fullmatch(pass_marker):
            raise FailureCorpusError("pass_marker format is invalid")
        introduced_version = _validate_sha40(introduced_version, "introduced_version")
        key = _recurrence_key(category, root_cause, generalized_test, pass_marker)

        matching = [record for record in self.records if record.recurrence_key == key]
        if matching:
            if recurs_from is None:
                raise FailureCorpusError("recurring failure requires recurs_from")
            if not any(record.failure_id == recurs_from for record in matching):
                raise FailureCorpusError("recurs_from must reference a matching recurrence")
        elif recurs_from is not None:
            raise FailureCorpusError("recurs_from provided but no matching prior failure exists")

        unsigned = {
            "failure_id": failure_id,
            "occurred_at": occurred_at,
            "category": category,
            "source_kind": source_kind,
            "source_ref": source_ref,
            "summary": summary,
            "root_cause": root_cause,
            "generalized_test": generalized_test,
            "pass_marker": pass_marker,
            "introduced_version": introduced_version,
            "status": "open",
            "fixed_version": None,
            "resolution_ref": None,
            "recurrence_key": key,
            "recurs_from": recurs_from,
        }
        record = FailureRecord(**unsigned, record_sha256=_sha256(unsigned))
        self._validate_record(record, verify_integrity=True)
        self.records = (*self.records, record)
        self._write()
        return record

    def close_failure(self, failure_id: str, *, fixed_version: str, resolution_ref: str) -> FailureRecord:
        fixed_version = _validate_sha40(fixed_version, "fixed_version")
        resolution_ref = _clean_text(resolution_ref, "resolution_ref", maximum=512)
        updated: list[FailureRecord] = []
        closed: FailureRecord | None = None
        for record in self.records:
            if record.failure_id != failure_id:
                updated.append(record)
                continue
            if record.status != "open":
                raise FailureCorpusError("failure is already fixed")
            candidate = replace(
                record,
                status="fixed",
                fixed_version=fixed_version,
                resolution_ref=resolution_ref,
                record_sha256="0" * 64,
            )
            candidate = replace(candidate, record_sha256=_sha256(candidate.unsigned()))
            self._validate_record(candidate, verify_integrity=True)
            updated.append(candidate)
            closed = candidate
        if closed is None:
            raise FailureCorpusError("failure_id not found")
        self.records = tuple(updated)
        self._write()
        return closed

    def verify_regressions(self, repo_root: str | Path, *, timeout_seconds: int = 120) -> dict[str, str]:
        root = Path(repo_root).resolve()
        if not root.is_dir():
            raise FailureCorpusError("repository root is invalid")
        by_test: dict[str, set[str]] = {}
        for record in self.records:
            if record.status != "fixed":
                continue
            by_test.setdefault(record.generalized_test, set()).add(record.pass_marker)

        results: dict[str, str] = {}
        for relative, expected_markers in sorted(by_test.items()):
            if len(expected_markers) != 1:
                raise FailureCorpusError("one generalized test cannot have conflicting pass markers")
            expected = next(iter(expected_markers))
            test_path = (root / relative).resolve()
            try:
                test_path.relative_to(root)
            except ValueError as exc:
                raise FailureCorpusError("generalized regression path escapes repository") from exc
            if not test_path.is_file():
                raise FailureCorpusError(f"generalized regression test missing: {relative}")
            env = os.environ.copy()
            existing = env.get("PYTHONPATH")
            env["PYTHONPATH"] = str(root) if not existing else str(root) + os.pathsep + existing
            try:
                proc = subprocess.run(
                    [sys.executable, str(test_path)],
                    cwd=root,
                    env=env,
                    capture_output=True,
                    text=True,
                    timeout=int(timeout_seconds),
                    shell=False,
                    check=False,
                )
            except (OSError, subprocess.TimeoutExpired) as exc:
                raise FailureCorpusError(f"generalized regression execution failed: {relative}") from exc
            combined = proc.stdout + "\n" + proc.stderr
            if proc.returncode != 0:
                raise FailureCorpusError(f"historical regression recurred: {relative}")
            if expected not in combined:
                raise FailureCorpusError(f"generalized regression pass marker missing: {relative}")
            results[relative] = expected
        return results


__all__ = ["FailureCorpus", "FailureCorpusError", "FailureRecord"]
