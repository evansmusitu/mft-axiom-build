#!/usr/bin/env python3
"""MUSITU AXIOM owner-device OFFLINE restored-key rehearsal; NEVER provider authority.

This tool proves only that a separate restored encrypted PEM copy can perform
Ed25519 signing and X25519 agreement and match independently trusted public pins.
It neither establishes ownership of the physical backup nor authorizes any D1
creation, data export/import, OAuth migration, spend, release, or Step 2.

No external dependency beyond the Python standard library and local OpenSSL 3.
Do not execute with real owner keys in CI, cloud browsers, or ChatGPT.
"""
from __future__ import annotations
import hashlib
import json
import os
import pathlib
import re
import secrets
import stat
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

SCHEMA = 'musitu.axiom.step1.owner-restored-keys-rehearsal.v1'
AMENDMENT_SHA256 = 'cb7f43e1e6b3c28afb88de5a08696dc7b650565a78394eda98e2498c099fb9d5'
SIGN_KEY = 'owner_ed25519_pkcs8_encrypted.pem'
ENC_KEY = 'owner_x25519_pkcs8_encrypted.pem'
PUBLIC_SIGN = 'owner_ed25519_spki.der'
PUBLIC_ENC = 'owner_x25519_spki.der'
PIN_RE = re.compile(r'^[a-f0-9]{64}$')

class NoGo(Exception):
    pass

def check(ok: bool, code: str) -> None:
    if not ok:
        raise NoGo(code)

def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def private_file(path: pathlib.Path) -> None:
    try:
        s = path.lstat()
        check(stat.S_ISREG(s.st_mode) and s.st_size <= 16384 and s.st_size >= 64,
              'MISSING_OR_INVALID_ENCRYPTED_KEY')
        check(s.st_uid == os.geteuid(), 'RECOVERED_PRIVATE_KEY_OWNER_MISMATCH')
        check(s.st_mode & 0o077 == 0, 'RECOVERED_PRIVATE_KEY_PERMISSIONS_TOO_OPEN')
        with path.open('rb') as f:
            head = f.readline(80)
        check(head == b'-----BEGIN ENCRYPTED PRIVATE KEY-----\n', 'RECOVERED_KEY_NOT_PKCS8_ENCRYPTED')
    except OSError:
        raise NoGo('MISSING_OR_INVALID_ENCRYPTED_KEY') from None

def safe_dir(path: pathlib.Path, code: str) -> pathlib.Path:
    check(path.is_absolute(), 'ABSOLUTE_DIRECTORY_REQUIRED')
    try:
        check(path.resolve(strict=True) == path, 'NONCANONICAL_DIRECTORY_REFUSED')
        check(path.is_dir(), code)
        for directory in (path, *path.parents):
            info = directory.stat()
            check(info.st_uid in (0, os.geteuid()), 'UNTRUSTED_DIRECTORY_OWNER')
            # A sticky shared ancestor such as /tmp protects its owned children.
            # The actual working directory must never be shared-writable.
            if info.st_mode & 0o022:
                check(directory != path and bool(info.st_mode & stat.S_ISVTX),
                      'DIRECTORY_WRITABLE_BY_OTHERS')
        return path
    except OSError:
        raise NoGo(code) from None

def public_file(path: pathlib.Path) -> bytes:
    try:
        s = path.lstat()
        check(stat.S_ISREG(s.st_mode) and 24 < s.st_size < 2048, 'INVALID_PUBLIC_SPKI')
        return path.read_bytes()
    except OSError:
        raise NoGo('INVALID_PUBLIC_SPKI') from None

