# Isolated follow-on engineering — offline two-party custody and terminal-envelope hygiene

**Scope:** only `musitu-mail-fabric/` on isolated product branch. No provider send, no public route, no Cloudflare deployment, no DNS or existing secret mutation. Exact GitHub HEAD and tests must be independently revalidated after commit. Current product label stays at v0.18.0 rather than pretending deployment readiness from an unqualified version number.

## Key custody: what the code actually does

- `sealRecoveryKeys({tenantId,epoch,keys,custodians})` packages the original message-encryption, recipient-privacy, encrypted-backup, and Ed25519 signing-private keys in an AES-256-GCM protected payload; each of the two separate custodians receives an independently RSA-OAEP-SHA256-encrypted XOR share of the random 256-bit wrapping key.
- The escrow descriptor commits to both custodian public-key SHA-256 fingerprints, tenant, epoch, UUID and Ed25519 signing-public-key fingerprint as authenticated encryption associated data. Private RSA credentials are never written into the escrow object. The output contains **sensitive encrypted material**: never commit, publish, email, upload to this chat, or reuse a test envelope for live keys.
- `recoverRecoveryKeys(bundle,{expectedTenantId,expectedEpoch,trustedBundleSha256,custodians})` refuses partial or duplicate custodians, wrong key pair, tampered envelope, missing outside digest and wrong epoch/tenant. Caller must pin the exact bundle digest and current epoch via independent authenticated out-of-band storage to prevent archive rollback or substitution. Both custodian private keys must be held and unlocked separately.
- A successful local recovery returns the same protected operational keys to caller memory; **it never automatically rotates running Worker keys, deploys credentials, reopens customer sending or updates a cloud backup.** The temporary buffers are best-effort wiped inside the library, but JavaScript memory, caller-provided secret handling, and OS swap cannot be proven cleared; use audited HSM/KMS-backed custody for genuine production.
- RSA-3072+ cryptography is standard but this orchestration **has not undergone independent cryptographic or operational review**. Do not claim recoverability across real cloud-account loss or real production rotation merely from local success. Onboarding real custodians requires key generation and access controls managed outside GitHub or ChatGPT, independent custody agreement, backup encryption and offline tested disaster recovery.

## Rotation procedure before any live promotion

1. Obtain two independently provisioned custodial encryption public keys with independently attested fingerprints and separation of access, preferably HSM/KMS policies rather than exported PEM private keys.
2. Capture trusted current tenant epoch, external key-trust head and backup key fingerprints without copying secret material into logs.
3. Generate a freshly signed `src/trust/transitions.mjs` Ed25519 old-to-new trust transition under offline, dual-operator approval; pin its trust head. Coordinate envelope key rotation with rewrapping of outstanding queued ciphertext and retention of old privacy-key continuity until suppression HMACs are safely migrated. **Never silently overwrite an old key while queued ciphertext or suppressions still depend on it.**
4. Create new escrow epoch using the two custodians and independently record and pin its exact SHA-256 in immutable restricted evidence. Prove both restoration and original old epoch verification against a **separate sacrificial database** before retiring any prior keys. Log only digests, immutable change references and redacted verification outcomes.
5. Reconcile lease claims, provider-acceptance ambiguity, suppressed recipients and all backup snapshots. Only an explicitly approved release process may move actual Worker credentials. No live rotation workflow is provided by the current implementation.

## Retention safety

`sweepTerminalEnvelopeResidue(db,{tenantId,now,minAgeDays,dryRun,legalHold,backupVerified,retentionApproved,acknowledgement})` has a safe `dryRun:true` default; it reports only aggregated counts. To erase, set `dryRun:false`, `legalHold:false`, `backupVerified:true`, `retentionApproved:true`, and `acknowledgement:'ERASE_ONLY_TERMINAL_ENVELOPE_RESIDUE'` after verifying the source backup and independent authorization outside the software. The function limits rows by tenant, terminal state and minimum age, issues an atomic conditional SQL update, and returns a count. It never deletes idempotency keys, receipt chains, provider events or suppressions.

This is *residual ciphertext cleanup*, **not general erasure**. Define legally reviewed per-jurisdiction retention periods, immutable evidence requirements, DSAR/erasure exceptions, legal-hold authorities, consent records, processor obligations and secure deletion procedures before wider deployment. Queue/lease states must be reconciled separately and cannot be erased under this job. A single input boolean `backupVerified` is an operator attestation and is not independent evidence.

## Genuine external blocks, kept distinct from local implementation

- Connected Resend on 11 October 2026: verified domain `mftintelligence.com` (sending enabled), and **zero event webhooks**. Existing provider configuration has not been modified. No live provider-originated signed events have been proven; original private two-Worker proof is synthetic. A real event trial requires separately approved controlled recipient addresses, a disposable provider webhook signing secret, isolated nonpublic-by-default receiving infrastructure with a privately reviewed intentional callback ingress, and independent delivery evidence. No customer/production send is authorized.
- An independent external security assessor must receive the exact isolated commit, threat model and reproducible synthetic harness, and return a signed independent report. This file is self-authored and is not certification.
- Abuse review must cover sender identity, unsubscribe/consent-by-purpose, phishing/link checks, reputation, complaint escalation, tenant-specific rate limiting and real operational staffing. Current transactional kind allowlisting, quotas and bounce suppression are insufficient on their own.

### Tested local contract

`node --test test/offline-custody-v019.test.mjs test/retention-safety-v019.test.mjs` and `npm run check && npm test` exercise envelope round-trip, missing custodians, tampered digest, incorrect epoch/tenant, dry-run defaults, cross-tenant isolation, protected QUEUED/SENDING rows, legal-hold rejection and preserving idempotency. These are local code tests, not third-party or live-provider qualifications.

## Additional isolated send-policy hardening

The product now fails closed on URLs not in an explicit exact-host HTTPS allowlist and rejects malformed allowlist settings and credential-bearing URLs. Worker settings use `MMF_APPROVED_LINK_DOMAINS` for comma-separated lower-case exact hostnames; it is absent by default. This is a strict pre-send gate and can reject legitimate transactional links until operators approve their real hosts. Social-engineering language without URL syntax, visually deceptive display text, domain reputation, compromised approved domains and link redirect chains still require an independently reviewed external abuse controls program.
