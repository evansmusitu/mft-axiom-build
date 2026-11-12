# AXIOM existing customer IdP D1 — controlled current-state recovery acceptance

**State:** `STEP1_RECOVERY_REQUIRES_OWNER_AND_SEPARATE_CUSTODIAN`; `NOT_RELEASE`. This plan does not approve any work requiring a paid API, customer-data export, new database or modification to customer data. Source account `93f395f5121954671f92fffa453d6b61`, existing source D1 `ccc473f1-fbb5-4b8d-8a24-45f3696ac10f`. Do not use the existing OAuth-specific DR database `c023a0a0-472a-4178-ad07-02f1d6b2e122`.

## Facts verified before the recovery ceremony

- Exact provider D1 creation event pinned to 6 Sep 2026 16:47:38 UTC, accepted current member and MFA; provider evidence is not independent-owner signoff. See `STEP1_D1_ORIGIN_EVIDENCE_20261110_NOT_RELEASE.md`.
- 12 Nov: 68 live Workers; zero historical D1 consumers, zero staging private D1 binding, no authorized session transition; workflow `43155446894`.
- 12 Nov: complete provider list/detail readback across 11 existing databases: all contain schema objects; no safe empty existing target.
- 12 Nov: current source IdP DDL parity is 13/13; canonical aggregate has 2 each historical identities, tenants, memberships, canonical links, flows and sessions; zero active; no raw customer values were retrieved. Counts and DDL hashes do NOT prove full data restoration.
- 12 Nov: synthetic local SQL restore safety 7/7, independently pinned approval-control tests 15/15, authenticated encryption transport tests 18/18; NONE is a hosted current-state recovery witness.
- Cloudflare Time Travel is an in-place destructive restore, not a clone; SQL export is a POST that can temporarily interrupt queries. Provider docs: https://developers.cloudflare.com/d1/reference/time-travel/ and https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/export/.

## Required approvals BEFORE any mutating step

1. Explicit account owner signs an exact-plan approval identifying the original D1 and a NEW disposable target, data classes, purpose, retention, deletion, approved maintenance window and rollback authority. Approval must not use broad verbal "continue" as substitute for scope. Provider billing snapshot must independently establish any additional cost is within the approved budget.
2. A real independent custodian, not merely a second signing key in the same owner's control, verifies their separate administrator identity and signs the same scoped plan. Their independent X25519 recipient SPKI SHA-256 is exchanged over a trusted out-of-band path; their private key never reaches GitHub, Cloudflare or ChatGPT logs. No "test" key can be accepted for customer data.
3. Custodian independently attests a recovery environment, key separation, encrypted-retention period and auditable backup chain. An immutable nonce/spent-ledger check prevents replay of a previously signed approval.
4. An operator verifies the trusted reviewer and execution route are separately permission-scoped: no production OAuth change, no source D1 restore, no Mail Fabric reuse, no external customer traffic or billing/charges.

## Execution sequence AFTER those approvals exist

1. Re-read Cloudflare D1 original metadata, current bookmark, binding inventory, account entitlements and database names. Confirm target name absent from ALL pages, and no ongoing source writes unknown to the owner. Fail on query errors, stale evidence or duplicate name.
2. Create **one new** approved recovery-only D1. Pin returned UUID, creation receipt and account; deny if it is the source or existing OAuth DR UUID. Immediately re-read ALL Worker bindings to show zero consumers. Do not trust deprecated `num_tables=0` for emptiness; use actual `sqlite_schema` GET-side count query on the new isolated D1 with fixed SQL, plus explicit staged write authorization only for that target.
3. With a separately signed maintenance authorization, take a fresh source bookmark before export. Call the Cloudflare SQL export endpoint under a short scoped token; acknowledge possible source query interruption; keep provider-issued export URL in a private boundary, never a log. Abort and preserve `NOT_RELEASE` on interrupted/cancelled/inconsistent export.
4. Seal raw exported SQL **offline in memory**, with `step1_encrypted_sql_export_transport.mjs` and the independently pinned custodian X25519 public key. Include authenticated source database UUID, captured UTC, bookmarked SHA-256 and whole-catalog SHA-256. Never place unencrypted SQL, raw identity rows or private keys in CI artifacts, Git commits, Cloudflare Worker variables or chat. Record encrypted-blob SHA-256, access, expiry and independent custody receipt.
5. Custodian independently decrypts only in an isolated restore workstation, verifies AEAD tag and pinned source bookmark, and audits full imported user SQL and foreign-key/integrity checks. Re-encrypt or securely dispose of all local temporary plaintext; record only SHA-256 and aggregate parity receipts. Synthetics do not count.
6. Import **only into the new approved disposable D1**, never the source or any pre-existing product database. Compare every expected table, index, trigger, view, exact DDL digest, row count and deterministic content digests against the source snapshot. Confirm no cross-tenant records, no active-session revival, and no mismatch.
7. Independently repeat a destructive recovery/rollback exercise **on disposable target only**. Confirm durable source data unaffected, unauthorized customer access absent, and all cleanup/reset/revocation evidence signed.
8. Separate owner and custodian review the full chain and explicitly sign acceptance. Do not set `source_reuse_authorized=true` or `step_2_authorized=true` from CI test counts, a signed key alone or partial parity.

## Machine-checkable non-go state until witnessed

```json
{
  "source_reuse_authorized": false,
  "current_backup_qualified": false,
  "independent_human_custody_qualified": false,
  "isolated_hosted_restore_qualified": false,
  "least_privilege_qualified": false,
  "step_2_authorized": false,
  "release_authority": false,
  "reason": "CURRENT_SOURCE_BACKUP_AND_OWNER_APPROVED_ISOLATED_RESTORE_ABSENT"
}
```

PR216 and PR1 remain draft/unmerged, PR83 full-stack veto and B27 failures remain intact. **No change to production OAuth, user sessions, payments or release.**
