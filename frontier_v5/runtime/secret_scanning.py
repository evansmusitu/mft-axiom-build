"""Deterministic SEC-015 secret scanning for source, artifacts, and logs.

This module intentionally performs no network calls and reads no credential store.
It detects credential-shaped material in supplied text/trees, emits only redacted
findings, and permits only exact SHA-256 fingerprint suppressions with justification.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
from pathlib import Path
import re
from typing import Mapping

_HEX64 = re.compile(r"^[0-9a-f]{64}$")
_PRIVATE_KEY = re.compile(
    r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?"
    r"-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----",
    re.IGNORECASE,
)
_CREDENTIAL = re.compile(
    r"(?ix)"
    r"\b(?:api[_-]?key|service[_-]?password|password|auth\s+token|auth[_-]?token|"
    r"access[_-]?token|bearer[_-]?token|client[_-]?secret|secret[_-]?key|private[_-]?key)\b"
    r"\s*[:=]\s*"
    r"(?:[\"'](?P<quoted>[^\"'\r\n]{20,})[\"']|(?P<bare>[A-Za-z0-9_./+=:-]{20,}))"
)
_SOURCE_CONCAT_EXPRESSION = re.compile(
    r"^\+\s*[A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*\s*=)?$"
)
_SKIP_DIRS = frozenset({".git", ".venv", "venv", "__pycache__", ".pytest_cache", "node_modules"})
_MAX_FILE_BYTES = 2 * 1024 * 1024


@dataclass(frozen=True)
class SecretFinding:
    rule_id: str
    source: str
    line: int
    fingerprint: str
    redacted: str

    def to_dict(self) -> dict[str, object]:
        return {
            "rule_id": self.rule_id,
            "source": self.source,
            "line": self.line,
            "fingerprint": self.fingerprint,
            "redacted": self.redacted,
        }


@dataclass(frozen=True)
class SecretScanReport:
    findings: tuple[SecretFinding, ...]
    suppressed_count: int = 0
    scanned_files: int = 0

    @property
    def clean(self) -> bool:
        return not self.findings

    def to_dict(self) -> dict[str, object]:
        return {
            "clean": self.clean,
            "findings": [finding.to_dict() for finding in self.findings],
            "suppressed_count": self.suppressed_count,
            "scanned_files": self.scanned_files,
        }


class SecretScanner:
    """Fail-closed credential-pattern scanner with non-disclosing evidence."""

    def __init__(self, suppressions: Mapping[str, str] | None = None) -> None:
        self._suppressions: dict[str, str] = {}
        for fingerprint, justification in dict(suppressions or {}).items():
            normalized = str(fingerprint).lower()
            if not _HEX64.fullmatch(normalized):
                raise ValueError("secret-scan suppressions require an exact SHA-256 fingerprint")
            if len(str(justification).strip()) < 12:
                raise ValueError("secret-scan suppression requires a substantive justification")
            self._suppressions[normalized] = str(justification).strip()

    @staticmethod
    def _fingerprint(secret: str) -> str:
        return hashlib.sha256(secret.encode("utf-8")).hexdigest()

    @staticmethod
    def _redacted(rule_id: str, fingerprint: str) -> str:
        return f"<redacted:{rule_id}:sha256:{fingerprint[:12]}>"

    @staticmethod
    def _line(text: str, offset: int) -> int:
        return text.count("\n", 0, offset) + 1

    @staticmethod
    def _looks_runtime_reference(value: str, *, kind: str) -> bool:
        stripped = value.strip()
        lowered = stripped.lower()
        return (
            stripped.startswith("${{")
            or stripped.startswith("${")
            or "os.environ" in lowered
            or "process.env" in lowered
            or stripped.startswith("env:")
            or (kind == "source" and _SOURCE_CONCAT_EXPRESSION.fullmatch(stripped) is not None)
        )

    def _finding(self, *, rule_id: str, source: str, line: int, secret: str) -> tuple[SecretFinding | None, int]:
        fingerprint = self._fingerprint(secret)
        if fingerprint in self._suppressions:
            return None, 1
        return (
            SecretFinding(
                rule_id=rule_id,
                source=source,
                line=line,
                fingerprint=fingerprint,
                redacted=self._redacted(rule_id, fingerprint),
            ),
            0,
        )

    def scan_text(self, text: str, *, source: str, kind: str) -> SecretScanReport:
        if kind not in {"source", "artifact", "log"}:
            raise ValueError("kind must be source, artifact, or log")

        findings: list[SecretFinding] = []
        suppressed = 0
        occupied: list[tuple[int, int]] = []

        for match in _PRIVATE_KEY.finditer(text):
            secret = match.group(0)
            finding, count = self._finding(
                rule_id="private-key",
                source=source,
                line=self._line(text, match.start()),
                secret=secret,
            )
            suppressed += count
            if finding is not None:
                findings.append(finding)
            occupied.append(match.span())

        for match in _CREDENTIAL.finditer(text):
            if any(start <= match.start() < end for start, end in occupied):
                continue
            secret = match.group("quoted") or match.group("bare") or ""
            if self._looks_runtime_reference(secret, kind=kind):
                continue
            finding, count = self._finding(
                rule_id="credential-assignment",
                source=source,
                line=self._line(text, match.start()),
                secret=secret,
            )
            suppressed += count
            if finding is not None:
                findings.append(finding)

        findings.sort(key=lambda item: (item.source, item.line, item.rule_id, item.fingerprint))
        return SecretScanReport(tuple(findings), suppressed_count=suppressed, scanned_files=1)

    @staticmethod
    def _kind_for(path: Path) -> str:
        name = path.name.lower()
        suffix = path.suffix.lower()
        if suffix in {".log", ".out", ".trace"} or name.endswith(".log.txt"):
            return "log"
        if suffix in {".zip", ".tar", ".gz", ".tgz", ".whl", ".artifact"}:
            return "artifact"
        return "source"

    def scan_tree(self, root: str | Path) -> SecretScanReport:
        base = Path(root).resolve()
        if not base.exists() or not base.is_dir():
            raise ValueError("scan_tree root must be an existing directory")

        findings: list[SecretFinding] = []
        suppressed = 0
        scanned = 0

        for path in sorted(base.rglob("*")):
            if not path.is_file():
                continue
            try:
                relative_parts = path.relative_to(base).parts
            except ValueError:
                continue
            if any(part in _SKIP_DIRS for part in relative_parts):
                continue
            try:
                if path.stat().st_size > _MAX_FILE_BYTES:
                    continue
                raw = path.read_bytes()
            except (OSError, PermissionError):
                continue
            if b"\x00" in raw:
                continue
            try:
                text = raw.decode("utf-8")
            except UnicodeDecodeError:
                continue

            relative = path.relative_to(base).as_posix()
            report = self.scan_text(text, source=relative, kind=self._kind_for(path))
            findings.extend(report.findings)
            suppressed += report.suppressed_count
            scanned += 1

        findings.sort(key=lambda item: (item.source, item.line, item.rule_id, item.fingerprint))
        return SecretScanReport(tuple(findings), suppressed_count=suppressed, scanned_files=scanned)
