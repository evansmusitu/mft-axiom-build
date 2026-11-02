# AR-03 through AR-06 candidate track

This directory is an isolated, provider-independent recovery candidate. It
implements one integrated path across:

- AR-03 identity and onboarding;
- AR-04 Project/Work graph persistence and reconciliation;
- AR-05 durable task execution; and
- AR-06 one registry, invocation, and receipt fabric.

It does **not** claim that any formal phase gate is earned. AR-02 remains open,
the store is local SQLite rather than qualified cloud authority, and real
provider/tool execution was not performed.

## Candidate architecture

`CandidateRuntime` opens one SQLite database and composes four server-shaped
services. Identity contexts are HMAC-attested and revalidated against live
credential and membership state. Project graph entities preserve canonical
body/provenance hashes and a per-project event chain. The task kernel persists
plans, budgets, approvals, leases, stable invocation IDs, retries, and unified
tool receipts. The fabric registers the exact 74 quantitative operations plus
the other ordered lane entry points, and denies unbound or externally
unauthorized calls.

The default executable binding is deliberately narrow: bounded arithmetic only.
The complete registry is exercised with `SYNTHETIC_TEST_ONLY` bindings in the
contract tests; that is not evidence of live tool or production readiness.

## Local verification

From the repository root:

```bash
python -m unittest discover -s recovery/ar03_06/tests -p 'test_*.py' -v
python recovery/ar03_06/verify_candidate_builder.py
python recovery/ar03_06/verify_candidate_independent.py
```

The restart/idempotency test injects a failure after a separate durable side
effect, closes the runtime, reopens it, and proves the stable invocation is not
applied twice. Negative tests cover tenant isolation, forged/stale identity
contexts, API-key scope, risk downgrade, approval tampering, retrieved-content
side-effect authority, step tampering, receipt tampering, and audit tampering.

## Explicit limits

- No `main`, PR #1, provider, production, deployment, secret, S4, or S5 state is
  changed by this candidate.
- No real cloud, queue/workflow provider, OAuth provider, MCP provider, browser,
  computer-use, live/multimodal, or two-physical-device qualification occurred.
- Local and synthetic passes cannot satisfy the AR-03 through AR-06 formal
  gates while inherited prerequisites and live evidence remain open.
- Wolfram parity, frontier superiority, and full-product connection remain
  `NOT_CERTIFIED` / `NOT_PROVEN`.

