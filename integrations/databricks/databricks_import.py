"""Fail-closed, zero-compute Databricks notebook import. No secret or user identity logs."""
from __future__ import annotations

import base64
import json
import os
import re
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

HOST = 'https://dbc-3179c56f-a6c7.cloud.databricks.com'
PILOT_FOLDER = 'MUSITU_AXIOM_PRIVATE_PILOT_20261027'
NOTEBOOK_BASENAME = '01_musitu_axiom_selfcontained'
ALLOWED_ENDPOINTS = {
    ('GET', '/api/2.0/preview/scim/v2/Me'),
    ('GET', '/api/2.0/workspace/get-status'),
    ('POST', '/api/2.0/workspace/mkdirs'),
    ('POST', '/api/2.0/workspace/import'),
}


def validate_username(value: object) -> str:
    """Only an ordinary email, never a relative/absolute path."""
    if not isinstance(value, str) or len(value) > 254:
        raise ValueError('Unexpected Databricks identity format')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._%+\-]*@[A-Za-z0-9][A-Za-z0-9.\-]*\.[A-Za-z]{2,}', value):
        raise ValueError('Databricks userName was not an ordinary email address')
    if '..' in value or value.endswith('.'):
        raise ValueError('Unsafe Databricks identity path')
    return value


def make_import_payload(path: str, source: bytes) -> dict:
    if not isinstance(path, str) or not path.startswith('/Users/') or '/../' in path:
        raise ValueError('Notebook path must remain within a user home')
    if not isinstance(source, bytes) or not source.startswith(b'# Databricks notebook source\n'):
        raise ValueError('Source is not a Databricks Python notebook')
    if len(source) > 100_000:
        raise ValueError('Notebook exceeds pilot size ceiling')
    return {
        'path': path, 'format': 'SOURCE', 'language': 'PYTHON',
        'content': base64.b64encode(source).decode('ascii'), 'overwrite': False,
    }


def run_import(api, notebook_source: bytes) -> dict:
    """Import exactly one notebook; never overwrite, start compute, or run code."""
    user = api('GET', '/api/2.0/preview/scim/v2/Me')
    if not isinstance(user, dict):
        raise RuntimeError('Could not resolve workspace identity')
    username = validate_username(user.get('userName'))
    folder = f'/Users/{username}/{PILOT_FOLDER}'
    target = f'{folder}/{NOTEBOOK_BASENAME}'
    body = make_import_payload(target, notebook_source)
    existing = api('GET', '/api/2.0/workspace/get-status', params={'path': target})
    if existing is not None:
        raise RuntimeError('Target notebook already exists; refusing to overwrite')
    api('POST', '/api/2.0/workspace/mkdirs', payload={'path': folder})
    api('POST', '/api/2.0/workspace/import', payload=body)
    status = api('GET', '/api/2.0/workspace/get-status', params={'path': target})
    if not isinstance(status, dict) or status.get('object_type') != 'NOTEBOOK' or status.get('language') != 'PYTHON':
        raise RuntimeError('Import response could not be verified as Python notebook')
    return {'status': 'IMPORTED_AND_VERIFIED', 'object_id': status.get('object_id')}


def make_databricks_api(token: str):
    if not token or '\n' in token or '\r' in token:
        raise ValueError('Missing or malformed Databricks token')

    def api(method: str, path: str, payload: dict | None = None, params: dict | None = None):
        if (method, path) not in ALLOWED_ENDPOINTS:
            raise RuntimeError('API operation is not allowed in pilot')
        if method == 'POST' and params:
            raise RuntimeError('Unexpected API query parameter on write')
        uri = HOST + path + (('?' + urlencode(params)) if params else '')
        data = json.dumps(payload, separators=(',', ':')).encode() if payload is not None else None
        request = Request(uri, method=method, data=data, headers={
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        })
        try:
            with urlopen(request, timeout=25) as response:
                if response.status not in (200, 201):
                    raise RuntimeError(f'Databricks API returned HTTP {response.status}')
                raw = response.read(1_000_000)
                return json.loads(raw.decode()) if raw else {}
        except HTTPError as exc:
            if method == 'GET' and path == '/api/2.0/workspace/get-status' and exc.code == 404:
                return None
            raise RuntimeError(f'Databricks endpoint rejected request with HTTP {exc.code}') from None
        except URLError:
            raise RuntimeError('Databricks HTTPS connection failed') from None
    return api


def main() -> int:
    notebook_path = Path(__file__).resolve().parent / 'notebooks' / '01_musitu_axiom_selfcontained.py'
    source = notebook_path.read_bytes()
    result = run_import(make_databricks_api(os.environ['DATABRICKS_TOKEN']), source)
    if not isinstance(result.get('object_id'), int):
        raise RuntimeError('Missing Databricks notebook identifier')
    print('MUSITU_DATABRICKS_NOTEBOOK_IMPORT_VERIFIED')
    print(f"DATABRICKS_NOTEBOOK_OBJECT_ID={result['object_id']}")
    print('DATABRICKS_COMPUTE_NOT_STARTED')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, RuntimeError) as error:
        print('MUSITU_DATABRICKS_NOTEBOOK_IMPORT_FAILED: ' + str(error), file=sys.stderr)
        sys.exit(1)
