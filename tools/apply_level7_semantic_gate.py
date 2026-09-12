from __future__ import annotations

from pathlib import Path


PATH = Path("frontier_review_safe/external_validation.py")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one anchor, found {count}")
    return text.replace(old, new, 1)


def main() -> int:
    text = PATH.read_text(encoding="utf-8")

    text = replace_once(
        text,
        "from .longitudinal_binding import LongitudinalIdentityBinding\n",
        "from .longitudinal_binding import LongitudinalIdentityBinding\n"
        "from .longitudinal_artifacts import validate_longitudinal_artifact_bundle\n",
        "semantic verifier import",
    )

    text = replace_once(
        text,
        "        trusted_issuers: Mapping[str, frozenset[str]] | None = None,\n"
        "        min_refreshes: int = 3,\n"
        "    ) -> dict[str, Any]:\n"
        "        reasons = []\n",
        "        trusted_issuers: Mapping[str, frozenset[str]] | None = None,\n"
        "        semantic_artifacts: Mapping[str, Mapping[str, Any]] | None = None,\n"
        "        min_refreshes: int = 3,\n"
        "    ) -> dict[str, Any]:\n"
        "        reasons = []\n",
        "level7 semantic argument",
    )

    text = replace_once(
        text,
        "        secrets, secrets_valid = _runtime_mapping(verifier_secrets)\n"
        "        issuers, issuers_valid = _runtime_mapping(trusted_issuers)\n"
        "        if not secrets_valid:\n"
        "            reasons.append(\"external_verifier_secret_store_invalid\")\n"
        "        if not issuers_valid:\n"
        "            reasons.append(\"external_attestation_trust_root_invalid\")\n"
        "        if level6.get(\"status\") != \"PASS\" or level6.get(\"attestation_verified\") is not True:\n",
        "        secrets, secrets_valid = _runtime_mapping(verifier_secrets)\n"
        "        issuers, issuers_valid = _runtime_mapping(trusted_issuers)\n"
        "        semantic_bundles, semantic_bundles_valid = _runtime_mapping(semantic_artifacts)\n"
        "        if not secrets_valid:\n"
        "            reasons.append(\"external_verifier_secret_store_invalid\")\n"
        "        if not issuers_valid:\n"
        "            reasons.append(\"external_attestation_trust_root_invalid\")\n"
        "        if not semantic_bundles_valid:\n"
        "            reasons.append(\"longitudinal_semantic_artifact_store_invalid\")\n"
        "        if level6.get(\"status\") != \"PASS\" or level6.get(\"attestation_verified\") is not True:\n",
        "level7 semantic store",
    )

    text = replace_once(
        text,
        "        saw_identity_mismatch = False\n"
        "        saw_provenance_mismatch = False\n"
        "        for refresh in typed_refreshes:\n",
        "        saw_identity_mismatch = False\n"
        "        saw_provenance_mismatch = False\n"
        "        semantic_failure_reasons: list[str] = []\n"
        "        for refresh in typed_refreshes:\n",
        "semantic failure accumulator",
    )

    text = replace_once(
        text,
        "            if latest_validation_at is not None and parse_time(refresh.executed_at) < latest_validation_at:\n"
        "                saw_predating_refresh = True\n"
        "                continue\n"
        "            receipt = receipt_map.get(refresh.refresh_id)\n",
        "            if latest_validation_at is not None and parse_time(refresh.executed_at) < latest_validation_at:\n"
        "                saw_predating_refresh = True\n"
        "                continue\n"
        "            semantic_check = validate_longitudinal_artifact_bundle(\n"
        "                refresh, semantic_bundles.get(refresh.refresh_id)\n"
        "            )\n"
        "            if semantic_check[\"status\"] != \"PASS\":\n"
        "                semantic_failure_reasons.extend(semantic_check[\"reasons\"])\n"
        "                continue\n"
        "            receipt = receipt_map.get(refresh.refresh_id)\n",
        "semantic validation before attestation",
    )

    text = replace_once(
        text,
        "            if saw_provenance_mismatch:\n"
        "                reasons.append(\"longitudinal_refresh_provenance_type_mismatch\")\n"
        "            reasons.append(\"insufficient_attested_longitudinal_refreshes\")\n",
        "            if saw_provenance_mismatch:\n"
        "                reasons.append(\"longitudinal_refresh_provenance_type_mismatch\")\n"
        "            reasons.extend(semantic_failure_reasons)\n"
        "            reasons.append(\"insufficient_attested_longitudinal_refreshes\")\n",
        "semantic fail-closed reasons",
    )

    text = replace_once(
        text,
        "            \"refresh_count\": len(passed_refreshes),\n"
        "            \"distinct_refresh_times\": len(distinct_refresh_times),\n",
        "            \"refresh_count\": len(passed_refreshes),\n"
        "            \"semantic_artifacts_verified\": passed and len(passed_refreshes) >= effective_min_refreshes,\n"
        "            \"distinct_refresh_times\": len(distinct_refresh_times),\n",
        "semantic verification result",
    )

    PATH.write_text(text, encoding="utf-8")
    print("MUSITU_AXIOM_LEVEL7_SEMANTIC_GATE_PATCH_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
