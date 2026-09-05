#!/usr/bin/env python3
import argparse
import hashlib
import json
import pathlib
import re
import subprocess
import sys

EXIT_BLOCKED = 42
EXIT_INVALID = 43


def fail_blocked(code: str, detail: str) -> None:
    print(f"PHASE5_AUTHORITY_GATE_BLOCKED:{code}:{detail}")
    raise SystemExit(EXIT_BLOCKED)


def fail_invalid(code: str, detail: str) -> None:
    print(f"PHASE5_AUTHORITY_GATE_INVALID:{code}:{detail}")
    raise SystemExit(EXIT_INVALID)


def sha256_file(path: pathlib.Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidate-digest", required=True)
    ap.add_argument("--candidate-artifact-id", required=True, type=int)
    ap.add_argument("--candidate-run-id", required=True, type=int)
    ap.add_argument("--trusted-key-fingerprint-file", required=True)
    ap.add_argument("--public-key", required=True)
    ap.add_argument("--approval", required=True)
    ap.add_argument("--signature", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    digest = args.candidate_digest.lower()
    if not re.fullmatch(r"[0-9a-f]{64}", digest):
        fail_invalid("CANDIDATE_DIGEST_FORMAT", digest)

    fp_path = pathlib.Path(args.trusted_key_fingerprint_file)
    pub_path = pathlib.Path(args.public_key)
    approval_path = pathlib.Path(args.approval)
    sig_path = pathlib.Path(args.signature)

    # Trust anchor must exist before any approval can be considered. The gate never
    # accepts a key supplied only by the candidate or approval envelope.
    if not fp_path.is_file():
        fail_blocked("TRUSTED_AUTHORITY_KEY_FINGERPRINT_MISSING", str(fp_path))
    fingerprint = fp_path.read_text(encoding="ascii").strip().lower()
    if not re.fullmatch(r"[0-9a-f]{64}", fingerprint):
        fail_invalid("TRUSTED_AUTHORITY_KEY_FINGERPRINT_FORMAT", fingerprint)
    if not pub_path.is_file():
        fail_blocked("AUTHORITY_PUBLIC_KEY_MISSING", str(pub_path))
    observed_key_sha = sha256_file(pub_path)
    if observed_key_sha != fingerprint:
        fail_invalid("AUTHORITY_PUBLIC_KEY_FINGERPRINT_MISMATCH", observed_key_sha)

    if not approval_path.is_file():
        fail_blocked("APPROVAL_ENVELOPE_MISSING", str(approval_path))
    if not sig_path.is_file():
        fail_blocked("APPROVAL_SIGNATURE_MISSING", str(sig_path))

    try:
        approval = json.loads(approval_path.read_text(encoding="utf-8-sig"))
    except Exception as exc:
        fail_invalid("APPROVAL_JSON_INVALID", type(exc).__name__)

    required = {
        "schema": "mft.education_nexus.phase5.external_authority_approval.v1",
        "decision": "approve_phase5",
        "candidate_artifact_sha256": digest,
        "candidate_artifact_id": args.candidate_artifact_id,
        "candidate_run_id": args.candidate_run_id,
        "phase5_approved": True,
        "phase5_exit_gate_passed": True,
        "all_five_phases_complete": True,
    }
    for key, expected in required.items():
        if approval.get(key) != expected:
            fail_invalid("APPROVAL_FIELD_MISMATCH", f"{key}={approval.get(key)!r}")
    for key in ("authority_id", "issued_at", "nonce"):
        if not isinstance(approval.get(key), str) or not approval[key].strip():
            fail_invalid("APPROVAL_FIELD_MISSING", key)

    canonical = json.dumps(approval, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8") + b"\n"
    payload_path = approval_path.with_suffix(approval_path.suffix + ".canonical")
    payload_path.write_bytes(canonical)

    proc = subprocess.run(
        [
            "openssl", "pkeyutl", "-verify", "-pubin", "-inkey", str(pub_path),
            "-rawin", "-in", str(payload_path), "-sigfile", str(sig_path),
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    if proc.returncode != 0:
        fail_invalid("APPROVAL_SIGNATURE_INVALID", proc.stdout.strip()[-500:])

    result = {
        "schema": "mft.education_nexus.phase5.external_authority_verification.v1",
        "candidate_artifact_sha256": digest,
        "candidate_artifact_id": args.candidate_artifact_id,
        "candidate_run_id": args.candidate_run_id,
        "authority_id": approval["authority_id"],
        "authority_public_key_sha256": observed_key_sha,
        "approval_signature_verified": True,
        "phase5_authority_verified": True,
        "promotion_performed": False,
        "note": "Authority verification only. Canonical replay/integration must still independently earn the Phase-5 exit seal.",
    }
    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print("PHASE5_EXTERNAL_AUTHORITY_VERIFICATION_PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
