# MUSITU Store V2 — Paynow Status Observations (private candidate)

**Scope:** Review-only, optional SQLite/D1 migration candidate. No live schema changes or deployment, no integration-key material, no merchant collection, paid entitlements, refunds, settlements, publisher payments, or Store Phase 2 admission.

## Why this candidate exists

The isolated callback implementation accepts exactly matched, independently signed/polled `Paid` or `Refunded` outcomes as **manual review evidence only**. It intentionally leaves `Created`, `Sent`, `Cancelled`, `Disputed`, `Awaiting Delivery` and `Delivered` in the current intent state while review is pending. That prevents false refund claims, but it does not yet provide a durable history of provider status observations, including terminal cancellation or paid funds held in escrow/suspense.

This candidate adds **one append-only Store-only table** `store_paynow_status_observations` for the six non-final / non-review statuses. It does not modify the original Store payment schema or status machine, and it must not be considered a replacement for a vetted finance ledger.

## Admitted evidence, not authority

Each record preserves an event identifier, original Store order reference, Paynow transaction reference, provider status, amount, currency, provider poll URL, independent callback and poll payload digests and timestamp. SQL constraints require the original order's amount, currency, and poll URL to match. Provider references cannot be claimed across separate Store orders, including records already present in the signed paid/refunded review table. Duplicate signed evidence is rejected, and updates/deletions/replacements are prohibited.

**Caution:** The database does not cryptographically verify the callback or poll. Only a separately reviewed upstream worker can verify the Paynow SHA-512 signature, independent signed status, safe poll host, order and amount identity, and securely supply hashes. A staff insert, wrong DB role, or forged event is not genuine provider confirmation merely because it meets SQL constraints. Treat the record as append-only forensic evidence, not authorization to settle or release anything.

## Explicit exclusions and later acceptance requirements

1. No Store callback handler writes this table yet; that is a separate authenticated, atomic and replay-safe application change.
2. Provider-specific final `Paid` and `Refunded` still use only the existing immutable review path. A review -> post-payment dispute/refund sequence needs an independently accepted journal design.
3. `Cancelled` is terminal at Paynow, but this candidate does not automatically set a Store intent to `cancelled` or prove a refund.
4. `Disputed`, `Awaiting Delivery`, `Delivered` require a business/legal decision for escrow and dispute handling; do not mark funds available for payout or grant entitlements.
5. The candidate targets SQLite/D1 tests only, not PostgreSQL syntax, Neon staging, production Cloudflare D1, or public commerce.
6. Require owner-reviewed DPO/legal, Paynow marketplace authorization, identity/MFA, signed release acceptance and proven recovery before considering live migration.

## Evidence

Run from repository root:

`python3 -m unittest -v store/phase1/payments/test_store_paynow_status_observations.py`

This test uses a real **in-memory SQLite engine** and synthetic immutable events, with no network or provider secret. Do not disable `PRAGMA foreign_keys=ON`. On the isolated GitHub branch, the existing payment CI may run it as an additional independent qualification.

**Review decision required:** Should events after reviewed orders be recorded in this table, or in a separate post-payment reconciliation journal? Owner/operator review must resolve this before any writer or live migration is built.
