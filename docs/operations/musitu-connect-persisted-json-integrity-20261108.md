# MUSITU Connect — strict persisted JSON integrity (2026-11-08)

**Scope:** source-only local SQLite run/audit ledger. No hosted D1 or Neon access, customer credential, deployment, release, independent mine validation, or audit-attestation publication.

## Failure mode

Python's default `json.loads` silently accepts duplicate object member names (last key wins) and the nonstandard `NaN` / `Infinity` tokens. In the local Connect run ledger, a writer who could alter `envelope_json`, `lineage_json`, or `run_audit.payload_json` could insert duplicate names while keeping the final decoded value identical. Existing canonical run hashes, event hashes and terminal audit checkpoints could therefore continue to validate even though the persisted representation had become ambiguous. Nonfinite lineage metadata could also be stored by `json.dumps` without `allow_nan=False`.

## Implementation and compatibility

`connect/persistence.py` now strictly decodes the three persisted JSON columns using a nested `object_pairs_hook` that rejects repeated names and a `parse_constant` hook that rejects nonstandard numeric tokens. `RunStore.verify_audit_chain` already catches `ValueError` and returns `False` for invalid stored JSON. The storage writers reject nonfinite objects instead of writing future JSON that their verifier would refuse. Unambiguous standard JSON with unsorted keys, Unicode, or legal formatting differences continues to be accepted; this does **not** change the signed canonical business payload or assert that the raw storage bytes are cryptographically sealed.

## TDD and limits

Seven disposable local SQLite tests in `tests/connect/test_persisted_json_fail_closed.py` cover duplicate envelope-source, nested lineage-source and genesis audit fields, nonfinite lineage/audit values, and preventing new nonfinite entries. Initial regression execution failed as expected on six cases; after the patch, seven of seven pass. Focused persistence, provenance, runtime, Mining Adapter and contract suites: 45 of 45 pass. Node Connect/customer tests: 50 of 50 pass. Passing local tests are **not** production qualification; use the exact committed-head GitHub CI as an independent check.

This is fail-closed decoding, not proof of immutable storage or independent third-party custody. A database owner capable of coherently rewriting whole rows, chains, and local checkpoints is outside this mitigation. The separately keyed offline HMAC attestation still depends on protected keys and independently pinned latest artifacts. Legacy databases with valid standard JSON remain compatible; deliberately nonstandard legacy rows will now fail closed and require separately reviewed remediation rather than automatic rewrite.

No changes are authorized to the frozen methane score/measurement thresholds or chronological test contract, the approved general-purpose production Connect-to-Axiom arithmetic path, customer admission, hosted Cloudflare D1, Neon, external publication, Git main, or mine-safety gates.
