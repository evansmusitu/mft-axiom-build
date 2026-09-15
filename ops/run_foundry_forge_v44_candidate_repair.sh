#!/usr/bin/env bash
set -euo pipefail

: "${MODAL_TOKEN_ID:?MODAL_TOKEN_ID required}"
: "${MODAL_TOKEN_SECRET:?MODAL_TOKEN_SECRET required}"
: "${CLOUDFLARE_GLOBAL_API_KEY:?CLOUDFLARE_GLOBAL_API_KEY required}"
: "${GITHUB_TOKEN:?GITHUB_TOKEN required}"

FORGE_MODAL_APP='musitu-forge-v44-media-candidate'
PAYLOAD_DIR='deploy_payload/foundry_forge_v3'
FORGE_PROTOCOL_DIGEST='c9fe2c0dcbc51ed7329aeea8b8d9985c0ccfc70123ac181c755285f1a0fbf3de'
V46_EVIDENCE_HEAD='9967e7b64641aa92d5b48cb195f89db97438d2bd'
V46_EXECUTABLE_SOURCE_COMMIT='f0e805ae298b4720f9263dc15d10f4864b385669'
MEDIA_ARTIFACT_ID='10383022629'
MEDIA_ARTIFACT_BYTES='191975531'
MEDIA_ARTIFACT_SHA256='bf7d35e39d289193b6bf5173a21e3c0f80856bb741c61ef2ebbcd12b7c939c8a'
MEDIA_TGZ_SHA256='0505c249624985dfd05c80fd8826015d0b5036cd9854f4aa3d36f3cc5a5bb8e4'
FFMPEG_SHA256='e8a8d46f5225f3062cec7c07fb145d58ae73c603cb740dcd5bad34bfb54e455a'
FFPROBE_SHA256='cefc5f81c0b18429cdbf8fa5a89e1e9c759235e10f93f9b329ff1b2fdff26f46'
VIDEO_ADAPTER_SHA256='2b72d255e314ec9091f13ecc5c7affdb7702ab5f1ec387179dfdfbbbfd017953'
DERIVED_FIELD_BLOB='f570400ea59c8fa9426c247a4345299b6db1c020'
DERIVED_UPLOAD_BLOB='00a36b90604c93d39ca67fdfa579393a266fd868'
VIDEO_V2_BLOB='6f85e82ea447d3e9ebc4c77feaa55a6a6a684f1f'

python -m pip install --disable-pip-version-check --quiet 'modal==1.5.5'
modal app list --json >/dev/null

rm -rf runtime media-closure /tmp/v44-recovery /tmp/FOUNDRY_PRIVATE_STAGING_TRANSPORT_V3.json /tmp/v44-media-recovery.zip
cat \
  "$PAYLOAD_DIR/bundle.part.00.txt" \
  "$PAYLOAD_DIR/bundle.part.01.txt" \
  "$PAYLOAD_DIR/bundle.part.02.txt" \
  "$PAYLOAD_DIR/bundle.part.03.00.txt" \
  "$PAYLOAD_DIR/bundle.part.03.01.txt" \
  "$PAYLOAD_DIR/bundle.part.03.02.txt" \
  "$PAYLOAD_DIR/bundle.part.04.00a.txt" \
  "$PAYLOAD_DIR/bundle.part.04.00b.txt" \
  "$PAYLOAD_DIR/bundle.part.04.01.txt" \
  "$PAYLOAD_DIR/bundle.part.04.02.correct.txt" \
  > /tmp/FOUNDRY_PRIVATE_STAGING_TRANSPORT_V3.json

