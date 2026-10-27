"""Fail-closed commercial general-availability gate; no network or mutations.

`--audit`: return 0 only when release evidence is internally consistent,
including a closed gate for missing evidence.
`--enforce-ready`: return 0 only when ALL commercial controls are qualified,
backed by nonempty evidence references, and the explicit launch state is ready.
This checks documentary structure, not the authenticity of external providers:
hosted D1 tests, legal approvals and paging must be independently checked.
"""
import argparse
import hashlib
import hmac
import os
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RECORD_PATH = ROOT / 'qualification/musitu_connect_commercial_ga_release.json'
SCHEMA = 'musitu.connect.commercial_ga_release.v1'
BLOCKED = 'BLOCKED_PENDING_INDEPENDENT_COMMERCIAL_EVIDENCE'
READY = 'QUALIFIED_AND_SEPARATELY_RELEASED'
MAX_RELEASE_RECORD_BYTES = 65_536
EXPECTED = frozenset({
    'hosted_isolated_cloudflare_d1_staging_concurrency',
    'hosted_customer_tenant_isolation_and_request_attribution',
    'hosted_idempotent_quota_rate_payload_enforcement',
    'production_scoped_customer_identity_and_rotation',
    'production_registration_offboarding_and_revocation',
    'commercial_checkout_billing_invoicing_and_refund_reconciliation',
    'backup_restore_rpo_rto_and_recovery_rehearsal',
    'external_alert_delivery_and_human_acknowledgment',
    'operations_on_call_and_incident_rollback_signoff',
    'commercial_terms_privacy_data_processing_and_retention_signoff',
    'production_security_review_and_secrets_access_audit',
    'customer_support_and_service_level_readiness',
    'public_connect_mcp_and_domain_review',
})


def _unique_json_object(pairs):
    """Reject ambiguous JSON keys at *any* nesting depth, including approval."""
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('DUPLICATE_RELEASE_JSON_KEY')
        result[key] = value
    return result


def _reject_nonfinite_constant(_token):
    raise ValueError('NON_FINITE_RELEASE_NUMBER')


def _finite_json_float(token):
    value = float(token)
    if not math.isfinite(value):
        raise ValueError('NON_FINITE_RELEASE_NUMBER')
    return value


def load_release_record(path=None):
    """Read one bounded strict UTF-8 JSON document; never log original values.

    The original canonical HMAC contract is unchanged. The caller still needs
    independent evidence and a separately held production approval key.
    """
    source = RECORD_PATH if path is None else path
    with source.open('rb') as file:
        raw = file.read(MAX_RELEASE_RECORD_BYTES + 1)
    if not raw or len(raw) > MAX_RELEASE_RECORD_BYTES:
        raise ValueError('INVALID_RELEASE_RECORD_SIZE')
    return json.loads(
        raw.decode('utf-8', errors='strict'),
        object_pairs_hook=_unique_json_object,
        parse_constant=_reject_nonfinite_constant,
        parse_float=_finite_json_float,
    )


