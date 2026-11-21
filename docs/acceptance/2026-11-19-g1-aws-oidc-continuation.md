# G1 AWS integration continuation — 19 November 2026

**Status: MAIN BRANCH PROTECTION ACTIVE; AWS WORKFLOWS DRAFT / NOT CONNECTED;
G1 NO-GO.**

This is a narrow main-targeted security bootstrap. It reuses the STS-first,
fixed-operation and sanitized-output approach of draft PR #239 without merging
its Phase 2 staging parent or treating that source as the latest core. Existing
PR #239, G1 issue #240 and PR #1 remain open; PR #1 remains draft and unmerged.

## Verified engineering destination

The connected GitHub account enumerated 17 repositories, followed by an empty
second page. `evansmusitu/mft-axiom-build`, immutable repository ID `1356837528`,
is the destination supported by the current G1 issue/PR lineage, the 29 October
whole-system audit, and the 18 November published-plugin verification record.
Current PR #243 contains the recent gateway release source in this repository.
The isolated qualification repository contains only its README/workflow smoke
harness; the private archive's main predates the current G1/AWS work. The
financial-runtime repository is a separate component. No alternative canonical
GitHub destination was designated in the retrieved history.

This conclusion is based on the source/history comparison, not the repository
name. `main` is a shared integration branch, not a claim that it contains all
unmerged Axiom feature stacks. Starting main SHA is
`c3c5aaab90e94f1ca84ac9903f9d481c23c4f350`.

## Fresh live findings and explicit holds

| Control | Native observation on 19 November | Result |
|---|---|---|
| GitHub main | Initially `protected:false`; after ruleset creation, native readback `protected:true` | ACTIVE protection verified at 05:07 UTC / 07:07 Africa/Harare |
| Existing rule | Rule 27261118, “Protect MUSITU AXIOM Main”, is active but targets **tags**, all tags | Does not protect main; preserve tag protection |
| Branch administration API | Connected GitHub integration receives HTTP 403 | Cannot activate protections through that connector |
| Browser administration | Secure request timed out, but a fresh authorized GitHub tab confirmed authenticated settings access | Branch rule activated in the signed-in UI |
| Independent reviewer | Native Manage access shows **zero collaborators**, only the owner | Owner must designate and authorize an independent human reviewer |
| Administrator environment | Native environments inventory has no `g1-aws-admin` | Creation held until its independent approval gate can be complete |
| AWS console | Billing Credits page returned “Site Unavailable”, unchanged after one reload | Balance/expiration/eligibility NOT VERIFIED |
| AWS API identity | No authenticated AWS invocation | NOT VERIFIED |
| Neon G1 staging | PostgreSQL 17, AWS Ohio, protected default main, public blocked, VPC allowed, Scale organization | Public block preserved |
| Neon compute | One idle read/write endpoint, min/max 0.25 CU | No compute wake or SQL request performed |
| Neon SQL roles | Control-plane list contains only `neondb_owner` | Restricted runtime/NOLOGIN owner still missing; ACLs unverified |
| Cloudflare/Modal | Existing main deploy/reconcile workflows use existing protected provider credentials; current release evidence points to existing Modal compute | Source reviewed; no fresh administrator inventory or credential values retrieved |

Other Neon projects are separate; this task does not change their access
policies. No database policy, role, grant, schema, source endpoint, provider
credential, Cloudflare/Modal deployment or production runtime setting was changed.

## Activated GitHub main protection

Created in the browser and verified through the GitHub API: ruleset **27611672**, targeting
only `refs/heads/main`, with active enforcement, no bypass actors, blocked
deletion/force pushes, mandatory PR approval, dismissal of stale reviews,
approval of the latest push by someone else, code-owner review, resolved
threads, and strict `g1-aws-source` status checks pinned to GitHub Actions app
15368. The native readback reports `current_user_can_bypass:never`. The proposed
source policy now matches those live settings, including GitHub's additional
approval for unattributed changes. The existing tag rule **27261118** is unchanged.

The native source/audit record is
`docs/acceptance/evidence/2026-11-19-g1-github-protection-readback.json`.
It is unsigned provider readback, not independent security certification.
The new offline check runs on every main-targeted PR to avoid path-filter
deadlocks after it is reviewed and merged. No privileged workflow was merged.

The new CODEOWNERS protects `.github/`, the executor code, tests and this
runbook. It currently names the existing owner only. **Before merging this
owner-authored PR, the owner must designate an authorized independent human
security reviewer and add that person as a code owner.** Do not substitute
Codex/bot review, self-approval, an invented reviewer or bypass. This is an
intentional unresolved activation prerequisite, not completed protection.