test "$(stat -c %s /tmp/FOUNDRY_PRIVATE_STAGING_TRANSPORT_V3.json)" = '72860'
test "$(sha256sum /tmp/FOUNDRY_PRIVATE_STAGING_TRANSPORT_V3.json | awk '{print $1}')" = '07aa7a330de816bb6a22e9954435fd4a26807eec6a124482c99ef35224253e86'
python - <<'PY'
import base64, hashlib, json, pathlib
p=pathlib.Path('/tmp/FOUNDRY_PRIVATE_STAGING_TRANSPORT_V3.json')
b=json.loads(p.read_text())
if b['schema']!='musitu.foundry_forge.private_payload_transport_bundle.v3': raise SystemExit('bundle_schema_mismatch')
if b['source_commit']!='f0e805ae298b4720f9263dc15d10f4864b385669': raise SystemExit('source_commit_mismatch')
c=dict(b); expected=c.pop('bundle_content_sha256')
if hashlib.sha256(json.dumps(c,sort_keys=True,separators=(',',':')).encode()).hexdigest()!=expected: raise SystemExit('bundle_content_digest_mismatch')
m=b['envelope']; km=b['transport_key_manifest']
cipher=base64.b64decode(b['ciphertext_base64'],validate=True)
wrapped=base64.b64decode(b['wrapped_master_secret_base64'],validate=True)
encpriv=base64.b64decode(b['transport_private_key_encrypted_base64'],validate=True)
if hashlib.sha256(cipher).hexdigest()!=m['ciphertext_sha256']: raise SystemExit('ciphertext_mismatch')
if hashlib.sha256(wrapped).hexdigest()!=m['wrapped_master_secret_sha256']: raise SystemExit('wrapped_secret_mismatch')
if hashlib.sha256(encpriv).hexdigest()!=km['encrypted_private_key_sha256']: raise SystemExit('encrypted_private_key_mismatch')
if hashlib.sha256(b['transport_public_key_pem'].encode()).hexdigest()!=km['public_key_sha256']: raise SystemExit('public_key_mismatch')
if b['plaintext_source_committed'] is not False or b['private_signing_material_included'] is not False: raise SystemExit('transport_truth_boundary_mismatch')
pathlib.Path('/tmp/payload.enc').write_bytes(cipher)
pathlib.Path('/tmp/master.wrapped').write_bytes(wrapped)
pathlib.Path('/tmp/private.pem.enc').write_bytes(encpriv)
PY
openssl enc -d -aes-256-cbc -pbkdf2 -iter 250000 -in /tmp/private.pem.enc -out /tmp/private.pem -pass env:CLOUDFLARE_GLOBAL_API_KEY
chmod 600 /tmp/private.pem
openssl pkeyutl -decrypt -inkey /tmp/private.pem -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 -pkeyopt rsa_mgf1_md:sha256 -in /tmp/master.wrapped -out /tmp/master.secret
python - <<'PY'
import hashlib,hmac,json,pathlib
b=json.loads(pathlib.Path('/tmp/FOUNDRY_PRIVATE_STAGING_TRANSPORT_V3.json').read_text()); m=b['envelope']
master=pathlib.Path('/tmp/master.secret').read_bytes(); cipher=pathlib.Path('/tmp/payload.enc').read_bytes()
if len(master)!=32: raise SystemExit('master_secret_size_invalid')
hkey=hashlib.sha256(b'musitu.foundry_forge.private_payload.hmac.v3\0'+master).digest()
if not hmac.compare_digest(hmac.new(hkey,cipher,hashlib.sha256).hexdigest(),m['ciphertext_hmac_sha256']): raise SystemExit('ciphertext_hmac_mismatch')
pathlib.Path('/tmp/master.hex').write_text(master.hex())
PY
MASTER_HEX="$(cat /tmp/master.hex)"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 250000 -in /tmp/payload.enc -out /tmp/runtime.tar.gz -pass pass:"$MASTER_HEX"
python - <<'PY'
import hashlib,json,pathlib
b=json.loads(pathlib.Path('/tmp/FOUNDRY_PRIVATE_STAGING_TRANSPORT_V3.json').read_text()); m=b['envelope']; raw=pathlib.Path('/tmp/runtime.tar.gz').read_bytes()
if len(raw)!=m['plaintext_tar_gz_bytes'] or hashlib.sha256(raw).hexdigest()!=m['plaintext_tar_gz_sha256']: raise SystemExit('plaintext_archive_mismatch')
PY
mkdir runtime
tar -xzf /tmp/runtime.tar.gz -C runtime
python - <<'PY'
import hashlib,json,pathlib
root=pathlib.Path('runtime'); m=json.loads((root/'FORGE_PRIVATE_RUNTIME_MANIFEST.json').read_text())
assert m['schema']=='musitu.foundry_forge.private_runtime_minimal_source.v3'
assert m['source_commit']=='f0e805ae298b4720f9263dc15d10f4864b385669'
assert m['target_runtime']['canonical_boot_health']=='PASS'
assert m['staging_truth_boundary']['production_authorized'] is False
bad=[]
for f in m['files']:
    p=root/f['path']; data=p.read_bytes() if p.is_file() else b''
    if not p.is_file() or len(data)!=f['size'] or hashlib.sha256(data).hexdigest()!=f['sha256']: bad.append(f['path'])
