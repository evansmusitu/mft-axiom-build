#!/usr/bin/env python3
"""Fail-closed benchmark/external-baseline registry governance for DEF-015.

This module validates registry lifecycle and promotion policy only.  It does not
execute external systems, authenticate provenance by itself, create benchmark
results, or certify MUSITU.  A registry entry becomes promotion-eligible only
when all externally produced evidence fields are already present and satisfy the
same sealed-case, constraints, freshness, licensing, contamination, failure-
retention, and origin-authentication requirements.
"""
from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import datetime, timezone
from typing import Any
import re


_HEX64 = re.compile(r"^[0-9a-f]{64}$")
_SCHEMA = "musitu.axiom.frontier.external-baseline-registry.v2"
_AUTHENTICATED_RUN = "AUTHENTICATED_EXTERNAL_RUN"
_AUTHORIZED_LICENSE = "AUTHORIZED_FOR_EVALUATION"
_AUTHORIZED_ACCESS = "AUTHORIZED_CURRENT_ACCESS"
_CLEAN = "CLEAN"


class BenchmarkRegistryError(RuntimeError):
    """Raised when registry structure or promotion evidence fails closed."""


def _mapping(value: Any, name: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise BenchmarkRegistryError(f"{name} must be an object")
    return value


def _string(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise BenchmarkRegistryError(f"{name} must be a non-empty string")
    return value.strip()


def _bool(value: Any, name: str) -> bool:
    if type(value) is not bool:
        raise BenchmarkRegistryError(f"{name} must be boolean")
    return value


def _sha(value: Any, name: str, *, nullable: bool = False) -> str | None:
    if value is None and nullable:
        return None
    text = _string(value, name).lower()
    if not _HEX64.fullmatch(text):
        raise BenchmarkRegistryError(f"{name} must be a lowercase SHA-256 digest")
    return text


def _utc(value: Any, name: str) -> datetime:
    text = _string(value, name)
    try:
        parsed = datetime.fromisoformat(text[:-1] + "+00:00" if text.endswith("Z") else text)
    except ValueError as exc:
        raise BenchmarkRegistryError(f"{name} must be an ISO-8601 timestamp") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise BenchmarkRegistryError(f"{name} must include a timezone")
    return parsed.astimezone(timezone.utc)


def _now(value: datetime) -> datetime:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise BenchmarkRegistryError("now must be a timezone-aware datetime")
    return value.astimezone(timezone.utc)


def _string_list(value: Any, name: str, *, allow_empty: bool) -> list[str]:
    if isinstance(value, (str, bytes, bytearray)) or not isinstance(value, Sequence):
        raise BenchmarkRegistryError(f"{name} must be a sequence")
    items = [_string(item, f"{name} item") for item in value]
    if not allow_empty and not items:
        raise BenchmarkRegistryError(f"{name} cannot be empty")
    if len(set(items)) != len(items):
        raise BenchmarkRegistryError(f"{name} must contain unique values")
    return items


class BenchmarkRegistryGate:
    """Validate benchmark-registry structure and fail-closed promotion policy."""

    def validate_registry(self, registry: Mapping[str, Any], *, now: datetime) -> dict[str, Any]:
        registry = _mapping(registry, "registry")
        current = _now(now)
        if _string(registry.get("schema"), "registry.schema") != _SCHEMA:
            raise BenchmarkRegistryError(f"registry schema must be {_SCHEMA}")
        _string(registry.get("purpose"), "registry.purpose")
        _string(registry.get("evidence_rule"), "registry.evidence_rule")

        reviewed = _utc(registry.get("registry_reviewed_at"), "registry.registry_reviewed_at")
        expires = _utc(registry.get("registry_expires_at"), "registry.registry_expires_at")
        if reviewed >= expires:
            raise BenchmarkRegistryError("registry review time must precede registry expiry")
        if current >= expires:
            raise BenchmarkRegistryError("registry expired")

        minimum = registry.get("minimum_distinct_external_providers_for_broad_claim")
        if isinstance(minimum, bool) or not isinstance(minimum, int) or minimum < 1:
            raise BenchmarkRegistryError("minimum distinct external provider count must be an integer >= 1")

        required_domains = _string_list(
            registry.get("required_comparison_domains"),
            "registry.required_comparison_domains",
            allow_empty=False,
        )
        required_domain_set = set(required_domains)

        raw_references = registry.get("references")
        if isinstance(raw_references, (str, bytes, bytearray)) or not isinstance(raw_references, Sequence):
            raise BenchmarkRegistryError("registry.references must be a sequence")
        references = list(raw_references)
        if not references:
            raise BenchmarkRegistryError("registry.references cannot be empty")

        seen_ids: set[str] = set()
        for index, raw in enumerate(references):
            reference = _mapping(raw, f"reference[{index}]")
            registry_id = _string(reference.get("registry_id"), f"reference[{index}].registry_id")
            if registry_id in seen_ids:
                raise BenchmarkRegistryError(f"duplicate registry_id: {registry_id}")
            seen_ids.add(registry_id)
            _string(reference.get("provider"), f"reference[{index}].provider")
            _string(reference.get("system_class"), f"reference[{index}].system_class")
            _string(reference.get("system_version"), f"reference[{index}].system_version")
            _string(reference.get("license_status"), f"reference[{index}].license_status")
            _string(reference.get("access_status"), f"reference[{index}].access_status")
            _string(reference.get("evidence_status"), f"reference[{index}].evidence_status")
            _string(reference.get("contamination_status"), f"reference[{index}].contamination_status")
            ref_reviewed = _utc(reference.get("reviewed_at"), f"reference[{index}].reviewed_at")
            ref_expires = _utc(reference.get("expires_at"), f"reference[{index}].expires_at")
            # Expired historical evidence is permitted to remain registered so
            # the promotion layer can reject it explicitly as expired.  For a
            # still-current reference, review chronology must remain coherent.
            if current < ref_expires and ref_reviewed >= ref_expires:
                raise BenchmarkRegistryError(f"reference {registry_id} review time must precede expiry")
            domains = _string_list(
                reference.get("comparison_domains"),
                f"reference[{index}].comparison_domains",
                allow_empty=True,
            )
            unknown_domains = sorted(set(domains) - required_domain_set)
            if unknown_domains:
                raise BenchmarkRegistryError(
                    f"reference {registry_id} has unknown comparison domains: {unknown_domains}"
                )
            _sha(reference.get("sealed_case_set_sha256"), f"reference[{index}].sealed_case_set_sha256", nullable=True)
            _sha(reference.get("constraints_sha256"), f"reference[{index}].constraints_sha256", nullable=True)
            _sha(reference.get("results_sha256"), f"reference[{index}].results_sha256", nullable=True)
            _sha(
                reference.get("external_provenance_sha256"),
                f"reference[{index}].external_provenance_sha256",
                nullable=True,
            )
            _bool(reference.get("failures_retained"), f"reference[{index}].failures_retained")
            _bool(
                reference.get("external_origin_authenticated"),
                f"reference[{index}].external_origin_authenticated",
            )

        if _string(registry.get("current_level5_status"), "registry.current_level5_status") not in {
            "NOT_VERIFIED",
            "VERIFIED",
        }:
            raise BenchmarkRegistryError("registry.current_level5_status is invalid")
        if _string(registry.get("current_level6_status"), "registry.current_level6_status") not in {
            "NOT_VERIFIED",
            "VERIFIED",
        }:
            raise BenchmarkRegistryError("registry.current_level6_status is invalid")
        if _string(
            registry.get("current_global_superiority_status"),
            "registry.current_global_superiority_status",
        ) not in {"NOT_CERTIFIED", "CERTIFIED"}:
            raise BenchmarkRegistryError("registry.current_global_superiority_status is invalid")

        return {
            "schema": "musitu.axiom.frontier.benchmark-registry-structure.v1",
            "gate": "PASS",
            "reference_count": len(references),
            "minimum_distinct_external_providers": minimum,
            "required_comparison_domains": required_domains,
            "registry_reviewed_at": reviewed.isoformat(),
            "registry_expires_at": expires.isoformat(),
        }

    def evaluate_promotion(
        self,
        registry: Mapping[str, Any],
        *,
        now: datetime,
        expected_case_set_sha256: str | None,
        expected_constraints_sha256: str | None,
    ) -> dict[str, Any]:
        structure = self.validate_registry(registry, now=now)
        registry = _mapping(registry, "registry")
        current = _now(now)
        expected_case = (
            _sha(expected_case_set_sha256, "expected sealed case hash")
            if expected_case_set_sha256 is not None
            else None
        )
        expected_constraints = (
            _sha(expected_constraints_sha256, "expected constraints hash")
            if expected_constraints_sha256 is not None
            else None
        )

        minimum = int(structure["minimum_distinct_external_providers"])
        required_domains = set(structure["required_comparison_domains"])
        eligible: list[Mapping[str, Any]] = []
        blockers: list[str] = []

        for raw in registry["references"]:
            reference = _mapping(raw, "reference")
            registry_id = str(reference["registry_id"])
            if reference["evidence_status"] != _AUTHENTICATED_RUN:
                continue

            if reference["license_status"] != _AUTHORIZED_LICENSE:
                blockers.append(f"reference {registry_id} license is not authorized for evaluation")
            if reference["access_status"] != _AUTHORIZED_ACCESS:
                blockers.append(f"reference {registry_id} access is not authorized for current evaluation")
            if reference["contamination_status"] != _CLEAN:
                blockers.append(f"reference {registry_id} contamination status is not CLEAN")
            if str(reference["system_version"]).strip() in {"", "NOT_CAPTURED"}:
                blockers.append(f"reference {registry_id} system version is not captured")

            expires = _utc(reference["expires_at"], f"reference {registry_id}.expires_at")
            if current >= expires:
                blockers.append(f"reference {registry_id} expired")

            case_hash = reference.get("sealed_case_set_sha256")
            if case_hash is None:
                blockers.append(f"reference {registry_id} sealed case hash is missing")
            elif expected_case is not None and case_hash != expected_case:
                blockers.append(f"reference {registry_id} sealed case hash mismatch")

            constraints_hash = reference.get("constraints_sha256")
            if constraints_hash is None:
                blockers.append(f"reference {registry_id} constraints hash is missing")
            elif expected_constraints is not None and constraints_hash != expected_constraints:
                blockers.append(f"reference {registry_id} constraints hash mismatch")

            if reference.get("results_sha256") is None:
                blockers.append(f"reference {registry_id} results hash is missing")
            if reference.get("external_provenance_sha256") is None:
                blockers.append(f"reference {registry_id} external provenance hash is missing")
            if reference["failures_retained"] is not True:
                blockers.append(f"reference {registry_id} failures retained requirement is not satisfied")
            if reference["external_origin_authenticated"] is not True:
                blockers.append(f"reference {registry_id} external origin is not authenticated")
            if not reference["comparison_domains"]:
                blockers.append(f"reference {registry_id} comparison domain coverage is empty")

            prefix = f"reference {registry_id} "
            if not any(message.startswith(prefix) for message in blockers):
                eligible.append(reference)

        providers = {str(reference["provider"]) for reference in eligible}
        covered_domains: set[str] = set()
        for reference in eligible:
            covered_domains.update(str(domain) for domain in reference["comparison_domains"])

        if len(providers) < minimum:
            blockers.append(
                "distinct external provider count "
                f"{len(providers)} is below required minimum {minimum}"
            )
        missing_domains = sorted(required_domains - covered_domains)
        if missing_domains:
            blockers.append(f"comparison domain coverage missing: {missing_domains}")

        ready = not blockers
        return {
            "schema": "musitu.axiom.frontier.benchmark-registry-promotion.v1",
            "gate": "PASS",
            "status": "PROMOTION_READY" if ready else "BLOCKED",
            "level5_eligible": ready,
            "eligible_reference_count": len(eligible),
            "distinct_provider_count": len(providers),
            "covered_domains": sorted(covered_domains),
            "required_comparison_domains": sorted(required_domains),
            "blockers": blockers,
            "claim_policy": "REGISTRY_POLICY_ONLY_NO_AUTOMATIC_LEADERSHIP_CERTIFICATION",
        }

    def require_promotion(
        self,
        registry: Mapping[str, Any],
        *,
        now: datetime,
        expected_case_set_sha256: str | None,
        expected_constraints_sha256: str | None,
    ) -> dict[str, Any]:
        result = self.evaluate_promotion(
            registry,
            now=now,
            expected_case_set_sha256=expected_case_set_sha256,
            expected_constraints_sha256=expected_constraints_sha256,
        )
        if result["status"] != "PROMOTION_READY":
            detail = "; ".join(str(item) for item in result["blockers"])
            raise BenchmarkRegistryError(f"promotion blocked: {detail}")
        return result


__all__ = ["BenchmarkRegistryError", "BenchmarkRegistryGate"]
