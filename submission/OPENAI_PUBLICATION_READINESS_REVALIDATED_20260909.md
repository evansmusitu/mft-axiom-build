# MUSITU Axiom — OpenAI Publication Readiness Revalidation

Status date: 2026-09-09

This record revalidates the automated publication-readiness evidence for the existing execution packet at `submission/OPENAI_PUBLICATION_EXECUTION_PACKET.md`. It supersedes older automated readiness/reviewer references in that packet where newer verified evidence is listed below. All portal instructions, security boundaries, private reviewer-credential handling, domain-challenge handling, country-selection requirements, and post-approval publication rules remain unchanged.

## Current verified public contract

- Public MCP tools: `108`
- Certified mapped runtime operations: `74`
- Business-facing quantitative products: `30`
- Positive review tests: `5`
- Negative review tests: `3`
- Submission JSON SHA-256: `e54351fac1c140da8dc4f463795a281eeb9c9ee61e804a0a993ea82a8e7f5e0d`
- Production admission: `PASS`
- Real-money E2E: certified
- `WOLFRAM_PARITY=NOT_CERTIFIED`
- `SUPERIORITY=NOT_CERTIFIED`

The four commerce tools below remain forbidden from the public ChatGPT surface:

- `musitu_axiom_plans`
- `musitu_axiom_recommend_plan`
- `musitu_axiom_start_checkout`
- `musitu_axiom_checkout_status`

## Automated submission-readiness gate

Latest sealed readiness evidence generated before the reviewer-gate alignment:

- Gate: `MUSITU_AXIOM_OPENAI_SUBMISSION_AUTOMATION_PASS`
- Verified branch commit: `ba6cd72ec712c6a49b529e0d37b968f0ab701386`
- GitHub Actions run: `34338194208`
- Job: `102422474762`
- Conclusion: `success`
- Evidence SHA-256: `dff005045437bc6ae31a3c52a0de9f8823ac6b36833f68615270ee2f902bac19`
- Directory state: `NOT_SUBMITTED`

The readiness verifier now validates the official `$schema` used by `chatgpt-app-submission.json`, uses semantic OAuth UserInfo source checks rather than formatting-sensitive matches, and binds live MCP health to the version declared by committed source. Current MCP source/server version is `4.0.1`.

## Fresh production OIDC / enterprise-identity proof

A fresh production rerun on 2026-09-09 proved the identity contract that OpenAI documents for enterprise workspace domain restrictions:

- Gate: `MUSITU_AXIOM_OIDC_DOMAIN_RESTRICTIONS_PASS`
- GitHub Actions run: `34331655679`, rerun attempt `2`
- Job: `102436078814`
- Conclusion: `success`
- OIDC discovery: live
- `openid` scope: enabled and advertised
- `email` scope: enabled and advertised
- UserInfo endpoint: live
- UserInfo verified email: `true`
- PKCE: `S256`
- ID-token signing: `RS256`
- JWKS: live, public-only
- Refresh rotation: proven
- Revocation: fail-closed
- Secret publication: none

This proves the production authorization server satisfies the documented identity requirements. A yellow OpenAI Platform enterprise-domain warning that remains after this proof must be resolved by making the existing OpenAI draft/connection re-discover and reauthorize the current identity configuration; it must not be hidden by weakening or removing OIDC.

## Fresh dedicated reviewer-account proof

The reviewer readiness verifier was aligned to the current mobile-safe production callback instead of the obsolete 302/303-only expectation and rerun against the persistent dedicated reviewer account.

- Gate: `MUSITU_AXIOM_OPENAI_REVIEWER_DEMO_READY`
- Verified branch commit: `08264ddcca3698e4455af7d65117c96176f1041e`
- GitHub Actions run: `34343192374`
- Job: `102438560795`
- Conclusion: `success`
- Evidence schema: `musitu.axiom.openai_reviewer_demo_readiness.v2`
- Evidence SHA-256: `9bfb24857c0776bcdcf11ce833723be7522752f0747f1b5b4e565a4f6c0ef39e`
- Reviewer credential persistent: `true`
- Reviewer credential expires: `false`
- MFA/SMS/email-confirmation/private-network requirement: `false`
- Mobile-safe HTTP 200 callback handoff: proven
- Requested scopes: `openid email axiom.execute`
- ID token present: `true`
- UserInfo verified: `true`
- Public mapped operation count: `74`
- Business product count: `30`
- Positive tests passed: `5`
- Negative-test contracts: `3`
- Revocation fail-closed: `true`
- Reviewer credential published: `false`
- OAuth tokens published: `false`

The private reviewer credential must still be entered only in OpenAI's private reviewer credential field. It must never be committed, logged, included in the submission ZIP, or pasted into chat.

## Defects eliminated during revalidation

The publication verification fabric was corrected without weakening any product or security requirement:

1. Reviewer portal material recognizes `PROVISIONED_PERSISTENT_PRIVATE_PORTAL_CREDENTIAL_REQUIRED`: the account exists and is verified, but its secret remains portal-only.
2. OAuth UserInfo source checks are semantic and whitespace-tolerant rather than brittle string-format checks.
3. The submission contract validates the official `$schema` URI in the sealed submission JSON.
4. Live MCP health is bound to the version declared by committed MCP source rather than a stale hard-coded version.
5. The reviewer verifier now tests the production HTTP 200 mobile-safe callback document, exact registered ChatGPT callback, state, one-time authorization code, PKCE token exchange, OIDC identity, five positive cases, and revocation instead of requiring the obsolete server-side redirect response.

These changes do not expand the public tool surface, expose commerce tools, relax OAuth, alter the sealed submission JSON, publish secrets, or claim OpenAI submission/publication.

## Supporting sealed evidence retained

- Public Plugin v4 evidence SHA-256: `dfb4b615adf612b32c09db64c66eafc71b991f192326993a9c31a4115f6d3935`
- OAuth UserInfo v2 evidence SHA-256: `55af99a2b0cc7ed9f61a6d0a9590ee42effc1e7a223a6f73c0f7b27e364b316a`

## Remaining portal-only actions

Repository automation cannot truthfully mark these complete without direct authenticated OpenAI Platform evidence or publisher-controlled secret entry:

1. `PUBLISHER_IDENTITY_VERIFICATION_OR_CONFIRMATION`
2. `OPENAI_DOMAIN_CHALLENGE_CONFIRMATION_IF_PORTAL_REQUIRES_IT`
3. `PRIVATE_REVIEWER_DEMO_CREDENTIAL_ENTRY`
4. `COUNTRY_AVAILABILITY_SELECTION`
5. `ENTERPRISE_IDENTITY_REDISCOVERY_OR_REAUTHORIZATION_IF_WARNING_REMAINS`
6. `FINAL_SUBMIT_AND_PUBLISH_AFTER_APPROVAL`

`Submit for Review` and `Publish` remain separate events. Do not claim submitted, approved, or published without direct OpenAI Platform evidence.

## Protected repository state

- Working branch: `frontier/axiom-v5-skill-fabric`
- Sealed `main` must remain exactly `d6a846f6bbe0bccac1758713eb4de167caf07113`.
- PR #1 must remain draft and unmerged unless explicit authorization changes that rule.

This revalidation record contains no reviewer secret, OAuth token, OpenAI domain challenge token, or other publication credential.
