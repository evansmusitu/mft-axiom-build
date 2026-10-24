# MUSITU Enterprise Studio V0.3 — Stream Exhaustion Protection and Emergency SQLite Return

**2026-10-25 — isolated branch, source-only. Production cutover and billed rendering: NO-GO.**

## Scope / motivation

The frozen-ledger R2 byte verifier constrained total bytes, but an untrusted or damaged provider stream could emit unbounded zero-byte chunks or very many tiny chunks without exhausting the byte budget. The canary guard also revalidated short-lived fences **before** a potentially slow independent provider callback, permitting the callback to outlast evidence and fencing validity before its first route CAS.

A separate failure mode arises if a process crashes while the isolated route remains `NEON_CANARY_READONLY`. The original `guardedStudioNeonPromotion` attempts immediate rollback while alive, but process death can prevent `finally` from running. Manual recovery needs an independently authorized, fenced, SQLite-only return interface.

## Implemented

1. `musitu_studio/neon/r2_content_reconcile.mjs`: Reject empty byte chunks; bound per-object and global chunk iteration independent of byte count. Defaults: 65,536 chunks/object; 262,144 aggregate; configurable hard ceilings of 1 million and 2 million respectively. Validate options **before any R2 reader invocation**, fail closed on provider read failures and preserve prior immutable receipt semantics. These limits bound CPU/work but **are not** network timeouts, billing limits or Cloudflare audit proofs.
2. `musitu_studio/neon/migration_promotion_guard.mjs`: After durable nonce reservation, revalidate the complete canonical source evidence, every independent provider receipt (not merely R2 signed versions), and signer/version status. After these potentially slow provider callbacks finish, **repeat canonical evidence freshness, source SQLite freeze and Neon read-only write-barrier probes** immediately before any route CAS. Revalidate the same signed Android owner receipt at the final boundary. Any expiry, revoked provider, or lost barrier aborts with no route switch. A nonce already reserved remains consumed.
3. `musitu_studio/neon/read_only_canary_recovery.mjs`: Add a narrowly scoped, provider-injected **emergency-return-only** control plane. It cannot switch SQLite toward Neon. It accepts only a frozen incident identity tied to exact source head and run, independently authenticated signed owner recovery approval, a fresh SQLite source authority receipt, and an exclusive external fencing lease. It attempts only an epoch-and-token-fenced `NEON_CANARY_READONLY -> SQLITE_DO` CAS and demands readback. On unknown route, CAS denial, or unrecoverable failure it **retains** the lease for manual recovery. Old incident timestamps remain recoverable if a fresh signed owner approval and fresh SQLite source authority exist; future-invalid or ambiguous timestamps fail. No customer objects, keys, or records are read by this module.
4. Unit tests exercise all these fail-closed cases, including originally failing red regressions (captured separately). External adapters are hypothetical; no production control plane is attached.

## Mandatory production integration contract

Callbacks must be implemented using **real** durable provider-backed leases/fencing CAS, independently verified Android owner signatures, Cloudflare SQLite DO source authority, audited control-plane transport and readback. A caller returning `verified: true` from synthetic tests is not evidence. An operator Ed25519 R2 signature does not prove native Cloudflare provenance. These modules must not be invoked against live routes without signed owner authorization, complete hosted restoration/rollback, private Neon connectivity, immutable source export and audit reconciliation, and enforceable provider spending hard stops.

No deployed production routes, SQLite rows, R2 objects, Cloudflare Access, Neon network settings, V0.2 or Modal CPU/GPU were modified. These changes **do not** authorize Neon migration or billable rendering.

## Offline reproduction

```sh
node --test musitu_studio/neon/tests/*.test.mjs
node --test musitu_studio/edge/tests/v03_glb_*.test.mjs musitu_studio/edge/tests/v03_scene_preview.test.mjs
python -m unittest discover -s ops/tests -p 'test_studio_*.py' -v
```

Test totals in the complete handoff are bound to the exact GitHub commit, not an earlier local copy; exact-commit hosted GitHub Actions success remains separately unverified unless read back from the Actions provider.
