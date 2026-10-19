# Authentication email delivery diagnosis — 19 October 2026

Phase 1 remains incomplete. The single approved test passed for actual Resend API delivery to the existing owner-controlled Gmail mailbox. It does not qualify the ZITADEL SMTP connection, staff login or a production release.

## Genuine delivery evidence

The user approved the dedicated SMTP proposal and one owner-mailbox delivery test on 18 October at 23:54:53 Africa/Harare. The existing connected Resend domain `mftintelligence.com` was independently re-read as verified, sending enabled, US-East. No domain, DNS, tracking or existing credential changed.

Exactly one plain-text test was sent from `MUSITU Phase1 Staging <musitu-auth@mftintelligence.com>` using idempotency key `musitu-phase1-approved-gmail-delivery-test-20261018-v1`. Provider email `01a15129-3f4a-71bf-b633-117ac3a4f680` was created at `2026-10-18T22:37:00.276Z` and independently read back as delivered. No send retry occurred.

A separate Gmail metadata read found the test in INBOX, CATEGORY_UPDATES and UNREAD. Its Message-ID exactly matches the provider result; sender, recipient and subject also match. SPF and DKIM were pass. DMARC was not reported in the inspected headers; no DMARC-pass claim is made. No Gmail message body or authentication code was read. The recipient address and private Gmail message identifier are omitted from repository evidence.

Read-only usage changed from daily 0/100 and monthly 1/3000 to daily 1/100 and monthly 2/3000. This is one included-allocation send, not billing-invoice evidence. No upgrade or charge was authorized or initiated.

## ZITADEL and credential boundary

Real administrator password and existing authenticator MFA admitted the isolated EU console. Its SMTP list showed No SMTP Provider available / 0 total results. The QA user's displayed history recorded verification code generation at 22:54 and 23:00 Harare, a verification failure at 22:55, and no email-sent event. The empty custom-provider list and absent sent event do not establish the internal managed-cloud queue outcome; the verification failure does not identify a transport cause. Failed Events had no rows.

The proposed dedicated SMTP configuration remains unsubmitted. Description, host `smtp.resend.com:587`, TLS and user `resend` were prepared; sender fields remained blank after ordinary browser fill failures. No credential, Save, Test, Continue or Activate action occurred.

The connector exposes the verified domain but no owner-profile email. The user explicitly selected `evansmusitu5@gmail.com` and asserted domain ownership. The browser account menu confirmed that email but its domain list showed No domains yet and no alternate team choice. This discrepancy remains unresolved. A sending-only key dialog was cancelled before Add because the domain restriction was unavailable. No account/domain creation, domain claim or DNS workaround was performed.

Email-based secure sign-in did not establish a verified Resend browser session; a fresh dashboard page redirected to login. There was no visible error sufficient to classify incorrect credentials or bot blocking. Private user completion of the existing sign-in remains necessary. Do not retrieve a new key through a connector that exposes its secret, reuse production keys or place secret values in chat, files, logs or evidence.

## Acceptance status

Passed: one actual verified-sender Resend API-to-Gmail delivery with provider and mailbox readback.

Open: dedicated scoped credential, actual ZITADEL SMTP configuration and verification-code delivery, QA verification/MFA, actual staff authorization/revocation, remaining identity/provider/Meta/AI/operations/recovery and independent approval gates. Existing source/runtime validation retains its earlier scope. No public launch, production-system change or completion attestation.

Structured evidence: `evidence/20261019/resend-gmail-delivery-test.json`.
