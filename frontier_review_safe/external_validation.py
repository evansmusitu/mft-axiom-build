from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Mapping, Sequence

from . import external_validation_core as _core
from .external_validation_core import *  # noqa: F401,F403
from .longitudinal_binding import LongitudinalArtifactBundle, LongitudinalIdentityBinding


@dataclass(frozen=True)
class LongitudinalRefreshRecord(_core.LongitudinalRefreshRecord):
    artifact_bundle: LongitudinalArtifactBundle | None = None

    def __post_init__(self) -> None:
        super().__post_init__()
        if self.artifact_bundle is not None and not isinstance(self.artifact_bundle, LongitudinalArtifactBundle):
            raise ValueError("longitudinal artifact bundle must use LongitudinalArtifactBundle")

    @property
    def fingerprint(self) -> str:
        return _core.sha256(asdict(self))


class ExternalEvidenceGate(_core.ExternalEvidenceGate):
    @classmethod
    def level7(
        cls,
        level6: Mapping[str, Any],
        refreshes: Sequence[LongitudinalRefreshRecord],
        *,
        receipts: Sequence[_core.ExternalAttestationReceipt] = (),
        verifier_secrets: Mapping[str, bytes] | None = None,
        trusted_issuers: Mapping[str, frozenset[str]] | None = None,
        min_refreshes: int = 3,
    ) -> dict[str, Any]:
        reasons: list[str] = []
        if not isinstance(level6, _core.MappingABC):
            reasons.append("invalid_level6_assessment")
            level6 = {}
        try:
            level6_provider_values = tuple(level6.get("level5_provider_orgs", ()))
        except Exception:
            reasons.append("invalid_level6_provider_orgs")
            level6_provider_values = ()
        typed_refreshes, invalid_refreshes = _core._typed_records(refreshes, LongitudinalRefreshRecord)
        if invalid_refreshes:
            reasons.append("invalid_longitudinal_refresh_record")
        secrets, secrets_valid = _core._runtime_mapping(verifier_secrets)
        issuers, issuers_valid = _core._runtime_mapping(trusted_issuers)
        if not secrets_valid:
            reasons.append("external_verifier_secret_store_invalid")
        if not issuers_valid:
            reasons.append("external_attestation_trust_root_invalid")
        if level6.get("status") != "PASS" or level6.get("attestation_verified") is not True:
            reasons.append("level6_not_attested_and_passed")
        try:
            expected_identity = LongitudinalIdentityBinding.from_level6(level6)
        except ValueError:
            expected_identity = None
            reasons.append("level6_identity_binding_invalid")
        expected_baseline_registry_hash = level6.get("baseline_registry_hash")
        if expected_baseline_registry_hash is not None and not _core._valid_sha256(expected_baseline_registry_hash):
            reasons.append("level6_baseline_registry_hash_invalid")
            expected_baseline_registry_hash = None
        if not isinstance(min_refreshes, int) or isinstance(min_refreshes, bool):
            reasons.append("invalid_longitudinal_refresh_floor")
            effective_min_refreshes = cls.LEVEL7_REFRESH_FLOOR
        else:
            effective_min_refreshes = max(cls.LEVEL7_REFRESH_FLOOR, min_refreshes)
            if min_refreshes < cls.LEVEL7_REFRESH_FLOOR:
                reasons.append("longitudinal_refresh_floor_below_required")
        level5_providers = {
            _core._organization_key(provider)
            for provider in level6_provider_values
            if isinstance(provider, str) and provider.strip()
        }
        level5_provider_independence = {
            _core._independence_organization_key(provider)
            for provider in level6_provider_values
            if isinstance(provider, str) and provider.strip()
        }
        latest_validation_raw = level6.get("latest_validation_at")
        latest_validation_at = None
        if latest_validation_raw is not None:
            if not isinstance(latest_validation_raw, str):
                reasons.append("level6_validation_time_invalid")
            else:
                try:
                    latest_validation_at = _core.parse_time(latest_validation_raw)
                except ValueError:
                    reasons.append("level6_validation_time_invalid")
        receipt_map, duplicate_receipts, invalid_receipts = cls._receipt_map(receipts, "longitudinal_refresh")
        if duplicate_receipts:
            reasons.append("duplicate_longitudinal_refresh_attestation_receipt")
        if invalid_receipts:
            reasons.append("invalid_longitudinal_refresh_attestation_receipt")

        passed_refreshes: list[LongitudinalRefreshRecord] = []
        receipt_hashes: list[str] = []
        semantic_evidence_hashes: list[str] = []
        seen_refresh_ids: set[str] = set()
        semantic_artifact_reasons: set[str] = set()
        saw_semantic_artifacts_missing = False
        saw_nonindependent_provenance = False
        saw_executor_identity_invalid = False
        saw_executor_overlap = False
        saw_attester_overlap = False
        saw_attester_executor_overlap = False
        saw_predating_refresh = False
        saw_attestation_time_reversal = False
        saw_identity_mismatch = False
        saw_provenance_mismatch = False

        for refresh in typed_refreshes:
            if refresh.refresh_id in seen_refresh_ids:
                reasons.append("duplicate_longitudinal_refresh")
                continue
            seen_refresh_ids.add(refresh.refresh_id)
            if expected_identity is None or not expected_identity.matches(
                candidate_sha=refresh.candidate_sha,
                case_set_hash=refresh.case_set_hash,
            ):
                saw_identity_mismatch = True
                continue
            if refresh.passed is not True:
                continue
            if refresh.provenance_type != "independent_lab_record":
                saw_nonindependent_provenance = True
                continue
            if not isinstance(refresh.executor_org, str) or not refresh.executor_org.strip():
                saw_executor_identity_invalid = True
                continue
            if _core._independence_organization_key(refresh.executor_org) in level5_provider_independence:
                saw_executor_overlap = True
                continue
            if latest_validation_at is not None and _core.parse_time(refresh.executed_at) < latest_validation_at:
                saw_predating_refresh = True
                continue
            receipt = receipt_map.get(refresh.refresh_id)
            if receipt is None:
                continue
            verification = _core.ExternalAttestationService.verify(
                receipt,
                expected_subject_type="longitudinal_refresh",
                expected_subject_id=refresh.refresh_id,
                expected_subject_hash=refresh.fingerprint,
                verifier_secrets=secrets,
                trusted_issuers=issuers,
            )
            if verification["status"] != "PASS":
                continue
            if receipt.provenance_type != refresh.provenance_type:
                saw_provenance_mismatch = True
                continue
            if _core.parse_time(receipt.issued_at) < _core.parse_time(refresh.executed_at):
                saw_attestation_time_reversal = True
                continue
            if not isinstance(receipt.issuer_org, str) or not receipt.issuer_org.strip():
                saw_attester_overlap = True
                continue
            if _core._independence_organization_key(receipt.issuer_org) in level5_provider_independence:
                saw_attester_overlap = True
                continue
            if (
                _core._independence_organization_key(receipt.issuer_org)
                == _core._independence_organization_key(refresh.executor_org)
            ):
                saw_attester_executor_overlap = True
                continue

            if not isinstance(refresh.artifact_bundle, LongitudinalArtifactBundle):
                saw_semantic_artifacts_missing = True
                continue
            semantic = refresh.artifact_bundle.verify(
                candidate_sha=refresh.candidate_sha,
                case_set_hash=refresh.case_set_hash,
                baseline_registry_hash=refresh.baseline_registry_hash,
                retained_failure_corpus_hash=refresh.retained_failure_corpus_hash,
                drift_report_hash=refresh.drift_report_hash,
                replacement_governance_hash=refresh.replacement_governance_hash,
            )
            if semantic["status"] != "PASS":
                semantic_artifact_reasons.update(semantic["reasons"])
                continue

            passed_refreshes.append(refresh)
            receipt_hashes.append(verification["receipt_sha256"])
            semantic_evidence_hashes.append(semantic["semantic_evidence_sha256"])

        distinct_refresh_times = {_core.parse_time(r.executed_at) for r in passed_refreshes}
        baseline_registry_hashes = {r.baseline_registry_hash for r in passed_refreshes}
        if len(passed_refreshes) < effective_min_refreshes:
            if saw_nonindependent_provenance:
                reasons.append("longitudinal_refresh_provenance_required")
            if saw_executor_identity_invalid:
                reasons.append("longitudinal_refresh_executor_identity_invalid")
            if saw_executor_overlap:
                reasons.append("longitudinal_refresh_executor_overlaps_level5_provider")
            if saw_attester_overlap:
                reasons.append("longitudinal_refresh_attester_overlaps_level5_provider")
            if saw_attester_executor_overlap:
                reasons.append("longitudinal_refresh_attester_overlaps_executor")
            if saw_predating_refresh:
                reasons.append("longitudinal_refresh_predates_level6_validation")
            if saw_attestation_time_reversal:
                reasons.append("longitudinal_refresh_attestation_predates_execution")
            if saw_identity_mismatch:
                reasons.append("longitudinal_refresh_identity_mismatch")
            if saw_provenance_mismatch:
                reasons.append("longitudinal_refresh_provenance_type_mismatch")
            if saw_semantic_artifacts_missing:
                reasons.append("longitudinal_semantic_artifacts_missing")
            if semantic_artifact_reasons:
                reasons.append("longitudinal_semantic_artifacts_invalid")
            reasons.append("insufficient_attested_longitudinal_refreshes")
        elif len(distinct_refresh_times) < effective_min_refreshes:
            reasons.append("insufficient_distinct_longitudinal_refresh_times")
        if len(passed_refreshes) >= effective_min_refreshes:
            if (
                expected_baseline_registry_hash is not None
                and expected_baseline_registry_hash not in baseline_registry_hashes
            ):
                reasons.append("level5_baseline_registry_not_anchored")
            if len(baseline_registry_hashes) < 2:
                reasons.append("baselines_not_refreshed")

        reasons = sorted(set(reasons))
        passed = not reasons
        semantic_floor_met = len(passed_refreshes) >= effective_min_refreshes
        return {
            "status": "PASS" if passed else "FAIL",
            "level": 7,
            "reasons": reasons,
            "attestation_verified": passed,
            "semantic_artifacts_verified": semantic_floor_met,
            "semantic_artifact_reasons": sorted(semantic_artifact_reasons),
            "candidate_sha": expected_identity.candidate_sha if expected_identity is not None else None,
            "case_set_hash": expected_identity.case_set_hash if expected_identity is not None else None,
            "baseline_registry_hash": expected_baseline_registry_hash,
            "level5_provider_orgs": sorted(level5_providers),
            "latest_validation_at": (
                latest_validation_at.isoformat() if latest_validation_at is not None else None
            ),
            "refresh_count": len(passed_refreshes),
            "distinct_refresh_times": len(distinct_refresh_times),
            "refresh_executor_orgs": sorted({
                _core._independence_organization_key(r.executor_org)
                for r in passed_refreshes
                if isinstance(r.executor_org, str) and r.executor_org.strip()
            }),
            "refresh_evidence_sha256": _core.sha256([
                asdict(r) for r in sorted(passed_refreshes, key=lambda x: x.refresh_id)
            ]),
            "semantic_evidence_sha256": (
                _core.sha256(sorted(semantic_evidence_hashes))
                if semantic_evidence_hashes else None
            ),
            "attestation_sha256": (
                _core.sha256(sorted(receipt_hashes)) if receipt_hashes else None
            ),
        }


# Keep legacy implementation byte-for-byte in external_validation_core while
# ensuring all runtime lookups used by ClaimBoundary.authorize_verified resolve
# to the hardened Level-7 record and gate defined above.
_core.LongitudinalRefreshRecord = LongitudinalRefreshRecord
_core.ExternalEvidenceGate = ExternalEvidenceGate

ClaimBoundary = _core.ClaimBoundary
