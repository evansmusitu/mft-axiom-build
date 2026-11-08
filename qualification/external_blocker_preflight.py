"""Non-enabling offline preflight for externally supplied MUSITU release evidence."""
from pathlib import Path

REQUIREMENTS = {
    "customer_admission": {
        "tenant_credentials_rotation": "security_owner",
        "hosted_tenant_isolation_usage": "security_owner",
        "per_tenant_quota_and_payload": "security_owner",
        "customer_onboarding_offboarding": "pilot_customer_owner",
        "approved_terms_privacy_dpa": "legal_and_privacy_reviewer",
        "pilot_customer_acceptance": "pilot_customer_owner",
        "product_scope_signoff": "product_scope_owner",
        "security_signoff": "security_owner",
        "legal_privacy_signoff": "legal_and_privacy_reviewer",
        "pilot_owner_signoff": "pilot_customer_owner",
    },
    "operational_authorization": {
        "human_paging_acknowledgement": "production_operations_owner",
        "rollback_and_recovery_rehearsal": "production_operations_owner",
        "operations_owner_signoff": "production_operations_owner",
        "separate_release_authorization": "separate_production_release_authorization",
    },
    "external_audit_custody": {
        "external_custodian_acceptance": "independent_audit_custodian",
        "independent_signing_key_custody": "independent_audit_custodian",
        "immutable_receipt_and_retention": "independent_audit_custodian",
        "independently_pinned_latest_attestation": "independent_audit_custodian",
        "restore_and_rollback_detection": "independent_audit_custodian",
    },
    "mine_chronological_validation": {
        "source_rights_and_license": "mine_data_owner",
        "original_1hz_28_measured_channels": "independent_mine_reviewer",
        "source_sha_and_calibration_custody": "independent_mine_reviewer",
        "independent_physical_methane_events": "independent_mine_reviewer",
        "prospective_holdout_preaccess_seal": "independent_mine_reviewer",
        "frozen_model_sha_and_threshold": "independent_mine_reviewer",
        "chronological_folds_and_metrics": "independent_mine_reviewer",
        "independent_safety_and_alarm_review": "independent_mine_reviewer",
    },
}



import argparse
import hashlib
import hmac
import json
from pathlib import Path
import re

GATE_SCHEMA = "musitu.connect.beta_release_gate.v1"
MANIFEST_SCHEMA = "musitu.external_blocker_receipts.v1"
REPORT_SCHEMA = "musitu.external_blocker_preflight.v1"
BLOCKED_STATE = "BLOCKED_PENDING_CUSTOMER_AND_OPERATIONS_EVIDENCE"
BLOCKED_REPORT = "BLOCKED_PENDING_INDEPENDENT_EVIDENCE"
RELEASE_DECISIONS = (
    "new_beta_customer_admission_authorized",
    "public_customer_publication_authorized",
    "openai_plugin_submission_or_publication_authorized",
    "predictive_methane_production_authorized",
)
SIGNOFF_ROLES = frozenset((
    "product_scope_owner", "security_owner", "production_operations_owner",
    "legal_and_privacy_reviewer", "pilot_customer_owner",
    "separate_production_release_authorization",
))
RECEIPT_FIELDS = frozenset((
    "gate", "requirement", "owner_role", "file", "sha256", "custody_reference",
))
SAFE_BASENAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,159}\Z")
SHA256 = re.compile(r"[0-9a-f]{64}\Z")
MAX_RECEIPT_BYTES = 20 * 1024 * 1024
MAX_MANIFEST_BYTES = 512 * 1024


def _unique_pairs(pairs):
    record = {}
    for key, value in pairs:
        if key in record:
            raise ValueError("duplicate_json_property")
        record[key] = value
    return record


def _reject_constant(value):
    raise ValueError("nonstandard_json_number")


def _read_unique_json(path: Path, limit: int):
    if not path.is_file() or path.is_symlink() or path.stat().st_size > limit:
        raise ValueError("external_preflight_document_invalid")
    raw = path.read_bytes()
    try:
        return json.loads(raw.decode("utf-8"),
                          object_pairs_hook=_unique_pairs,
                          parse_constant=_reject_constant,
                          parse_float=_finite_json_number)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("external_preflight_json_invalid") from exc


def _finite_json_number(token):
    # JSON permits scientific notation, but not overflow to Infinity.
    from math import isfinite
    number = float(token)
    if not isfinite(number):
        raise ValueError("nonstandard_json_number")
    return number


def _check_beta_gate(gate):
    if not isinstance(gate, dict) or any((
        gate.get("schema") != GATE_SCHEMA,
        gate.get("assessment_kind") != "FEATURE_BRANCH_PREPARATORY_NON_ENABLING",
        gate.get("state") != BLOCKED_STATE,
        gate.get("existing_production_runtime_enabled") is not True,
        gate.get("existing_production_connect_axiom_compute_preserved") is not True,
        any(gate.get(key) is not False for key in RELEASE_DECISIONS),
    )):
        raise ValueError("beta_release_gate_unexpected")
    roles = gate.get("mandatory_external_signoffs")
    if (not isinstance(roles, list) or not all(type(v) is str for v in roles)
            or len(roles) != len(SIGNOFF_ROLES) or set(roles) != SIGNOFF_ROLES):
        raise ValueError("beta_release_gate_unexpected")


