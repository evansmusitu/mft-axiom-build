#!/usr/bin/env python3
import json, pathlib, re, subprocess, sys
ROOT = pathlib.Path(__file__).resolve().parents[3]
HERE = pathlib.Path(__file__).resolve().parent
BASE = json.loads((HERE/'HOSTED_CAPABILITY_BASELINE.json').read_text())
LEDGER = (HERE/'FRONTIER_PARITY_LEDGER.md').read_text()
RELEASE = json.loads((HERE/'RELEASE_CANDIDATE.json').read_text())
SOURCE = json.loads((HERE/'SOURCE_ARTIFACT.json').read_text())

def git_blob(path):
    p = subprocess.run(['git','hash-object',str(path)], cwd=ROOT, text=True, capture_output=True)
    if p.returncode:
        raise RuntimeError(p.stderr.strip())
    return p.stdout.strip()

checks=[]
def check(name, ok, detail=''):
    checks.append((name,bool(ok),detail))

# Preserve every hosted customer-requested capability at its authoritative blob.
for rel,want in BASE['required_paths'].items():
    p=ROOT/rel
    check('hosted_path_exists:'+rel,p.is_file(), 'missing' if not p.is_file() else '')
    if p.is_file():
        got=git_blob(p)
        check('hosted_blob_pinned:'+rel,got==want,f'got={got} want={want}')

for route in BASE['required_public_routes']:
    check('route_declared:'+route, route in LEDGER)
install=(ROOT/'commerce/chemistry/storefront/install.mjs').read_text(errors='ignore')
for family in BASE['required_platform_families']:
    check('platform_family:'+family, family in install)

# The exact universal build source is a sealed artifact rather than a generated binary dump in Git.
check('source_artifact_schema',SOURCE.get('schema')=='musitu.chemistry.frontier_universal.source_artifact.v1')
check('source_artifact_hash',bool(re.fullmatch(r'[0-9a-f]{64}',str(SOURCE.get('artifact_sha256','')))))
check('source_artifact_nonempty',int(SOURCE.get('artifact_bytes',0))>0 and int(SOURCE.get('artifact_file_count',0))>=20)
check('source_artifact_no_private_keys',SOURCE.get('contains_private_keys') is False)
check('source_artifact_no_payment_secrets',SOURCE.get('contains_payment_secrets') is False)
check('source_artifact_no_publication_authority',SOURCE.get('publication_authority') is False)
required_source=[
 'source/index.html','source/app.js','source/commercial.js','source/content.json','source/frontier.js','source/frontier.css',
 'source/manifest.webmanifest','source/sw.js','build_frontier_universal.py','verify_frontier_universal.py',
 'binary/frontier_android_binary_overlay.zip.b64'
]
for rel in required_source:
    check('source_hash_pinned:'+rel,bool(re.fullmatch(r'[0-9a-f]{64}',str(SOURCE.get('internal_sha256s',{}).get(rel,'')))))
check('source_rebuild_62',SOURCE.get('rebuild_evidence',{}).get('verification')=='62/62 PASS')
check('frontier_contract_46',SOURCE.get('candidate_verification',{}).get('frontier_contract')=='46/46 PASS')
check('commercial_crypto_25',SOURCE.get('candidate_verification',{}).get('commercial_crypto')=='25/25 PASS')
check('strict_script_csp_evidence',SOURCE.get('candidate_verification',{}).get('strict_script_csp') is True)
check('scientific_response_evidence',SOURCE.get('candidate_verification',{}).get('scientific_response_os') is True)
check('offline_authority_evidence',SOURCE.get('candidate_verification',{}).get('offline_payment_authority') is False)

src_ref=RELEASE.get('source_artifact',{})
check('release_source_pointer',src_ref.get('pointer')=='SOURCE_ARTIFACT.json')
check('release_source_hash_matches',src_ref.get('sha256')==SOURCE.get('artifact_sha256'))
check('release_source_library_id_matches',src_ref.get('library_file_id')==SOURCE.get('library_file_id'))
check('release_repro_apk_matches',RELEASE.get('reproducibility',{}).get('unsigned_repro_apk_sha256')==SOURCE.get('rebuild_evidence',{}).get('unsigned_apk_sha256'))
check('release_repro_web_matches',RELEASE.get('reproducibility',{}).get('repro_web_zip_sha256')==SOURCE.get('rebuild_evidence',{}).get('web_zip_sha256'))
check('hosted_baseline_reference',RELEASE.get('hosted_capability_parity',{}).get('baseline')=='HOSTED_CAPABILITY_BASELINE.json')
check('hosted_gate_reference',RELEASE.get('hosted_capability_parity',{}).get('gate')=='verify_frontier_parity.py')
check('publication_false', RELEASE.get('publication',{}).get('authorized') is False and RELEASE.get('publication',{}).get('production_deployed') is False and RELEASE.get('publication',{}).get('production_apk_replaced') is False)
check('no_frontier_deployer', not any('deploy' in p.name.lower() for p in HERE.rglob('*') if p.is_file()))

failed=[x for x in checks if not x[1]]
for name,ok,detail in checks:
    print(('PASS' if ok else 'FAIL'),name,detail)
print(f'FRONTIER_PARITY_CHECKS={len(checks)} PASS={len(checks)-len(failed)} FAIL={len(failed)}')
if failed:
    sys.exit(1)
print('MUSITU_CHEMISTRY_FRONTIER_PARITY_PASS')
