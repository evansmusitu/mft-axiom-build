"""Fail-closed external incident delivery for a read-only Connect runtime guard.

No production writes. An external provider's HTTP acknowledgement never proves
that a human received or acted on a page; this is a separate operational gate.
The delivery API only executes when explicitly armed by an operator.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
from typing import Any, Mapping
from urllib.request import Request, urlopen

PAGERDUTY_ENDPOINT = 'https://events.pagerduty.com/v2/enqueue'
DEDUP_KEY = 'musitu-connect-production-runtime-availability-v1'


def evaluate_paging(
    guard: Mapping[str, Any], *, enable_external_page: bool = False,
    routing_key: str = '',
) -> dict[str, Any]:
    """Return a sanitized assessment; never expose the routing key or raw errors."""
    result: dict[str, Any] = {
        'schema': 'musitu.connect.production_paging_assessment.v1',
        'delivery_status': 'GUARD_EVIDENCE_INVALID',
        'production_guard_passed': False,
        'provider_transport_acknowledged': False,
        'external_paging_verified': False,
        'production_mutation_performed': False,
        'credentials_published': False,
    }
    if (not isinstance(guard, Mapping)
            or guard.get('schema') != 'musitu.connect.live_runtime_guard.v1'
            or type(guard.get('passed')) is not bool
            or not isinstance(guard.get('source_commit'), str)
            or len(guard['source_commit']) != 40
            or any(ch not in '0123456789abcdef' for ch in guard['source_commit'])
            or guard.get('credentials_used') is not False
            or guard.get('production_mutation_performed') is not False):
        return result

    healthy = (
        guard['passed'] is True
        and guard.get('health_http_status') == 200
        and guard.get('unauthenticated_plan_http_status') == 401
    )
    result['production_guard_passed'] = healthy
    if healthy:
        result['delivery_status'] = 'NO_INCIDENT_NO_PAGE'
        return result
    if not enable_external_page:
        result['delivery_status'] = 'EXTERNAL_PAGING_DISABLED'
        return result
    if not routing_key.strip():
        result['delivery_status'] = 'EXTERNAL_PAGING_UNCONFIGURED'
        return result

    payload = {
        'routing_key': routing_key,
        'event_action': 'trigger',
        'dedup_key': DEDUP_KEY,
        'payload': {
            'summary': 'MUSITU Connect production runtime guard failed',
            'source': 'musitu-connect-production',
            'severity': 'critical',
            'timestamp': datetime.now(timezone.utc).isoformat(timespec='seconds'),
            'custom_details': {
                'guard_passed': False,
                'health_http_status': (
                    guard.get('health_http_status') if type(guard.get('health_http_status')) is int else None
                ),
                'unauthenticated_plan_http_status': (
                    guard.get('unauthenticated_plan_http_status')
                    if type(guard.get('unauthenticated_plan_http_status')) is int else None
                ),
            },
        },
    }
    request = Request(
        PAGERDUTY_ENDPOINT,
        data=json.dumps(payload, separators=(',', ':')).encode('utf-8'),
        headers={'Content-Type': 'application/json', 'Accept': 'application/json'},
        method='POST',
    )
    try:
        with urlopen(request, timeout=12) as response:
            raw = response.read(8193)
            if response.status != 202 or len(raw) > 8192:
                raise ValueError('provider_response_unacceptable')
        acknowledgement = json.loads(raw)
        if (not isinstance(acknowledgement, Mapping)
                or acknowledgement.get('status') != 'success'
                or acknowledgement.get('dedup_key') != DEDUP_KEY):
            raise ValueError('provider_ack_mismatch')
    except (Exception):
        # HTTP error messages, response bodies and credentials are never emitted.
        result['delivery_status'] = 'EXTERNAL_PAGING_DELIVERY_FAILED'
        return result
    result['delivery_status'] = 'PROVIDER_ACKNOWLEDGED_ONLY'
    result['provider_transport_acknowledged'] = True
    # The real human/on-call acknowledgement is not verified by this API.
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description='Read-only MUSITU Connect incident paging readiness')
    parser.add_argument('--guard', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--enable-external-page', action='store_true')
    args = parser.parse_args()
    try:
        guard = json.loads(args.guard.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        guard = {}
    key = os.environ.get('MUSITU_CONNECT_PAGERDUTY_ROUTING_KEY', '') if args.enable_external_page else ''
    result = evaluate_paging(guard, enable_external_page=args.enable_external_page, routing_key=key)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, sort_keys=True, indent=2) + '\n', encoding='utf-8')
    print('CONNECT_PRODUCTION_PAGING_STATUS=' + result['delivery_status'])
    print('EXTERNAL_PAGING_QUALIFIED=false')
    return 0 if result['production_guard_passed'] else 2


if __name__ == '__main__':
    raise SystemExit(main())
