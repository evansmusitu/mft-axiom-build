# Connect authenticated request integrity — non-deployed feature branch (2026-11-07)

This change hardens the existing general-purpose MUSITU Connect → Axiom
arithmetic execution path. It **does not** authorize deployment, a new
customer, D1 changes, methane prediction, or a release-gate promotion.

## Boundary contracts

- Before planning or outbound risk computation, the production Worker reads at
  most 65,536 **raw UTF-8 bytes** of authenticated JSON. Invalid UTF-8,
  non-object root values, duplicate keys at any nesting depth, non-finite or
  lossy JSON number tokens, and excess bytes fail closed with the existing
  HTTP 400 `INVALID_REQUEST` response. All authentication remains ahead of
  input parsing. The limit matches the separate nonproduction customer
  payload module's documented ceiling; this does not wire that module into
  the production Worker.
- The Python Connect → Axiom HTTP/MCP executors validate the operation as a
  bounded ASCII identifier before preparing an authenticated request. Valid
  `arithmetic.evaluate` calls remain permitted; malformed operation values
  are rejected as `AXIOM_REQUEST_INVALID` before transport.
- A successful authenticated compute still requires correlated response IDs
  and the pre-existing response-integrity checks. The frozen methane model,
  thresholds, chronological evidence, and all safety gates are untouched.

## Reproducible offline qualification

```sh
node --test tests/connect/test_worker_request_integrity.mjs
node --test tests/connect/test_production_worker.mjs tests/connect/test_customer_identity.mjs tests/connect/test_customer_admission.mjs tests/connect/test_customer_payload.mjs tests/connect/test_customer_ingress_canary.mjs tests/connect/test_customer_provisioning.mjs tests/connect/test_synthetic_beta_acceptance.mjs tests/connect/test_worker_request_integrity.mjs
python -m unittest tests.connect.test_axiom_outbound_integrity -v
```

The new Worker regression suite first failed for duplicate keys, lossy numbers
and oversize bodies (200/200/502 instead of 400); after the change, all four
cases passed. The outbound Python operation test first failed for 22 invalid
cases; after validation, it passed. These are source-level tests, **not**
permission to run a production deployment or claim hosted D1 qualification.