def _verified_release_attestation(record):
    """Bind the entire release record to an independently held approval key.

    Evidence URI/author names in a writable repo are documentary pointers,
    *not* sufficient authority to open registrations or mint credentials.
    The signing key is NEVER stored in the repo or routine CI environment.
    Its custodian must independently inspect the external control evidence.
    """
    key = os.environ.get('MUSITU_GA_RELEASE_APPROVAL_KEY', '')
    signature = record['release'].get('approval_hmac_sha256')
    if len(key.encode('utf-8')) < 32 or not isinstance(signature, str) or len(signature) != 64:
        return False
    # Canonicalize a copy: never mutate the source record or sign its signature.
    import copy
    unsigned = copy.deepcopy(record)
    del unsigned['release']['approval_hmac_sha256']
    message = json.dumps(unsigned, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    correct = hmac.new(key.encode('utf-8'), message, hashlib.sha256).hexdigest()
    return hmac.compare_digest(correct, signature)


def audit(record):
    """Return (valid, ready, reason). Never trigger a deployment."""
    if not isinstance(record, dict) or record.get('schema') != SCHEMA:
        return False, False, 'INVALID_SCHEMA'
    if record.get('launch_mode') != 'FULL_COMMERCIAL_GA_NO_PILOT_NO_BETA':
        return False, False, 'INVALID_LAUNCH_MODE'
    scope = record.get('scope')
    if not isinstance(scope, dict) or scope.get('methane_prediction') != 'RESEARCH_ONLY_UNTIL_INDEPENDENT_FIELD_QUALIFICATION':
        return False, False, 'UNQUALIFIED_METHANE_CLAIM'
    auth = record.get('owner_authorization')
    if not isinstance(auth, dict) or any(auth.get(k) is not True for k in (
        'full_commercial_engineering_authorized', 'merge_authorized',
        'staging_and_production_engineering_authorized')):
        return False, False, 'NO_OWNER_AUTHORIZATION_RECORD'
    checks = record.get('qualifications')
    refs = record.get('independent_evidence_refs')
    if not isinstance(checks, dict) or set(checks) != EXPECTED or not isinstance(refs, dict):
        return False, False, 'INVALID_CONTROL_INVENTORY'
    if set(refs) - EXPECTED:
        return False, False, 'UNKNOWN_EVIDENCE_KEYS'
    if any(v not in ('QUALIFIED', 'NOT_DEMONSTRATED', 'NOT_DEMONSTRATED_FOR_CONNECT_GA') for v in checks.values()):
        return False, False, 'INVALID_CONTROL_STATUS'
    qualified = {key for key, status in checks.items() if status == 'QUALIFIED'}
    for key in qualified:
        proof = refs.get(key)
        if (not isinstance(proof, dict) or not isinstance(proof.get('source_uri'), str)
                or not proof['source_uri'].startswith(('https://', 'github-actions://'))
                or not isinstance(proof.get('independent_verifier'), str)
                or not proof['independent_verifier'].strip()
                or not isinstance(proof.get('verified_at_utc'), str)
                or not proof['verified_at_utc'].strip()):
            return False, False, 'MISSING_QUALIFIED_EVIDENCE:'+key
    release = record.get('release')
    if not isinstance(release, dict):
        return False, False, 'NO_RELEASE_RECORD'
    flags = ('commercial_ga_enabled', 'new_customer_registration_open',
             'production_customer_credentials_issued_by_this_release',
             'public_connect_publication_authorized_by_gate')
    if any(type(release.get(k)) is not bool for k in flags):
        return False, False, 'INVALID_RELEASE_FLAG'
    is_ready = qualified == EXPECTED
    if is_ready:
        # Final deployment remains a distinct recorded decision; historical
        # evidence alone must not silently flip release-state flags.
        if release.get('state') == READY and all(
            release[k] is True for k in (
                'commercial_ga_enabled', 'new_customer_registration_open',
                'public_connect_publication_authorized_by_gate'
            )
        ):
            if not _verified_release_attestation(record):
                return False, False, 'MISSING_OR_INVALID_RELEASE_ATTESTATION'
            return True, True, 'SIGNED_DOCUMENTARY_READY_VERIFY_EXTERNAL_EVIDENCE'
        if release.get('state') == BLOCKED and all(release[k] is False for k in flags):
            return True, False, 'AWAITING_EXPLICIT_RELEASE_PROMOTION'
        return False, False, 'READY_EVIDENCE_BUT_INCONSISTENT_PROMOTION'
    if release.get('state') != BLOCKED or any(release[k] is not False for k in flags):
        return False, False, 'UNQUALIFIED_RELEASE_PROMOTION_ATTEMPT'
    return True, False, 'MISSING_'+str(len(EXPECTED-qualified))+'_COMMERCIAL_CONTROLS'


def main():
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--audit', action='store_true')
    mode.add_argument('--enforce-ready', action='store_true')
    args = parser.parse_args()
    try:
        valid, ready, reason = audit(load_release_record())
    except (OSError, ValueError, RecursionError):
        valid, ready, reason = False, False, 'RELEASE_RECORD_UNREADABLE'
    if not valid:
        print('MUSITU_COMMERCIAL_GA_AUDIT=FAIL '+reason)
        return 1
    if args.audit:
        print('MUSITU_COMMERCIAL_GA_AUDIT=PASS '+reason)
        return 0
    if not ready:
        print('MUSITU_COMMERCIAL_GA=BLOCKED '+reason)
        return 1
    print('MUSITU_COMMERCIAL_GA=DOCUMENTARY_READY_EXTERNAL_VERIFICATION_REQUIRED')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