if bad: raise SystemExit('internal_manifest_mismatch '+repr(bad))
print('runtime_transport=PASS')
PY
rm -f /tmp/private.pem /tmp/private.pem.enc /tmp/master.secret /tmp/master.hex /tmp/master.wrapped /tmp/payload.enc /tmp/runtime.tar.gz

OVERLAY_DIR='runtime/apps/musitu_forge_custody_server'
BASE="https://raw.githubusercontent.com/evansmusitu/musitu-foundry-forge/$V46_EVIDENCE_HEAD/apps/musitu_forge_custody_server"
curl --fail --silent --show-error --location "$BASE/derived_field_dataset_admission.py" -o "$OVERLAY_DIR/derived_field_dataset_admission.py"
curl --fail --silent --show-error --location "$BASE/derived_upload_custody.py" -o "$OVERLAY_DIR/derived_upload_custody.py"
curl --fail --silent --show-error --location "$BASE/video_derivation_v2.py" -o "$OVERLAY_DIR/video_derivation_v2.py"
test "$(git hash-object "$OVERLAY_DIR/derived_field_dataset_admission.py")" = "$DERIVED_FIELD_BLOB"
test "$(git hash-object "$OVERLAY_DIR/derived_upload_custody.py")" = "$DERIVED_UPLOAD_BLOB"
test "$(git hash-object "$OVERLAY_DIR/video_derivation_v2.py")" = "$VIDEO_V2_BLOB"
test "$(sha256sum "$OVERLAY_DIR/video_derivation_v2.py" | awk '{print $1}')" = "$VIDEO_ADAPTER_SHA256"
python -m py_compile \
  "$OVERLAY_DIR/derived_field_dataset_admission.py" \
  "$OVERLAY_DIR/derived_upload_custody.py" \
  "$OVERLAY_DIR/video_derivation_v2.py"
echo 'v46_activation_overlay=PASS'

curl --fail --silent --show-error --location \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/evansmusitu/mft-axiom-build/actions/artifacts/$MEDIA_ARTIFACT_ID/zip" \
  -o /tmp/v44-media-recovery.zip
