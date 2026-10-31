# MUSITU Store V2 — read-only recovered evidence gap qualification (29 October 2026)

**Private Stage 1 engineering, no deployment approval.** This offline procedure extends `store_paynow_recovery_audit.py` from one local SQLite snapshot to a **two-snapshot differential**. It is intended to identify the **recovery point objective (RPO) gap** after an older backup is restored into an isolated offline path. It does **not** itself close that gap or prove a provider transaction.

## Strict prerequisites

- Two **operator-provided, unmodified, local SQLite snapshot files** made using the exact Store V2 quarantined D1/SQLite checkout and observation candidate schemas. Their provenance, chronological relationship, custody, authenticity and consent must be established **outside** this tool by an independent reviewer. Neither file may be an active Neon database, live Cloudflare D1 binding, or checkout worker connection.
- **Do not** copy a restored snapshot over the running Store database, turn on the optional observation writer, replay Paynow callbacks, trigger payment status polling, or enable payments, refunds, entitlements, publisher payouts or public release.
- No private provider secrets, customer data, tenant credentials, public network access, or payment API key is used by this procedure.

## Procedure

```sh
python3 store/phase1/payments/store_paynow_recovery_audit.py --snapshot /quarantine/old-restored.sqlite
python3 store/phase1/payments/store_paynow_recovery_audit.py --snapshot /quarantine/later-reference.sqlite
python3 store/phase1/payments/store_paynow_recovery_audit.py --restored /quarantine/old-restored.sqlite --later /quarantine/later-reference.sqlite
```

The `--later` option expresses an **operator assumption**; it is not an attested timestamp or authoritative Paynow receipt. All database reads use `mode=ro` and `PRAGMA query_only=ON`. A redacted JSON report contains only non-sensitive counts, SHA-256 snapshot fingerprints, the disposition and mandatory manual action. It **never outputs** order IDs, provider transaction IDs, payer identities, customer tokens, poll URLs, or record bodies.

## Results and actions

| Exit | Status | Required action |
|---|---|---|
| 0 | `equivalent` | Both audited Store snapshots contain equal records. **Do not** infer settlement, authentic provenance, approval to restore, or zero RPO outside the two compared snapshots. |
| 2 | `manual_reconciliation_required` | The supposedly later snapshot includes events, reviews, checkout states or other Store data not present in the restore. Preserve both snapshots and their original hashes, obtain independent Paynow evidence and operator/second-reviewer decisions, document every gap. No automatic replay or entitlement. |
| 1 | `conflict` | The supposed restore contains evidence missing from the later source, a reused evidence ID changed payload, a prior signed review changed or order identity differs. Treat chronology/provenance as untrusted; quarantine and investigate. |
| 1 | `unqualified_snapshot` | One snapshot fails schema/immutability/foreign-key and other offline audit constraints, is missing, oversized or unreadable. Reacquire a valid immutable backup before continuing. |

For either non-equivalent state, **automated reconciliation is prohibited**. Original provider payment/settlement evidence must be established using separately approved authenticated channels and independently reconciled with the checkout references and evidence digests by authorized humans. Reconstitute any missing append-only events **only** through a separately reviewed, signed, auditable procedure after independent provider receipts. Neither this script nor any unit test executes those actions.

## Bounded proof

`python3 -m unittest -v store/phase1/payments/test_store_paynow_recovery_compare.py`

The test suite generates its own synthetic first-party local SQLite snapshots, including a newly arrived observation after the backup, a later payment-review record, reversed temporal comparison, altered evidence under restored immutability triggers, schema damage, absent input, and a new checkout. No real provider calls or database migrations occur.

**Owner gate remains locked:** Neon observation table not deployed; Vercel private project with SSO protection is not authenticated Store payment-worker acceptance; Paynow integration 27721 is Testing with commercial marketplace/refund/payout approval outstanding. Signed original Store V1, main and PRs #1/#27/#32 must remain unchanged, draft and unmerged. Phase 2 pending; Store unpublished.
