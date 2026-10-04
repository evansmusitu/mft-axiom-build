# Proposed single-account developer allowance correction

Status: **PREPARED AND TESTED — NOT APPLIED**.

## Verified cause
Read-only diagnostic run `37207220294` inspected the current upstream source and the one account linked through the Claude publication issuer/resource. The account is active on the developer plan, with `monthly_unit_override=null`. The runtime converts that null to numeric zero and accepts it as a finite override. It never reaches the developer default of **1,000 monthly units**, which agrees with the public billing catalog. The resulting quota check rejects the real Claude tool calls with HTTP 402.

This explains the zero limit. It does not establish a billing purchase requirement. No credentials, account identifiers or token values were exposed.

## Exact proposed correction
Use `frontier_v5/distribution/claude/restore_linked_developer_allowance.sql` only after explicit authorization:
- Update exactly the current linked account's `monthly_unit_override` from SQL NULL to **1000** and its `updated_at` timestamp.
- Require one unique account with a valid, unrevoked Claude publication authorization; active developer plan; unchanged observed creation/update timestamps; null override; and current monthly bucket at zero usage/zero limit.
- Abort if any guard differs or affected-row count is not exactly one.
- Do not create/change credentials, plan, subscription, other accounts or usage consumption. No Worker, DNS, security-policy or frozen source deployment is involved.
- The existing reservation code refreshes the current bucket limit from the account policy before reserving units. No direct usage-bucket correction is necessary.

The SQL file is a proposal only. No workflow executes it. Thirteen offline SQLite guard tests passed, including unrelated-account preservation, repeat-run rejection, explicit-zero preservation, stale-account rejection, expired/revoked authorization rejection and ambiguous-account rejection.

## Why authorization is required
This is shared production customer data, not data exclusive to the Claude connector. Restoring this account's allowance also affects its access through OpenAI. The user's existing authorization preserves OpenAI production and permits only the isolated Claude surface. Explicit permission for this one-account data correction is therefore required. Frozen main, PR #1, OpenAI source blobs, endpoints and submission remain protected.

## Verification after an authorized correction
1. Re-read current branch, protected GitHub state, frozen live snapshot, upstream source digest and both developer allowances.
2. Re-run the guarded read-only account preflight immediately before the single update.
3. Read back the exact corrected allowance and prove other account/authentication/usage state was not modified by the correction.
4. Rerun the exact arithmetic and NPV prompts from the actual Claude conversation, using secure reauthorization only if needed.
5. Seal actual returned outputs, rerun distribution checks and reverify OpenAI. Keep READY false until all required technical and submission conditions pass.

## General defect remains separate
A future runtime fix would test for a non-null override before numerical conversion, preserving intentional explicit zero. It must be reviewed separately: the live runtime's paid-plan allowances differ from the billing catalog (pro: 100,000 vs 5,000; enterprise: null vs 25,000), and quant exists only in the observed runtime list. The account-specific workaround does not reconcile these broader policies. Remove or reconsider the explicit override when that later policy repair is deployed or the account changes plan.

## Rollback boundary
If the authorized correction must be reverted, guard on its exact update timestamp and 1000 override before restoring NULL. Preserve all actual usage records. Do not erase execution history or other account state.
