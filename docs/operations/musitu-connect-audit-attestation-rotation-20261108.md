# MUSITU Connect — offline audit attestation rotation contract (2026-11-08)

**Scope:** Source-only, offline local SQLite integrity assurance; not a production integration, customer-admission authorization, deployment, hosted D1/Neon change, or external custodian.

## Why this is needed

The previous `connect.audit_attestation.issue_audit_attestation` and `verify_audit_attestation` contract can compare one externally pinned HMAC-authenticated snapshot against a current SQLite database. However, the old pinned artifact becomes stale after a legitimate append. Without an explicit rotation check, an operator cannot verify that the *new* separately signed tip extends the precise hash originally entrusted to independent custody. Replacing a database with another internally valid history, then signing a fresh latest snapshot, would otherwise appear valid when only the proposed latest artifact was examined.

## Source-only verification contract

`verify_audit_attestation_rotation(store, pinned_previous, proposed_latest, secret)`:

- Authenticates **both** canonical HMAC-SHA256 artifacts using the caller-supplied, separately protected key (minimum 32 bytes). The supplied previous bytes must be the *exact independently pinned artifact*, not bytes retrieved from the possibly compromised database.
- Requires identical immutable run identity and provenance fields (run ID, connector, protocol, creation timestamp, canonical hash, signature hash, lineage hash, source, provenance).
- Rejects rollback and discontinuity in event count/index; permits identical current artifact as an idempotent no-op.
- Under **one SQLite read transaction**, validates the complete current run/audit chain, compares the proposed latest snapshot with the current DB, and checks that the earlier pinned event hash still appears at its original event index. The verifier never silently re-pins history from the current database.
- Refuses a caller-owned transaction without rolling it back. Returns `False` for invalid artifacts, bad keys, missing or forged history, and database integrity failures. No publishing, key generation, database mutation, or background operation is performed.

This function is intended as an optional owner-controlled, offline step **before** replacing a separately retained latest attestation; the calling operator still needs to arrange independent durable storage, key management, and an approved workflow. The previous single-artifact API and canonical wire format are unchanged.

## Boundaries and release gates

The HMAC key must stay confidential, separate from Connect request-signing secrets, and outside the audited SQLite system. Neither artifact authenticity nor these local tests proves immutable storage, independent timestamping, dual-control custody, third-party auditing, externally attested identity, or protection after both the key **and prior pinned artifact** are compromised. The verifier trusts the currently readable SQLite snapshot for the latest state but independently anchors its history to the supplied prior bytes.

No legacy database backfill, cloud deployment, hosted D1/Neon mutations, live credential use, customer beta admission, public Connect publication, methane-model tuning, safety-gate changes, or main-branch merge is authorized. Existing production Connect-to-Axiom general arithmetic remains untouched.

## TDD and qualification

Isolated disposable SQLite regressions: `python -m unittest tests.connect.test_audit_attestation_rotation -v` — two expected RED assertions for valid progression and identical current-tip rotation, followed by **8/8 GREEN**. Related local available Python suites **41/41 passed**; earlier attempt to select two not-present newer source-only test modules produced collection errors and was not reported as passing. The local extracted source tree is older than some remote test modules; exact-commit GitHub CI must be checked before asserting full branch qualification. No hosted infrastructure, external custody, or production operations were exercised.
