"""Offline, non-enabling comparison of sanitized Cloudflare readback manifest.

A hash match is NOT proof of source-to-build provenance, and a difference may
reflect a reviewed bundle/transform rather than an unauthorized modification.
Never uploads, decrypts, deploys, reads secrets or changes any release gate.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

MAX_MANIFEST = 65536
MAX_SOURCE = 1048576
SCHEMA = 'musitu.axiom.reviewer-fixes.readback.v1'
APPROVED_SOURCE = Path(__file__).resolve().parents[1] / 'mcp/musitu_axiom_plugin_gate_v4.mjs'
DIGEST = re.compile(r'[0-9a-f]{64}\Z')


def _denied(reason='INVALID_READBACK'):
    return {
        'schema': 'musitu.axiom.public_source_reconciliation.v1',
        'status': reason,
        'source_byte_match': False,
        'source_provenance_qualified': False,
        'release_authorized': False,
        'commercial_ga_qualified': False,
        'openai_submission_ready': False,
    }


def assess_readback(manifest, source_bytes):
    if (not isinstance(manifest, dict) or manifest.get('schema') != SCHEMA
            or manifest.get('mutation_performed') is not False):
        return _denied()
    if not isinstance(source_bytes, bytes) or not (0 < len(source_bytes) <= MAX_SOURCE):
        return _denied()
    try:
        entry = manifest['workers']['musitu-axiom-mcp']['modules']['index.mjs']
        sha, size = entry['sha256'], entry['bytes']
    except (KeyError, TypeError):
        return _denied()
    if (not isinstance(sha, str) or DIGEST.fullmatch(sha) is None
            or type(size) is not int or not 0 < size <= MAX_SOURCE):
        return _denied()
    source_sha = hashlib.sha256(source_bytes).hexdigest()
    match = sha == source_sha and size == len(source_bytes)
    return {
        **_denied('BYTE_IDENTICAL_CAPTURE_NOT_CERTIFIED'
                  if match else 'UNRECONCILED_DEPLOYED_SCRIPT'),
        'source_byte_match': match,
        'approved_source_sha256': source_sha,
        'observed_module_sha256': sha,
        'approved_source_bytes': len(source_bytes),
        'observed_module_bytes': size,
        'source_provenance_qualified': False,
    }


def _distinct(pairs):
    obj = {}
    for key, value in pairs:
        if key in obj:
            raise ValueError('DUPLICATE_MANIFEST_KEY')
        obj[key] = value
    return obj


def _reject_constant(_value):
    raise ValueError('INVALID_JSON_CONSTANT')


def load_manifest(path):
    with Path(path).open('rb') as file:
        raw = file.read(MAX_MANIFEST + 1)
    if not 0 < len(raw) <= MAX_MANIFEST:
        raise ValueError('INVALID_MANIFEST_SIZE')
    return json.loads(raw, object_pairs_hook=_distinct,
                      parse_constant=_reject_constant)


def main(argv=None):
    parser = argparse.ArgumentParser(description='Offline public Worker source comparison; non-enabling')
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        if APPROVED_SOURCE.stat().st_size > MAX_SOURCE:
            raise ValueError('SOURCE_OVERSIZE')
        report = assess_readback(load_manifest(args.manifest), APPROVED_SOURCE.read_bytes())
        with args.output.open('x', encoding='utf-8') as file:
            json.dump(report, file, sort_keys=True, indent=2, allow_nan=False)
            file.write('\n')
    except (ValueError, UnicodeError, OSError, RecursionError):
        print('PUBLIC_SOURCE_RECONCILIATION=BLOCKED INVALID_OR_UNWRITABLE_EVIDENCE')
        return 2
    print('PUBLIC_SOURCE_RECONCILIATION=' + report['status'])
    return 0 if report['source_byte_match'] else 2


if __name__ == '__main__':
    raise SystemExit(main())
