# Authentication email delivery — 19 October 2026

Phase 1 remains incomplete. Actual ZITADEL SMTP delivery to the owner-controlled QA mailbox now passed. The email verification code was accepted and the QA flow reached new MFA enrollment. Staff MFA, a signed staff SaaS session, role/revocation tests and all other required gates remain open.

## Actual ZITADEL SMTP acceptance

After the user privately configured the provider on their phone, the existing administrator signed into the isolated EU console with the existing password and authenticator through secure entry. The saved provider was independently read: ID `395779741543625920`, description `MUSITU Phase1 isolated authentication`, host `smtp.resend.com:587`, TLS enabled, username `resend`, sender `musitu-auth@mftintelligence.com` / `MUSITU Phase1 Staging`, reply-to blank. No password was read or replaced.

The provider initially had an empty Activated cell. The existing saved settings were retained and saved unchanged to expose Next Steps; ZITADEL explicitly said the provider could not send until activated. The previously approved activation was applied. The wizard then offered Deactivate, and an independent provider-list read showed `data-e2e="active-provider"` with a check-circle indicator. No other custom SMTP provider was listed.

The private SaaS Sign in link started the existing QA account's flow. The selected identity was positively `musitu-phase1-staff-qa`, not the administrator. Its existing password was accepted and the provider rendered Verify user / a new code has just been sent. No additional diagnostic Test or manual resend was clicked.

Resend metadata independently reports email `01a1535b-4e86-7289-a390-c8bc51e258a0`, created `2026-10-19T08:50:55.381Z`, delivered. A separate Gmail metadata-only read found the matching email in INBOX, CATEGORY_UPDATES and UNREAD, with the exact provider Message-ID and matching sender/recipient. SPF and DKIM pass; DMARC was not reported in inspected headers. No Gmail body, snippet, verification code or reset link was inspected or recorded. Personal recipient address and private Gmail message ID are omitted from repository evidence.

The user submitted the verification code through secure browser entry. The final rendered state advanced to Set up 2-Factor, offering Authenticator App and Universal Second Factor. This proves the verification code was accepted in that flow; the separate profile Email Verified flag has not yet been independently read. New MFA enrollment was handed over for user-controlled private entry/confirmation/submission. No QR payload, seed, recovery code or OTP was read. No authenticated staff application session, AGENT permissions or revocation acceptance is claimed yet.

## Credential lifecycle and unresolved scope evidence

The correct Resend account was positively identified as the user-selected account, and its verified `mftintelligence.com` domain ID `b210c166-6cb7-48a7-9c1f-eb1311beb7b4` and original Onboarding key matched connector metadata. The earlier browser-workspace discrepancy is resolved. No domain, DNS, tracking or production MAIL FABRIC change occurred.

The first dedicated key `01c58fc6-8075-4f4d-bad3-42dca5fa01fb` was lost during private copying. Its exact permanent revocation was approved by the user and independently verified; Onboarding remained. The R1 replacement `a65149c9-8cdb-4bcb-8890-de7295a537ed` was then created privately. After phone instructions the current inventory contains R2 `9eaf00bd-5324-4d01-86d6-c783441da905`, created `2026-10-19T08:33:56.093116Z`, R1 and Onboarding. No further key was deleted.

R1's form was prepared with Sending access restricted to the verified domain. R2's phone instructions required the same restriction. The current key-list response provides names/IDs/dates, not permissions/domain or the ZITADEL password-to-key binding. R2 scope and exact binding therefore remain independently unqualified. Do not claim them proved from the user's Done or successful transport alone; do not revoke R1 until its use/retention is resolved and exact revocation is approved.

No key/password/token/authorization code/cookie was read, decrypted, exported or recorded. The rejected credential-detail access was not retried through another surface. New credential handling remained private and user-controlled.

## Earlier distinct API-to-Gmail test

The one approved plain-text diagnostic test used idempotency key `musitu-phase1-approved-gmail-delivery-test-20261018-v1`, provider email `01a15129-3f4a-71bf-b633-117ac3a4f680`, created `2026-10-18T22:37:00.276Z`. Provider delivered and separate Gmail metadata matched, with SPF/DKIM pass and no DMARC report. Allocation changed daily 0/100 to 1/100 and monthly 1/3000 to 2/3000. No retry or upgrade was performed. This authorization was consumed; it is separate from the actual authentication email described above, and does not authorize repeated diagnostic Test sends.

Earlier diagnosis of missing custom SMTP, failed email verification and mismatched browser workspace is historical and superseded by the actual results above. Its immutable structured evidence retains its original time/scope: `evidence/20261019/resend-gmail-delivery-test.json`.

## Remaining acceptance

Open: independently verify the current dedicated-key restriction/binding; complete QA MFA, real signed staff session, allowed/denied staff actions, revocation/old-token/JWKS acceptance; all remaining Meta, governed AI/AXIOM, mobile, operations/recovery and independent approval gates. Existing local tests and synthetic hosted-Postgres results keep their earlier scope. No runtime code change, new deployment, release-gate attestation, public launch, customer import, unsolicited message, charge or protected-system change.

Current structured acceptance evidence: `evidence/20261019/zitadel-smtp-qa-email-acceptance.json`.
