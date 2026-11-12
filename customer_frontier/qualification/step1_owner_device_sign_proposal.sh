#!/usr/bin/env bash
# MUSITU AXIOM owner device only. No cloud, no D1, no private-key uploads.
set +x
set -euo pipefail
umask 077
if [ "$#" -ne 2 ] || [ ! -t 0 ] || [ ! -t 1 ]; then
  echo 'AXIOM_OWNER_SIGN_NO_GO: interactive terminal and KEYS_DIR NEW_PROPOSAL_DIR required' >&2
  exit 2
fi
for cmd in openssl node sha256sum; do command -v "$cmd" >/dev/null 2>&1 || { echo 'AXIOM_OWNER_SIGN_NO_GO: missing local command' >&2; exit 2; }; done
if [ -z "${AXIOM_TRUSTED_OWNER_ED25519_SPKI_SHA256:-}" ] || [ -z "${AXIOM_TRUSTED_OWNER_X25519_SPKI_SHA256:-}" ]; then
  echo 'AXIOM_OWNER_SIGN_NO_GO: separately reviewed public trust pins required' >&2
  exit 2
fi
keys="$1"; out="$2"
case "$keys" in /*) ;; *) echo 'AXIOM_OWNER_SIGN_NO_GO: absolute keys directory required' >&2; exit 2 ;; esac
case "$out" in /*) ;; *) echo 'AXIOM_OWNER_SIGN_NO_GO: absolute new output directory required' >&2; exit 2 ;; esac
node "$(dirname "$0")/step1_owner_device_signed_proposal.mjs" prepare "$keys" "$out"
payload="$out/OWNER_PROPOSAL_PAYLOAD.json"
if [ ! -f "$payload" ] || [ -L "$payload" ]; then
  echo 'AXIOM_OWNER_SIGN_NO_GO: no regular reviewed proposal payload' >&2
  exit 2
fi
expected_hash="$(sha256sum -- "$payload")"
expected_hash="${expected_hash%% *}"
if [[ ! "$expected_hash" =~ ^[a-f0-9]{64}$ ]]; then
  echo 'AXIOM_OWNER_SIGN_NO_GO: invalid proposal digest' >&2
  exit 2
fi
printf '\n--- EXACT OWNER RECOVERY PROPOSAL (NOT RELEASE) ---\n'
cat -- "$payload"
printf '\n--- END PROPOSAL ---\n'
printf 'SHA-256 of the exact proposal bytes: %s\n' "$expected_hash"
printf 'Read every field. This signs a PROPOSAL ONLY, not a D1 operation.\n'
printf 'Type the full SHA-256 digest to sign, or anything else to deny: '
IFS= read -r reviewed_hash </dev/tty || {
  echo 'AXIOM_OWNER_SIGN_NO_GO: review not completed' >&2
  exit 2
}
if [ "$reviewed_hash" != "$expected_hash" ]; then
  echo 'AXIOM_OWNER_SIGN_NO_GO: owner did not confirm exact proposal digest' >&2
  exit 2
fi
actual_hash="$(sha256sum -- "$payload")"
actual_hash="${actual_hash%% *}"
if [ "$actual_hash" != "$expected_hash" ]; then
  echo 'AXIOM_OWNER_SIGN_NO_GO: proposal changed since owner review' >&2
  exit 2
fi
echo 'The next prompt is ONLY for the offline owner-device encrypted Ed25519 signing key.'
openssl pkeyutl -sign -rawin \
  -inkey "$keys/private/owner_ed25519_pkcs8_encrypted.pem" \
  -in "$payload" -out "$out/OWNER_SIGNATURE.bin"
chmod 600 "$out/OWNER_SIGNATURE.bin"
actual_hash="$(sha256sum -- "$payload")"
actual_hash="${actual_hash%% *}"
if [ "$actual_hash" != "$expected_hash" ]; then
  echo 'AXIOM_OWNER_SIGN_NO_GO: proposal changed during signing' >&2
  exit 2
fi
node "$(dirname "$0")/step1_owner_device_signed_proposal.mjs" finalize "$keys" "$out"
echo 'AXIOM_OWNER_PROPOSAL_SIGNED_LOCALLY_BUT_NO_D1_AUTHORITY_NOT_RELEASE'
