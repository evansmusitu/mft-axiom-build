# MUSITU Store V2 — Private Paynow observation recovery qualification

**Status: isolated offline candidate only (29 October 2026). Not approved for deployment, migration, settlement, refunds, payouts, public store availability or real-money use.** The signed Store V1 is unchanged. Use the single Store-only Paynow **27721 Testing** integration; its key is already in sensitive Preview-only Vercel custody and is **never** required by this audit.

## Why this exists

The immutable D1/SQLite `store_paynow_status_observations` candidate is NOT a deployed database table. SQLite `INSERT` change counts, recovery from a backup, and receipt hashes cannot independently establish signed Paynow settlement. A safe first step is to verify that an *independently obtained offline SQLite snapshot* contains precisely the reviewed checkout + observation schema, immutable constraints and consistent evidence relationships. This tool cannot connect to Neon, D1, Paynow, Vercel or publishers.

## Read-only auditor and stop conditions

`store_paynow_recovery_audit.py --snapshot /path/to/disposable-store-snapshot.sqlite`

The CLI accesses only the local SQLite snapshot with `mode=ro` and `PRAGMA query_only=ON`; it does not run migrations, mutation SQL, network calls or create missing files. A success returns JSON containing an observation count, review count, and deterministic SHA-256 fingerprint of the ordered observation rows. It emits **no customer identifiers, order reference, Paynow reference, URLs or secret values**. The hash is for snapshot comparison, not an authenticity signature.

An exit code of 1 (or a false `qualified` field) is a hard stop. It detects:
- Missing or altered expected schemas, uniqueness indexes or immutability triggers, including a trigger re-created with the same name but weaker SQL; unreviewed added Store tables such as publisher payouts.
- SQLite integrity/foreign-key failures, orphaned or contradictory checkout review state, altered observation order identity and mismatches between provider references claimed by an observation and an earlier paid/refund review.
- An observation event ID inconsistent with the prescribed SHA-256 of order reference, Paynow reference and signed callback + independent-poll digest; invalid statuses and impossible amount/currency, malformed or unreadable files.
- Unavailable inputs without creating a database; overly large observational tables without unbounded in-memory loading.

The output is explicitly marked `local_sqlite_snapshot_only`, with `deployment_authorized=false` and `money_movement_authorized=false`, **even when qualified**. A structurally sound ledger does not establish valid callback signatures, lawful distribution rights, identity proof, transaction settlement or financial approval.

## Disposable backup/restore drill (automated)

`python3 -m unittest -v store/phase1/payments/test_store_paynow_recovery_audit.py`

The test suite builds its own schema on a temporary local SQLite file, seeds synthetic first-party rows with no live customer identity, validates a legitimate observation, makes a SQLite-native snapshot backup, appends a later synthetic observation to the source, restores the backup into a *different* local path and verifies that its fingerprint exactly matches the backup's prior state. It deliberately corrupts unrelated copies to prove schema tampering, cross-order claims, a torn review, broken foreign keys and invalid event IDs fail closed. Every test uses temporary files; none touches Neon, Cloudflare D1, GitHub secrets, customer storage or actual Paynow.

The restored fingerprint establishes **snapshot-equivalent recovery only**; the later event necessarily remains missing and requires an independently designed catch-up/reconciliation procedure. It does not qualify time-to-recover, loss tolerance, provider replay or real hosted persistence.

## Next independent authorization gates

1. A separate reviewer must approve the exact observation schema SQL, D1/SQLite connection semantics, backup provenance, retention/immutability policy, migration and rollback strategy; current snapshot tests do not do that.
2. Owner-controlled, authenticated private OIDC/MFA and SSO HTTP acceptance must be demonstrated. Vercel's protected `READY` deny-all witness is not a certified Store payment worker.
3. After explicit database/deployment authorization, the Store-only private candidate can be evaluated in its own disposable staging namespace with an operator restore drill. Do **not** migrate the active Neon tenant or enable `STORE_PAYNOW_OBSERVATIONS_ENABLED` on the existing deployed project by default.
4. Real Paynow-hosted **TESTING** success/cancel events require genuine provider receipts and authenticated independent polling. Existing merchant enrollment and integration 27721 are complete; written Paynow third-party marketplace/settlement/refund permissions remain outstanding.
5. Independently signed publishers' distribution rights, verified external APKs and operational/legal/privacy approvals remain mandatory before any real-money or public release gate. PRs #1/#27/#32 remain open, draft and unmerged.
