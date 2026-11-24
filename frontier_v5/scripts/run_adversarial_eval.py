#!/usr/bin/env python3
"""Score the prompt-injection detector that LiveResearchAdapter actually uses.

Each corpus case is pushed through ``fullstack.LiveResearchAdapter.fetch`` with
an in-process fake transport (no DNS lookup, no socket), so the score reflects
the production retrieval path rather than a standalone class. Benign cases are
scored too, so false positives are measured alongside missed attacks.
"""
import hashlib
import json
import os
import pathlib
import socket
import sys
from unittest.mock import patch

from frontier_v5.runtime import fullstack, fullstack_base, malicious_file_guard, retrieval_security

root = pathlib.Path(__file__).resolve().parents[1]
cases = json.loads((root / 'evals/adversarial_retrieval_cases.json').read_text(encoding='utf-8'))
PUBLIC = [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('93.184.216.34', 443))]


class _Response:
    status = 200

    def __init__(self, body: bytes) -> None:
        self._body = body

    def getheader(self, name, default=None):
        return 'text/plain; charset=utf-8' if name.casefold() == 'content-type' else default

    def read(self, limit):
        return self._body[:limit]


class _Connection:
    body = b''

    def __init__(self, host, port, addresses, timeout):
        pass

    def request(self, method, target, headers=None):
        pass

    def getresponse(self):
        return _Response(type(self).body)

    def close(self):
        pass


def adapter_flags(text: str) -> list:
    _Connection.body = text.encode('utf-8')
    adapter = fullstack.LiveResearchAdapter({'evidence.example'})
    with patch('socket.getaddrinfo', return_value=PUBLIC), patch.object(fullstack, '_PinnedHTTPSConnection', _Connection):
        return list(adapter.fetch('https://evidence.example/case').injection_flags)


# The adapter calls fullstack_base.RetrievedContentFirewall; every production
# import path must resolve to that same class.
used = fullstack_base.RetrievedContentFirewall
paths = {
    'fullstack': fullstack.RetrievedContentFirewall,
    'fullstack_base': fullstack_base.RetrievedContentFirewall,
    'malicious_file_guard': malicious_file_guard.RetrievedContentFirewall,
    'retrieval_security': retrieval_security.RetrievedContentFirewall,
}
divergent = sorted(name for name, impl in paths.items() if impl is not used)

rows = []
failed = []
for c in cases:
    got = adapter_flags(c['text'])
    expected = sorted(c['flags'])
    ok = got == expected and got == list(used.scan(c['text']))
    rows.append({'id': c['id'], 'pass': ok, 'expected': expected, 'got': got})
    if not ok:
        failed.append(c['id'])
benign = [r for r in rows if not r['expected']]
attacks = [r for r in rows if r['expected']]
false_positives = [r['id'] for r in benign if r['got']]
false_negatives = [r['id'] for r in attacks if not r['got']]
status = 'PASS' if not failed and not divergent else 'FAIL'
body = json.dumps(rows, sort_keys=True, separators=(',', ':')).encode()
out = {
    'schema': 'musitu.axiom.frontier.adversarial.v2',
    'implementation': f'{used.__module__}.{used.__qualname__}',
    'evaluated_via': 'frontier_v5.runtime.fullstack.LiveResearchAdapter.fetch',
    'divergent_implementations': divergent,
    'count': len(rows),
    'passed': len(rows) - len(failed),
    'attack_count': len(attacks),
    'benign_count': len(benign),
    'false_positives': false_positives,
    'false_negatives': false_negatives,
    'failed': failed,
    'status': status,
    'suite_sha256': hashlib.sha256(body).hexdigest(),
    'rows': rows,
}
output = os.environ.get('MUSITU_ADVERSARIAL_EVAL_OUTPUT', '')
if output:  # opt-in: never write to a fixed shared path
    pathlib.Path(output).write_text(json.dumps(out, indent=2), encoding='utf-8')
print(json.dumps({k: out[k] for k in ('status', 'implementation', 'count', 'passed', 'attack_count', 'benign_count',
                                      'false_positives', 'false_negatives', 'failed', 'divergent_implementations',
                                      'suite_sha256')}))
if status != 'PASS':
    for row in rows:
        if not row['pass']:
            print(json.dumps(row, sort_keys=True))
    sys.exit(2)
print('MUSITU_AXIOM_FRONTIER_ADVERSARIAL_PASS')
