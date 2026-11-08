# MUSITU AXIOM | Actual staging D1 synthetic batch rollback | 8 November 2026

**Status: HOSTED SYNTHETIC ATOMIC ROLLBACK PASS. NOT A FULL RESTORE. NOT RELEASE.**

## Authority and scope
Owner explicitly approved safe non-destructive reuse of exactly one previously qualified customer staging D1 UUID `ccc473f1-fbb5-4b8d-8a24-45f3696ac10f`. Production OAuth `504029cc-f9a5-495e-818f-63c6144b4ea4`, shared q06, other databases, commercial Paynow, billing, and paid upgrades were outside scope.

## Live execution
- PR115 draft/isolated, source HEAD `89c5567825dbf21b8a360cf9d074a542478becdc`; single-use GitHub Actions run **42447897393**, job **128630622898**: SUCCESS, attempt 1.
- Immutable reviewed source checkout `abdf00c692e4597d0489cc597522c58b0f63da56`. Pinned Git blob SHA-1: synthetic Worker `345d66ad33293ef34038c3cd91b81e760728d94a`, driver `6e86c436d91d54c2fb4baaa2c6fd5f3f9d88bdf0`, tests `c8072ef08559a38d1b321bc2785119607fe294fb`, read-only catalogue source `34fab291033cde14e13efdd9e87bd5e8d5d16100`.
- 20 preflight synthetic privacy/bindings tests PASS; separate synthetic D1 batch, authentication and rollback tests PASS, run 42447811357 PASS before live job.
- Live fresh fixed-UUID metadata + catalog read-only scan: **zero** current Worker/Pages bindings among inspected current surfaces; 78 objects matched SHA256 `e0a8f47429b1479d7dd2037633e8ca309645fb65fe345335801fc8653b49b7a1`; actual D1 catalogue SELECT confirmed changes=0, rows_written=0, changed_db=false.
- A private temporary Worker was deployed under an exclusive hardcoded run name, with ephemeral 64-character bearer authorization and ownership markers. Its only mutation was a deliberately failing `D1Database.batch` containing one uniquely named synthetic CREATE TABLE followed by one valid and one CHECK-violating INSERT. Expected CHECK failure verified.
- Hosted Worker reported `rolled_back=true`, `foreign_keys_check_passed=true`, same 78-object schema hash, synthetic table absent. Separate Cloudflare read-only catalog re-query also preserved identical fingerprint. **No existing customer rows read or altered by the probe.**
- Owned ephemeral Worker settings were read back with both DB and ownership marker checks, deleted with HTTP 200, and follow-up Worker-settings GET returned HTTP 404. Driver final flags: `rollback_verified=true`, `initial_catalog_verified=true`, `after_catalog_verified=true`, `temporary_worker_removed=true`, `probe_table_persisted=false`, `error=null`, `production_oauth_changed=false`, `full_hosted_restore_qualified=false`, `release_authority=false`.

## Permanent evidence integrity
- GitHub Actions artifact ID `13604955221` contains only redacted result JSON, hashed current catalog/bindings report and its SHA256 companion. ZIP size **14,587 bytes**, SHA256 `d9602383f79517f1feae8c7f93d57cc7b8fcfe4b084f8082502466441f4087be`, ZIP CRC PASS.
- Uploaded and subsequently downloaded the exact ZIP from **owner-only, unshared** Google Drive private recovery folder `1AN3iDFBSHb0RDoL2-108PFE-Z0a7eo70`. Drive file `1BLvNFbSgTwyaCPkoIO-kijXO2kwzSwti`, 14,587 bytes; both independently SHA256-hashed copies are identical and ZIP CRC PASS.
- Exact Drive URL: https://drive.google.com/file/d/1BLvNFbSgTwyaCPkoIO-kijXO2kwzSwti/view
- Hosted run URL: https://github.com/evansmusitu/mft-axiom-build/actions/runs/42447897393

## Preserved snapshot and prior recovery
- PR113 owner encrypted logical D1 export run `42446715749`: 40,173-byte RSA-4096-OAEP-SHA256 + AES-256-GCM ciphertext SHA256 `d8fdb7d06f27d3053799ba70eb2c4c12d2b5570eb9c5cf4724e7216908d0b3b3`.
- Owner-only Google Drive exact snapshot: https://drive.google.com/file/d/1mN8yJSNILPbhwhFKlqZ9sv9dJHQ9vk31/view ; source and downloaded zip byte hash matched. The same authenticated logical export was restored in TWO independent fresh local SQLite databases, including 25 user tables and 25 rows, no disclosed customer data, with SQLite integrity+foreign-key checks and transaction rollback probes PASS. **Local restore is not remote hosted D1 recovery certification.**

## Remaining technical blockers
A same-DB synthetic transaction is not an isolated disposable full-database restore. **Full hosted restore, destructive recovery, production existing-schema OAuth upgrade, hosted identity/onboarding and ChatGPT continuity, real execution/payment/device acceptance, independent custody/B27, PR83 full-stack integration and publication remain unqualified/blocked.** Do not use this receipt to waive these gates. Production OAuth has not changed.

No production release, code merge, paid plan, real-money action, OAuth migration, existing-customer-table mutation or permanent Worker deployment occurred. PR1 remains separate DRAFT/UNMERGED; PR83's deliberate full-stack veto remains intact. `B27=FAILED_IN_SYNTHETIC_ATTACK`; parity/superiority NOT_CERTIFIED; saved final usage UNKNOWN; `release=BLOCKED`; `spend_authority_usd=0`.