test "$(stat -c %s /tmp/v44-media-recovery.zip)" = "$MEDIA_ARTIFACT_BYTES"
test "$(sha256sum /tmp/v44-media-recovery.zip | awk '{print $1}')" = "$MEDIA_ARTIFACT_SHA256"
mkdir /tmp/v44-recovery
unzip -q /tmp/v44-media-recovery.zip -d /tmp/v44-recovery
test "$(sha256sum /tmp/v44-recovery/recovery/v44-media-closure-candidate.tgz | awk '{print $1}')" = "$MEDIA_TGZ_SHA256"
python - <<'PY'
import json, pathlib
r=json.loads(pathlib.Path('/tmp/v44-recovery/recovery/recovery-report.json').read_text())
if r['schema']!='musitu.foundry_forge.v44_media_recovery.v1': raise SystemExit('recovery_schema_mismatch')
gates=r['fail_closed_gates']
if not all(gates.get(k) is True for k in ('exact_binary_pins','no_copy_collisions','non_glibc_count_matches_v44','same_recursive_dependency_paths')): raise SystemExit('recovery_gate_failed')
if r['non_glibc_dependency_count']!=207 or r['resolved_loaded_path_count']!=211: raise SystemExit('recovery_count_mismatch')
if r['executable_sha256']['ffmpeg']!='e8a8d46f5225f3062cec7c07fb145d58ae73c603cb740dcd5bad34bfb54e455a': raise SystemExit('ffmpeg_reference_mismatch')
if r['executable_sha256']['ffprobe']!='cefc5f81c0b18429cdbf8fa5a89e1e9c759235e10f93f9b329ff1b2fdff26f46': raise SystemExit('ffprobe_reference_mismatch')
PY
mkdir media-closure
tar -xzf /tmp/v44-recovery/recovery/v44-media-closure-candidate.tgz -C media-closure
test "$(find media-closure/opt/ffmpeg-libs -maxdepth 1 -type f | wc -l)" = '207'
test "$(sha256sum media-closure/opt/ffmpeg-bin/ffmpeg | awk '{print $1}')" = "$FFMPEG_SHA256"
test "$(sha256sum media-closure/opt/ffmpeg-bin/ffprobe | awk '{print $1}')" = "$FFPROBE_SHA256"

python - <<'PY'
from pathlib import Path
import re, subprocess
root=Path('media-closure/opt/ffmpeg-libs')
aliases=0
for p in sorted(root.iterdir()):
    if not p.is_file(): continue
    out=subprocess.check_output(['readelf','-d',str(p)],text=True,stderr=subprocess.DEVNULL)
    m=re.search(r'\(SONAME\).*\[(.*?)\]',out)
    if not m: raise SystemExit('missing_soname:'+p.name)
    soname=m.group(1)
    if soname==p.name: continue
    target=root/soname
    if target.exists() or target.is_symlink(): raise SystemExit('soname_collision:'+soname)
    target.symlink_to(p.name); aliases+=1
if aliases!=195: raise SystemExit(f'soname_alias_count_mismatch:{aliases}')
print('soname_aliases=195')
PY

test "$(git hash-object ops/foundry_forge_modal_pilot_v4.py)" = '66ddaa5f715fa1c7abde4305b8bdc2d58d2c1169'
cp ops/foundry_forge_modal_pilot_v4.py ops/foundry_forge_modal_candidate_v47_repair.py
python - <<'PY'
from pathlib import Path
p=Path('ops/foundry_forge_modal_candidate_v47_repair.py')
s=p.read_text()
def replace_once(old,new):
    global s
    if s.count(old)!=1: raise SystemExit('candidate_patch_anchor_mismatch:'+repr(old[:80]))
    s=s.replace(old,new)