def preflight(original: pathlib.Path, restored: pathlib.Path, target: pathlib.Path,
              trusted_sign: str | None, trusted_enc: str | None) -> dict:
    """No private decryption, no output mutation, no network; useful for isolated tests."""
    check(bool(PIN_RE.fullmatch(trusted_sign or '')) and
          bool(PIN_RE.fullmatch(trusted_enc or '')), 'REVIEWED_PUBLIC_TRUST_PINS_REQUIRED')
    original = safe_dir(original, 'ORIGINAL_KEY_DIRECTORY_REQUIRED')
    restored = safe_dir(restored, 'SEPARATE_RESTORED_DIRECTORY_REQUIRED')
    check(original != restored, 'RESTORED_COPY_MUST_BE_SEPARATE')
    check(target.is_absolute(), 'ABSOLUTE_OUTPUT_REQUIRED')
    check(not target.exists() and not target.is_symlink(), 'OUTPUT_MUST_BE_NEW')
    safe_dir(target.parent, 'OUTPUT_PARENT_NOT_PRESENT')
    check(not any(root == target or root in target.parents for root in (original,restored)),
          'OUTPUT_MUST_BE_OUTSIDE_KEY_DIRECTORIES')
    pub_dir = safe_dir(original / 'public', 'PUBLIC_DIRECTORY_REQUIRED')
    private_dir = restored / 'private'
    try:
        private_info = private_dir.lstat()
    except OSError:
        raise NoGo('RESTORED_PRIVATE_DIRECTORY_REQUIRED') from None
    check(stat.S_ISDIR(private_info.st_mode), 'RESTORED_PRIVATE_DIRECTORY_REQUIRED')
    check(private_info.st_uid == os.geteuid(), 'RESTORED_PRIVATE_DIRECTORY_OWNER_MISMATCH')
    check(private_info.st_mode & 0o077 == 0, 'RESTORED_PRIVATE_DIRECTORY_PERMISSIONS_TOO_OPEN')
    check(pub_dir != private_dir, 'PUBLIC_PRIVATE_DIRECTORY_COLLISION')
    sign_data = public_file(pub_dir / PUBLIC_SIGN)
    enc_data = public_file(pub_dir / PUBLIC_ENC)
    check(digest(sign_data) == trusted_sign and digest(enc_data) == trusted_enc,
          'PUBLIC_KEYS_DO_NOT_MATCH_EXTERNAL_TRUST')
    check(trusted_sign != trusted_enc, 'UNSEPARATED_KEY_PINS')
    sign_key = private_dir / SIGN_KEY
    enc_key = private_dir / ENC_KEY
    private_file(sign_key)
    private_file(enc_key)
    for name, recovery in ((SIGN_KEY,sign_key),(ENC_KEY,enc_key)):
        original_private = original / 'private' / name
        if original_private.exists():
            try:
                check(not original_private.samefile(recovery), 'RESTORED_COPY_HARDLINKS_ORIGINAL')
            except OSError:
                raise NoGo('ORIGINAL_COPY_COMPARISON_FAILED') from None
    # A separate path is not proof of separate physical media or recoverability.
    return {'sign_key':sign_key, 'enc_key':enc_key,'sign_public':sign_data,
            'enc_public':enc_data, 'trusted_sign':trusted_sign,
            'trusted_enc':trusted_enc}

def run_openssl(args: list[str], *, binary_output: bool = False) -> bytes:
    try:
        # Terminal remains attached for encrypted-key passphrase prompts.
        p = subprocess.run(['openssl', *args], stdout=subprocess.PIPE,
                           stderr=subprocess.DEVNULL, check=False, timeout=40)
    except (OSError, subprocess.TimeoutExpired):
        raise NoGo('LOCAL_OPENSSL_UNAVAILABLE_OR_TIMEOUT') from None
    check(p.returncode == 0, 'LOCAL_ENCRYPTED_KEY_OPERATION_FAILED')
    return p.stdout if binary_output else b''

def canonical_pub_from_encrypted(private: pathlib.Path) -> bytes:
    return run_openssl(['pkey','-in',str(private),'-pubout','-outform','DER'],binary_output=True)

