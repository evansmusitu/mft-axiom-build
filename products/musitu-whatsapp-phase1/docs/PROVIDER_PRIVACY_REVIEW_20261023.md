# Provider and privacy acceptance review

Reviewed 23 October 2026. This is a technical inventory and published-terms review,
not a legal compliance certificate or an owner acceptance. No contract, data
preference, paid plan, public notice or deletion setting was changed by this review.

## Current data paths and outstanding evidence

| Provider | Current application data path | Acceptance evidence still needed |
| --- | --- | --- |
| Vercel | Private SaaS code/runtime, identity callbacks, authenticated requests and controlled recovery builds. All application deployments require hosting SSO; project live=false. | Actual project optional-training preference; exact applicable agreement/processor coverage; function/log retention and region settings. |
| Neon | Tenant records, encrypted message/recipient content, approvals, suppressions and encrypted sessions. Live project metadata reports `aws-us-east-2`. | Applicable account agreement/subprocessors and approved class-specific retention/erasure. Database region alone does not determine every provider data path. |
| ZITADEL | Business identity, MFA, token/introspection and provider account records. Prior genuine acceptance used the existing EU1 instance. | Current instance/contract/subprocessor evidence and resolution of exposed QA-factor and old-token/signing-key acceptance. |
| Resend | Existing identity-provider email delivery, recipient and delivery metadata. | Account-specific DPA copy and actual relevant email-retention configuration. |
| Meta / WhatsApp | Owner-controlled development channel, inbound events, the tightly bounded approved reply and signed status callbacks. | Actual signed delivery; applicable current platform/processor/transfer terms and recipient scope. |
| Groq | Only the selected question and approved FAQ question choices for owner-enabled, staff-requested assistance. Stored business answers are selected inside MUSITU; no autonomous send. | Actual Free-plan, Zero Data Retention, credential scope/expiry and approved data-use evidence; owner answer/privacy/cost acceptance. |
| Google Drive and ChatGPT Library | The new encrypted offsite checkpoint, retained privately. Outer recovery key was not delivered with the artifact. | Applicable account contracts, access/retention/region decisions and accepted independent custodian/key access. Existing private artifact retention is not a general enterprise DPA assurance. |
| AXIOM | SaaS transport disabled; no AXIOM credential found in protected Preview metadata. Operator/plugin capability access is separate. | Authorized service identity/interface and genuine SaaS-originated execution, error and numeric-result evidence. No production or frozen submission changes. |

## Findings from current primary sources

1. **Vercel plan and contract scope.** The current Terms restrict Hobby to
   personal/non-commercial use. Its DPA describes processor coverage for Pro
   and Enterprise, while the general Terms incorporate a DPA as applicable.
   Account-specific Hobby coverage remains unestablished. Keep this private
   development candidate separate from any commercial/customer release; do not
   buy a plan or declare contractual coverage without evidence.
   Sources: [Terms](https://vercel.com/legal/terms),
   [DPA](https://vercel.com/legal/dpa).

2. **Vercel optional training.** Vercel documents Hobby opt-in defaults and an
   owner opt-out in Team/Project Settings. The project read/update schemas exposed
   here do not return or change that preference. Its current value is unknown.
   Use the existing [Vercel dashboard](https://vercel.com/dashboard), select
   team `evansmusitu`, then only project
   `musitu-whatsapp-phase1-private-20261014` and its Data Preferences/Settings.
   Preserve any existing team-wide opt-out; never enable team sharing to obtain
   a project control. Record the actual displayed choice and save/readback.
   Source: [Vercel's published explanation](https://vercel.com/changelog/updates-to-terms-of-service-march-2026).

3. **Groq retention and location.** Groq documents limited reliability/abuse logs
   of up to 30 days, US storage for retained customer data, and self-service Zero
   Data Retention. This does not prove our organization enabled it. An actual
   owner should inspect and, for this privacy objective, enable appropriate ZDR
   at [Data Controls](https://console.groq.com/settings/data-controls), retain
   free-plan/budget restrictions and verify save/readback. Do not expose the
   existing key; its actual expiration remains unverified.
   Source: [Your Data in GroqCloud](https://console.groq.com/docs/your-data).

4. **ZITADEL and Resend are distinct location paths.** ZITADEL documents selectable
   primary regions and regional backups. Resend states that stored customer data
   is in the US and that selecting a domain sending region does not change that
   storage location. Resend also documents a standard DPA applying to every
   account, downloadable under authenticated Documents. The specific account
   copy was not retrieved here. Do not claim that EU1 identity makes all email,
   database, hosting or backup processing EU-only.
   Sources: [ZITADEL regions](https://help.zitadel.com/where-is-zitadel-cloud-data-stored),
   [ZITADEL DPA](https://zitadel.com/docs/legal/data-processing-agreement),
   [Resend DPA/location explanation](https://resend.com/security/gdpr).

5. **Neon contract review.** The 14 October platform schedule references the
   Databricks agreement, processor provisions and additional subprocessors.
   The project's authenticated region readback is US East 2. A published schedule
   is not an account-specific completed transfer assessment or retention policy.
   Source: [Neon platform schedule](https://neon.com/platform-terms).

6. **Meta source limitation.** The current WhatsApp Business Platform terms
   redirected to a sign-in/temporary-block page during the public-source read.
   No alternate route was attempted, and an old terms revision was not substituted
   as current acceptance. Existing owner-approved Meta publication remains its
   own historical evidence; provider/privacy acceptance remains open.
   Source: [Current platform terms entry](https://www.whatsapp.com/legal/business-solution-terms).

## Retention and request decisions to record

| Record class | Verified current behavior | Required decision and qualification |
| --- | --- | --- |
| Inbound and development-reply bodies | Content is encrypted; message visibility uses retention timestamps. Expired reads exclude content. | Physical disposition, trigger, exceptions and a tested purge that preserves replay/delivery safety. No purge is authorized by this review. |
| Contacts, conversations, drafts and approvals | Linked tenant data remains stored. | Period, linkage inventory and correction/erasure behavior with referential integrity. |
| Consent, suppressions and uncertain attempts | Safety records survive recovery. | Minimal retained identifiers/grounds and how erasure preserves opt-out and duplicate-send protection. Never erase these blindly. |
| Bookings, membership, identity and audit | Separate business/security records and provider copies exist. | Class-specific operational/legal grounds, retention and staff-access disposition. No universal deadline is inferred. |
| Model metadata | Request state and usage preserve budget/idempotency evidence. | Minimal retained fields, period and handling of UNKNOWN outcomes. |
| Hosted snapshots and offsite copies | Existing 14 October snapshot and encrypted 18/23 October artifacts are preserved. | Recovery targets, expiry, custodian access and privacy-action reconciliation before restore. No artifact was deleted. |

The new guarded review-export path is read-only and limited to the development
owner's selected conversation. It requires real session and owner membership
checks, exact approval, a fresh browser-generated key, bounded output and a final
owner/session recheck. Its scope excludes other systems and unlinked records;
it neither delivers a subject-access response nor erases data. A safe local
receipt is offered to the owner; no new database audit permission was granted.

The bounded privacy-intake subject search returned no matches. This demonstrates
one manual search, not a delivered request, continuous monitoring or tested
request-response service. The two nominee threads still contain only the
previously sent handoffs. Role acceptance, independence, account control and a
custodian exercise must be genuine and recorded separately.
