import base64
import hashlib
import importlib.metadata
import json
import os
import pathlib
import platform
import subprocess
import sys
import uuid

import modal

APP_NAME = 'musitu-forge-private-staging'
SOURCE_COMMIT = 'f0e805ae298b4720f9263dc15d10f4864b385669'
PROTOCOL_DIGEST = 'c9fe2c0dcbc51ed7329aeea8b8d9985c0ccfc70123ac181c755285f1a0fbf3de'
STATE_ROOT = pathlib.Path('/var/lib/musitu-forge')
ASSIGNMENT_KEY_ID = 'forge-assignment-pilot-v1'
RECEIPT_KEY_ID = 'forge-receipt-pilot-v1'

image = (
    modal.Image.debian_slim(python_version='3.12')
    .pip_install(
        'cffi==2.1.1',
        'cryptography==50.0.1',
        'pycparser==3.0',
        'fastapi==0.128.2',
        'httpx==0.28.1',
        'uvicorn==0.38.0',
    )
    .add_local_dir('runtime', '/opt/forge/runtime', copy=True)
)
state = modal.Volume.from_name('musitu-forge-state', create_if_missing=True)
app = modal.App(APP_NAME, include_source=True)


def _write_private_key(path: pathlib.Path) -> None:
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    key = Ed25519PrivateKey.generate()
    path.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
    )
    os.chmod(path, 0o600)


def _public_key_record(path: pathlib.Path, key_id: str) -> dict[str, str]:
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    key = serialization.load_pem_private_key(path.read_bytes(), password=None)
    if not isinstance(key, Ed25519PrivateKey):
        raise TypeError('pilot_signing_key_not_ed25519')
    raw = key.public_key().public_bytes(
        serialization.Encoding.Raw,
        serialization.PublicFormat.Raw,
    )
    return {
        'key_id': key_id,
        'public_key_base64': base64.b64encode(raw).decode('ascii'),
        'public_key_sha256': hashlib.sha256(raw).hexdigest(),
    }


def _initialize_state() -> dict[str, object]:
    STATE_ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(STATE_ROOT, 0o700)
    for name in ('custody', 'sessions', 'uploads', 'keys'):
        p = STATE_ROOT / name
        p.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(p, 0o700)

    registry = STATE_ROOT / 'activation_registry.json'
    if not registry.exists():
        registry.write_text(
            json.dumps(
                {'schema': 'musitu.forge.activation_registry.v1', 'activations': []},
                sort_keys=True,
                separators=(',', ':'),
            ) + '\n',
            encoding='utf-8',
        )
        os.chmod(registry, 0o600)
    elif registry.is_symlink() or not registry.is_file():
        raise RuntimeError('activation_registry_invalid')
    else:
        os.chmod(registry, 0o600)

    assignment = STATE_ROOT / 'keys' / 'assignment.pem'
    receipt = STATE_ROOT / 'keys' / 'receipt.pem'
    if not assignment.exists():
        _write_private_key(assignment)
    if not receipt.exists():
        _write_private_key(receipt)
    for key_path in (assignment, receipt):
        if key_path.is_symlink() or not key_path.is_file():
            raise RuntimeError('pilot_signing_key_invalid')
        os.chmod(key_path, 0o600)

    identity_path = STATE_ROOT / 'deployment_identity.json'
    if not identity_path.exists():
        identity_path.write_text(
            json.dumps(
                {
                    'schema': 'musitu.forge.pilot_state_identity.v1',
                    'state_id': str(uuid.uuid4()),
                    'source_commit_at_creation': SOURCE_COMMIT,
                    'production_authorized': False,
                },
                sort_keys=True,
                separators=(',', ':'),
            ) + '\n',
            encoding='utf-8',
        )
        os.chmod(identity_path, 0o600)
    identity = json.loads(identity_path.read_text(encoding='utf-8'))
    return {
        'identity': identity,
        'assignment': _public_key_record(assignment, ASSIGNMENT_KEY_ID),
        'receipt': _public_key_record(receipt, RECEIPT_KEY_ID),
    }


def _backend_env() -> dict[str, str]:
    env = dict(os.environ)
    env.update(
        {
            'PYTHONPATH': '/opt/forge/runtime',
            'FORGE_QUALIFIED_CORE_ROOT': '/opt/forge/runtime',
            'FORGE_QUALIFIED_CORE_FIELD_PILOT_SHA256': '70e87784d402ca8ecbb1d34dd82bd5ad8f041612f30fec7e697da8e6bcfa3ca0',
            'FORGE_QUALIFIED_CORE_REVIEW_FIELD_PILOT_SHA256': '128f6e0dc78ece85b8c001d726f14d48dc4c635afe4b4ede6575fb201fe6f695',
            'FORGE_QUALIFIED_CORE_REVIEW_FIELD_DATASET_SHA256': '28d4e15f483080576b31474a10746fb025e94ddfa99fa77c1ed04283341c311d',
            'FORGE_QUALIFIED_CORE_FIELD_DATASET_SHA256': '28d4e15f483080576b31474a10746fb025e94ddfa99fa77c1ed04283341c311d',
            'FORGE_QUALIFIED_CORE_FAULT_FIELD_PILOT_SHA256': '128f6e0dc78ece85b8c001d726f14d48dc4c635afe4b4ede6575fb201fe6f695',
            'FORGE_RELEASE_ROOT': '/opt/forge/runtime',
            'FORGE_PROTOCOL_DIGEST': PROTOCOL_DIGEST,
            'FORGE_FIELD_CUSTODY_ROOT': str(STATE_ROOT / 'custody'),
            'FORGE_ACTIVATION_REGISTRY': str(STATE_ROOT / 'activation_registry.json'),
            'FORGE_SESSION_STATE_ROOT': str(STATE_ROOT / 'sessions'),
            'FORGE_UPLOAD_STATE_ROOT': str(STATE_ROOT / 'uploads'),
            'FORGE_ASSIGNMENT_SIGNING_KEY_ID': ASSIGNMENT_KEY_ID,
            'FORGE_ASSIGNMENT_SIGNING_KEY_FILE': str(STATE_ROOT / 'keys' / 'assignment.pem'),
            'FORGE_RECEIPT_SIGNING_KEY_ID': RECEIPT_KEY_ID,
            'FORGE_RECEIPT_SIGNING_KEY_FILE': str(STATE_ROOT / 'keys' / 'receipt.pem'),
            'FORGE_BIND_HOST': '127.0.0.1',
            'FORGE_BIND_PORT': '8787',
        }
    )
    return env


