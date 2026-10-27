"""One-shot, no-compute, no-overwrite synthetic notebook import into caller home."""
from __future__ import annotations
import base64
import json
import os
import pathlib
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

WORKSPACE_HOST = 'https://dbc-3179c56f-a6c7.cloud.databricks.com'
PREFIX = 'MUSITU_AXIOM_DATABRICKS_PILOT_20261027'
NOTEBOOK_NAME = '01_musitu_axiom_selfcontained'


def deploy(request, source: bytes) -> str:
    if not source or len(source) > 100_000:
        raise ValueError('Notebook source missing or exceeds pilot limit')
    identity = request('GET', '/api/2.0/preview/scim/v2/Me')
    username = identity.get('userName', '') if isinstance(identity, dict) else ''
    if not isinstance(username, str) or not re.fullmatch(r'[A-Za-z0-9._+@-]{1,180}', username) or '..' in username:
        raise ValueError('Caller user name is not safe for workspace path')
    folder = f'/Users/{username}/{PREFIX}'
    notebook = f'{folder}/{NOTEBOOK_NAME}'
    status_path = '/api/2.0/workspace/get-status?' + urlencode({'path': notebook})
    existing = request('GET', status_path)
    if existing is not None:
        if not isinstance(existing, dict) or existing.get('object_type') != 'NOTEBOOK':
            raise ValueError('Target workspace path occupied by unexpected object')
        return 'ALREADY_EXISTS'
    request('POST', '/api/2.0/workspace/mkdirs', {'path': folder})
    request('POST', '/api/2.0/workspace/import', {
        'path': notebook,
        'format': 'SOURCE',
        'language': 'PYTHON',
        'content': base64.b64encode(source).decode('ascii'),
        'overwrite': False,
    })
    check = request('GET', status_path)
    if not isinstance(check, dict) or check.get('object_type') != 'NOTEBOOK':
        raise ValueError('Import was not independently verified')
    return 'IMPORTED'


def databricks_request(method: str, path: str, payload=None):
    token = os.environ.get('DATABRICKS_TOKEN', '')
    if not token:
        raise RuntimeError('DATABRICKS_TOKEN missing')
    if method not in ('GET', 'POST') or not path.startswith('/api/2.0/'):
        raise RuntimeError('Unexpected method/path')
    data = json.dumps(payload, separators=(',', ':')).encode() if payload is not None else None
    req = Request(WORKSPACE_HOST + path, data=data, method=method, headers={
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
    })
    try:
        with urlopen(req, timeout=30) as response:
            raw = response.read(150_000)
            return json.loads(raw) if raw else {}
    except HTTPError as e:
        if method == 'GET' and '/api/2.0/workspace/get-status?' in path and e.code == 404:
            return None
        raise RuntimeError(f'Databricks API {method} failed with HTTP {e.code}') from None
    except URLError:
        raise RuntimeError('Databricks API network error') from None


def main():
    source = pathlib.Path(__file__).resolve().parents[1] / 'notebooks' / '01_musitu_axiom_selfcontained.py'
    try:
        verdict = deploy(databricks_request, source.read_bytes())
        print(f'MUSITU_DATABRICKS_PILOT_NOTEBOOK_{verdict}; no compute executed')
    except (ValueError, RuntimeError, OSError) as e:
        print(f'::error::{type(e).__name__}: {e}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