def do_rehearsal(original: pathlib.Path, restored: pathlib.Path, target: pathlib.Path,
                 trusted_sign: str | None, trusted_enc: str | None,
                 human_confirmation: str) -> dict:
    check(sys.stdin.isatty() and sys.stdout.isatty() and not os.environ.get('CI')
          and not os.environ.get('GITHUB_ACTIONS'), 'INTERACTIVE_OWNER_DEVICE_ONLY')
    check(human_confirmation == 'I RESTORED ENCRYPTED COPIES ON MY OWN DEVICE',
          'EXPLICIT_OWNER_OFFLINE_CONFIRMATION_REQUIRED')
    v = preflight(original, restored, target, trusted_sign, trusted_enc)
    check(digest(canonical_pub_from_encrypted(v['sign_key'])) == trusted_sign,
          'RECOVERED_ED25519_PUBLIC_KEY_MISMATCH')
    check(digest(canonical_pub_from_encrypted(v['enc_key'])) == trusted_enc,
          'RECOVERED_X25519_PUBLIC_KEY_MISMATCH')
    # All temporary files are local; neither production SQL nor owner keys are copied.
    with tempfile.TemporaryDirectory(prefix='axiom-offline-recovery-') as temp:
        td = pathlib.Path(temp)
        sign_public = td / PUBLIC_SIGN
        enc_public = td / PUBLIC_ENC
        sign_public.write_bytes(v['sign_public'])
        enc_public.write_bytes(v['enc_public'])
        challenge = td / 'challenge.bin'
        signature = td / 'signature.bin'
        ephemeral = td / 'synthetic_x25519_private.pem'
        ephemeral_pub = td / 'synthetic_x25519_public.pem'
        shared_owner = td / 'derived_restored.bin'
        shared_synthetic = td / 'derived_synthetic.bin'
        challenge.write_bytes(secrets.token_bytes(64))
        os.chmod(challenge, 0o600)
        run_openssl(['pkeyutl','-sign','-rawin','-inkey',str(v['sign_key']),'-in',str(challenge),'-out',str(signature)])
        check(signature.stat().st_size == 64, 'ED25519_SIGNATURE_SIZE_INVALID')
        run_openssl(['pkeyutl','-verify','-rawin','-pubin','-keyform','DER','-inkey',str(sign_public),
                     '-in',str(challenge),'-sigfile',str(signature)])
        run_openssl(['genpkey','-algorithm','X25519','-out',str(ephemeral)])
        run_openssl(['pkey','-in',str(ephemeral),'-pubout','-out',str(ephemeral_pub)])
        run_openssl(['pkeyutl','-derive','-inkey',str(v['enc_key']),'-peerkey',str(ephemeral_pub),'-out',str(shared_owner)])
        run_openssl(['pkeyutl','-derive','-inkey',str(ephemeral),'-peerform','DER','-peerkey',str(enc_public),'-out',str(shared_synthetic)])
        check(shared_owner.stat().st_size == 32 and
              secrets.compare_digest(shared_owner.read_bytes(), shared_synthetic.read_bytes()),
              'X25519_KEY_AGREEMENT_MISMATCH')
        challenge_hash = digest(challenge.read_bytes())
    # No challenge, signature, shared secret, private key or passphrase in receipt.
    receipt = {'schema':SCHEMA,'governance_amendment_sha256':AMENDMENT_SHA256,
        'performed_at_utc':datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'challenge_sha256':challenge_hash,
        'owner_ed25519_spki_sha256':trusted_sign,
        'owner_x25519_spki_sha256':trusted_enc,
        'restored_private_copy_separate_path_observed':True,
        'ed25519_challenge_signature_verified_locally':True,
        'x25519_synthetic_key_agreement_verified_locally':True,
        'separate_physical_backup_media_independently_verified':False,
        'owner_identity_and_mfa_verified':False,
        'on_device_execution_independently_attested':False,
        'production_owner_trust_pins_activated':False,
        'actual_customer_data_backup_restored':False,
        'provider_zero_additional_spend_qualified':False,
        'hosted_d1_restore_parity_qualified':False,
        'historical_independent_custody_passed':False,
        'step1_closed':False,'step2_authorized':False,'release_authorized':False,
        'release_status':'NOT_RELEASE','status':'LOCAL_RESTORED_KEY_REHEARSAL_ONLY_NO_GO'}
    target.mkdir(mode=0o700)
    filename = target/'OWNER_RESTORED_KEYS_LOCAL_REHEARSAL_NOT_AUTHORITY.json'
    with filename.open('x') as f:
        json.dump(receipt,f,sort_keys=True,indent=2)
        f.write('\n')
    os.chmod(filename,0o600)
    return receipt

def main() -> int:
    try:
        check(len(sys.argv)==4, 'USAGE_ORIGINAL_KEYS_RESTORED_COPY_NEW_OUTPUT_DIR')
        original,restored,target = map(pathlib.Path,sys.argv[1:])
        check(sys.stdin.isatty() and sys.stdout.isatty() and not os.environ.get('CI')
              and not os.environ.get('GITHUB_ACTIONS'), 'INTERACTIVE_OWNER_DEVICE_ONLY')
        print('AXIOM offline local rehearsal only. Use RESTORED encrypted private PEM copies, NOT your sole original.')
        print('No D1 export, creation, restore, charge or release will be authorized.')
        print('To proceed type: I RESTORED ENCRYPTED COPIES ON MY OWN DEVICE')
        confirmation=input('Owner confirmation: ')
        result=do_rehearsal(original,restored,target,
            os.environ.get('AXIOM_TRUSTED_OWNER_ED25519_SPKI_SHA256'),
            os.environ.get('AXIOM_TRUSTED_OWNER_X25519_SPKI_SHA256'),confirmation)
        print(result['status'])
        return 0
    except (NoGo, EOFError, KeyboardInterrupt) as exc:
        code=exc.args[0] if isinstance(exc,NoGo) else 'OWNER_ABORTED'
        print('AXIOM_OWNER_RESTORED_KEYS_NO_GO:'+code, file=sys.stderr)
        return 2
    except Exception:
        print('AXIOM_OWNER_RESTORED_KEYS_NO_GO:UNEXPECTED_LOCAL_PRECONDITION',file=sys.stderr)
        return 2

if __name__=='__main__':
    sys.exit(main())
