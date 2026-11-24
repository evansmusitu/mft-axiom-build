"""Deterministic SEC-015 secret scanning for source, artifacts, and logs.

This module intentionally performs no network calls and reads no credential store.
It detects credential-shaped material in supplied text/trees, emits only redacted
findings, and permits only exact SHA-256 fingerprint suppressions with justification.

Report fingerprints are HMAC-SHA256 values keyed by a random per-scan key, so a
report never contains a value-derived hash that could be brute-forced offline or
correlated across scans. Suppressions name the SHA-256 of the exact approved
fixture value (``SecretScanner.suppression_fingerprint``); that hash is compared
internally and never emitted.

Files that cannot be scanned (binary, non-UTF-8, oversized, unreadable) are
listed in ``SecretScanReport.skipped`` and make the report not clean.

Scope note: raw numeric key parameters, such as the labelled fixture-only RSA
integers in ``frontier_v5/tests/test_oidc_contract.py``, are not detected. No
pattern separates them from ordinary large integers or digests without heavy
false positives; such fixtures must stay labelled and never be deployed.
"""
from __future__ import annotations

from bisect import bisect_right, insort
from dataclasses import dataclass
import hashlib
import hmac
from pathlib import Path
import re
import secrets
from typing import Mapping

_HEX64 = re.compile(r"^[0-9a-f]{64}$")
# BEGIN/END markers are matched separately and paired in one linear pass; a
# single BEGIN...lazy...END regex is quadratic on many unterminated BEGINs.
_PRIVATE_KEY_MARKER = re.compile(
    r"-----(?P<edge>BEGIN|END) (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----",
    re.IGNORECASE,
)
_AWS_ACCESS_KEY_ID = re.compile(r"(?<![A-Z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Z0-9])")
_GITHUB_TOKEN = re.compile(
    r"(?<![A-Za-z0-9_])(?P<prefix>gh[pousr]_|github_pat_)(?P<body>[A-Za-z0-9_]{36,255})(?![A-Za-z0-9_])"
)
_CREDENTIAL = re.compile(
    r"(?ix)"
    r"\b(?:api[_-]?key|service[_-]?password|password|auth\s+token|auth[_-]?token|"
    r"access[_-]?token|bearer[_-]?token|client[_-]?secret|secret[_-]?key|private[_-]?key)\b"
    r"[\"']?\s*[:=]\s*"  # optional closing quote covers JSON/dict keys: "api_key": "..."
    r"(?:[\"'](?P<quoted>[^\"'\r\n]{20,})[\"']|(?P<bare>[A-Za-z0-9_./+=:-]{20,}))"
)
# Environment-style names such as CLOUDFLARE_API_TOKEN=..., DB_PASSWORD: "...".
_ENV_CREDENTIAL = re.compile(
    r"(?ix)(?<![A-Za-z0-9_])"
    r"[A-Za-z0-9_]*_(?:TOKEN|SECRET|API_?KEY|PASSWORD|PASSWD|SECRET_?KEY|SECRET_ACCESS_KEY|PRIVATE_KEY)"
    r"(?![A-Za-z0-9_-])[\"']?[ \t]*[:=][ \t]*"
    r"(?:\"(?P<dq>[^\"\\\r\n]{8,256})\"|'(?P<sq>[^'\\\r\n]{8,256})'"
    r"|(?P<bare>[A-Za-z0-9_+/=-]{16,256})(?![A-Za-z0-9_+/=.:@(\[-]))"
)
_SOURCE_CONCAT_EXPRESSION = re.compile(
    r"^\+\s*[A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*\s*=)?$"
)
_SHELL_VARIABLE = re.compile(r"\$[A-Za-z_][A-Za-z0-9_]*")
_PLACEHOLDER_MARKERS = (
    "redacted", "placeholder", "changeme", "change_me", "change-me", "example", "dummy",
    "synthetic", "fixture", "fake", "sample", "your_", "your-", "notreal", "not_a_real",
)
_MASK_CHARS = frozenset("x*.-_#\u2022")
_SKIP_DIRS = frozenset({".git", ".venv", "venv", "__pycache__", ".pytest_cache", "node_modules"})
_MAX_FILE_BYTES = 2 * 1024 * 1024


def _is_placeholder(value: str) -> bool:
    """Obvious non-secrets: empty, masked (xxx, ****), <redacted>, {{ tpl }}, marker words."""
    v = value.strip()
    low = v.lower()
    if not v or set(low) <= _MASK_CHARS:
        return True
    if (v[0], v[-1]) in {("<", ">"), ("{", "}"), ("[", "]"), ("%", "%")}:
        return True
    return any(marker in low for marker in _PLACEHOLDER_MARKERS)


def _token_like(value: str) -> bool:
    return any(ch.isdigit() for ch in value) and any(ch.isalpha() for ch in value)


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
class SkippedFile:
    source: str
    reason: str

    def to_dict(self) -> dict[str, str]:
        return {"source": self.source, "reason": self.reason}


