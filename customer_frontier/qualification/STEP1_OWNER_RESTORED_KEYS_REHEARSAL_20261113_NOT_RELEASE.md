# MUSITU AXIOM Step 1 — owner encrypted-key recovery rehearsal

**Governed continuation only.** Isolated addition to draft PR241, based on the owner's sole-authority amendment; no prior gates are marked passed and no production operations are changed. `Step1 OPEN · Step2 PROHIBITED · NOT_RELEASE`.

## Scope of this tool

The offline Python3 + OpenSSL3 script verifies that a *separate restored copy* of the owner's encrypted PKCS#8 Ed25519 and X25519 private PEM files still performs cryptographic operations and matches externally reviewed public SPKI fingerprints. It tests challenge signing and a synthetic X25519 key agreement. The script never reads production SQL, connects to Cloudflare/GitHub, changes D1, or authorizes any release. Its receipt stores a random challenge **hash** and the **public** key pins only; no private keys, signatures, secrets, passphrases, synthetic shared secrets, or raw challenge are retained. It intentionally refuses to run in CI or noninteractive mode with real owner keys.

## Owner-only use — secure offline computer, not ChatGPT or GitHub Actions

1. First run the existing `step1_owner_offline_key_ceremony.sh` **on your secure device**, if not yet done. Verify the original's `public/` fingerprints against a separately reviewed trusted record; do not invent trust by copying an unverified receipt's pins into the environment.
2. Put the encrypted PEM backups on an independently protected offline physical medium. **Test a restored copy**, not the original. Do not paste private keys/passphrases into this chat, Google Drive, GitHub, or CI. Copy *only the two already-encrypted PEM files* from that offline medium to a new private restore directory, with permissions `0700` for `private/` and `0600` for PEM files. The restore copy may be local temporarily; store no permanent unencrypted keys.
3. On the offline owner-controlled computer with Python 3, OpenSSL 3 and a real terminal, independently set the reviewed **public** pin environment variables `AXIOM_TRUSTED_OWNER_ED25519_SPKI_SHA256` and `AXIOM_TRUSTED_OWNER_X25519_SPKI_SHA256`. Do not use GitHub Secrets for the owner private keys.
4. From the PR241 source checkout, run (replace paths with your own **absolute** directories):

```sh
python3 customer_frontier/qualification/step1_owner_restored_keys_rehearsal.py \
  "$HOME/axiom_owner_recovery_keys_private_20261112" \
  "$HOME/axiom_restored_backup_test_20261113" \
  "$HOME/axiom_owner_recovery_proof_new_20261113"
```

The first path is the original keys directory with `public/*.der` and `public/*.pem`. The second is the distinct **restored-backup copy** containing `private/owner_ed25519_pkcs8_encrypted.pem` and `private/owner_x25519_pkcs8_encrypted.pem`. The last path must not exist yet and must be outside both key directories. The tool prompts for an explicit owner confirmation and the encrypted PEM passphrases locally in OpenSSL. On success it writes `OWNER_RESTORED_KEYS_LOCAL_REHEARSAL_NOT_AUTHORITY.json` into the new third directory. On failure it refuses to write a success receipt. Keep the private keys and the restored copy on the owner's protected device only.

## Non-claims / remaining evidence

A local `LOCAL_RESTORED_KEY_REHEARSAL_ONLY_NO_GO` receipt **does not independently prove** the owner's identity, MFA, separate physical-media durability, ability to recover after actual device loss, or a provider-controlled restore. It is also not a signed recovery permit. Even genuine owner-held keys do not establish a hard zero-incremental-spend Cloudflare guarantee, authorize customer-data export, permit a new disposable D1, or qualify hosted parity. The historic OAuth DR UUID remains quarantined (404 / no matching scoped audit events) and cannot be reused. PR83's full-stack veto and B27 independent authority failure remain historically failed, regardless of the new owner governance policy.

**No customer data, production changes, charges or release. `NOT_RELEASE`.**