replace_once("APP_NAME = 'musitu-forge-private-staging'", "APP_NAME = 'musitu-forge-v44-media-candidate'")
replace_once("modal.Image.debian_slim(python_version='3.12')", "modal.Image.from_registry('ubuntu:24.04', add_python='3.12')")
replace_once(".add_local_dir('runtime', '/opt/forge/runtime', copy=True)", ".add_local_dir('runtime', '/opt/forge/runtime', copy=True)\n    .add_local_dir('media-closure', '/opt/forge/media', copy=True)")
replace_once("modal.Volume.from_name('musitu-forge-state', create_if_missing=True)", "modal.Volume.from_name('musitu-forge-v44-media-candidate-state', create_if_missing=True)")
replace_once("for name in ('custody', 'sessions', 'uploads', 'keys'):", "for name in ('custody', 'sessions', 'uploads', 'keys', 'video-derivation'):")
replace_once(
    "            'FORGE_BIND_HOST': '127.0.0.1',",
    "            'FORGE_VIDEO_DERIVATION_ROOT': str(STATE_ROOT / 'video-derivation'),\n"
    "            'FORGE_VIDEO_DERIVATION_ADAPTER_SHA256': '2b72d255e314ec9091f13ecc5c7affdb7702ab5f1ec387179dfdfbbbfd017953',\n"
    "            'FORGE_FFMPEG_FILE': '/opt/forge/media/opt/ffmpeg-bin/ffmpeg',\n"
    "            'FORGE_FFMPEG_SHA256': 'e8a8d46f5225f3062cec7c07fb145d58ae73c603cb740dcd5bad34bfb54e455a',\n"
    "            'FORGE_FFPROBE_FILE': '/opt/forge/media/opt/ffmpeg-bin/ffprobe',\n"
    "            'FORGE_FFPROBE_SHA256': 'cefc5f81c0b18429cdbf8fa5a89e1e9c759235e10f93f9b329ff1b2fdff26f46',\n"
    "            'LD_LIBRARY_PATH': '/opt/forge/media/opt/ffmpeg-libs',\n"
    "            'FORGE_BIND_HOST': '127.0.0.1',"
)
replace_once(
    "        'release_signing_authority': 'MUSITU_STORE',\n    }",
    "        'release_signing_authority': 'MUSITU_STORE',\n"
    "        'candidate_overlay_git_blobs': {\n"
    "            'derived_field_dataset_admission.py': (lambda b: hashlib.sha1(b'blob ' + str(len(b)).encode() + b'\\0' + b).hexdigest())((root / 'apps/musitu_forge_custody_server/derived_field_dataset_admission.py').read_bytes()),\n"
    "            'derived_upload_custody.py': (lambda b: hashlib.sha1(b'blob ' + str(len(b)).encode() + b'\\0' + b).hexdigest())((root / 'apps/musitu_forge_custody_server/derived_upload_custody.py').read_bytes()),\n"
    "            'video_derivation_v2.py': (lambda b: hashlib.sha1(b'blob ' + str(len(b)).encode() + b'\\0' + b).hexdigest())((root / 'apps/musitu_forge_custody_server/video_derivation_v2.py').read_bytes()),\n"
    "        },\n"
    "        'candidate_media': {\n"
    "            'libc': platform.libc_ver(),\n"
    "            'ffmpeg_sha256': hashlib.sha256(pathlib.Path('/opt/forge/media/opt/ffmpeg-bin/ffmpeg').read_bytes()).hexdigest(),\n"
    "            'ffprobe_sha256': hashlib.sha256(pathlib.Path('/opt/forge/media/opt/ffmpeg-bin/ffprobe').read_bytes()).hexdigest(),\n"
    "            'ffmpeg_version': subprocess.check_output(['/opt/forge/media/opt/ffmpeg-bin/ffmpeg','-version'], env=_backend_env(), text=True).splitlines()[0],\n"
    "            'ffprobe_version': subprocess.check_output(['/opt/forge/media/opt/ffmpeg-bin/ffprobe','-version'], env=_backend_env(), text=True).splitlines()[0],\n"
    "        },\n"
    "    }"
)
p.write_text(s)
PY
python -m py_compile ops/foundry_forge_modal_candidate_v47_repair.py

modal deploy ops/foundry_forge_modal_candidate_v47_repair.py \
  --name "$FORGE_MODAL_APP" \
  --strategy recreate \
  --tag 'FOUNDRY-V44-MEDIA-CANDIDATE-REPAIR-20260915' | tee modal-candidate-repair-deploy.log
python - <<'PY' > modal-url.txt
import modal
u=modal.Function.from_name('musitu-forge-v44-media-candidate','forge_custody').get_web_url()
if not u or not u.startswith('https://'): raise SystemExit('candidate_url_missing')
print(u)
PY

URL="$(cat modal-url.txt)"
code="$(curl -sS -o unauth-body.txt -w '%{http_code}' "$URL/v1/health" || true)"
if [ "$code" != 401 ] && [ "$code" != 403 ]; then echo "anonymous_proxy_boundary_failed_http_$code" >&2; exit 1; fi

