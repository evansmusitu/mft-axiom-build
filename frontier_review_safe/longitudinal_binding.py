from __future__ import annotations

from collections.abc import Mapping as MappingABC
from dataclasses import dataclass
from typing import Any, Mapping


def valid_sha256(value: Any) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(c in "0123456789abcdef" for c in value.lower())
    )


def valid_git_sha(value: Any) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 40
        and all(c in "0123456789abcdef" for c in value.lower())
    )


@dataclass(frozen=True)
class LongitudinalIdentityBinding:
    candidate_sha: str
    case_set_hash: str

    def __post_init__(self) -> None:
        if not valid_git_sha(self.candidate_sha):
            raise ValueError("longitudinal candidate_sha must be an exact 40-hex Git SHA")
        if not valid_sha256(self.case_set_hash):
            raise ValueError("longitudinal case_set_hash must be SHA-256")

    @classmethod
    def from_level6(cls, level6: Mapping[str, Any]) -> "LongitudinalIdentityBinding":
        if not isinstance(level6, MappingABC):
            raise ValueError("level6 assessment must be a mapping")
        return cls(
            candidate_sha=level6.get("candidate_sha"),
            case_set_hash=level6.get("case_set_hash"),
        )

    def matches(self, *, candidate_sha: str, case_set_hash: str) -> bool:
        return candidate_sha == self.candidate_sha and case_set_hash == self.case_set_hash
