# MUSITU Connect — offline pinned audit attestation (2026-11-08)

**Status:** source-only, non-deployed reference control. **No** hosted database, customer admission, immutable storage, live production mutation, or external operator approval is claimed.

## Threat boundary

`run_audit_heads` is transactionally maintained but held in the same SQLite database as `run_audit`. A database writer can rewrite both. The new isolated module `connect/audit_attestation.py` can issue **canonical HMAC-SHA256 bytes** using a separately managed secret (at least 32 bytes). The bytes bind run ID, connector, protocol, creation time, canonical run SHA-256, stored signature SHA-256, lineage SHA-256, source, provenance, audit event count, terminal index, and terminal hash. The issuer verifies the local run and audit chain first, inside a consistent SQLite read snapshot.

A verifier checks canonical encoding, required fields, HMAC, and the **current** run/audit state against the **specific independently pinned attestation supplied by its owner**. Later legitimate events invalidate an older attestation: the owner must sign and retain a new latest artifact. Neither issuance nor verification writes to a customer database or uploads any data.

## Security and operational limitations

- The current module does **not** provide an immutable external storage provider, key custody, secure delivery channel, audit-publisher scheduling, timestamps with independent authority, or a witness signature. These are separate **BLOCKED** operational controls.
- A caller must generate a high-entropy **separate** HMAC key and protect it outside the audited database. Key length alone does not prove entropy or custody. Do **not** commit or log a real key, pass customer bearer material, or reuse the canonical Connect request signing secret.
- Retain and independently pin the **latest** attestation in owner-controlled storage. Without that latest signed artifact, full database plus artifact rollback may go undetected. Compromise of the external HMAC secret also defeats this verification. This is **not** WORM, external attestation, independent audit, or third-party notarization.
- The consistent read snapshot uses the local `RunStore` connection and re-entrant lock. It refuses issuance during an existing caller-managed transaction rather than risking rollback of another operation. Multi-host and hosted D1 semantics are **not qualified**.
- Reopening legacy databases missing the local audit-head checkpoint remains fail-closed; no automatic migration or historical backfill is introduced.
- No methane evaluation/model thresholds, production arithmetic routing, customer credentials, production Worker deployment, hosted Neon/D1 resources, Git `main`, or promotion gates are changed by this source-only module.

## Local test evidence

`python -m unittest tests.connect.test_audit_attestation tests.connect.test_persistence tests.connect.test_persistence_storage_canonical_integrity tests.connect.test_runtime tests.connect.test_contract -q` — **35/35 passed** on local copied 2026-11-07 source snapshot (new module not yet on live branch at test time). Initial behaviorally failing tests returned false success for altered attestation state and incorrect secrets; subsequent 12 isolated regression scenarios pass. `node --test` on identity/admission/provisioning/payload — **54/54 passed**. Unrestricted local Python discovery timed out and is **not** reported as passed. Commit-level GitHub CI is independently required before new-head acceptance.

## Recommended separate authorization

Before treating this as a real external audit control: security review of key lifecycle, placement in independently managed immutable/latest-pointer storage, rollback/replay protection, human operational ownership, authorized retention/privacy, full database restoration trials, host-to-host consistency, and source-specific independently witnessed evidence. All existing product and methane-safety release blockers remain unchanged.