Create `g1-aws-admin` only when its protection can be complete. Generate the
environment payload with `python3 -m ops.g1_aws.guardrails environment
--reviewer-id <confirmed-independent-human-id>`. The generator rejects the
initiating owner's ID. Independently verify the selected person's repository
permission and acceptance before applying it. Set prevent-self-review, disable
administrator bypass, use custom deployment branches, and create exactly the
branch policy `{ "name": "main", "type": "branch" }`; no tags or wildcard
branches. Read the native environment and branch policy back before AWS trust.
If these features are unavailable under the actual plan, remain blocked until
an equivalent independent approval control is reviewed. OIDC does not remove
the need for independent approval.

## OIDC bootstrap and separate read stages

All new AWS execution is manual, owner-triggered, immutable-repository-ID
checked, protected-main-only, and routed through the protected environment.
No new workflow reads persistent AWS keys or accepts arbitrary commands.

1. Owner designates an independent human reviewer and authorizes the necessary
   repository access; no collaborator was invited by this continuation.
   Independent human review then approves this narrow PR. Merge only after native
   branch and environment protections are verified. `workflow_dispatch` cannot
   be used for these new files until they exist on default main.
2. Run **G1 AWS OIDC subject and identity preflight**, operation `discover`.
   Independent environment approval is required. The reusable executor prints
   only allowlisted public claim context, never the bearer token/JWT. This
   diagnostic explicitly does **not** verify the JWT signature or AWS access.
   The actual AWS STS exchange will verify signature/trust later.
3. Reuse an existing GitHub OIDC provider and suitable non-root IAM admin role
   where present. In an authenticated AWS administrator interface, inspect
   before creating anything. Generate an exact trust document with `python3 -m
   ops.g1_aws.guardrails trust --account-id <authenticated-account-id>
   --observed-sub <subject-from-protected-discovery>`. No wildcard or optional
   trust conditions: audience, exact observed subject, repository/owner IDs,
   actor ID, main ref, environment and reusable workflow must match.
   AWS currently documents these GitHub-specific condition keys. The repository
   was created on 4 September 2026, so the newer immutable subject format may
   apply; do not assume the older name-only subject. Unknown formats fail closed.
4. Review the concrete IAM trust/access expansion before applying it. The role
   may have managed `AdministratorAccess`, subject to SCPs/boundaries and explicit
   denies; that does not authorize unrelated writes or spending. No root keys.
   Protect the role ARN/account as environment variables `AWS_G1_ADMIN_ROLE_ARN`
   and `AWS_G1_ACCOUNT_ID`. They are metadata, not access keys.
5. Run the identity workflow's `identity` operation. The action is pinned to
   verified upstream v5.1.1 commit `61815dcd50bd041e203e49132bacad1fd04d2708`.
   Session duration is 900 seconds, with explicit deny of every AWS action except
   STS GetCallerIdentity. The caller must be the expected assumed role/account
   with the run-correlated session name. Root, IAM user and other-role identities
   are rejected. Success still reports effective admin privileges unverified.
6. After reviewing that live result, independently approve **G1 AWS Ohio and
   credits read-only inventory**. It uses a separately restricted session:
   fixed Ohio EC2 Describe calls, expected-role IAM reads and Billing GetCredits.
   It checks the native role trust against the exact reviewed scope and reports
   AdministratorAccess attachment separately from effective permissions. It
   emits counts and credit amounts/expiry/products without account, role,
   resource, credit identifiers or raw errors. Missing CLI API support or denied
   billing access fails closed. Credit data does not itself prove applicability
   to every planned charge or account-plan restriction.

All checkout actions are pinned to verified upstream v4.3.1 commit
`34e114876b0b11c390a56381ad16ebd13914f8d5`, without persisted Git credentials.
AWS credential action outputs are disabled; no credentials/JWT/provider raw
responses are uploaded as artifacts. Preserve GitHub run approvals, run/attempt
IDs and CloudTrail STS session correlation as audit evidence. A new CloudTrail
trail/storage subscription is not provisioned without a cost review.

Long-lived keys are not used by this proposal. If separately authorized later,
the only permitted destination remains protected environment secrets
`AWS_ADMIN_ACCESS_KEY_ID` and `AWS_ADMIN_SECRET_ACCESS_KEY`, entered by the owner
through the secure interface after native protections have been verified.

## Infrastructure and financial gate

The existing authorization is **USD25 maximum combined incremental AWS +
Cloudflare + Neon cost for one pilot lasting no more than 24 hours**, with a
USD20 planning maximum and USD5 contingency. Credits do not increase it. The
clock starts at first approved billable creation; none was initiated here.

`ops.g1_aws.guardrails.assess_pilot` validates a dated three-provider gross cost
proposal, evidence digests, network/TLS invariants, reviewed SQL privilege plan,
and a tested teardown scheduled before creation. It deliberately returns
`deployment_authorized:false`, `g1_accepted:false`, and independent evidence
verification false. Input assertions/digests are not signatures or proof that
an actual external teardown is installed. Cost alerts are not a hard cap.

