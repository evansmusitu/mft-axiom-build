# MUSITU Axiom Enterprise Customer Support — Production Handoff

`production_authority: support-only user authorization already granted`

## Release contract

1. Revalidate protected main, PR #1, frozen OpenAI, Claude distribution, Official Support and recovery-production branches.
2. Take a fresh D1 Time Travel bookmark and record only its SHA-256.
3. Create a dedicated Cloudflare Access self-hosted application for `support.mftintelligence.com/enterprise/*` with **zero allow policies initially**.
4. Apply `support/schema.sql` additively. Existing support row counts must not decrease or mutate unexpectedly.
5. Deploy the current public support Worker with:
   - `support/enterprise/index.html` at `/enterprise/`
   - `support/enterprise/app.js` at `/enterprise/app.js`
   - enterprise API requests routed to the support Worker
   - `SUPPORT_ENTERPRISE_ACCESS_TEAM_DOMAIN`
   - `SUPPORT_ENTERPRISE_ACCESS_AUD`
6. Deploy the current operator Worker/console so organization invite controls are available.
7. Preserve all existing secret and resource bindings by strict inheritance. Never read or copy the support data key, Turnstile secret or webhook secrets.
8. Keep secure public-support and operator workers.dev/previews disabled. The separate metadata-only public-status Worker is unrelated and must remain unchanged.
9. Only after code and D1 are staged, create exactly one authenticated-users Access allow policy for the enterprise path. No Bypass policy.
10. Prove anonymous `/enterprise/`, `/enterprise/app.js` and enterprise APIs are blocked before UI content is returned.
11. Re-prove the existing public support root, recovery Access, operator console, inbound email, scheduler, attachments and dedicated public-status Worker remain intact.
12. Human validation then proves: operator creates org + one-time invite → authenticated customer joins → org membership appears → shared case inherits server plan → second member can read/reply → revoked member loses access.

## Security invariants

- Invitation plaintext is shown once and only SHA-256 is persisted.
- Invite redemption uses atomic `UPDATE ... RETURNING` single-use claiming.
- Access identity is stored only as SHA-256 of verified issuer + subject.
- Raw email, JWT, OTP, password and raw subject are never stored in org membership.
- Customer input cannot select its support plan or requester organization.
- Shared case reads/messages are re-authorized to the named organization on every request.
- Suspended organizations and revoked memberships fail closed.
- Internal notes, approvals, recovery secrets and operator-only metadata never appear in the enterprise customer API.
