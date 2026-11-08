# AXIOM isolated disaster-recovery target admission — 8 November 2026

**Status: ONE ISOLATED EMPTY D1 TARGET EXISTS; NO DATA RESTORE; NOT RELEASE.**

## Owner-provided target and source protection
- Target Cloudflare account: `c954f0c842a486d0388c05b19cd21e47` (owner nominated).
- Original staging source account: `93f395f5121954671f92fffa453d6b61`; original staging D1 `ccc473f1-fbb5-4b8d-8a24-45f3696ac10f` **not modified**.
- Protected OAuth production D1 `504029cc-f9a5-495e-818f-63c6144b4ea4` **not modified**.
- Target name: `axiom-disposable-dr-target-20261108`.
- Target D1 UUID: `e36972b3-850d-4273-b934-2fa67587d9f1`.

## Actual read-only preflight and fail-safe creation
1. Draft PR119, read-only alternate account D1 list run `42453703508` (job `128648116831`) SUCCESS: Cloudflare HTTP 200, **0 D1 databases** before creating anything; used existing repository secret `AXIOM_CUSTOMER_STAGING_CF_API_TOKEN` without exposing it. Free-tier billing/account ownership and token write permissions were not independently qualified.
2. Draft PR120 offline protocol CI `42453912783`, job `128648750130` SUCCESS. Six synthetic tests: exact zero-before one-POST/one-after protocol, existing resource denial, pagination/count inconsistency denial, unexpected response denial, forbidden POST denial with no retry, post-create drift denial.
3. Draft PR121 live one-use CREATE workflow `42453984921` job `128648969395` **FAILED CLOSED** after guarded source/test preflight passed. The safe receipt reports `D1_LIST_PAGINATION_OR_DRIFT`, and no successful-creation conclusion should be inferred solely from this job. This may have occurred on readback after one POST. The POST **was never retried**, including following this failure.
4. **Independent read-only GET reconciliation** draft PR122 run `42454083209`, job `128649268352` **SUCCESS**. Fresh Cloudflare GET list: HTTP 200, precisely one listed database, reported total 1, zero unexpected databases; exact target UUID matched. Second GET target metadata: HTTP 200, exact UUID/name matched. Status `SINGLE_TARGET_EXISTS_AND_METADATA_CONFIRMED`. No POST, no writes, no customer data.
5. **Result**: exactly one empty disposable D1 target has been provisioned and its identity subsequently verified independently; this is not a hosted restore or data-equivalence claim.

## Privately archived, independently checked evidence
- Failed-closed attempt GitHub artifact `13605924740` ZIP 409 bytes SHA256 `54ced48661e9411adf029823f07a5b3cb9b0eef45f15c0a87a63267d55646668`.
- Independent successful GET verification GitHub artifact `13606941385` ZIP 563 bytes SHA256 `31ebafd1f0767502d8741cb82a8ebb94fdb373d59996562cf4252a0704f9bb10`.
- ZIP CRC PASS for both; independent private Google Drive upload and download **byte-for-byte equality** of both ZIPs:
  - Independent D1 target readback: owner-only Drive ID `1nhh2-sNzxPRW04xrCM5_HC-ujcn8fvno` https://drive.google.com/file/d/1nhh2-sNzxPRW04xrCM5_HC-ujcn8fvno/view
  - Initial inconclusive attempt: owner-only Drive ID `1VJaXuJXHQq4cQqOn4FOo3x9npel5upZd` https://drive.google.com/file/d/1VJaXuJXHQq4cQqOn4FOo3x9npel5upZd/view
- Both Drive files: `shared=false`; owner-only permission.

## Remaining admission and no-release invariants
- Independent recoverability is **not yet qualified**: target has **no restored data or schema**. Source encrypted snapshot 40,173-byte envelope from PR113 remains private owner Drive, with original/source SHA256 `d8fdb7d06f27d3053799ba70eb2c4c12d2b5570eb9c5cf4724e7216908d0b3b3`.
- Need independently verified owner authorization and security-preserving staging import of that original recovery snapshot, full catalog/row/fingerprint checks, destructive isolated restore/rollback, and repeat cleanup/recovery. No customer data copied from source by this run.
- `production_oauth_upgrade=BLOCKED`; `customer_identity=UNQUALIFIED`; `real_paynow_devices=UNQUALIFIED`; `execution_and_final_usage=UNQUALIFIED`; `independent_custody_B27=FAILED_IN_SYNTHETIC_ATTACK`; `full_stack_PR83=FAILED_AT_SECURITY_VETO`; `release=BLOCKED`.
- PR1 and PR83 stay DRAFT/UNMERGED. This PR and parent PRs are DRAFT/UNMERGED. No paid upgrades, no billing charges or release authority; **spend cap $0**.