@app.function(
    image=image,
    name='runtime_probe',
    min_containers=0,
    max_containers=1,
    scaledown_window=30,
    timeout=120,
    volumes={'/var/lib/musitu-forge': state},
)
def runtime_probe():
    state.reload()
    keys = _initialize_state()
    state.commit()
    root = pathlib.Path('/opt/forge/runtime')
    manifest = json.loads((root / 'FORGE_PRIVATE_RUNTIME_MANIFEST.json').read_text())
    bad = []
    for item in manifest['files']:
        p = root / item['path']
        b = p.read_bytes() if p.is_file() else b''
        if not p.is_file() or len(b) != item['size'] or hashlib.sha256(b).hexdigest() != item['sha256']:
            bad.append(item['path'])
    return {
        'schema': 'musitu.forge.modal_private_pilot_probe.v4',
        'source_commit': SOURCE_COMMIT,
        'source_manifest_ok': not bad,
        'bad_files': bad,
        'protocol_digest': PROTOCOL_DIGEST,
        'python': platform.python_version(),
        'machine': platform.machine(),
        'libc': platform.libc_ver(),
        'packages': {name: importlib.metadata.version(name) for name in ('cryptography', 'cffi', 'pycparser', 'fastapi', 'httpx', 'uvicorn')},
        'persistent_state': keys['identity'],
        'assignment_authority': keys['assignment'],
        'receipt_authority': keys['receipt'],
        'production_authorized': False,
        'release_signing_authority': 'MUSITU_STORE',
    }


@app.function(
    image=image,
    name='forge_custody',
    min_containers=0,
    max_containers=1,
    scaledown_window=120,
    timeout=900,
    volumes={'/var/lib/musitu-forge': state},
)
@modal.asgi_app(requires_proxy_auth=True)
def forge_custody():
    import asyncio
    import contextlib

    import httpx
    from contextlib import asynccontextmanager
    from fastapi import FastAPI, Request, Response

    proc = None

    @asynccontextmanager
    async def lifespan(_app):
        nonlocal proc
        state.reload()
        _initialize_state()
        state.commit()
        proc = subprocess.Popen(
            [sys.executable, '-m', 'apps.musitu_forge_custody_server'],
            env=_backend_env(),
        )
        async with httpx.AsyncClient(timeout=2) as client:
            for _ in range(120):
                if proc.poll() is not None:
                    raise RuntimeError(f'custody_server_exited_{proc.returncode}')
                try:
                    response = await client.get('http://127.0.0.1:8787/v1/health')
                    if response.status_code == 200:
                        health = response.json()
                        if health.get('status') == 'READY' and health.get('production_authorized') is False:
                            break
                except Exception:
                    pass
                await asyncio.sleep(0.25)
            else:
                proc.terminate()
                raise RuntimeError('custody_server_not_ready')
        try:
            yield
        finally:
            if proc and proc.poll() is None:
                proc.terminate()
                with contextlib.suppress(Exception):
                    proc.wait(timeout=10)
            state.commit()

    api = FastAPI(lifespan=lifespan)

    @api.api_route('/{path:path}', methods=['GET', 'POST', 'PUT', 'OPTIONS', 'HEAD', 'DELETE', 'PATCH'])
    async def relay(path: str, request: Request):
        body = await request.body()
        headers = {
            k: v
            for k, v in request.headers.items()
            if k.lower() not in {'host', 'modal-key', 'modal-secret', 'content-length'}
        }
        async with httpx.AsyncClient(timeout=120, follow_redirects=False) as client:
            upstream = await client.request(
                request.method,
                'http://127.0.0.1:8787/' + path,
                params=request.query_params,
                headers=headers,
                content=body,
            )
        if request.method in {'POST', 'PUT', 'PATCH', 'DELETE'}:
            state.commit()
        out = {
            k: v
            for k, v in upstream.headers.items()
            if k.lower() not in {'connection', 'transfer-encoding', 'content-length', 'server'}
        }
        return Response(
            content=upstream.content,
            status_code=upstream.status_code,
            headers=out,
            media_type=None,
        )

    return api
