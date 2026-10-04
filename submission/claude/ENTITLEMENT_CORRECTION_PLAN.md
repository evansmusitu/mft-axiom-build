# Proposed single-account developer allowance correction

Status: **AUTHORIZED, APPLIED, AND VERIFIED — REAL CLAUDE EXECUTION RETEST PENDING**.

## Verified cause
Read-only diagnostic run `37207220294` inspected the current upstream source and the one account linked through the Claude publication issuer/resource. The account is active on the developer plan, with `monthly_unit_override=null`. The runtime converts that null to numeric zero and accepts it as a finite override. It never reaches the developer default of **1,000 monthly units**, which agrees with the public billing catalog. The resulting quota check rejects the real Claude tool calls with HTTP 402.

This explains the zero limit. It does not establish a billing purchase requirement. No credentials, account identifiers or token values were exposed.

## Applied correction
The explicitly authorized correction was applied by GitHub Actions run `37209332065` (attempt 2, job `111459225856`) after the same guards were revalidated:
- Update exactly the current linked account's `monthly_unit_override` from SQL NULL to **1000** and its `updated_at` timestamp.
- Require one unique account with a valid, unrevoked Claude publication authorization; active developer plan; unchanged observed creation/update timestamps; null override; and current monthly bucket at zero usage/zero limit.
- Abort if any guard differs or affected-row count is not exactly one.
- Do not create/change credentials, plan, subscription, other accounts or usage consumption. No Worker, DNS, security-policy or frozen source deployment is involved.
- The existing reservation code refreshes the current bucket limit from the account policy before reserving units. No direct usage-bucket correction is necessary.

The proposal SQL remains a reference/guard specification. Thirteen offline SQLite guard tests passed before execution. The live correction then passed `MUSITU_AXIOM_CLAUDE_SINGLE_ACCOUNT_ENTITLEMENT_CORRECTION_PASS`: exactly one active Developer account changed from `monthly_unit_override=NULL` to `1000`; OAuth metadata, subscription state, and usage buckets were unchanged; no credential or customer identifier was exposed; zero other customer rows changed.

## Authorization and scope
The user explicitly authorized this exact one-account correction. Frozen `main`, PR #1, and the frozen OpenAI source blobs remained protected. The correction did not change any plan, subscription, token, credential, usage row, Worker, DNS, security policy, or other customer.

## Verification after correction
1. Re-read current branch, protected GitHub state, frozen live snapshot, upstream source digest and both developer allowances.
2. Re-run the guarded read-only account preflight immediately before the single update.
3. Read back the exact corrected allowance and prove other account/authentication/usage state was not modified by the correction.
4. Rerun the exact arithmetic and NPV prompts from the actual Claude conversation, using secure reauthorization only if needed.
5. Seal actual returned outputs, rerun distribution checks and reverify OpenAI. Keep READY false until all required technical and submission conditions pass.

## General defect remains separate
A future runtime fix would test for a non-null override before numerical conversion, preserving intentional explicit zero. It must be reviewed separately: the live runtime's paid-plan allowances differ from the billing catalog (pro: 100,000 vs 5,000; enterprise: null vs 25,000), and quant exists only in the observed runtime list. The account-specific workaround does not reconcile these broader policies. Remove or reconsider the explicit override when that later policy repair is deployed or the account changes plan.

## Rollback boundary
If the authorized correction must be reverted, guard on its exact update timestamp and 1000 override before restoring NULL. Preserve all actual usage records. Do not erase execution history or other account state.
