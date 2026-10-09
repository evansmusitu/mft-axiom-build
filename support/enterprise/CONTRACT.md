# MUSITU Axiom Enterprise Customer Support Security Contract

This branch closes the gap between enterprise support administration and real customer organization access.

## Identity and membership

- Customer organization access is authenticated by Cloudflare Access.
- MUSITU stores only SHA-256 of the verified Access issuer + subject. Raw email, OTP, JWT, password and raw subject are never persisted.
- Membership is explicitly scoped to an organization and role.
- A verified identity can belong to more than one organization; every shared-case request names its organization and is re-authorized against that membership.
- Suspended organizations and revoked memberships fail closed.

## Invitation

- Operators create one-time organization invitation codes.
- Only the SHA-256 invitation token is stored.
- The plaintext invitation code is returned once and never retrievable by operators.
- Invitations expire, are organization-scoped, role-scoped, and may be consumed only once.
- Joining requires both a valid invitation and a verified Access identity.

## Organization cases

- Organization case priority still derives from impact and safety; payment tier never raises incident priority.
- SLA/support-plan metadata is inherited from the server-side organization record, never accepted from a customer-supplied plan field.
- Organization cases persist `requester_ref=org_ref` so organization webhooks and shared-case visibility remain scoped.
- Any active organization member may view customer-visible case threads and post customer messages for that organization.
- Internal notes, approvals, recovery secrets and operator-only metadata are never exposed through the enterprise customer API.
- Recovery codes remain available as a backup capability but are not required for an authenticated organization member to use a shared case.

## Production boundary

Production deployment requires an additive D1 migration, a dedicated Cloudflare Access application for `support.mftintelligence.com/enterprise/*`, exact Access-JWT verification in the Worker, and anonymous-denial proof before the UI is exposed.