def _verified_receipts(manifest_path, evidence_root):
    if manifest_path is None and evidence_root is None:
        return set()
    if manifest_path is None or evidence_root is None:
        raise ValueError("receipt_manifest_and_evidence_root_required")
    manifest = _read_unique_json(Path(manifest_path), MAX_MANIFEST_BYTES)
    if (type(manifest) is not dict or set(manifest) != {"schema", "receipts"}
            or manifest["schema"] != MANIFEST_SCHEMA
            or type(manifest["receipts"]) is not list
            or len(manifest["receipts"]) > 128):
        raise ValueError("receipt_manifest_schema_invalid")
    root = Path(evidence_root)
    if not root.is_dir() or root.is_symlink():
        raise ValueError("receipt_path_invalid")
    seen = set()
    for receipt in manifest["receipts"]:
        if type(receipt) is not dict or set(receipt) != RECEIPT_FIELDS:
            raise ValueError("receipt_schema_invalid")
        gate = receipt["gate"]
        requirement = receipt["requirement"]
        if (type(gate) is not str or type(requirement) is not str
                or gate not in REQUIREMENTS or requirement not in REQUIREMENTS[gate]):
            raise ValueError("receipt_requirement_unknown")
        key = (gate, requirement)
        if key in seen:
            raise ValueError("duplicate_receipt")
        if (type(receipt["owner_role"]) is not str
                or receipt["owner_role"] != REQUIREMENTS[gate][requirement]):
            raise ValueError("receipt_owner_role_invalid")
        name = receipt["file"]
        if type(name) is not str or SAFE_BASENAME.fullmatch(name) is None or name in (".", ".."):
            raise ValueError("receipt_path_invalid")
        path = root / name
        if path.is_symlink() or not path.is_file():
            raise ValueError("receipt_path_invalid")
        if path.stat().st_size > MAX_RECEIPT_BYTES or path.stat().st_size == 0:
            raise ValueError("receipt_content_size_invalid")
        digest = receipt["sha256"]
        if type(digest) is not str or SHA256.fullmatch(digest) is None:
            raise ValueError("receipt_sha256_invalid")
        custody = receipt["custody_reference"]
        if type(custody) is not str or not 8 <= len(custody.strip()) <= 512:
            raise ValueError("receipt_custody_reference_invalid")
        sha = hashlib.sha256()
        with path.open("rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                sha.update(chunk)
        if not hmac.compare_digest(sha.hexdigest(), digest):
            raise ValueError("receipt_sha256_mismatch")
        seen.add(key)
    return seen


def assess_external_blockers(*, gate_path: Path, manifest_path: Path | None = None,
                             evidence_root: Path | None = None) -> dict:
    """Screen metadata and bytes without ever authenticating or granting release.

    Reported matching hashes only prove that the supplied manifest describes
    supplied bytes. They do not prove evidence truth, third-party custody,
    reviewer identity, site rights, or any permission to deploy or admit.
    """
    gate = _read_unique_json(Path(gate_path), MAX_MANIFEST_BYTES)
    _check_beta_gate(gate)
    present = _verified_receipts(manifest_path, evidence_root)
    outcomes = {}
    for gate_name, items in REQUIREMENTS.items():
        missing = [name for name in items if (gate_name, name) not in present]
        hashed = [name for name in items if (gate_name, name) in present]
        outcomes[gate_name] = {
            "missing_requirements": missing,
            "hash_matched_unreviewed": hashed,
            "complete_for_external_review": not missing,
            "qualified": False,
            "independent_owner_approval_verified": False,
        }
    return {
        "schema": REPORT_SCHEMA,
        "status": BLOCKED_REPORT,
        "release_authorized": False,
        "independent_authenticity_verified": False,
        "receipt_hashes_only_are_not_external_approval": True,
        "existing_authorized_arithmetic_unchanged": True,
        "frozen_lightgbm_model_and_thresholds_unchanged": True,
        "gates": outcomes,
    }


def main():
    parser = argparse.ArgumentParser(description="Offline external blockers preflight (never enables release)")
    parser.add_argument("--beta-gate", type=Path,
                        default=Path(__file__).resolve().parent / "musitu_connect_beta_release_gate.json")
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--evidence-root", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = assess_external_blockers(gate_path=args.beta_gate, manifest_path=args.manifest,
                                      evidence_root=args.evidence_root)
    body = json.dumps(report, sort_keys=True, indent=2, allow_nan=False) + "\n"
    if args.output is not None:
        if args.output.exists():
            raise FileExistsError("preflight_report_must_be_new")
        with args.output.open("x", encoding="utf-8") as stream:
            stream.write(body)
    else:
        print(body, end="")


if __name__ == "__main__":
    main()
