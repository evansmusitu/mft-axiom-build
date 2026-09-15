#!/usr/bin/env bash
set -euo pipefail
: "${CLOUDFLARE_GLOBAL_API_KEY:?CLOUDFLARE_GLOBAL_API_KEY required}"

PAYLOAD_DIR='deploy_payload/foundry_forge_v3'
OVERLAY_BUNDLE='deploy_payload/foundry_forge_v44_activation_overlay/overlay.transport.json'
TMP='/tmp/musitu-forge-v44-overlay-shim'
rm -rf "$TMP"
mkdir -p "$TMP/bin" "$TMP/plain"

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
  > "$TMP/base-bundle.json"
test "$(stat -c %s "$TMP/base-bundle.json")" = '72860'
test "$(sha256sum "$TMP/base-bundle.json" | awk '{print $1}')" = '07aa7a330de816bb6a22e9954435fd4a26807eec6a124482c99ef35224253e86'

python - "$TMP" "$OVERLAY_BUNDLE" <<'PY'
import base64, hashlib, hmac, json, pathlib, sys
root=pathlib.Path(sys.argv[1])
overlay_path=pathlib.Path(sys.argv[2])
base=json.loads((root/'base-bundle.json').read_text())
pem=base['transport_public_key_pem']
pub_sha=hashlib.sha256(pem.encode()).hexdigest()
if pub_sha!='c4412eda35e81593ef5e2cdd8ee4a64bac0b9e59ad68bde04d879376c25109bd': raise SystemExit('transport_public_key_sha_mismatch')
km=base['transport_key_manifest']
if km['public_key_sha256']!=pub_sha: raise SystemExit('base_public_key_manifest_mismatch')
encpriv=base64.b64decode(base['transport_private_key_encrypted_base64'],validate=True)
if hashlib.sha256(encpriv).hexdigest()!=km['encrypted_private_key_sha256']: raise SystemExit('encrypted_private_key_mismatch')
(root/'private.pem.enc').write_bytes(encpriv)
(root/'public.pem').write_text(pem)

overlay=json.loads(overlay_path.read_text())
if overlay['schema']!='musitu.foundry_forge.v44_activation_overlay_transport.v1': raise SystemExit('overlay_schema_mismatch')
if overlay['source_v46_head']!='9967e7b64641aa92d5b48cb195f89db97438d2bd' or overlay['source_file_count']!=3: raise SystemExit('overlay_source_authority_mismatch')
if overlay['plaintext_source_committed_to_infrastructure_repo'] is not False or overlay['private_signing_material_included'] is not False or overlay['production_authorized'] is not False: raise SystemExit('overlay_truth_boundary_mismatch')
expected_content=overlay['bundle_content_sha256']
unsigned=dict(overlay); unsigned.pop('bundle_content_sha256')
actual_content=hashlib.sha256(json.dumps(unsigned,sort_keys=True,separators=(',',':')).encode()).hexdigest()
if actual_content!=expected_content or expected_content!='1e53fe4c83c294efbcdf363f4d88a982ed057060a8923cbafba6c951e9af3ad3': raise SystemExit('overlay_bundle_content_mismatch')
if overlay['key_wrap']['public_key_sha256']!=pub_sha: raise SystemExit('overlay_public_key_binding_mismatch')
if overlay['plaintext_archive_sha256']!='77af3c9953aafc39048e4af1380349d4b47c4b48db4fa6127abc888f9ad731c9' or overlay['plaintext_archive_bytes']!=11120: raise SystemExit('overlay_plaintext_reference_mismatch')
cipher=base64.b64decode(overlay['ciphertext_base64'],validate=True)
wrapped=base64.b64decode(overlay['wrapped_master_secret_base64'],validate=True)
if len(cipher)!=overlay['ciphertext_bytes'] or hashlib.sha256(cipher).hexdigest()!=overlay['ciphertext_sha256'] or overlay['ciphertext_sha256']!='90a4f460b2c262bd27073f5f690080d61e87b9a9a8c5de5ade480b1f6ae3fe22': raise SystemExit('overlay_ciphertext_mismatch')
if len(wrapped)!=overlay['wrapped_master_secret_bytes'] or hashlib.sha256(wrapped).hexdigest()!=overlay['wrapped_master_secret_sha256'] or overlay['wrapped_master_secret_sha256']!='0762737dc5cf4eedecb3091fbd20be88f182b75d9083d236c8755741f3ae457f': raise SystemExit('overlay_wrapped_secret_mismatch')
(root/'overlay.enc').write_bytes(cipher)
(root/'overlay.master.wrapped').write_bytes(wrapped)
(root/'overlay-metadata.json').write_text(json.dumps({'ciphertext_hmac_sha256':overlay['ciphertext_hmac_sha256'],'plaintext_archive_sha256':overlay['plaintext_archive_sha256'],'plaintext_archive_bytes':overlay['plaintext_archive_bytes']},sort_keys=True))
PY

openssl enc -d -aes-256-cbc -pbkdf2 -iter 250000 \
  -in "$TMP/private.pem.enc" -out "$TMP/private.pem" \
  -pass env:CLOUDFLARE_GLOBAL_API_KEY
chmod 600 "$TMP/private.pem"
openssl pkeyutl -decrypt -inkey "$TMP/private.pem" \
  -pkeyopt rsa_padding_mode:oaep \
  -pkeyopt rsa_oaep_md:sha256 \
  -pkeyopt rsa_mgf1_md:sha256 \
  -in "$TMP/overlay.master.wrapped" -out "$TMP/overlay.master"

