"""Fail-closed SEC-004 artifact ingress guard.

The guard performs bounded, non-executing structural inspection before an
untrusted document container reaches higher-level parsers. It deliberately uses
only the Python standard library, never extracts archive members to disk, never
executes embedded content, and always treats document text as data-only.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
from pathlib import Path, PurePosixPath
import re
import xml.etree.ElementTree as ET
import zipfile

from .fabric import FrontierError
from . import fullstack_base as _base
from .fullstack_base import RetrievedContentFirewall


class ArtifactSecurityError(FrontierError):
    """Raised when an artifact violates the fail-closed ingress contract."""


@dataclass(frozen=True)
class ArtifactInspection:
    safe: bool
    kind: str
    sha256: str
    byte_length: int
    member_count: int
    uncompressed_bytes: int
    instruction_authority: str
    injection_flags: tuple[str, ...]

    def to_dict(self) -> dict[str, object]:
        return {
            "safe": self.safe,
            "kind": self.kind,
            "sha256": self.sha256,
            "byte_length": self.byte_length,
            "member_count": self.member_count,
            "uncompressed_bytes": self.uncompressed_bytes,
            "instruction_authority": self.instruction_authority,
            "injection_flags": list(self.injection_flags),
        }


class SecureArtifactIngress:
    """Bounded structural validator for untrusted document artifacts."""

    _OOXML_ROOTS = {
        ".docx": ("docx", "word/document.xml"),
        ".xlsx": ("xlsx", "xl/workbook.xml"),
        ".pptx": ("pptx", "ppt/presentation.xml"),
    }
    _MACRO_SUFFIXES = frozenset({".docm", ".xlsm", ".pptm", ".dotm", ".xltm", ".potm", ".ppsm"})
    _ACTIVE_MEMBER_FRAGMENTS = (
        "vbaproject.bin",
        "/embeddings/",
        "/activex/",
        "/macrosheets/",
        "/oleobjects/",
    )
    _XML_DANGEROUS = re.compile(br"<!\s*(?:DOCTYPE|ENTITY)\b", re.IGNORECASE)
    _PDF_ACTIVE = (
        b"/javascript",
        b"/js",
        b"/launch",
        b"/openaction",
        b"/aa",
        b"/embeddedfile",
        b"/richmedia",
    )

    def __init__(
        self,
        *,
        max_file_bytes: int = 8_000_000,
        max_archive_members: int = 2_000,
        max_uncompressed_bytes: int = 32_000_000,
        max_compression_ratio: float = 100.0,
    ) -> None:
        self.max_file_bytes = int(max_file_bytes)
        self.max_archive_members = int(max_archive_members)
        self.max_uncompressed_bytes = int(max_uncompressed_bytes)
        self.max_compression_ratio = float(max_compression_ratio)
        if self.max_file_bytes <= 0:
            raise ValueError("max_file_bytes must be positive")
        if self.max_archive_members <= 0:
            raise ValueError("max_archive_members must be positive")
        if self.max_uncompressed_bytes <= 0:
            raise ValueError("max_uncompressed_bytes must be positive")
        if self.max_compression_ratio <= 1.0:
            raise ValueError("max_compression_ratio must exceed 1")

    @staticmethod
    def _sha256(payload: bytes) -> str:
        return hashlib.sha256(payload).hexdigest()

    @staticmethod
    def _safe_member_name(name: str) -> str:
        normalized = str(name).replace("\\", "/")
        if not normalized or normalized.startswith("/"):
            raise ArtifactSecurityError("archive path is absolute or empty")
        path = PurePosixPath(normalized)
        if any(part in {"", ".", ".."} for part in path.parts):
            raise ArtifactSecurityError("archive path traversal prohibited")
        first = path.parts[0] if path.parts else ""
        if ":" in first:
            raise ArtifactSecurityError("archive path drive prefix prohibited")
        return path.as_posix()

    @staticmethod
    def _text_flags(payload: bytes) -> tuple[str, ...]:
        text = payload.decode("utf-8", "replace")
        return RetrievedContentFirewall.scan(text)

    def _inspect_ooxml(self, path: Path, raw: bytes, kind: str, required_root: str) -> ArtifactInspection:
        if not zipfile.is_zipfile(path):
            raise ArtifactSecurityError("OOXML container signature mismatch")

        flags: set[str] = set()
        total_uncompressed = 0
        names: set[str] = set()
        try:
            with zipfile.ZipFile(path, "r") as zf:
                infos = zf.infolist()
                if len(infos) > self.max_archive_members:
                    raise ArtifactSecurityError("archive member limit exceeded")
                if not infos:
                    raise ArtifactSecurityError("OOXML container has no members")

                for info in infos:
                    normalized = self._safe_member_name(info.filename)
                    folded = normalized.casefold()
                    if folded in names:
                        raise ArtifactSecurityError("archive contains duplicate member path")
                    names.add(folded)

                    if info.flag_bits & 0x1:
                        raise ArtifactSecurityError("encrypted archive member prohibited")
                    if any(fragment in "/" + folded for fragment in self._ACTIVE_MEMBER_FRAGMENTS):
                        raise ArtifactSecurityError("active content archive member prohibited")

                    total_uncompressed += int(info.file_size)
                    if total_uncompressed > self.max_uncompressed_bytes:
                        raise ArtifactSecurityError("archive uncompressed size limit exceeded")

                    if info.file_size > 1024:
                        ratio = float(info.file_size) / float(max(1, info.compress_size))
                        if ratio > self.max_compression_ratio:
                            raise ArtifactSecurityError("archive compression ratio limit exceeded")

                    if folded.endswith((".xml", ".rels")):
                        payload = zf.read(info)
                        if self._XML_DANGEROUS.search(payload):
                            raise ArtifactSecurityError("XML DTD/entity declarations prohibited")
                        try:
                            ET.fromstring(payload)
                        except ET.ParseError as exc:
                            raise ArtifactSecurityError("malformed XML member") from exc
                        flags.update(self._text_flags(payload))
        except zipfile.BadZipFile as exc:
            raise ArtifactSecurityError("malformed OOXML archive container") from exc

        if "[content_types].xml" not in names or required_root.casefold() not in names:
            raise ArtifactSecurityError("OOXML container missing required structural member")

        return ArtifactInspection(
            safe=True,
            kind=kind,
            sha256=self._sha256(raw),
            byte_length=len(raw),
            member_count=len(names),
            uncompressed_bytes=total_uncompressed,
            instruction_authority="artifact-content-data-only",
            injection_flags=tuple(sorted(flags)),
        )

    def _inspect_pdf(self, raw: bytes) -> ArtifactInspection:
        if not raw.startswith(b"%PDF-"):
            raise ArtifactSecurityError("PDF container signature mismatch")
        eof = raw.rfind(b"%%EOF")
        if eof < 0:
            raise ArtifactSecurityError("malformed PDF container missing EOF")
        if raw[eof + len(b"%%EOF"):].strip():
            raise ArtifactSecurityError("PDF trailing polyglot data prohibited")

        lowered = raw.lower()
        if any(token in lowered for token in self._PDF_ACTIVE):
            raise ArtifactSecurityError("active PDF content prohibited")

        flags = RetrievedContentFirewall.scan(raw.decode("latin-1", "replace"))
        return ArtifactInspection(
            safe=True,
            kind="pdf",
            sha256=self._sha256(raw),
            byte_length=len(raw),
            member_count=0,
            uncompressed_bytes=len(raw),
            instruction_authority="artifact-content-data-only",
            injection_flags=tuple(sorted(flags)),
        )

    def inspect(self, path: str | Path) -> ArtifactInspection:
        artifact = Path(path)
        if not artifact.is_file():
            raise ArtifactSecurityError("artifact path must identify a regular file")
        try:
            size = artifact.stat().st_size
        except OSError as exc:
            raise ArtifactSecurityError("artifact metadata unavailable") from exc
        if size <= 0:
            raise ArtifactSecurityError("artifact is empty")
        if size > self.max_file_bytes:
            raise ArtifactSecurityError("artifact file size limit exceeded")

        suffix = artifact.suffix.casefold()
        if suffix in self._MACRO_SUFFIXES:
            raise ArtifactSecurityError("active macro-enabled document format prohibited")

        raw = artifact.read_bytes()
        if suffix in self._OOXML_ROOTS:
            kind, required_root = self._OOXML_ROOTS[suffix]
            return self._inspect_ooxml(artifact, raw, kind, required_root)
        if suffix == ".pdf":
            return self._inspect_pdf(raw)
        raise ArtifactSecurityError("unsupported artifact container type")


def install_secure_artifact_ingress() -> None:
    """Install one explicit inbound-inspection entrypoint on ArtifactWorkbench.

    This mirrors the existing runtime extension pattern used by other isolated
    Frontier capabilities. It mutates only the class object already exported by
    ``fullstack_base``; all existing artifact creation methods remain unchanged.
    """
    workbench = _base.ArtifactWorkbench
    if getattr(workbench, "_musitu_secure_artifact_ingress_installed", False):
        return

    def inspect_input(path: str | Path, **limits: object) -> dict[str, object]:
        return SecureArtifactIngress(**limits).inspect(path).to_dict()

    setattr(workbench, "inspect_input", staticmethod(inspect_input))
    setattr(workbench, "_musitu_secure_artifact_ingress_installed", True)


__all__ = [
    "ArtifactInspection",
    "ArtifactSecurityError",
    "SecureArtifactIngress",
    "install_secure_artifact_ingress",
]
