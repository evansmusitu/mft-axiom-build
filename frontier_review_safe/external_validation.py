from __future__ import annotations

from collections.abc import Mapping as MappingABC
from typing import Any, Mapping, Sequence
import json

from . import external_validation_semantic_core as _semantic
from .external_validation_semantic_core import *  # noqa: F401,F403
from .core import parse_time, sha256
from .longitudinal_binding import LongitudinalArtifactBundle, valid_sha256

# Preserve the complete earned semantic-gate module surface.
_organization_key = _semantic._organization_key
_independence_organization_key = _semantic._independence_organization_key
LongitudinalRefreshRecord = _semantic.LongitudinalRefreshRecord


def _governance_transition(refresh: LongitudinalRefreshRecord) -> dict[str, Any] | None:
    bundle = getattr(refresh, "artifact_bundle", None)
    if not isinstance(bundle, LongitudinalArtifactBundle):
        return None
    try:
        value = json.loads(bundle.replacement_governance_json)
    except (TypeError, ValueError, json.JSONDecodeError):
        return None
    if not isinstance(value, MappingABC):
        return None
    before = value.get("baseline_registry_hash_before")
    after = value.get("baseline_registry_hash_after")
    decision = value.get("decision")
    if not valid_sha256(before) or not valid_sha256(after) or not isinstance(decision, str):
        return None
    return {
        "before": before,
        "after": after,
        "decision": decision,
    }


def _longest_anchored_governance_chain(
    candidates: Sequence[dict[str, Any]],
    *,
    anchor_hash: str,
) -> list[dict[str, Any]]:
    best_by_end: dict[str, list[dict[str, Any]]] = {}
    ordered = sorted(
        candidates,
        key=lambda row: (row["executed_at"], row["refresh"].refresh_id),
    )
    for row in ordered:
        predecessor: list[dict[str, Any]] | None = [] if row["before"] == anchor_hash else None
        existing = best_by_end.get(row["before"])
        if existing and existing[-1]["executed_at"] < row["executed_at"]:
            if predecessor is None or len(existing) > len(predecessor):
                predecessor = existing
        if predecessor is None:
            continue
        chain = [*predecessor, row]
        current = best_by_end.get(row["after"])
        current_ids = tuple(item["refresh"].refresh_id for item in current or ())
        chain_ids = tuple(item["refresh"].refresh_id for item in chain)
        if current is None or len(chain) > len(current) or (
            len(chain) == len(current) and chain_ids < current_ids
        ):
            best_by_end[row["after"]] = chain
    if not best_by_end:
        return []
    return min(
        best_by_end.values(),
        key=lambda chain: (-len(chain), tuple(item["refresh"].refresh_id for item in chain)),
    )


class ExternalEvidenceGate(_semantic.ExternalEvidenceGate):
    @classmethod
    def level7(
        cls,
        level6: Mapping[str, Any],
        refreshes: Sequence[LongitudinalRefreshRecord],
        *,
        receipts: Sequence[_semantic.ExternalAttestationReceipt] = (),
        verifier_secrets: Mapping[str, bytes] | None = None,
        trusted_issuers: Mapping[str, frozenset[str]] | None = None,
        min_refreshes: int = 3,
    ) -> dict[str, Any]:
        try:
            refresh_values = tuple(refreshes)
            receipt_values = tuple(receipts)
        except Exception:
            return super().level7(
                level6,
                refreshes,
                receipts=receipts,
                verifier_secrets=verifier_secrets,
                trusted_issuers=trusted_issuers,
                min_refreshes=min_refreshes,
            )

        result = dict(super().level7(
            level6,
            refresh_values,
            receipts=receipt_values,
            verifier_secrets=verifier_secrets,
            trusted_issuers=trusted_issuers,
            min_refreshes=min_refreshes,
        ))
        result.setdefault("governance_chain_verified", False)
        result.setdefault("governance_chain_refresh_count", 0)
        result.setdefault("governance_chain_refresh_ids", [])
        result.setdefault("governance_chain_sha256", None)

        # Do not obscure an earlier fail-closed reason. Chain validation is an
        # additional promotion condition only after the earned semantic gate passes.
        if result.get("status") != "PASS":
            return result
        if not isinstance(level6, MappingABC):
            return result
        anchor_hash = level6.get("baseline_registry_hash")
        if anchor_hash is None:
            result["governance_chain_reason"] = "level6_baseline_anchor_absent"
            return result
        if not valid_sha256(anchor_hash):
            result["status"] = "FAIL"
            result["attestation_verified"] = False
            result["reasons"] = sorted(set([*result.get("reasons", []), "level6_baseline_registry_hash_invalid"]))
            result["governance_chain_reason"] = "level6_baseline_registry_hash_invalid"
            return result

        effective_min = (
            max(cls.LEVEL7_REFRESH_FLOOR, min_refreshes)
            if isinstance(min_refreshes, int) and not isinstance(min_refreshes, bool)
            else cls.LEVEL7_REFRESH_FLOOR
        )
        accepted: list[dict[str, Any]] = []
        for refresh in refresh_values:
            if not isinstance(refresh, LongitudinalRefreshRecord):
                continue
            individual = super().level7(
                level6,
                [refresh],
                receipts=receipt_values,
                verifier_secrets=verifier_secrets,
                trusted_issuers=trusted_issuers,
                min_refreshes=effective_min,
            )
            if individual.get("refresh_count") != 1:
                continue
            transition = _governance_transition(refresh)
            if transition is None:
                continue
            accepted.append({
                "refresh": refresh,
                "executed_at": parse_time(refresh.executed_at),
                **transition,
            })

        chain = _longest_anchored_governance_chain(accepted, anchor_hash=anchor_hash)
        chain_ids = [row["refresh"].refresh_id for row in chain]
        chain_baselines = {row["refresh"].baseline_registry_hash for row in chain}
        result["governance_chain_refresh_count"] = len(chain)
        result["governance_chain_refresh_ids"] = chain_ids
        if chain:
            result["governance_chain_sha256"] = sha256([
                {
                    "refresh_id": row["refresh"].refresh_id,
                    "executed_at": row["refresh"].executed_at,
                    "before": row["before"],
                    "after": row["after"],
                    "decision": row["decision"],
                }
                for row in chain
            ])

        chain_reasons: list[str] = []
        has_anchor_start = any(row["before"] == anchor_hash for row in accepted)
        if len(chain) < effective_min:
            chain_reasons.append(
                "longitudinal_governance_chain_discontinuity"
                if has_anchor_start
                else "longitudinal_governance_chain_anchor_mismatch"
            )
        if len(chain) >= effective_min:
            if anchor_hash not in chain_baselines:
                chain_reasons.append("level5_baseline_registry_not_anchored")
            if len(chain_baselines) < 2:
                chain_reasons.append("baselines_not_refreshed")

        if chain_reasons:
            result["status"] = "FAIL"
            result["attestation_verified"] = False
            result["governance_chain_verified"] = False
            result["reasons"] = sorted(set([*result.get("reasons", []), *chain_reasons]))
            result["governance_chain_reason"] = sorted(set(chain_reasons))[0]
            return result

        result["governance_chain_verified"] = True
        result["governance_chain_reason"] = None
        return result


# ClaimBoundary.authorize_verified is defined in the frozen legacy module and
# resolves ExternalEvidenceGate dynamically from that module's globals. Point
# it at the chain-hardened successor without changing the prior implementation.
_semantic._core.LongitudinalRefreshRecord = LongitudinalRefreshRecord
_semantic._core.ExternalEvidenceGate = ExternalEvidenceGate

ClaimBoundary = _semantic.ClaimBoundary
