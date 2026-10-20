# MUSITU WhatsApp AI Employee — privacy publication review draft

Status: HISTORICAL PRIVATE REVIEW DRAFT, 20 October 2026. The user subsequently
approved Evans Musitu as operator and evansmusitu5@gmail.com as the public privacy
contact. Current public notice source is `deployments/privacy-notice/public/`.
This engineering review is not the public notice and asserts no legal certification.
Retention/deletion qualification and applicable legal review remain incomplete.

## Original review decisions (operator/contact now approved)

- Confirm whether the legal operator is Evans Musitu personally or a registered
  entity, and supply the exact public operator name.
- Approve the public privacy contact. Suggested for review only:
  evansmusitu5@gmail.com. It has not been published as a privacy contact.
- Confirm applicable rights, lawful processing arrangements, request handling,
  retention periods for each record class and backups, and processor contracts.
- Qualify the deletion/export workflow and retention cleanup before promising
  deadlines or automatic erasure. The current application has no qualified
  customer deletion/export flow or scheduled message deletion.

## Proposed notice content, subject to the decisions above

MUSITU WhatsApp AI Employee is a private staging application for business
inquiries, appointments and staff-assisted customer service. It is undergoing
qualification and has not been released for public customer use.

Operator: [confirmed legal operator]. Privacy contact: [approved public email].
Effective date: [date of approved publication].

### Information used

The system is designed to process business account and staff identity information,
business membership/roles, approved business knowledge, appointment resources and
booking details, WhatsApp channel/message identifiers, conversation text and
recipient information, consent/opt-out records, response approvals, operational
audit records and model usage records. Current acceptance uses synthetic
businesses and an owner-controlled development recipient, without customer imports.

### Purposes and access

Information supports sign-in and MFA, business-specific access, inquiry handling,
human handover, appointment/conflict management, approved answer drafting,
opt-out suppression and operational/security review. Business memberships restrict
which records staff can access. AI draft assistance requires the business owner's
permission and a staff request; responses require human approval. Public messaging
and unrestricted signup are disabled in this private candidate.

### Providers and transfers

The candidate uses Meta WhatsApp Cloud API for its development channel, Vercel
for application hosting, Neon for PostgreSQL storage, ZITADEL for identity and
Resend for authentication email. Groq is the selected AI inference provider.
When AI assistance is enabled, the selected message question and approved FAQ
question choices can be processed by Groq; the implementation selects approved
business answers from MUSITU's stored knowledge. Provider usage metadata is
recorded for budget and review controls. Prior Groq qualification used synthetic
inputs; the full authenticated WhatsApp workflow is not yet qualified.

MUSITU AXIOM application transport remains unconnected; it is not currently a
qualified customer-data processor in this SaaS. No Mail Fabric integration is
enabled. The public notice must be updated before enabling additional processors.

Cross-border processing may occur. Exact provider regions, subprocessors,
contractual arrangements and applicable transfer requirements must be confirmed
before customer-data processing or any region-specific assurance is published.

### Storage, security and retention

The candidate uses encrypted message/recipient content, encrypted server-side
identity-session payloads, opaque browser session handles, restricted database
roles, tenant policies and MFA validation. Those measures do not amount to a
guarantee against every security incident. The existing QA-factor exposure is an
open staging acceptance issue and must be resolved before a security assurance.

Message records currently have a 30-day visibility deadline, and application reads
exclude expired message content. This is not a verified 30-day deletion policy.
Contact, audit, approval, suppression, booking, model-ledger and backup retention
must be separately defined. An encrypted manual recovery artifact and a retained
database snapshot exist; scheduled erasure/recovery is not yet qualified.

### Opt-outs and requests

The implementation records STOP/UNSUBSCRIBE and manual customer opt-outs to
suppress replies. Suppression records serve replay/safety purposes; opting out
does not itself erase all existing records. Genuine Meta opt-out acceptance is
still pending.

Proposed public request instructions: contact [approved privacy email], identify
the relevant business and request type, and allow a minimal ownership/identity
check. Do not request passwords, authenticator codes or API keys. Request routing
between the business and MUSITU, response deadlines, deletion scope and lawful
retention exceptions require operator approval and operational qualification.

## Proposed separate Meta data-deletion instructions page

The page should identify the same approved operator and privacy contact; explain
how a person requests deletion and verifies ownership; distinguish WhatsApp opt-out
from data erasure; describe approved retention/backups/exceptions; and provide a
request reference/response path. Do not claim automatic deletion, a production
callback, or a guaranteed deadline before the actual workflow is qualified.

## Current Meta blocker and publication boundary

The actual isolated app is Unpublished. Its setup page limits unpublished apps
to dashboard test webhooks, including withholding real admin/developer/tester
traffic. Messages is subscribed at v26.0; callback metadata was read without
revealing the masked verify token. The Publish page is disabled, and Basic settings
show both privacy-policy and data-deletion URLs empty. No setting was changed.

Publishing an approved public policy/instructions page and publishing the Meta app
are separate actions. Neither action is authorized by this draft or has been
performed. Keep SaaS SSO, test-only account/recipient boundaries and outbound gates.
See `evidence/20261020/meta-publication-readonly.json`.
