#!/usr/bin/env bash
# MUSITU AXIOM owner device only. No cloud, no D1, no private-key uploads.
set +x
set -euo pipefail
umask 077
if [ "$#" -ne 2 ] || [ ! -t 0 ] || [ ! -t 1 ]; then
  echo 'AXIOM_OWNER_SIGN_NO_GO: interactive terminal and KEYS_DIR NEW_PROPOSAL_DIR required' >&2
  exit 2
fi
for cmd in openssl node; do command -v "$cmd" >/dev/null 2>&1 || { echo 'AXIOM_OWNER_SIGN_NO_GO: missing local command' >&2; exit 2; }; done
if [ -z "${AXIOM_TRUSTED_OWNER_ED25519_SPKI_SHA256:-}" ] || [ -z "${AXIOM_TRUSTED_OWNER_X25519_SPKI_SHA256:-}" ]; then
  echo 'AXIOM_OWNER_SIGN_NO_GO: separately reviewed public trust pins required' >&2
  exit 2
fi
keys="$1"; out="$2"
case "$keys" in /*) ;; *) echo 'AXIOM_OWNER_SIGN_NO_GO: absolute keys directory required' >&2; exit 2 ;; esac
case "$out" in /*) ;; *) echo 'AXIOM_OWNER_SIGN_NO_GO: absolute new output directory required' >&2; exit 2 ;; esac
node "$(dirname "$0")/step1_owner_device_signed_proposal.mjs" prepare "$keys" "$out"
echo 'Review the exact proposed plan in OWNER_PROPOSAL_PAYLOAD.json before signing.'
echo 'The next prompt is ONLY for the offline owner-device encrypted Ed25519 signing key.'
openssl pkeyutl -sign -rawin \
  -inkey "$keys/private/owner_ed25519_pkcs8_encrypted.pem" \
  -in "$out/OWNER_PROPOSAL_PAYLOAD.json" -out "$out/OWNER_SIGNATURE.bin"
chmod 600 "$out/OWNER_SIGNATURE.bin"
node "$(dirname "$0")/step1_owner_device_signed_proposal.mjs" finalize "$keys" "$out"
echo 'AXIOM_OWNER_PROPOSAL_SIGNED_LOCALLY_BUT_NO_D1_AUTHORITY_NOT_RELEASE'