python - <<'PY'
import json, modal
r=modal.Function.from_name('musitu-forge-v44-media-candidate','runtime_probe').remote()
if r.get('source_commit')!='f0e805ae298b4720f9263dc15d10f4864b385669': raise SystemExit('source_commit_mismatch')
if r.get('source_manifest_ok') is not True or r.get('bad_files'): raise SystemExit('source_manifest_failed')
if r.get('protocol_digest')!='c9fe2c0dcbc51ed7329aeea8b8d9985c0ccfc70123ac181c755285f1a0fbf3de': raise SystemExit('protocol_digest_mismatch')
if r.get('production_authorized') is not False: raise SystemExit('truth_boundary_failed')
overlay=r.get('candidate_overlay_git_blobs') or {}
expected={
 'derived_field_dataset_admission.py':'f570400ea59c8fa9426c247a4345299b6db1c020',
 'derived_upload_custody.py':'00a36b90604c93d39ca67fdfa579393a266fd868',
 'video_derivation_v2.py':'6f85e82ea447d3e9ebc4c77feaa55a6a6a684f1f',
}
if overlay!=expected: raise SystemExit('candidate_overlay_mismatch:'+repr(overlay))
media=r.get('candidate_media') or {}
if list(media.get('libc') or [])!=['glibc','2.39']: raise SystemExit('candidate_libc_mismatch:'+repr(media.get('libc')))
if media.get('ffmpeg_sha256')!='e8a8d46f5225f3062cec7c07fb145d58ae73c603cb740dcd5bad34bfb54e455a': raise SystemExit('candidate_ffmpeg_mismatch')
if media.get('ffprobe_sha256')!='cefc5f81c0b18429cdbf8fa5a89e1e9c759235e10f93f9b329ff1b2fdff26f46': raise SystemExit('candidate_ffprobe_mismatch')
if not str(media.get('ffmpeg_version','')).startswith('ffmpeg version 7.1.5-0+deb13u1 '): raise SystemExit('candidate_ffmpeg_version_mismatch')
if not str(media.get('ffprobe_version','')).startswith('ffprobe version 7.1.5-0+deb13u1 '): raise SystemExit('candidate_ffprobe_version_mismatch')
open('modal-candidate-repair-runtime-probe.json','w').write(json.dumps(r,indent=2,sort_keys=True))
print('candidate_runtime_probe=PASS')
PY

modal workspace proxy-tokens create --json > proxy-token.json
python - <<'PY'
import json,pathlib
obj=json.load(open('proxy-token.json')); vals=[]
def walk(x):
    if isinstance(x,dict):
        for v in x.values(): walk(v)
    elif isinstance(x,list):
        for v in x: walk(v)
    elif isinstance(x,str): vals.append(x)
walk(obj); keys=[x for x in vals if x.startswith('wk-')]; secs=[x for x in vals if x.startswith('ws-')]
if len(keys)!=1 or len(secs)!=1: raise SystemExit('proxy_token_shape_invalid')
pathlib.Path('/tmp/proxy-key').write_text(keys[0]); pathlib.Path('/tmp/proxy-secret').write_text(secs[0])
PY
KEY="$(cat /tmp/proxy-key)"; SECRET="$(cat /tmp/proxy-secret)"
cleanup(){ modal workspace proxy-tokens delete -y "$KEY" >/dev/null 2>&1 || true; rm -f /tmp/proxy-key /tmp/proxy-secret proxy-token.json; }
trap cleanup EXIT
ok=0
for attempt in $(seq 1 90); do
  code="$(curl -sS -o /tmp/health.json -w '%{http_code}' -H "Modal-Key: $KEY" -H "Modal-Secret: $SECRET" "$URL/v1/health" || true)"
  if [ "$code" = 200 ]; then ok=1; break; fi
  [ "$code" = 503 ] || { echo "health_failed_http_$code" >&2; cat /tmp/health.json >&2 || true; exit 1; }
  sleep 2
