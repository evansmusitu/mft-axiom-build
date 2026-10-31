# MUSITU AXIOM — Partial refund overlap regression

State: **ISOLATED CANDIDATE — NOT LIVE COMMERCE CERTIFICATION**. No provider charges/refunds performed.

## Reproduced defect in previous candidate

A price grants 3 compute units for 100 currency minor units. Two separate real-provider-verified refunds of 40 and 60 minor units begin against the same order. Each verification reads the settled refund total before either transaction commits. If the 60-cent refund commits first and the 40-cent refund computes its reversal using its stale earlier read, the two independent reversals total **2 units**. The order is completely refunded yet the customer retains **1 unit**. This is unsafe accounting, regardless of otherwise valid provider receipts.

`tests/refund_overlap.test.mjs` reproduced the defect as a red regression before repair; `balance.booked` was 1 instead of 0.

## Candidate repair

Compute cumulative refunded value and exact integer-unit reversal within an atomic D1 `batch`, AFTER that batch's `provider_events` insert and `refund_requests.state=settled` update. Use positive-integer `CAST` to avoid a floating-point binding changing division semantics. A DB transition trigger refuses total settled refunds above the captured amount. A checked product cap prevents intermediate arithmetic overflowing JavaScript-safe/SQLite integer arithmetic. Some small partial refunds reverse 0 whole units, but the final refund must still produce the exact total credit reversal.

The original provider evidence and provider-only settlement authorization remain required; the public Worker cannot submit or self-assert it. A refund request alone still does not debit units or execute a refund.

## Local acceptance

- Old candidate interleaving: **FAIL REPRODUCED** (1 unit remains).
- Repaired candidate interleaving: **PASS** (0 units remain).
- 10/90 split with 3 units: **PASS** (0 then 3 units reversed).
- Concurrent total monetary over-refund: **PASS DENIAL** (`refund_exceeds_order_amount`).

This exercises a Node 22 SQLite test double, not real Cloudflare D1 worker concurrency, provider signature verification, cross-region settlement, financial statements, live-refund policy or production rollback. Those gates remain **NOT PROVEN**. Actual PSP reconciliation, independent security/authorization review, owner approval and real D1 staging stress tests are mandatory prior to deployment. B27 independent antirollback remains `FAILED_IN_SYNTHETIC_ATTACK` and is not waived by accounting tests.
