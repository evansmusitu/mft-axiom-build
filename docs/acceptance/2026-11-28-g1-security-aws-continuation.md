# G1 security and AWS continuation — 28 November 2026

G1 remains PARTIAL/BLOCKED. Repository security settings are live; source changes
remain a separate proposal until independent review and protected merge. The
source-level checks do not establish AWS identity or effective access denial.

The canonical repository is `evansmusitu/mft-axiom-build`, repository ID
`1356837528`, owner ID `285482095`, default branch `main`. Main remains at
`c3c5aaab90e94f1ca84ac9903f9d481c23c4f350`. This proposal continues unmerged
PR #244's source and preserves its branch. It does not merge PR #1, #239 or #244.

## Live protections

Ruleset `27611672` is active on `refs/heads/main`, with no bypass actors. It
preserves deletion/force-push restrictions, one approving review, stale-review
dismissal, latest-push approval by another person, code-owner review, conversation
resolution, strict `g1-aws-source` from GitHub Actions app `15368`, and the extra
approval for unattributed changes. Linear history and verified signatures are
now required; only squash/rebase merges are allowed by this ruleset. Existing
tag ruleset `27261118` is preserved. Administrator bypass remains unavailable.
Creation/direct-update restrictions are off.

CodeQL default setup successfully scanned main in Actions run `45756372577`:
GitHub Actions, Python, C/C++, and JavaScript/TypeScript. CodeQL is now required
by the ruleset, blocking high-or-higher security alerts and standard errors.
That scan found 19 existing main alerts, including sensitive logging/storage,
regex complexity, cryptographic-use and HTTP response findings. They have not
been dismissed or represented as remediated by this proposal. The native UI
also reported one open secret-scanning alert; its credential was not retrieved.
A clean current-tree Gitleaks result does not clear historical native alerts.

Dependency graph and Dependabot alerts were enabled. Existing native secret
scanning and push protection remain enabled. External fork workflow approval was
changed to require approval for all external contributors. Default workflow
permissions remain read-only; Actions cannot approve PRs.

## Source changes

- Pin external actions by verified full commit SHA and disable checkout token
  persistence. Add missing concurrency controls.
- Credential-bearing jobs require the immutable repository, protected main,
  manual dispatch and the authorized owner. The existing fixed read-only Bing
  daily schedule remains permitted on protected main. Existing deployment
  scripts are not executed by this work.
- Preserve the existing clean-handoff artifact's exact temporary directory and
  intentional hidden source files. Its narrow audit exception does not allow
  uploading arbitrary repository roots or hidden files elsewhere.
- Extend CODEOWNERS to infrastructure, IAM, deployment, operations, packaging and
  authentication paths. The owner is the only named owner: independent human
  ownership is still unresolved and must be established before this owner-
  authored change can be accepted. Do not invent a reviewer or use an owner-
  controlled alternate identity.
- Add real workflow-boundary, lint, Bandit, Gitleaks and dependency-audit checks,
  plus weekly Dependabot update configuration. Fix the audited qualification
  dependency set's two OpenTelemetry advisories by updating SDK/exporter from
  `1.45.0` to `1.45.2`; the subsequent Python and npm audits found none.
- Retain the fixed OIDC read executor, but target a separate verification role
  through `AWS_G1_VERIFICATION_ROLE_ARN`. The verification role template only
  allows fixed STS/IAM/Billing/Ohio EC2 reads and explicitly denies other
  operations. `${VERIFIED_ROLE_ARN}` must be replaced with authenticated native
  metadata before applying; this is a template, not an AWS resource.

No AWS role/provider, permanent key, billable service, cloud deployment, database
role/grant, customer action, production AI execution or payment was created.

## Measured tests and coverage

The original 26 G1 tests pass; seven new workflow-boundary cases bring the suite
to 33 passing tests. Six existing privileged deployment/billing regressions also
pass. Actionlint `1.7.7` validates all 223 proposed workflows. Gitleaks `8.28.0`
finds no current-tree leaks with output fully redacted. Upstream binary SHA-256
checksums are checked before execution, locally and in CI.

Coverage for the three existing G1 AWS modules was measured before the changes:
175/249 executable statements, approximately 70.28%. CI uses the observed,
rounded-down 70% floor and produces Cobertura XML with a required artifact-upload
step. This is scoped G1 module coverage, not product-wide coverage. Native
GitHub coverage enforcement is not enabled: it requires Code Quality, an
eligible plan and an actual successful native coverage upload. Neither an
artifact upload nor an invented percentage is a substitute.

## Activation blockers and exact sequence

1. Identify a genuinely independent human, verify consent and repository write
   permission, and add that human as code owner for privileged paths. The last
   successful Manage access observation (26 November) showed zero collaborators;
   refreshing that page on 28 November requires GitHub sudo email verification.
2. Create `g1-aws-admin` only with the independent reviewer configured,
   prevent-self-review enabled, administrator bypass disabled, and a custom
   branch policy allowing exactly branch `main` (no wildcard/tags). Its absence
   is confirmed on 28 November; the existing environment is
   `axiom-support-production`. No unprotected AWS environment was created.
3. Independently review and merge the scoped proposal only after all required
   checks and signing requirements pass. Unsigned branch commits may need to be
   recreated using verified signing; do not weaken the signature rule.
4. Authenticate to the correct AWS account and inspect existing IAM/OIDC and
   resources. AWS Console returns `Site Unavailable` / `Unable to access this
   site` in the authorized browser. No AWS connector/CLI credentials are
   available here; the account ID, partition and effective principal are not
   verified. Ohio is supported by the G1 architecture and live Neon metadata,
   not a substitute for STS account verification.
5. Approve and apply only the exact reviewed verification role/trust. Bind the
   actual repository/environment/reusable workflow claims and audience. Run
   permitted STS identity and fixed inventory through the independently gated
   workflow, then demonstrate denied repository/branch/environment identities
   and denied write permissions, with CloudTrail/session correlation evidence.
6. Define deployment/bootstrap policies only after exact resource/action
   inventory; no broad administrator default is supplied. Obtain explicit
   approval for any destructive or cost-incurring AWS action. Preserve the
   existing USD25 combined/24-hour pilot ceiling from prior evidence; it is not
   an instruction to spend now.
7. Establish and prove a distinct pre-merge staging deployment environment/check
   before requiring deployment success. Never require the post-merge AWS admin
   environment on pre-merge PRs. No synthetic deployment status was created.
8. Complete native Code Quality/coverage plan enablement and baseline uploads
   before adding their rules; verify Copilot review availability/credit and
   billing controls before enabling automatic metered reviews.

Neon project `royal-grass-27046609`, branch `br-quiet-star-bee8qn26`, remains
PostgreSQL 17 in `aws-us-east-2`, protected main, public connections blocked,
VPC allowed, and idle compute `ep-shiny-violet-beinhrc2` at 0.25 CU. Its role
inventory has only `neondb_owner`; restricted runtime/NOLOGIN ownership and the
private Cloudflare/Neon transport acceptance remain unproved. Existing
Cloudflare/Modal source configuration is reused without deployment.

## Rollback

Before merge, close the new proposal and retain its branch/evidence; this does
not affect main source. After an independently approved merge, use a reviewed
revert PR, preserving branch/review/scanning/signature protections. Do not use
force pushes or owner bypass. If a particular pinned action proves incompatible,
review a pin-only fix. Preserve the tag ruleset and existing cloud resources.
AWS rollback is not applicable to this session because no AWS mutation occurred.
Future role/resource changes need native pre-change policy/inventory backups and
a separately approved revoke/teardown plan; expiry tags alone do not stop billing.