done
test "$ok" = 1
python - <<'PY'
import json
h=json.load(open('/tmp/health.json'))
assert h['schema']=='musitu.forge.health.v1'
assert h['status']=='READY'
assert h['production_authorized'] is False
assert h['custody_uploads_ready'] is True
assert h['video_derivation_runtime_configured'] is True
assert h['field_dataset_admission_configured'] is False
assert h['expert_review_projection_configured'] is False
assert h['fault_episode_submission_configured'] is False
open('modal-candidate-repair-health.json','w').write(json.dumps(h,indent=2,sort_keys=True))
PY
curl -sS -o /tmp/wrong.json -H "Modal-Key: $KEY" -H "Modal-Secret: $SECRET" -H 'X-MUSITU-Client-Protocol: 0000000000000000000000000000000000000000000000000000000000000000' "$URL/v1/field/assignments?technician_id=probe" >/dev/null || true
curl -sS -o /tmp/correct.json -H "Modal-Key: $KEY" -H "Modal-Secret: $SECRET" -H "X-MUSITU-Client-Protocol: $FORGE_PROTOCOL_DIGEST" "$URL/v1/field/assignments?technician_id=probe" >/dev/null || true
python - <<'PY'
import json
wrong=json.load(open('/tmp/wrong.json')); correct=json.load(open('/tmp/correct.json'))
if wrong.get('error')!='protocol_digest_mismatch': raise SystemExit('wrong_digest_not_rejected')
if correct.get('error')!='bearer_required': raise SystemExit('correct_digest_not_accepted_before_auth')
print('candidate_protocol_compatibility=PASS')
PY
modal workspace proxy-tokens delete -y "$KEY" >/dev/null
rm -f /tmp/proxy-key /tmp/proxy-secret proxy-token.json
trap - EXIT

python - <<'PY'
import hashlib,json,pathlib
r=json.load(open('modal-candidate-repair-runtime-probe.json'))
h=json.load(open('modal-candidate-repair-health.json'))
e={
 'schema':'musitu.forge.modal_v44_media_candidate_repair.v1',
 'candidate_only':True,
 'live_cutover_performed':False,
 'cloudflare_write_performed':False,
 'source_commit':'f0e805ae298b4720f9263dc15d10f4864b385669',
 'v46_evidence_head':'9967e7b64641aa92d5b48cb195f89db97438d2bd',
 'protocol_digest':'c9fe2c0dcbc51ed7329aeea8b8d9985c0ccfc70123ac181c755285f1a0fbf3de',
 'modal_app':'musitu-forge-v44-media-candidate',
 'state_volume':'musitu-forge-v44-media-candidate-state',
 'activation_overlay_git_blobs':{
   'derived_field_dataset_admission.py':'f570400ea59c8fa9426c247a4345299b6db1c020',
   'derived_upload_custody.py':'00a36b90604c93d39ca67fdfa579393a266fd868',
   'video_derivation_v2.py':'6f85e82ea447d3e9ebc4c77feaa55a6a6a684f1f',
 },
 'media_artifact_id':10383022629,
 'media_artifact_sha256':'bf7d35e39d289193b6bf5173a21e3c0f80856bb741c61ef2ebbcd12b7c939c8a',
 'media_tgz_sha256':'0505c249624985dfd05c80fd8826015d0b5036cd9854f4aa3d36f3cc5a5bb8e4',
 'video_adapter_sha256':'2b72d255e314ec9091f13ecc5c7affdb7702ab5f1ec387179dfdfbbbfd017953',
 'ffmpeg_sha256':'e8a8d46f5225f3062cec7c07fb145d58ae73c603cb740dcd5bad34bfb54e455a',
 'ffprobe_sha256':'cefc5f81c0b18429cdbf8fa5a89e1e9c759235e10f93f9b329ff1b2fdff26f46',
 'soname_alias_count':195,
 'runtime_probe':r,
 'health':h,
 'production_authorized':False,
 'gate':'PASS'
}
raw=json.dumps(e,indent=2,sort_keys=True).encode()
pathlib.Path('modal-v44-media-candidate-repair-evidence.json').write_bytes(raw)
pathlib.Path('modal-v44-media-candidate-repair-evidence.sha256').write_text(hashlib.sha256(raw).hexdigest()+'  modal-v44-media-candidate-repair-evidence.json\n')
PY

echo 'FOUNDRY_V44_CANDIDATE_REPAIR=PASS'
