# Official support threat model

## Assets

Customer identity, case narrative, quantitative inputs and results, evidence references, entitlement and billing context, security disclosures, privacy requests, incident information, recovery credentials, and the append-only audit chain.

## Trust boundaries

1. Public browser to edge intake.
2. Edge intake to Cloudflare Turnstile Siteverify.
3. Worker to envelope-encrypted D1 storage.
4. Customer recovery credential to case read boundary.
5. Staff identity/policy plane to any sensitive operation executor.
6. Support evidence to product, provider, privacy, security, billing, and incident teams.

## Primary threats and controls

| Threat | Control | Remaining deployment proof |
|---|---|---|
| Credential or payment-secret submission | Client and server inspection; reject before storage; never return matched value | Live negative probes and log review |
| Case enumeration | Non-sequential case IDs; recovery credential required; indistinguishable 404 | Edge penetration test |
| Recovery-code theft | Shown once; only hash stored; no URL query credential | Browser and observability review |
| Narrative disclosure | AES-256-GCM envelope encryption with case-bound AAD | Secret provisioning and key-rotation drill |
| Tampering or silent deletion | Append-only event table and SHA-256 chain | Restore and independent verification drill |
| Forged priority | Server-derived impact model | Abuse corpus evaluation |
| Prompt injection in customer content | Content remains data-only; no instruction authority; no automatic actions | Agent/triage red-team test |
| Support-agent overreach | Sensitive-action matrix; customer verification; independent approval; scoped executor | Staff identity and policy integration |
| Public status misinformation | Verified incident evidence required before public update | Incident-command integration |
| PII overcollection | No raw contact fields; opaque requester reference; bounded fields | Data-flow review |
| Abuse and denial of service | Turnstile token verified server-side; hostname/action binding; single-use short-lived proof; size limits | Live negative probes and rate-limit evidence |
| Accessibility exclusion | Semantic form, keyboard flow, live regions, high contrast, reduced motion, responsive layout | Automated scan and real-device/user testing |

## Explicit non-authority

The support hostname and mailbox are owner-approved, but human role identities remain deployment prerequisites. The current branch does not invent staff identities, expose secrets, claim live DNS or mail delivery, authorize refunds or account changes, publish incident claims, promise an SLA, or alter any OpenAI/Claude production surface.
