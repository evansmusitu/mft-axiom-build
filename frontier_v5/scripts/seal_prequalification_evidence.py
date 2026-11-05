#!/usr/bin/env python3
"""Seal allowlisted, *non-release* CI evidence without claiming staging qualification.

Do not ingest Cloudflare/provider live-adapter or objective-PASS files here. Those
require a separate trusted, independently authorized workflow and evaluation.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re

ALLOWLIST = (
    'musitu-frontier-multimodal.json',
    'musitu-frontier-adversarial.json',
    'musitu-frontier-independent-validation.json',
    'musitu-frontier-market-cache.json',
    'musitu-frontier-supply-chain.json',
    'musitu-screen.png',
)
MAX_EVIDENCE_BYTES = 2_000_000
SENSITIVE_KEYS = frozenset({
    'access_token', 'refresh_token', 'authorization', 'api_key', 'private_key',
    'client_secret', 'secret', 'password', 'session_cookie', 'bearer',
    'cloudflare_global_api_key', 'cloudflare_api_token', 'stripe_secret',
})
SENSITIVE_VALUES = re.compile(r'(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|'
                              r'\b(?:sk_live_|whsec_|ghp_|gho_|ghu_|ghs_|ghr_)\S+|'
                              r'\bAKIA[A-Z0-9]{16}\b)')


def _reject_sensitive(obj):
    if isinstance(obj, dict):
        for key, value in obj.items():
            if key.lower().replace('-', '_') in SENSITIVE_KEYS:
                raise ValueError('sensitive_evidence_key')
            _reject_sensitive(value)
    elif isinstance(obj, list):
        for value in obj:
            _reject_sensitive(value)
    elif isinstance(obj, str) and SENSITIVE_VALUES.search(obj):
        raise ValueError('sensitive_evidence_value')


def build_manifest(root: Path, head_sha: str, run_id: str) -> dict:
    """Read only the allowlist; never infer full-stack success from stage files."""
    if not re.fullmatch(r'[a-fA-F0-9]{40}', str(head_sha)):
        raise ValueError('invalid_head_sha')
    if not re.fullmatch(r'[0-9]{1,20}', str(run_id)):
        raise ValueError('invalid_run_id')
    root = Path(root)
    files, missing = {}, []
    for name in ALLOWLIST:
        path = root / name
        if path.is_symlink():
            raise ValueError('symlink_evidence_rejected:' + name)
        if not path.exists():
            missing.append(name)
            continue
        if not path.is_file() or path.stat().st_size > MAX_EVIDENCE_BYTES:
            raise ValueError('oversized_evidence_or_nonfile:' + name)
        data = path.read_bytes()
        if name.endswith('.json'):
            try:
                payload = json.loads(data)
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise ValueError('malformed_evidence_json:' + name) from exc
            _reject_sensitive(payload)
        elif not data.startswith(b'\x89PNG\r\n\x1a\n'):
            raise ValueError('invalid_evidence_png')
        files[name] = {'sha256': hashlib.sha256(data).hexdigest(), 'size_bytes': len(data)}
    return {
        'schema': 'musitu.axiom.frontier.prequalification-evidence.v1',
        'source_head_sha': str(head_sha).lower(),
        'github_run_id': str(run_id),
        'status': 'PARTIAL_NOT_RELEASE',
        'claims': {
            'full_stack': 'NOT_CERTIFIED',
            'external_superiority': 'NOT_CERTIFIED',
            'production_live_adapter': 'BLOCKED',
        },
        'required_independent_gates': {
            'staging_live_adapter': 'NOT_PROVEN',
            'production_auth_and_d1_isolation': 'NOT_PROVEN',
            'retained_complete_staging_evidence': 'NOT_PROVEN',
            'external_comparative_eval': 'NOT_CERTIFIED',
            'independent_security_review': 'NOT_PROVEN',
        },
        'exclusions': [
            'production-connected live adapter data and provider credentials',
            'full-stack objective PASS manifest',
            'release/superiority certification',
        ],
        'retained_evidence': files,
        'missing_evidence': missing,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path('/tmp'))
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--head-sha', required=True)
    parser.add_argument('--run-id', required=True)
    args = parser.parse_args()
    manifest = build_manifest(args.root, args.head_sha, args.run_id)
    args.output.write_text(json.dumps(manifest, sort_keys=True, indent=2) + '\n', encoding='utf-8')
    print('MUSITU_AXIOM_FRONTIER_PREQUALIFICATION_RETAINED_NOT_RELEASE')
    print(f'allowlisted_files={len(manifest["retained_evidence"])}')


if __name__ == '__main__':
    main()
