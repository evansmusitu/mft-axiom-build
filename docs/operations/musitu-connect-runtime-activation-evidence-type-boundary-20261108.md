# MUSITU Connect runtime activation evidence — strict type boundary (2026-11-08)

**Scope:** Source-only, offline qualification contract. This patch does **not** activate any runtime, authorize a new customer, deploy Connect or Axiom, alter hosted data, or change methane-model gates.

## Finding

`ProductionRuntimeActivationEvidence.is_valid()` previously used Python truthiness for six positive evidence flags and the inverse of the rollback flag. A parsed document containing `"false"` for a required positive flag, or `0` for `rollback_required`, could therefore qualify a boolean condition without the required literal JSON boolean. Malformed non-string endpoint or authorization inputs could raise exceptions rather than return a deterministic negative decision. A value of `"https://"` without a host also passed the old endpoint prefix check.

## Change

The validator now requires every positive evidence flag to be exactly `True` and `rollback_required` to be exactly `False`. It checks that the expected authorization ID is a nonblank string, and that the endpoint is a string with an HTTPS scheme and a host, without embedded username/password credentials. A malformed URL returns `False` rather than escaping the policy boundary.

The existing rule, field names, and interpretation of `pr_9_unmerged` are deliberately **not** changed here. The policy model does not inspect GitHub PR state, grant production permissions, check a live endpoint, or independently attest to supplied evidence. An operator must independently validate the underlying facts. PR #9 remains merged and closed; no contradictory runtime-enable claim is made.

## Evidence

New source-only regression tests under `tests/connect/test_runtime_activation_strict_evidence.py` reproduced the old validator's defects: 30 failed subtest assertions and eight errors on malformed evidence. After correction, the new four tests and existing three activation tests passed (7/7). Related local activation, admission, runtime and platform suites passed (49/49), with Python compilation successful. The repository's full GitHub qualification workflow must be checked against the **exact new commit**.

## Preserved restrictions

No modifications to `main`, PR #9, production Worker deployment, existing authorized Connect-to-Axiom arithmetic, tenant/Neon/D1 data, secrets, beta admission, independent mine validation, frozen LightGBM model or threshold, or methane promotion. The change only prevents invalid typed input from satisfying the hypothetical activation evidence policy.
