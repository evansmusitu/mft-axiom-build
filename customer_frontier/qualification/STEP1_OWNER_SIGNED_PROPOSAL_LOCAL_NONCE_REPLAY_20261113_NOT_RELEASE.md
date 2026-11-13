# AXIOM Step 1 — owner-signed recovery proposal local nonce replay guard

**Scope: additive draft PR241 candidate, NOT RELEASE.** This checks that a valid short-lived, externally pinned Ed25519 signature on an **owner-only recovery proposal** can be consumed at most once in an offline SQLite ledger. It does **not** authorize D1 creation, SQL export/import, OAuth migration, customer identity, spending, release, or Step 2. It does not change PR216's two-human runtime check. The historical independent-custody and PR83/B27 vetoes are unchanged.

## Trust boundary

1. Existing `step1_owner_control_policy_candidate.mjs` verifies the exact canonical signed proposal, its signer against a separately reviewed Ed25519 SPKI SHA-256 pin, the X25519 recipient SPKI pin, exact source/account, amendment hash, 15-minute maximum owner-device proposal, nonce, no-cost claim, and previous security failures. A signed proposal is **NOT** a permission for provider operations.
2. `step1_owner_signed_proposal_nonce_guard.mjs` runs that verifier **first**. Only then may it call the local Python nonce store. No private PEM, passphrase, SQL, customer record or Cloudflare token is accessed. The `OWNER_SIGNED_PROPOSAL_NOT_AUTHORITY.json` input contains only the public signing key, signed payload and signature.
3. `step1_owner_nonce_replay_store.py` requires a pre-existing **owner-only directory** (absolute path, mode `0700`, local OS user ownership), creates a mode `0600` SQLite database, uses an immediate transaction, `synchronous=FULL` and explicit unique indexes on `(account, D1, signer, nonce)` and exact proposal digest. It refuses duplicate nonce, replay, mismatched source, symlink/hardlink, loose permissions, corrupt or drifted schema, malformed inputs and unqualified policy flags. Concurrency and restart cases are covered by tests.
4. Important: the Python store **does not authenticate the signature independently**, and could be invoked directly to poison a local nonce ledger. Never use the Python store alone, a self-described signed receipt, or a local SQLite row as a provider-access credential. The Node verification must precede local reservation. A local DB snapshot **can be rolled back**; test evidence explicitly demonstrates this. Hosted durable replay, external anti-rollback and real owner identity remain **OPEN**.

## Owner-only execution, after the real offline key ceremony

On the owner's secure offline Linux/macOS computer (or a separately qualified Windows environment), from the exact PR241 working tree, with Node.js and Python3 installed and reviewed public trust pins in the environment:

```sh
export AXIOM_TRUSTED_OWNER_ED25519_SPKI_SHA256='<separately reviewed 64-character signing public SPKI SHA-256>'
export AXIOM_TRUSTED_OWNER_X25519_SPKI_SHA256='<separately reviewed 64-character recipient public SPKI SHA-256>'
mkdir -m 700 "$HOME/axiom_step1_owner_local_nonce_ledger_private"
node customer_frontier/qualification/step1_owner_signed_proposal_nonce_guard.mjs \
  "$HOME/axiom_owner_signed_proposal_private_20261113_01/OWNER_SIGNED_PROPOSAL_NOT_AUTHORITY.json" \
  "$HOME/axiom_step1_owner_local_nonce_ledger_private"
```

The signed owner proposal must be unexpired and must have been created by the existing offline owner-device signing script, after the full SHA-256 owner review. The Node CLI refuses CI and noninteractive execution; Python's test suite uses **synthetic keys and claims only**. Do not copy private keys, passphrases, sensitive backup data, signed permits or the raw local ledger into ChatGPT, GitHub, Cloudflare, or Drive. Public pins and sanitized `NO_GO` receipts may be shared only through the reviewed procedure.

A local result with `LOCAL_OWNER_SIGNED_PROPOSAL_REPLAY_CONSUMED_ONLY_NO_GO` means only **this local ledger observed one nonce reservation**. It **never** establishes durable *hosted* nonce consistency, physical backup recoverability, independent trust pin approval, production owner MFA, zero additional spend, hosted D1 restore/parity, or B27 global rollback proof. An offline backup/revert of the ledger can replay a historical nonce, which is intentionally marked as unqualified.

**Next genuine blockers:** verified owner-device keys + recovery and MFA, hosted nonrollback/nonce control appropriate to owner-only governance, a current scoped encrypted SQL backup, a qualified new disposable D1 target with cost admission, hosted restore and parity. Existing DR UUID `c023a0a0-472a-4178-ad07-02f1d6b2e122` remains quarantined after 404/unreconciled state.

**Step 1 OPEN · Step 2 PROHIBITED · NOT_RELEASE.**
