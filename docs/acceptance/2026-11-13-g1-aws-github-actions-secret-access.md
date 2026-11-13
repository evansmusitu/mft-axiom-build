# G1 AWS GitHub Actions secrets bridge — read-only first

**Status (2026-11-13):** Draft source only. No authenticated AWS access, key readback, billed resource creation, branch merge, live deployment or G1 acceptance. The user selected AWS API access keys in GitHub Actions secrets as the connection mechanism; the user reported US$50 AWS credits, not independently verified. Prior US$25 combined AWS+Cloudflare+Neon, 24-hour pilot ceiling remains unchanged.

## Secure installation steps for the owner

1. **Protect GitHub main BEFORE storing any AWS secret.** At this check, evansmusitu/mft-axiom-build had **zero branch rulesets**. In Settings → Rules → Rulesets, protect main, require review/status checks and restrict .github/workflows edits. A malicious edit to an unprotected Actions workflow can misuse secrets. Confirm the rules really apply to this account/repository.
2. Create a dedicated **non-root, programmatic-only AWS IAM user** with solely the policy at [.github/policies/g1-aws-readonly-iam-policy.json](../../.github/policies/g1-aws-readonly-iam-policy.json) and **no other attached or inherited write privileges**. This policy allows only EC2 DescribeVpcs, DescribeSubnets, DescribeVpcEndpoints in **us-east-2**. STS GetCallerIdentity is available without an explicit allow policy. Do not grant AdministratorAccess or reuse production API keys.
3. In GitHub repository Settings → Environments, create **g1-aws-readonly**. Restrict it to **main**; configure required reviewers and bypass restrictions if the account plan supports them. Confirm restrictions are actively enforced. Add exactly these **GitHub environment secrets** under that environment, rather than repository-wide secrets: **AWS_G1_ACCESS_KEY_ID** (IAM access key ID) and **AWS_G1_SECRET_ACCESS_KEY** (matching access key secret). Copy from AWS IAM directly into GitHub. **Never paste passwords, keys or MFA codes into this conversation, a commit or a workflow input.**
4. In AWS Billing → Credits, independently inspect whether US$50 AWS credits are **active, unexpired and eligible** for the intended AWS PrivateLink/tunnel services. Credits do not pay Cloudflare or Neon invoices. The existing **US$25 total cross-provider G1 authorization** is unchanged; the internal planning target is US$20 with US$5 contingency. Cost alerts are not hard cost stops.
5. The owner and independent security reviewer inspect **draft PR #239** and this workflow. It must reach main **only after** protection and environment controls are configured. Per [GitHub's documentation](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow), a new manual workflow must exist on the default branch before it can be dispatched.
6. Once deployed on protected **main**, only GitHub actor **evansmusitu** can run Actions → **G1 AWS read-only inventory** → Run workflow → check **confirm_read_only**. It emits only sanitized region, VPC/subnet/Interface endpoint **counts and endpoint state counts**; it does NOT print ARN, AWS account number, subnet/VPC/endpoint IDs, credentials, routes or CIDRs. A connected GitHub tool can read the harmless run result and guide later G1 planning.
7. Monitor access in AWS CloudTrail, **rotate/revoke the long-lived IAM access key** when no longer needed, and prefer **GitHub OIDC → AWS STS temporary credentials** for future recurring use. See [official AWS/GitHub credentials advice](https://github.com/aws-actions/configure-aws-credentials) and [GitHub AWS OIDC guidance](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws).

## Control boundaries

This bridge gives **GitHub Actions**, not ChatGPT itself, restricted AWS API access. The connected GitHub app can inspect logged, sanitized results; it cannot directly read GitHub secrets, fetch the IAM secret value or invoke arbitrary AWS operations. There is **no read-only workflow billing credit verification**; credit status requires owner-native billing console review or a separately approved billing read role.

The inventory IAM policy has **zero create, delete or modification permissions**. Actual G1 provisioning must use a *different*, independently reviewed, time-bounded, least-privilege deployment role with approved cost estimate, teardown owner, Neon VPCE assignment, Cloudflare Tunnel/VPC/Hyperdrive operator access, TLS verify-full origin proof, restricted PostgreSQL runtime and definer roles, live all-worker protected spending ledger tests and independent security acceptance. Never upgrade the inventory user to AdministratorAccess. **G1 remains NO-GO**.

## Source and test inventory

- .github/workflows/g1-aws-readonly-inventory.yml — main-only, owner-only, manual-only, environment-scoped workflow; no PR or push secrets use.
- .github/policies/g1-aws-readonly-iam-policy.json — explicit Ohio-only AWS EC2 Describe permissions.
- scripts/g1_aws_inventory_readonly.py — explicit AWS CLI read allowlist; sanitized errors and output.
- tests/test_g1_aws_inventory.py — five credential-free offline tests including behavior-assertion red/green, redaction and workflow guard checks.

Local offline validation command: `python -m unittest discover -s tests -v`. Local 5/5 passed when these files were prepared; this is NOT a live AWS authentication or endpoint test.
