# MUSITU Store V2 — private APK structural preflight / independent audit candidate

**Classification:** isolated Phase 1 engineering candidate, not deployed, not certified, not authorization. 24 October 2026.

## Context, unchanged authority

Canonical product is the 24 October 2026 verified whole-product archive, source manifest 359 files, original market vision, Axiom project `musitu-store-global-superiority-20261011`, plan `plan_4ff9d564fe764ebe843d78df913c7d86`, Phase 1 RUNNING, Phase 2 PENDING. The original mandatory gates, including three independently accepted genuine publishers and two approved genuine third-party applications, are NOT waived or redefined. No real third-party application, Paynow payment, publishing identity, production release, customer grant, or physical-device approval is represented here.

## New private-only files

- `private-apk-structure.mjs`: read-only, no-extraction, bounded ZIP central-directory inspection of a privately sealed APK under an operator-created 0700 root. It accepts only a random-format quarantine key and mandatory immutable submission SHA-256/byte count; verifies content digest by reading from an opened private descriptor. It refuses symlink/hardlink objects, group/other permissions, encrypted or unsafe-path entries, case-insensitive duplicates, unsupported methods, ZIP64/multi-disk structures, malformed/overlapping entries, unreasonable expansion metadata and missing APK manifest/classes.dex. It permits small standard Android zipalign zero padding in local extra fields. No tool runs arbitrary decompression or an application binary.
- `private-apk-structure.test.mjs`: adversarial synthetic APKs, immutable-digest substitution, three common ZIP corruption types, private filesystem constraints, exact manifest binding, real adapter-to-review chain. Offline local testing additionally covered three genuine first-party APK files from the verified handoff: the 10,097-byte offline test artifact and preserved unsigned 1.0.1/1.0.2 builds. All passed **structural** inspection. These are not installability, signature or security certifications.
- `private-structure-review.mjs`: internal-use-only coordinator. Requires operator-injected current reviewer authorization and an independent `review_security` role distinct from the submitter, loads the original private quarantine receipt from the trusted repository (never from a browser request), verifies the exact stored bytes, then conditionally appends a digest-bound **STRUCTURAL_PREFLIGHT_ONLY** audit record. Never exposes the private storage path or bytes in the returned result. Errors, forged results and conflicting receipts remain denied.
- `postgres-repository.mjs`: adds exact-manifest `readQuarantineReceipt` and conditional, parameterized `recordStructuralCheck` operations. Database must separately admit real identities; no real credentials, schema grants, migrations or data seeded.
- `postgres-apk-structure.candidate.sql` plus `.regression.sql`: disposable PostgreSQL 16, append-only structure-only receipt, exact uploader manifest and quarantine key binding, independent enrolled reviewer + active registered session at insertion, revoked/suspended session denial, no updating/deleting/replaying evidence, no positive publication state. Test creates only disposable fake fixtures in a transaction that **ROLLBACKs**.
- Two isolated CI workflows run Node security tests and PostgreSQL 16 candidate-schema adversarial checks, preserve frozen signed Store V1 source hashes and do not deploy or merge.

## What this does NOT test, and therefore cannot approve

The structural parser does **not** decompress individual members, verify CRC32 or decompress-limit actual member streams, parse AndroidManifest binary XML semantics, inspect DEX malware patterns, establish file origin, run `apksigner` APK Signature Scheme v1/v2/v3/v4 checks, validate certificates/key rotation, scan with up-to-date independent antivirus engines or sandboxes, verify legal/trademark/licensing rights, establish developer intent or consent, qualify Android/web/Windows installation, authorize a catalog version, issue entitlements, refund, charge, pay out, sign, publish, or approve any third-party APK. A syntactically valid ZIP may still be malicious or completely un-installable. Positive verdict means structural preflight only.

This single-host lab adapter is NOT acceptable as encrypted, durable, multi-zone production object storage. There is deliberately no public browser endpoint for structural inspection, no outbound scanner network connection, no implicit identity auto-enrollment, no staff bypass and no public object URL. An operator must separately provide a production-grade private object store and actual source/binary verification platform, key rotation and revocation, export/deletion lifecycle, auditor access and recovery evidence.

## Verification classification

- Run locally: `node --test store/phase1/developer_portal/*.test.mjs` and `node --check` for touched modules. This is local executable evidence, not independent production validation.
- GitHub CI: `.github/workflows/musitu-store-v2-developer-portal-auth.yml` and `.github/workflows/musitu-store-v2-developer-review-postgres-ci.yml` are triggered on the isolated branch and must both complete **success** on the exact new HEAD before database checks may be called independently verified.
- Private actual staging Neon was read-only last checked: no deployed portal session, publisher submission or quarantine receipt tables. Do **not** apply these SQL candidate files there as part of this change.
- Owner and independent reviewers must separately sign genuine privacy/legal/security/commerce/release decisions. A reviewer note is NOT an acceptance or public-release action.

## Known limitations and next engineering work

- Independently test real signed APKs with up-to-date `apksigner`, antivirus scanning and strict sandbox resource controls using genuine publisher-permitted binaries; bind all tool versions, certificates and bytes to the signed owner manifest.
- On remote durable storage, implement private encrypted object storage with version pinning, retry-safe ingestion, no overwrite, quarantine TTL, orphan reclamation and privacy deletion/export evidence, and test under concurrency and outages.
- Build live supported OIDC/MFA identity and revocation integration and least-privilege dedicated Postgres roles; run native end-to-end publisher enrollment only with authentic human consent.
- Resolve all original unchanged Phase 1 gates including three independent publishers, two approved third-party applications, Paynow transactions/refunds/settlement and accounting, real devices, support and independent production release authorization before Phase 2.

**No production migrations, public releases, protected branch merges or commercial effects are authorized by this note.**
