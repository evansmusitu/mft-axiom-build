# MUSITU Enterprise Studio V0.3 — single-administrator security decision

## Owner's authorized change
Allow a sole authorized Studio owner to approve their own project job without requiring a second employee. **Do not downgrade signed Cloudflare Access authentication, project authorization, audit immutability, R2 integrity, spend constraints, recovery restrictions or the V0.2 production boundary.** Keep genuine independent reviewer approval for team projects.

## What changes / what does not
A single-person approval is NOT equivalent to the risk reduction delivered by two independent people. Its true designation is `single_administrator`, audit event `JOB_APPROVED_SINGLE_ADMIN`, and evidence `independent_reviewer=false`. The two-person enterprise claim must not be used for that job. This operational tradeoff is owner-authorized; silent fake second-reviewer evidence is forbidden.

The sole-administrator exception is OFF by default and permits a self-approval only with a signed verified Cloudflare Access subject, exactly one configured global administrator, founder-owner status, exactly one project member, and deliberate same-origin confirmation. Revocation or a second member invalidates sole-person dispatch eligibility. Team approvals retain independent reviewer enforcement. The state change and audit are atomic, and R2 assets remain content-addressed and immutable.

Modal spending safeguard: CPU remains permanently source-locked in real V0.3 until independently verifiable account-level $0 unapproved-overage controls are established and a separate reviewed release changes the source. GPU remains off. Cloudflare hosted PITR qualification remains outstanding and cannot restore any live customer instance during qualification. No release of production code, secrets, Cloudflare policies, billing, R2, or databases occurs from the source-only implementation.

## Activation gate (not yet executed)
1. Obtain real signed Access session for the intended sole administrator, verify identity claim and that the selected project is theirs; keep Access staff-only with existing account/zone WAF protections.
2. Confirm that the private runtime global-admin list will contain exactly their signed subject, and obtain reviewed permission to set `STUDIO_V03_SINGLE_ADMIN_APPROVAL=true`; do not put an email address or JWT in source.
3. Run full Node and real SQLite Durable Object acceptance tests; verify self-approval acknowledgement, independent reviewer regression, post-grant revocation, audit provenance, and cross-project denial.
4. Only through the V0.3-isolated vetted provider release, verify the custom domain and eight Cloudflare Access-protected routes, and confirm CPU/GPU still source-locked. Do not touch V0.2 or Axiom main.
5. Read back sanitized provider receipts, signed operator approval and immutable audit evidence into the private handoff. Do not claim a second human approval occurred.

## Risk register
Remaining risk versus mandatory dual-control: a compromise of the only authorized identity permits a deliberate self-approval. Compensating controls restrict blast radius and improve accountability but cannot fully restore the independent-human check. Strong MFA/passkey enforcement and short Access sessions are recommended for activation, subject to authoritative account configuration verification. Higher-cost or destructive actions should retain separate release gates and provider-level spend and recovery safeguards.
