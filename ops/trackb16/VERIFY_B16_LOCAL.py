#!/usr/bin/env python3
"""Verifies B16 standalone offline S0 candidate only; never claims Workers runtime PASS."""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

BASE=Path(__file__).resolve().parent
PKGROOT=BASE.parent.parent
MANIFEST=BASE/'MANIFEST_B16.sha256'
lines=MANIFEST.read_text(encoding='utf-8').splitlines()
seen=set()
for line in lines:
    parts=line.split('  ',1)
    if len(parts)!=2 or len(parts[0])!=64:sys.exit('B16_MANIFEST_BAD_FORMAT')
    digest,name=parts
    rel=Path(name)
    if rel.is_absolute() or '..' in rel.parts or name in seen:sys.exit('B16_MANIFEST_UNSAFE_PATH')
    seen.add(name)
    f=PKGROOT/rel
    if not f.is_file() or hashlib.sha256(f.read_bytes()).hexdigest()!=digest:
        sys.exit('B16_MANIFEST_MISMATCH: '+name)
print('B16_MANIFEST_SHA256_PASS files='+str(len(lines)),flush=True)
for rel in ['src/identity.mjs','src/worker.mjs','src/admission.mjs','test/fixture_workload_key.mjs','test/admission.test.mjs','test/fixture_key.mjs',
            'test/identity.test.mjs','test/routing.test.mjs','test/runtime.test.mjs',
            'vitest.config.mjs']:
    r=subprocess.run(['node','--check',str(BASE/rel)],text=True,capture_output=True)
    if r.returncode:sys.exit('B16_SYNTAX_FAIL '+rel+': '+r.stderr[-500:])
print('B16_NODE_SYNTAX_PASS 10/10',flush=True)
run=subprocess.run(['node','--test',str(BASE/'test/identity.test.mjs'),
                    str(BASE/'test/routing.test.mjs'),str(BASE/'test/admission.test.mjs')],text=True,capture_output=True)
if run.returncode or '# tests 54' not in run.stdout or '# pass 54' not in run.stdout or '# fail 0' not in run.stdout:
    print(run.stdout[-2500:]);print(run.stderr[-500:])
    sys.exit('B16_LOCAL_TESTS_NOT_PROVEN')
print('B16_IDENTITY_ROUTING_INDEPENDENT_WORKLOAD_TESTS_PASS 54/54',flush=True)
config=json.loads((BASE/'wrangler.jsonc').read_text())
if (config.get('name')!='axiom-b16-s0-local-disabled' or
    config.get('vars',{}).get('AXIOM_ACCOUNT_ID')!='axiom-s0-isolated' or
    not config.get('vars',{}).get('AUTHORITY_ED25519_PUBKEY_B64') or
    config.get('vars',{}).get('WORKLOAD_AUTH_ED25519_PUBKEY_B64') == config.get('vars',{}).get('AUTHORITY_ED25519_PUBKEY_B64') or
    not config.get('vars',{}).get('WORKLOAD_AUTH_ED25519_PUBKEY_B64') or
    'status:503' not in (BASE/'src/worker.mjs').read_text()):
    sys.exit('B16_S0_PUBLIC_OR_AUTHORIZATION_GUARD_FAIL')
print('B16_S0_PUBLIC_FETCH_503_AND_SYNTHETIC_CONFIG_PASS',flush=True)
print('AXIOM_B16_LOCAL_S0_WORKLOAD_AUTH_VERIFY_PASS_CLOUDFLARE_RUNTIME_NOT_PROVEN')
