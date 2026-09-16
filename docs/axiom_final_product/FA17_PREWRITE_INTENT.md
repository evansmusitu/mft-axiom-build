# FA-17 — Security Hardening & Red Team — Pre-write Intent

Status: AUTHORITY_FROZEN_FOR_QUALIFICATION

## Frozen source

- source branch: `frontier/axiom-final-product-fa16-20260916`
- source commit: `e88f4ecd09343bd04d1196b3379ed8d8c3677c82`
- FA-16 qualification run: `35067956395` — PASS
- FA-16 phone evidence: preserved at SHA-256 `03478e2f17eb82f68417c826e86c29a1fed716d57d5fbe1e81f4d5f1c49a42f6`
- FA-16 tablet evidence: `DEFERRED_PENDING_FUTURE_CUSTOMER`
- FA-16 phase exit: not earned; subsequent qualification progression explicitly authorized.

## Required suites

SAST, isolated non-production DAST, prompt injection, privilege escalation, secret bait/exfiltration, SSRF/network pivot, supply-chain integrity, evaluator tamper and rollback/evidence tamper.

## Gate

Any open `HIGH` or `CRITICAL` finding blocks FA-17. Missing suites fail closed. A builder cannot certify itself, lower thresholds, grant production authority, or convert medium residual risk into a false full-security claim.

The phase may earn only `PASS_NO_OPEN_HIGH_SEVERITY` for the tested exact candidate and scope. It does not certify every legacy workflow, does not replace production red teaming, does not close the deferred tablet row, and grants no staging or production authority.

Security attacks may repair a finding only with a focused regression. The first local attack found that the FA-16 offline secret classifier did not cover GitHub fine-grained token shapes; FA-17 therefore includes the bounded classifier repair and regression while preserving every FA-16 authority and tablet-evidence boundary.
