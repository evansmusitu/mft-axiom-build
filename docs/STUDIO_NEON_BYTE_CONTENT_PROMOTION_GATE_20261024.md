# Studio V0.3 — require byte-level R2 evidence before any Neon read-only canary

**2026-10-24. Isolated branch, source-only. Production remains NO-GO.**

## Failure mode prevented

The previous `r2_references_verified` promotion gate could be satisfied by checking that each R2 key and its *declared* SHA-256 appeared in a complete frozen ledger. This does not establish that the actual Cloudflare R2 objects still exist or match their declared bytes. A fake or stale object could therefore pass metadata-only evaluation before the canary route CAS.

The offline `verifyStudioR2ObjectBytes()` module already stream-checks content and returns `musitu.studio.v03.r2-content-receipt.v1`, with `provider_verified:false` and `cutover_authorized:false`. This commit **connects that required receipt to the source-only promotion guard**, while keeping provider attestation a separate required input rather than upgrading synthetic evidence.

## New fail-closed contract

- All 16 existing and new named gates must pass; new name: `r2_content_sha256_reconciled`.
- `r2_content_receipt` must carry complete/verified flags, full `objects_verified` equal to the source assets-table count, bounded exact byte count consistent with asset schema, 64-character SHA-256 content HMAC, original source assets-table HMAC, same source/target freeze ID, and the explicit offline flags `provider_verified:false`, `cutover_authorized:false`, `customer_bytes_logged:false`.
- `r2_provider_attestation` must be a distinct fresh, read-only Cloudflare-R2 attestation, with a nonempty provider receipt ID, fixed dedicated-bucket identity digest, verified immutable/version-pinned read flag, frozen source binding, exact GitHub source commit, matching freeze ID, object count, byte total, and matching content HMAC. It must have a checked-at timestamp no more than five minutes old and no more than thirty seconds in the future.
- In `guardedStudioNeonPromotion` the injected `verifyProviderReceipts()` callback **must independently validate cryptographic signatures and provider account/bucket identity** for the new attestation as well as all other receipts; source code cannot infer these from user-supplied booleans. A receipt with a `verified:true` field, by itself, is NOT sufficient. If the independent verifier returns anything other than `true`, no route CAS runs.
- The existing independent live SQLite freeze probe, target write barrier, signed browser acceptance and return-to-SQLite CAS remain required. This is **not** a production write promotion path.

**Important limitation:** The connector currently provides no authenticated R2 content reader, signed version pin or trusted provider receipt verifier. The test suite uses synthetic buffers and fake receipt booleans. None of these new checks prove live customer R2 data was read, frozen or repaired. Production must stay on SQLite and Modal remains disabled pending independent evidence and financial hard-stop proof.

## Local evidence

Red-first synthetic tests failed on the prior source (six expected failures); after implementing the new gate `node --test musitu_studio/neon/tests/*.test.mjs` passed **118/118**, with five newly added regression cases. The unchanged GLB scene tests passed **23/23** and Python operational tests **27/27**. Full hosted Edge and GitHub Actions results remain unverified for this commit.