The separately approved **G1 Ohio PrivateLink offline proposal gate** receives
the private request via environment secret `G1_AWS_PILOT_REQUEST_JSON`, performs
no cloud call and prints only a sanitized summary/template digest. The endpoint
template generator reuses reviewed existing VPC/subnets/security group and
proposes nine interface endpoints. No host, NAT, EBS, public ingress, IAM role,
database change or Cloudflare service is created by that generator. No apply or
teardown mutation workflow is included: implement those only after real native
inventory, signed cost/network review and a concrete teardown design are ready.

Neon's refreshed public Ohio list contains nine service names. Refresh the
organization-scoped list and native AWS service/AZ availability before planning
charges; fail closed if the snapshot changes. Nine services in one AZ for 24
hours are **216 endpoint-AZ-hours**, or 432 for two AZs, before data/host/storage
and other vendors. This is a quantity calculation, not a verified regional quote.
Require current unit prices and full incremental subscription/minimum charges
for AWS tunnel host/EBS/IPv4/egress, Cloudflare Workers/Hyperdrive/VPC and Neon
private transfer. Include taxes/rounding and delayed billing exposure. No new
recurring plan/subscription is authorized.

Private DNS remains **disabled** in the initial generated proposal. Register
each actual endpoint in Neon first, wait for native acceptance, then perform a
separate reviewed DNS update. Preserve existing endpoint identities. Neon's
endpoint removal/re-add restriction requires explicit recovery planning; never
automatically unregister endpoints as a generic teardown. Disable access and
stop billable AWS resources using the reviewed provider-specific procedure,
then obtain post-teardown native inventory and delayed final charge readbacks.
Do not infer that an expiry tag or a GitHub schedule alone stops billing.

## G1 acceptance remains external and incomplete

Continue to require the selected AWS Ohio PrivateLink → owner-controlled
Cloudflare Tunnel → Workers VPC TCP service → private Hyperdrive → Neon route.
Existing Modal remains the compute layer. Do not substitute a public-IP route
or D1 ledger. The following still need native live evidence:

- Private DNS/IP routing, endpoint acceptance, private VPC service binding and
  negative public connection proof with Neon public access blocked.
- Cloudflare TLS `verify_full` with trusted CA and matching hostname/SAN,
  Hyperdrive cache disabled, bounded pool, actual current-backend `pg_stat_ssl`
  TLS >=1.2. Backend encryption alone does not prove hostname verification.
- Approved restricted runtime LOGIN plus separate nonadmin NOLOGIN function
  owner; exact SECURITY DEFINER signatures/search_path/EXECUTE/USAGE and denied
  direct-table access/role escalation. SQL migrations/grants require review.
- Exact Worker/queue/cron/compile/explain/repair inventory at one source SHA;
  shared SQL reserve/settle ledger; real cross-replica synthetic-provider
  concurrency, pre-upstream denials, duplicate/UNKNOWN/overage holds and
  revocation/failure handling. No paid model calls from this bridge.
- Independent network, database, Cloudflare and security receipts binding the
  same source/configuration, audit digest, cost/time limits and recovery plan.

## Validation and reproduction

`python3 -m unittest discover -s tests/g1_aws -p 'test_*.py' -v` passes **26
offline tests**. Initial new-module invocation failed because implementation
was absent. Cases exercise identity/redaction, fixed-operation dispatch, exact
trust, claim mismatches, policy restrictions, workflow protection, gross cost
ceilings, stale/missing estimates, service/AZ counts and teardown prerequisites.
`python3 -m compileall -q ops/g1_aws tests/g1_aws` passes. Actual CLI invocations
without protected role/request data fail closed; neither invokes AWS.
All five new workflows also pass `actionlint` 1.7.7, obtained from the official
release with the upstream SHA-256 checksum verified. These are source-level
checks, not an AWS connection/deployment/acceptance test.

## Official references checked for this continuation

- [GitHub deployment environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
- [GitHub OIDC AWS configuration](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws)
- [GitHub OIDC and immutable subject claims](https://docs.github.com/en/actions/reference/security/oidc)
- [AWS GitHub OIDC condition keys](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_iam-condition-keys.html)
- [AWS Billing GetCredits](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_billing_GetCredits.html)
- [AWS credit status/amount/expiry/products](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_billing_CreditData.html)
- [Neon private networking](https://neon.com/docs/guides/neon-private-networking)
- [AWS PrivateLink pricing](https://aws.amazon.com/privatelink/pricing/)
- [Cloudflare private Hyperdrive](https://developers.cloudflare.com/hyperdrive/configuration/connect-to-private-database-vpc/)
- [Cloudflare Workers VPC pricing](https://developers.cloudflare.com/workers-vpc/platform/pricing/)
