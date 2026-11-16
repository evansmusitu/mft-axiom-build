#!/usr/bin/env bash
# MUSITU AXIOM 2026-11-12: OWNER-DEVICE ONLY; never run in GitHub CI.
# Generates TWO encrypted private keys on the owner's offline device.
# No network, no remote writes, no access grants, no production authorization.
set -euo pipefail
umask 077
if [ "$#" -ne 1 ]; then
  echo "Usage: bash step1_owner_offline_key_ceremony.sh /path/to/NEW_LOCAL_PRIVATE_DIRECTORY" >&2
  exit 2
fi
if [ ! -t 0 ] || [ ! -t 1 ]; then
  echo 'OWNER_KEY_NO_GO: secure interactive local terminal required' >&2
  exit 2
fi
for program in openssl python3; do
  command -v "$program" >/dev/null 2>&1 || { echo "OWNER_KEY_NO_GO: missing $program" >&2; exit 2; }
done
output="$1"
if [ -e "$output" ] || [ -L "$output" ]; then
  echo 'OWNER_KEY_NO_GO: target already exists; refusing overwrite' >&2
  exit 2
fi
mkdir -m 700 -- "$output"
mkdir -m 700 -- "$output/private" "$output/public"
echo 'Generating encrypted owner signing key locally. Choose a strong unique passphrase.'
openssl genpkey -algorithm ED25519 -aes-256-cbc -out "$output/private/owner_ed25519_pkcs8_encrypted.pem"
echo 'Generating separately encrypted owner recovery key locally. Choose another strong passphrase.'
openssl genpkey -algorithm X25519 -aes-256-cbc -out "$output/private/owner_x25519_pkcs8_encrypted.pem"
echo 'Extracting signing public key; enter only your local private-key passphrase when prompted.'
openssl pkey -in "$output/private/owner_ed25519_pkcs8_encrypted.pem" -pubout -out "$output/public/owner_ed25519_spki.pem"
echo 'Extracting recipient public key; enter only your local private-key passphrase when prompted.'
openssl pkey -in "$output/private/owner_x25519_pkcs8_encrypted.pem" -pubout -out "$output/public/owner_x25519_spki.pem"
openssl pkey -pubin -in "$output/public/owner_ed25519_spki.pem" -outform DER -out "$output/public/owner_ed25519_spki.der"
openssl pkey -pubin -in "$output/public/owner_x25519_spki.pem" -outform DER -out "$output/public/owner_x25519_spki.der"
python3 - "$output" <<'PY'
import hashlib, json, pathlib, sys
p=pathlib.Path(sys.argv[1])
sha=lambda fn:hashlib.sha256((p/'public'/fn).read_bytes()).hexdigest()
receipt={
 'schema':'musitu.axiom.step1.owner-device-public-key-pins.v1',
 'owner_signing_algorithm':'Ed25519',
 'owner_encryption_recipient_algorithm':'X25519',
 'owner_ed25519_spki_sha256':sha('owner_ed25519_spki.der'),
 'owner_x25519_spki_sha256':sha('owner_x25519_spki.der'),
 'keys_created_on_owner_device_reported_only':True,
 'owner_identity_and_mfa_independently_qualified':False,
 'public_key_pins_approved_for_runtime':False,
 'current_encrypted_backup_qualified':False,
 'provider_zero_spend_qualified':False,
 'step1_closed':False,'step2_authorized':False,'release':'NOT_RELEASE'}
(p/'public'/'OWNER_PUBLIC_PINS_NOT_ATTESTATION.json').write_text(json.dumps(receipt,sort_keys=True,indent=2)+'\n')
PY
printf 'private/\n' > "$output/.gitignore"
chmod 600 "$output/private/"* "$output/public/"* "$output/.gitignore"
echo 'OWNER_KEY_CEREMONY_LOCAL_ONLY_NO_GO_NOT_RELEASE'
echo 'Keep the private/ folder and both passphrases on your own protected device. Never upload it to GitHub, Drive, ChatGPT, CI, or Cloudflare.'
echo 'Only public/owner_*_spki.der and public/OWNER_PUBLIC_PINS_NOT_ATTESTATION.json are candidates for externally reviewed pinning.'
