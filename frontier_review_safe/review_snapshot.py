from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Mapping, Sequence, Any
import hashlib
import json


class ReviewSnapshotViolation(RuntimeError):
    pass


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)


def _sha(value: Any) -> str:
    return hashlib.sha256(_canonical(value).encode()).hexdigest()


@dataclass(frozen=True)
class PublicContractObservation:
    mcp_url: str
    auth_url: str
    demo_url: str
    tool_names: tuple[str, ...]
    oauth_scopes: tuple[str, ...]
    forbidden_tools_present: tuple[str, ...]
    trading_enabled: bool
    transfer_enabled: bool
    digital_checkout_enabled: bool
    ads_enabled: bool


@dataclass(frozen=True)
class ReviewSnapshotManifest:
    schema: str
    authoritative_frontier_sha: str
    sealed_main_sha: str
    public_tool_count: int
    required_scopes: tuple[str, ...]
    forbidden_tools: tuple[str, ...]
    protected_paths: tuple[str, ...]
    protected_git_blob_shas: Mapping[str, str]
    mcp_url: str
    auth_url: str
    demo_url: str

    @property
    def fingerprint(self) -> str:
        return _sha(asdict(self))


class ReviewSnapshotGuard:
    """Pure read-only contract guard.

    It consumes observations supplied by CI/read-only adapters. It never performs
    network requests, deployment, secret access, or mutation itself.
    """

    def __init__(self, manifest: ReviewSnapshotManifest) -> None:
        self.manifest = manifest

    def verify_tree(self, git_blob_shas: Mapping[str, str]) -> dict[str, Any]:
        changed, missing = [], []
        for path, expected in self.manifest.protected_git_blob_shas.items():
            if path not in git_blob_shas:
                missing.append(path)
            elif git_blob_shas[path] != expected:
                changed.append(path)
        if missing or changed:
            raise ReviewSnapshotViolation(f"review snapshot tree drift: missing={missing}, changed={changed}")
        return {"status": "PASS", "protected_paths_verified": len(self.manifest.protected_git_blob_shas),
                "manifest_sha256": self.manifest.fingerprint}

    def verify_public_contract(self, observation: PublicContractObservation) -> dict[str, Any]:
        failures = []
        if observation.mcp_url != self.manifest.mcp_url: failures.append("mcp_url")
        if observation.auth_url != self.manifest.auth_url: failures.append("auth_url")
        if observation.demo_url != self.manifest.demo_url: failures.append("demo_url")
        if len(set(observation.tool_names)) != self.manifest.public_tool_count: failures.append("tool_count")
        if set(observation.oauth_scopes) != set(self.manifest.required_scopes): failures.append("oauth_scopes")
        if observation.forbidden_tools_present: failures.append("forbidden_tools_present")
        if any(x in set(observation.tool_names) for x in self.manifest.forbidden_tools): failures.append("forbidden_tool_in_tools")
        if observation.trading_enabled: failures.append("trading_enabled")
        if observation.transfer_enabled: failures.append("transfer_enabled")
        if observation.digital_checkout_enabled: failures.append("digital_checkout_enabled")
        if observation.ads_enabled: failures.append("ads_enabled")
        if failures:
            raise ReviewSnapshotViolation("review snapshot public-contract drift: " + ",".join(failures))
        return {"status": "PASS", "public_tool_count": self.manifest.public_tool_count,
                "contract_sha256": _sha(asdict(observation)), "manifest_sha256": self.manifest.fingerprint}

    @staticmethod
    def verify_no_protected_diff(changed_paths: Sequence[str], protected_prefixes: Sequence[str]) -> dict[str, Any]:
        violations = sorted({p for p in changed_paths if any(p == q or p.startswith(q.rstrip("/") + "/") for q in protected_prefixes)})
        if violations:
            raise ReviewSnapshotViolation("frontier change touches review-protected path: " + ",".join(violations))
        return {"status": "PASS", "checked_paths": len(changed_paths)}
