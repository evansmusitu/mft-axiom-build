# Staff browser permissions and membership revocation — 20 October 2026

The real QA SaaS session passed a bounded Chromium acceptance sequence against
synthetic business records on the existing protected runtime. This is new live
application evidence, separate from the local suite and synthetic identity tests.
Phase 1 remains incomplete.

The QA subject `395706056631686016` was ACTIVE AGENT in business
`f7453f47-9790-4ae9-8661-61ea8cad9300`. Its existing OWNER membership in
`08f57387-a249-4d91-8dfb-dc9ccb8062f9` served as a separate control.

Confirmed through visible business UI:

- Assigned-business overview opened, initially showing two bookings.
- Configuration reads and a synthetic configuration change were denied.
- Staff-management roster access and a foreign synthetic tenant were denied.
- One appointment was reserved through the named resource selector; a second
  overlapping reservation was rejected. The browser's 08:00–08:30 local input
  persisted as 06:00–06:30 UTC on 3 January 2027.
- After membership revocation, the same already-authenticated browser session
  could no longer open the revoked business. Its other QA-owned business still
  opened, and its owner-only roster showed the QA subject as the sole ACTIVE
  OWNER. No new login occurred between the denial and positive control.

Revocation setup was an explicitly scoped operator SQL update of only the
synthetic QA AGENT row from ACTIVE to REVOKED. It was not the owner's SaaS
Revoke access button and is not recorded as owner UI acceptance. The row remains
REVOKED; its other OWNER membership and original business owner remain ACTIVE.
The same-session positive control distinguishes revocation denial from session
expiry. No token, cookie, OTP, encrypted session payload or authenticator seed
was read or copied, and no direct bearer-JWT replay or live JWKS rotation test
is claimed. The earlier exposed-factor issue remains unresolved.

Independent SQL at 06:05:22.970 UTC confirms the membership states, exactly one
new booking `17c6bdd5-112d-4d91-849d-9b2da4058c15`, three target bookings total,
unchanged business configuration revision 2/description/18 October timestamp,
and one unrevoked unexpired session with latest expiry 06:10:39.465 UTC. Session
counts alone do not identify an actor; the observed role boundaries plus unique
control-tenant membership/roster provide the identity association.

These checks assert rendered results; raw HTTP status codes were not captured.
An initial read-only query used a nonexistent revoked_at column, failed without
mutation, and was corrected after reading the session schema to use revoked.
No production/customer record, model request, message send, password, factor or
MFA policy changed. Runtime code and deployment are unchanged, so no unrelated
test/build rerun was required. Evidence:
`evidence/20261020/staff-browser-membership-acceptance.json`.

Next: owner-driven revocation UI, direct replay/JWKS and mobile checks, factor
exposure resolution, genuine bound Meta traffic, governed AI/AXIOM, scheduled
recovery/alerts/second custodian and independent approval remain required.
