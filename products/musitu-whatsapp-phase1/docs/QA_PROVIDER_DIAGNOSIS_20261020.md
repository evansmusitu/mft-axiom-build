# QA sign-in diagnosis — 20 October 2026

Administrator console access was independently confirmed after the user's
manual sign-in. The existing QA profile is Active, with preferred login name
`musitu-phase1-staff-qa`, user ID `395706056631686016`, and verified email.

The rendered recent activity lists six Password check failed entries on
19 October at 12:20, after Password check succeeded at 11:58 and Multifactor
OTP check succeeded at 12:00. The activity UI did not state its timezone;
these are exact display labels/times, without conversion. This establishes
historical provider-side password-check failures. It does not establish the
current password, a lockout cause, or that the cloud browser was the cause.

A fresh sign-in through the actual SaaS /auth/login flow reached Loginname.
The secure username request returned submitted, then the provider showed
User not found in the system. The entered value is redacted and was not read
or reconstructed. No password or OTP was submitted in this attempt. No staff
SaaS session was established. Stop automated retries and use manual private
entry of the independently confirmed QA username and existing credentials.

Nothing was reset: password, authenticator, MFA policy and memberships are
unchanged. The earlier QA setup-secret exposure remains unresolved. Phase 1
is incomplete. Runtime remains the tested health deployment from commit
`3f7eb7b3be8d65a51e13e09387035c4e8ae5043c`; no code or deployment change is
needed for this diagnostic evidence. Details are retained in
`evidence/20261020/qa-provider-diagnosis.json`.
