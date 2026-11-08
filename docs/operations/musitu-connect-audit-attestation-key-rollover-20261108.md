# MUSITU Connect — offline audit HMAC key rollover verification (2026-11-08)

**Disposition:** source-only reference verification; no live key rotation, customer access, hosted D1/Neon write, Worker deployment, external custody, or production qualification.

## Purpose and exact trust boundary

`verify_audit_attestation_key_rotation(store, pinned_previous, proposed_latest, previous_secret, successor_secret)` authenticates a *previous independently pinned* canonical audit artifact under the previous HMAC key and a *proposed new* canonical artifact under a distinct successor HMAC key. It rejects identical keys, invalid keys, noncanonical artifacts, a different run or immutable origin, and any rollback/fork. It accepts a legitimate unchanged audit tip reauthenticated under the new key, or an append-only extended tip. Both snapshots must have a correctly authenticated HMAC; the latest must match the current intact local run, hash chain and checkpoint. A single consistent SQLite read transaction verifies that the exact event hash at the old index still exists in the new current chain.

`verify_audit_attestation_rotation` retains its existing single-key, append-only contract through the same internal continuity validator. The v1 canonical artifact format and signing domain are unchanged.

## Operating procedure — **not automated**

An authorized owner would have to retain the exact last *trusted*, previously signed bytes and previous key in storage separate from the audited DB; generate and protect a fresh high-entropy successor key; issue the proposed latest snapshot signed with that key while the trusted old artifact remains pinned; verify cross-key continuity; and only then independently retain the new signed bytes and arrange any approved key-retirement procedure. Verification alone neither approves the change nor destroys, rotates, generates or stores a key. A key-size check of at least 32 bytes does not establish entropy or safe key management. An attacker controlling the external pinned artifact and both keys can defeat this check. Neither an HMAC nor a file in the same system is independent WORM custody, independent timestamping, or a third-party attestation.

No automatic backfill of legacy audit histories is attempted. Legacy databases lacking an independently verified checkpoint remain blocked, rather than silently assigning a new terminal head to possibly truncated events.

## Local regression evidence

`tests/connect/test_audit_attestation_key_rotation.py` uses disposable SQLite and synthetic keys. It covers valid no-op transition and append-only transition, identical-key rejection, incorrect/swapped keys, cross-run substitution, a rewritten local chain despite a newly valid successor signature, stale latest attestation, preservation of caller-managed transactions, and canonical format rejection. TDD RED observed two expected failing valid-transition assertions before implementing the new function; GREEN observed 9/9 passing afterward. Existing single-key rotation tests remain in scope for regression verification.

This file does not qualify external tenant data, hosted D1/Neon, a deployed Worker, customer beta access, mine methane prediction, model promotion, or any safety-critical operation. Preserve the existing authorized general-purpose Connect-to-Axiom arithmetic path and all customer-admission and methane safety blockers.