@dataclass(frozen=True)
class SecretScanReport:
    findings: tuple[SecretFinding, ...]
    suppressed_count: int = 0
    scanned_files: int = 0
    skipped: tuple[SkippedFile, ...] = ()

    @property
    def clean(self) -> bool:
        # A scan that could not read every file is not evidence of cleanliness.
        return not self.findings and not self.skipped

    def to_dict(self) -> dict[str, object]:
        return {
            "clean": self.clean,
            "findings": [finding.to_dict() for finding in self.findings],
            "suppressed_count": self.suppressed_count,
            "scanned_files": self.scanned_files,
            "skipped": [item.to_dict() for item in self.skipped],
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
    def suppression_fingerprint(secret: str) -> str:
        """SHA-256 of an exact approved fixture value, for the ``suppressions`` map."""
        return hashlib.sha256(secret.encode("utf-8")).hexdigest()

    @staticmethod
    def _redacted(rule_id: str, fingerprint: str) -> str:
        return f"<redacted:{rule_id}:{fingerprint[:12]}>"

    @staticmethod
    def _looks_runtime_reference(value: str, *, kind: str) -> bool:
        stripped = value.strip()
        lowered = stripped.lower()
        return (
            stripped.startswith(("${", "$("))
            or _SHELL_VARIABLE.fullmatch(stripped) is not None
            or "os.environ" in lowered
            or "process.env" in lowered
            or stripped.startswith("env:")
            or (kind == "source" and _SOURCE_CONCAT_EXPRESSION.fullmatch(stripped) is not None)
        )

    @staticmethod
    def _private_key_spans(text: str) -> list[tuple[int, int]]:
        spans: list[tuple[int, int]] = []
        begin: int | None = None
        for marker in _PRIVATE_KEY_MARKER.finditer(text):
            if marker.group("edge").upper() == "BEGIN":
                if begin is None:
                    begin = marker.start()
            elif begin is not None:
                spans.append((begin, marker.end()))
                begin = None
        return spans

    def _candidates(self, text: str, kind: str):
        """Yield (rule_id, report_offset, value_start, value_end) in priority order."""
        for start, end in self._private_key_spans(text):
            yield "private-key", start, start, end
        for match in _AWS_ACCESS_KEY_ID.finditer(text):
            if not _is_placeholder(match.group(0)):
                yield "aws-access-key-id", match.start(), match.start(), match.end()
        for match in _GITHUB_TOKEN.finditer(text):
            if not _is_placeholder(match.group("body")):
                yield "github-token", match.start(), match.start(), match.end()
        for match in _CREDENTIAL.finditer(text):
            group = "quoted" if match.group("quoted") is not None else "bare"
            value = match.group(group)
            if self._looks_runtime_reference(value, kind=kind) or _is_placeholder(value):
                continue
            yield "credential-assignment", match.start(), match.start(group), match.end(group)
        for match in _ENV_CREDENTIAL.finditer(text):
            group = next(g for g in ("dq", "sq", "bare") if match.group(g) is not None)
            value = match.group(group)
            if (
                self._looks_runtime_reference(value, kind=kind)
                or _is_placeholder(value)
                or any(ch.isspace() for ch in value)
                or not _token_like(value)
            ):
                continue
            yield "credential-assignment", match.start(), match.start(group), match.end(group)

    def _scan(self, text: str, *, source: str, kind: str, key: bytes) -> tuple[list[SecretFinding], int]:
        findings: list[SecretFinding] = []
        suppressed = 0
        claimed: list[tuple[int, int]] = []  # disjoint, sorted value spans
        newlines: list[int] | None = None
        for rule_id, offset, start, end in self._candidates(text, kind):
            index = bisect_right(claimed, (start, end))
            if (index and claimed[index - 1][1] > start) or (index < len(claimed) and claimed[index][0] < end):
                continue
            insort(claimed, (start, end))
            secret = text[start:end]
            if self.suppression_fingerprint(secret) in self._suppressions:
                suppressed += 1
                continue
            if newlines is None:
                newlines = [m.start() for m in re.finditer("\n", text)]
            fingerprint = hmac.new(key, secret.encode("utf-8"), hashlib.sha256).hexdigest()
            findings.append(
                SecretFinding(
                    rule_id=rule_id,
                    source=source,
                    line=bisect_right(newlines, offset - 1) + 1,
                    fingerprint=fingerprint,
                    redacted=self._redacted(rule_id, fingerprint),
                )
            )
        return findings, suppressed

    def scan_text(self, text: str, *, source: str, kind: str) -> SecretScanReport:
        if kind not in {"source", "artifact", "log"}:
            raise ValueError("kind must be source, artifact, or log")
        findings, suppressed = self._scan(text, source=source, kind=kind, key=secrets.token_bytes(32))
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

        key = secrets.token_bytes(32)  # one key per scan: fingerprints correlate within this report only
        findings: list[SecretFinding] = []
        skipped: list[SkippedFile] = []
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
            relative = path.relative_to(base).as_posix()
            try:
                if path.stat().st_size > _MAX_FILE_BYTES:
                    skipped.append(SkippedFile(relative, "too-large"))
                    continue
                raw = path.read_bytes()
            except OSError:
                skipped.append(SkippedFile(relative, "unreadable"))
                continue
            if b"\x00" in raw:
                skipped.append(SkippedFile(relative, "binary"))
                continue
            try:
                text = raw.decode("utf-8")
            except UnicodeDecodeError:
                skipped.append(SkippedFile(relative, "non-utf8"))
                continue

            file_findings, file_suppressed = self._scan(text, source=relative, kind=self._kind_for(path), key=key)
            findings.extend(file_findings)
            suppressed += file_suppressed
            scanned += 1

        findings.sort(key=lambda item: (item.source, item.line, item.rule_id, item.fingerprint))
        return SecretScanReport(
            tuple(findings), suppressed_count=suppressed, scanned_files=scanned, skipped=tuple(skipped)
        )