python - "$TMP" <<'PY'
import hashlib,hmac,json,pathlib,sys
root=pathlib.Path(sys.argv[1])
master=(root/'overlay.master').read_bytes(); cipher=(root/'overlay.enc').read_bytes(); meta=json.loads((root/'overlay-metadata.json').read_text())
if len(master)!=32: raise SystemExit('overlay_master_secret_size_invalid')
hkey=hashlib.sha256(b'musitu.foundry_forge.v44_activation_overlay.hmac.v1\0'+master).digest()
actual=hmac.new(hkey,cipher,hashlib.sha256).hexdigest()
if actual!=meta['ciphertext_hmac_sha256'] or actual!='f83ef571937549c75d759c090581fc12219797ac1c721e0ae2951e3c8ea16360': raise SystemExit('overlay_hmac_mismatch')
(root/'overlay.master.hex').write_text(master.hex())
PY
MASTER_HEX="$(cat "$TMP/overlay.master.hex")"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 250000 \
  -in "$TMP/overlay.enc" -out "$TMP/overlay.tar.gz" \
  -pass pass:"$MASTER_HEX"
test "$(stat -c %s "$TMP/overlay.tar.gz")" = '11120'
test "$(sha256sum "$TMP/overlay.tar.gz" | awk '{print $1}')" = '77af3c9953aafc39048e4af1380349d4b47c4b48db4fa6127abc888f9ad731c9'
tar -xzf "$TMP/overlay.tar.gz" -C "$TMP/plain"

python - "$TMP/plain" <<'PY'
import hashlib,json,pathlib,sys
root=pathlib.Path(sys.argv[1]); m=json.loads((root/'OVERLAY_MANIFEST.json').read_text())
if m['schema']!='musitu.foundry_forge.v44_activation_overlay_plaintext.v1' or m['source_v46_head']!='9967e7b64641aa92d5b48cb195f89db97438d2bd' or m['source_file_count']!=3: raise SystemExit('overlay_plain_manifest_authority_mismatch')
if m['plaintext_source_committed_to_infrastructure_repo'] is not False or m['private_signing_material_included'] is not False or m['production_authorized'] is not False: raise SystemExit('overlay_plain_truth_boundary_mismatch')
expected={
 'apps/musitu_forge_custody_server/derived_field_dataset_admission.py':'f570400ea59c8fa9426c247a4345299b6db1c020',
 'apps/musitu_forge_custody_server/derived_upload_custody.py':'00a36b90604c93d39ca67fdfa579393a266fd868',
 'apps/musitu_forge_custody_server/video_derivation_v2.py':'6f85e82ea447d3e9ebc4c77feaa55a6a6a684f1f',
}
rows={x['path']:x for x in m['files']}
if set(rows)!=set(expected): raise SystemExit('overlay_plain_file_set_mismatch')
for rel,blob in expected.items():
    p=root/rel; data=p.read_bytes(); actual=hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
    if actual!=blob or rows[rel]['git_blob_sha1']!=blob or rows[rel]['size']!=len(data) or rows[rel]['sha256']!=hashlib.sha256(data).hexdigest(): raise SystemExit('overlay_plain_file_binding_mismatch:'+rel)
if hashlib.sha256((root/'apps/musitu_forge_custody_server/video_derivation_v2.py').read_bytes()).hexdigest()!='2b72d255e314ec9091f13ecc5c7affdb7702ab5f1ec387179dfdfbbbfd017953': raise SystemExit('overlay_video_adapter_sha_mismatch')
print('v44_activation_overlay_decrypt=PASS')
PY

rm -f "$TMP/private.pem" "$TMP/private.pem.enc" "$TMP/overlay.master" "$TMP/overlay.master.hex" "$TMP/overlay.master.wrapped" "$TMP/overlay.enc" "$TMP/overlay.tar.gz" "$TMP/base-bundle.json" "$TMP/public.pem" "$TMP/overlay-metadata.json"

cat > "$TMP/bin/curl" <<'SHIM'
#!/usr/bin/env bash
set -euo pipefail
out=''
url=''
args=("$@")
for ((i=0;i<${#args[@]};i++)); do
  case "${args[$i]}" in
    -o|--output)
      (( i + 1 < ${#args[@]} )) || { echo 'curl shim missing output path' >&2; exit 2; }
      out="${args[$((i+1))]}"
      ;;
    http://*|https://*) url="${args[$i]}" ;;
  esac
done
case "$url" in
  */apps/musitu_forge_custody_server/derived_field_dataset_admission.py)
    test -n "$out" || { echo 'curl shim output required' >&2; exit 2; }
    cp /tmp/musitu-forge-v44-overlay-shim/plain/apps/musitu_forge_custody_server/derived_field_dataset_admission.py "$out"; exit 0 ;;
  */apps/musitu_forge_custody_server/derived_upload_custody.py)
    test -n "$out" || { echo 'curl shim output required' >&2; exit 2; }
    cp /tmp/musitu-forge-v44-overlay-shim/plain/apps/musitu_forge_custody_server/derived_upload_custody.py "$out"; exit 0 ;;
  */apps/musitu_forge_custody_server/video_derivation_v2.py)
    test -n "$out" || { echo 'curl shim output required' >&2; exit 2; }
    cp /tmp/musitu-forge-v44-overlay-shim/plain/apps/musitu_forge_custody_server/video_derivation_v2.py "$out"; exit 0 ;;
esac
exec /usr/bin/curl "$@"
SHIM
chmod 700 "$TMP/bin/curl"

echo "$TMP/bin"
