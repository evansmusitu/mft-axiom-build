from __future__ import annotations

import argparse
import base64
from dataclasses import asdict
import json
from pathlib import Path
from typing import Any, Mapping, Sequence

from .baseline_registry import BaselineRegistration, BaselineRegistry
from .core import sha256
from .external_attestation import ExternalAttestationReceipt
from .external_execution import ProviderExecutionEvidence, ProviderExecutionNormalizer
from .external_validation import ExternalEvidenceGate

CONTRACT_SCHEMA = "musitu.axiom.level5-execution-contract.v1"
TARGET_MATRIX_SCHEMA = "musitu.axiom.level5-target-matrix.v1"
ASSESSMENT_SCHEMA = "musitu.axiom.level5-external-assessment.v1"
GLOBAL_FRONTIER_PROVIDER_ORGS = frozenset({"openai", "anthropic", "google", "microsoft"})


def _valid_sha256(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 64 and all(c in "0123456789abcdef" for c in value.lower())


def _valid_git_sha(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 40 and all(c in "0123456789abcdef" for c in value.lower())


def _canonical_identity(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip()) and value == value.strip() and value == " ".join(value.split())


def _load_json(path: str | Path) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _write_json(path: str | Path, value: Any) -> None:
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def validate_target_matrix(payload: Mapping[str, Any]) -> dict[str, Any]:
    if payload.get("schema") != TARGET_MATRIX_SCHEMA:
        raise ValueError("unsupported Level-5 target matrix schema")
    targets = payload.get("targets")
    if not isinstance(targets, list) or len(targets) < ExternalEvidenceGate.LEVEL5_PROVIDER_FLOOR:
        raise ValueError("Level-5 target matrix must contain at least three providers")
    seen: set[str] = set()
    global_claim_orgs: set[str] = set()
    for target in targets:
        if not isinstance(target, Mapping):
            raise ValueError("Level-5 provider target must be a mapping")
        for field in ("provider_org", "provider_class", "product", "access_mode", "public_source", "selection_reason"):
            if not _canonical_identity(target.get(field)):
                raise ValueError(f"invalid Level-5 provider target field: {field}")
        key = str(target["provider_org"]).casefold()
        if key in seen:
            raise ValueError("duplicate Level-5 target provider organization")
        seen.add(key)
        if target.get("mandatory_for_global_claim") is True:
            global_claim_orgs.add(key)
        recommended = target.get("recommended_exact_version")
        if recommended is not None and not _canonical_identity(recommended):
            raise ValueError("recommended_exact_version must be canonical when supplied")
        capabilities = target.get("capabilities", [])
        if not isinstance(capabilities, list) or any(not _canonical_identity(x) for x in capabilities):
            raise ValueError("target capabilities must be canonical strings")
    missing_global = GLOBAL_FRONTIER_PROVIDER_ORGS - global_claim_orgs
    if missing_global:
        raise ValueError("target matrix missing global-claim frontier providers: " + ",".join(sorted(missing_global)))
    return dict(payload)


def registry_from_contract(contract: Mapping[str, Any]) -> BaselineRegistry:
    if contract.get("schema") != CONTRACT_SCHEMA:
        raise ValueError("unsupported Level-5 execution contract schema")
    candidate_sha = contract.get("candidate_sha")
    if not _valid_git_sha(candidate_sha):
        raise ValueError("candidate_sha must be an exact 40-hex Git SHA")
    for field in ("created_at", "case_set_hash", "constraint_hash"):
        if not isinstance(contract.get(field), str) or not contract.get(field):
            raise ValueError(f"missing Level-5 contract field: {field}")
    if not _valid_sha256(contract["case_set_hash"]) or not _valid_sha256(contract["constraint_hash"]):
        raise ValueError("case_set_hash and constraint_hash must be SHA-256")
    providers = contract.get("providers")
    if not isinstance(providers, list) or len(providers) < ExternalEvidenceGate.LEVEL5_PROVIDER_FLOOR:
        raise ValueError("Level-5 contract must register at least three providers")
    registrations: list[BaselineRegistration] = []
    seen_orgs: set[str] = set()
    for row in providers:
        if not isinstance(row, Mapping):
            raise ValueError("provider registration must be a mapping")
        provider_org = row.get("provider_org")
        if not _canonical_identity(provider_org):
            raise ValueError("provider_org must be canonical")
        provider_key = str(provider_org).casefold()
        if provider_key in seen_orgs:
            raise ValueError("duplicate provider organization in Level-5 contract")
        seen_orgs.add(provider_key)
        for hash_field in ("permissions_hash", "configuration_hash", "account_scope_hash"):
            if not _valid_sha256(row.get(hash_field)):
                raise ValueError(f"{hash_field} must be SHA-256")
        capabilities_raw = row.get("capabilities", [])
        if not isinstance(capabilities_raw, list):
            raise ValueError("provider capabilities must be a list")
        registrations.append(BaselineRegistration(
            registration_id=str(row["registration_id"]),
            provider_org=str(provider_org),
            provider_class=str(row["provider_class"]),
            product=str(row["product"]),
            exact_version=str(row["exact_version"]),
            access_mode=str(row["access_mode"]),
            registered_at=str(row.get("registered_at", contract["created_at"])),
            valid_until=str(row["valid_until"]) if row.get("valid_until") is not None else (str(contract["valid_until"]) if contract.get("valid_until") is not None else None),
            case_set_hash=str(contract["case_set_hash"]),
            constraint_hash=str(contract["constraint_hash"]),
            permissions_hash=str(row["permissions_hash"]),
            configuration_hash=str(row["configuration_hash"]),
            account_scope_hash=str(row["account_scope_hash"]),
            capabilities=tuple(str(value) for value in capabilities_raw),
        ))
    return BaselineRegistry(
        schema="musitu.axiom.baseline-registry.v1",
        version=str(contract.get("registry_version", "level5-external-v1")),
        created_at=str(contract["created_at"]),
        registrations=tuple(registrations),
    )


def registry_payload(registry: BaselineRegistry) -> dict[str, Any]:
    return {
        "schema": registry.schema,
        "version": registry.version,
        "created_at": registry.created_at,
        "registrations": [asdict(row) for row in registry.registrations],
        "registry_sha256": registry.fingerprint,
    }


def normalize_execution_payloads(payloads: Sequence[Mapping[str, Any]], registry: BaselineRegistry, *, expected_candidate_sha: str) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    run_ids: set[str] = set()
    for payload in payloads:
        evidence = ProviderExecutionEvidence(**dict(payload))
        if evidence.candidate_sha != expected_candidate_sha:
            raise ValueError("provider evidence candidate_sha does not match execution contract")
        if evidence.run_id in run_ids:
            raise ValueError("duplicate provider execution run_id")
        run_ids.add(evidence.run_id)
        normalized.append(ProviderExecutionNormalizer.normalize(evidence, registry))
    return normalized


def _decode_verifier_secrets(payload: Mapping[str, Any]) -> dict[str, bytes]:
    secrets: dict[str, bytes] = {}
    for key_id, encoded in payload.items():
        if not _canonical_identity(key_id) or not isinstance(encoded, str):
            raise ValueError("invalid external verifier secret entry")
        try:
            secret = base64.b64decode(encoded, validate=True)
        except Exception as exc:
            raise ValueError("external verifier secrets must be base64") from exc
        if len(secret) < 32:
            raise ValueError("external verifier secret must contain at least 32 bytes")
        secrets[str(key_id)] = secret
    if not secrets:
        raise ValueError("at least one external verifier secret is required")
    return secrets


def _decode_trust_root(payload: Mapping[str, Any]) -> dict[str, frozenset[str]]:
    trust: dict[str, frozenset[str]] = {}
    for issuer_org, key_ids in payload.items():
        if not _canonical_identity(issuer_org) or not isinstance(key_ids, list):
            raise ValueError("invalid external trust-root entry")
        normalized = frozenset(str(key) for key in key_ids)
        if not normalized or any(not _canonical_identity(key) for key in normalized):
            raise ValueError("external trust-root key IDs must be canonical strings")
        trust[str(issuer_org)] = normalized
    if not trust:
        raise ValueError("external trust root cannot be empty")
    return trust


def _receipt_objects(payloads: Sequence[Mapping[str, Any]]) -> list[ExternalAttestationReceipt]:
    return [ExternalAttestationReceipt(**dict(payload)) for payload in payloads]


def assess_level5(contract: Mapping[str, Any], execution_payloads: Sequence[Mapping[str, Any]], receipt_payloads: Sequence[Mapping[str, Any]], *, verifier_secrets: Mapping[str, bytes], trusted_issuers: Mapping[str, frozenset[str]], target_matrix: Mapping[str, Any] | None = None) -> dict[str, Any]:
    registry = registry_from_contract(contract)
    candidate_sha = str(contract["candidate_sha"])
    normalized = normalize_execution_payloads(execution_payloads, registry, expected_candidate_sha=candidate_sha)
    runs = [row["run"] for row in normalized]
    receipts = _receipt_objects(receipt_payloads)
    required_provider_orgs = contract.get("required_provider_orgs", ExternalEvidenceGate.LEVEL5_PROVIDER_FLOOR)
    required_provider_classes = contract.get("required_provider_classes", [])
    if not isinstance(required_provider_classes, list):
        raise ValueError("required_provider_classes must be a list")
    assessment = ExternalEvidenceGate.level5(
        runs,
        receipts=receipts,
        verifier_secrets=verifier_secrets,
        trusted_issuers=trusted_issuers,
        baseline_registry=registry,
        required_provider_orgs=required_provider_orgs,
        required_provider_classes=tuple(str(x) for x in required_provider_classes),
    )
    contracted_orgs = sorted(str(row["provider_org"]).casefold() for row in contract["providers"])
    verified_orgs = {str(value).casefold() for value in assessment.get("provider_orgs", []) if isinstance(value, str)}
    result: dict[str, Any] = {
        "schema": ASSESSMENT_SCHEMA,
        "candidate_sha": candidate_sha,
        "execution_contract_sha256": sha256(dict(contract)),
        "baseline_registry_sha256": registry.fingerprint,
        "contracted_provider_orgs": contracted_orgs,
        "normalized_run_sha256": sorted(row["run_sha256"] for row in normalized),
        "level5": assessment,
        "claim_authority": "NONE_UNLESS_SEPARATELY_AUTHORIZED_BY_CLAIM_BOUNDARY",
    }
    if target_matrix is not None:
        matrix = validate_target_matrix(target_matrix)
        global_orgs = {str(row["provider_org"]).casefold() for row in matrix["targets"] if row.get("mandatory_for_global_claim") is True}
        result["global_frontier_provider_orgs"] = sorted(global_orgs)
        result["missing_global_frontier_provider_orgs"] = sorted(global_orgs - verified_orgs)
        result["global_frontier_coverage_complete"] = not (global_orgs - verified_orgs)
    return result


def _load_mapping(path: str | Path, description: str) -> Mapping[str, Any]:
    value = _load_json(path)
    if not isinstance(value, Mapping):
        raise ValueError(f"{description} must be a JSON object")
    return value


def _load_mapping_list(path: str | Path, description: str) -> list[Mapping[str, Any]]:
    value = _load_json(path)
    if not isinstance(value, list) or any(not isinstance(row, Mapping) for row in value):
        raise ValueError(f"{description} must be a JSON array of objects")
    return list(value)


def _command_registry(args: argparse.Namespace) -> int:
    contract = _load_mapping(args.contract, "execution contract")
    _write_json(args.output, registry_payload(registry_from_contract(contract)))
    return 0


def _command_assess(args: argparse.Namespace) -> int:
    contract = _load_mapping(args.contract, "execution contract")
    executions = _load_mapping_list(args.executions, "provider executions")
    receipts = _load_mapping_list(args.receipts, "external attestation receipts")
    secret_payload = _load_mapping(args.verifier_secrets, "external verifier secret store")
    trust_payload = _load_mapping(args.trust_root, "external trust root")
    matrix = _load_mapping(args.target_matrix, "target matrix") if args.target_matrix else None
    report = assess_level5(
        contract,
        executions,
        receipts,
        verifier_secrets=_decode_verifier_secrets(secret_payload),
        trusted_issuers=_decode_trust_root(trust_payload),
        target_matrix=matrix,
    )
    _write_json(args.output, report)
    print(json.dumps({
        "status": report["level5"]["status"],
        "candidate_sha": report["candidate_sha"],
        "run_count": report["level5"].get("run_count", 0),
        "reasons": report["level5"].get("reasons", []),
        "global_frontier_coverage_complete": report.get("global_frontier_coverage_complete"),
        "output": str(args.output),
    }, sort_keys=True))
    return 0 if report["level5"]["status"] == "PASS" else 2


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="MUSITU Axiom Level-5 external evidence verifier. This tool never issues external attestations.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    registry_parser = subparsers.add_parser("registry", help="build the exact baseline registry from a populated execution contract")
    registry_parser.add_argument("--contract", required=True)
    registry_parser.add_argument("--output", required=True)
    registry_parser.set_defaults(handler=_command_registry)
    assess_parser = subparsers.add_parser("assess", help="normalize provider evidence and verify independently issued Level-5 receipts")
    assess_parser.add_argument("--contract", required=True)
    assess_parser.add_argument("--executions", required=True)
    assess_parser.add_argument("--receipts", required=True)
    assess_parser.add_argument("--verifier-secrets", required=True)
    assess_parser.add_argument("--trust-root", required=True)
    assess_parser.add_argument("--target-matrix")
    assess_parser.add_argument("--output", required=True)
    assess_parser.set_defaults(handler=_command_assess)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return int(args.handler(args))


if __name__ == "__main__":
    raise SystemExit(main())
