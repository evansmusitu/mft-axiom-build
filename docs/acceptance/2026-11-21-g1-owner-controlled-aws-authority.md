# MUSITU AXIOM G1 — owner-controlled AWS operating authority with independent privileged-code review

Decision recorded: **21 November 2026**. Source of decision: the repository owner explicitly selected an owner-controlled AWS operations model while retaining independent approval for modifications to privileged code. This is an operating-policy proposal in draft [PR #244](https://github.com/evansmusitu/mft-axiom-build/pull/244), **not** GitHub environment activation, AWS permission issuance, or G1 acceptance.

## Authority separation

| Action | Authorized decision-maker | Evidence and controls |
| --- | --- | --- |
| Approve G1 scope, manual operation window, read-only inventory, or deny/stop operations | Authenticated owner `evansmusitu` | Recorded change/request identifier and before/after status; cannot change the committed fixed-operation allowlist without PR |
| Approve a concrete AWS/Cloudflare/Neon infrastructure proposal and gross cost | Authenticated owner `evansmusitu` | Versioned plan, native cost/credit verification, 24h lifecycle, tested teardown and written owner-specific authorization; a budget ceiling is **not** an instruction to create resources |
| Change privileged IAM trust/policies, protected workflow execution logic, `.github/`, G1 guardrails or protected `main` | Independent eligible GitHub code reviewer **and** protected repository ruleset | No self-review, no alternate user account owned by same operator, no bot substitute, and current PR/check/code-owner/last-push rules all pass |
| Release an AWS administrator role into production deployment or grant broad environment access | Owner authorizes scope **after** privileged source review and live protection readback | Separate protected environment and controlled AWS trust; do not bypass required deployment reviewer gates if still configured |
| Sign G1 network/TLS/database/ledger acceptance | Independent technical evidence/review in addition to owner operation authorization | Same source/configuration lineage and negative tests; no acceptance based solely on planning or owner instruction |

**Scope is deliberately narrow:** the owner may authorize **operations and spending** but that approval is **not** an approval of the owner's own GitHub PR and is **not** permission to remove branch rules, set `can_admins_bypass`, suppress required checks, or alter live AWS role permissions before independent review.

No reviewer has been designated for the privileged code since the previous `tallyvans` nomination was withdrawn. Do not add/invite that user or automatically substitute another account. Independent review is an outstanding implementation gate, not a permanently delegated operation.

## Execution architecture

1. Keep existing `main` ruleset **27611672** enforced. Maintain mandatory PR approval, code-owner review, approval by someone other than latest pusher, stale approval dismissal, resolved review threads, `g1-aws-source` status check, and prohibition on force push/deletion. The second existing tag-specific ruleset remains intact.
2. Keep this PR #244 **draft and unmerged** until the current native GitHub requirements are met. A repository owner cannot satisfy an independently required approval on the owner's own PR.
3. Owner-operated AWS tasks should be **fixed-purpose and manual** using reviewed GitHub Actions, not arbitrary workflow input or raw shell scripts. Prefer GitHub OIDC → AWS STS temporary 900-second sessions. First operation is the OIDC subject discovery; then a separately verified STS identity read, then separately authorized inventory. No AWS invocation is presumed by a passed offline source test.
4. Distinguish **owner operational consent** from **independent privileged environment deployment approval**. The current `g1-aws-admin` plan includes an independent deployment reviewer and `prevent_self_review`. Therefore it **cannot be activated or self-approved by the owner**. If a later proposal uses a separately owner-approvable environment for identity/inventory operations, it must first be reviewed, passed under `main` protection, and restricted to fixed read-only operations and temporary session policies; it must never expose unrestricted AWS administrator credentials to a self-approved unreviewed workflow.
5. For broad AWS administrator role trust or infrastructure mutations, require a separately reviewed and merged plan, least-privilege execution sessions, explicit owner approval of the operation and verified cloud/rollback/cost evidence. IAM `AdministratorAccess` on the underlying role does not remove these protections. Do not use root credentials or long-lived AWS access keys.
6. If no eligible independent code reviewer is available, **stop at source-level planning/testing and recorded approval**. Do not weaken controls to force a merge, invent AWS provider access, or claim progress through the protected gate.

## Financial decision

Owner's pre-existing pilot ceiling is **USD 25 maximum combined incremental AWS + Cloudflare + Neon for at most 24 hours**, inclusive of a **USD 20 gross-cost planning target** and **USD 5 contingency**. The owner's report of USD 50 AWS credits remains unverified and does **not** increase this ceiling. Bills, alerts, credits, budgets or time-to-live tags do not guarantee a hard charge limit. No billable creation until all-provider native estimates, complete teardown, independent reviewed scope, and a separate explicit owner approval of the concrete plan.

## Current evidence and blockers (as of this decision)

- Repository: `evansmusitu/mft-axiom-build`, `main` protected under active ruleset #27611672; PR #244 draft, not merged.
- Prepared G1 workflow: protected-main-only exact-repository/executor checks, owner trigger, fixed `discover`/`identity`/`inventory` modes, AWS Ohio region `us-east-2`, no arbitrary AWS mutations; source tests passed on prior head. **These are not proof of live AWS access.**
- No verified `g1-aws-admin` environment, approved AWS IAM OIDC role, STS identity, or credits readback; no AWS PrivateLink or Cloudflare tunnel rollout.
- Neon protected Ohio staging database has public access blocked; missing restricted database runtime and definer roles and private route acceptance.
- **G1 remains NO-GO** until the independent privileged-code approval and all external evidence gates pass.

This document records the owner-selected authorization structure. It is not itself an automated provider policy or a claim that it has been deployed.
