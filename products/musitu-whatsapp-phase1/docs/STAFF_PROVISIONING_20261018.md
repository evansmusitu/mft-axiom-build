# Approved QA staff provisioning — 18 October 2026

Phase 1 remains **INCOMPLETE**. The user explicitly approved the named QA identity, owner-controlled address and AGENT-only membership in the synthetic QA business, with authentication deferred.

## Actual provider creation

Created `musitu-phase1-staff-qa` (MUSITU Phase1 QA Staff) in the existing isolated EU ZITADEL instance. The actual profile confirms provider user ID `395706056631686016`, Active, created at22:26 Harare. Contact details are omitted from repository evidence. Email Verified remained unchecked, and Setup authentication later was selected. No initial password, invitation, registration link or organization/instance administrator role was created by the agent. The provider security page shows no passkey/device and no additional factors; its password asterisks are a generic UI display, not evidence that a usable password was set.

The first Create submission encountered an expired administrator authorization token. Its outcome was treated as unknown. Normal Login refreshed authorization; an independent Users read showed one existing administrator and zero QA matches before a single resubmission. The resulting QA profile was then verified. No blind duplicate creation was attempted.

## Actual approved membership

Preflight confirmed the exact synthetic tenant `f7453f47-9790-4ae9-8661-61ea8cad9300`, MUSITU Phase1 Synthetic Owner QA 20261018, was ACTIVE with one active owner and no membership for the new QA ID.

Using the original isolated database and an explicit tenant context, the existing `musitu.add_staff` command added `395706056631686016` with **AGENT** role. The command checks an active OWNER against an active tenant and writes its own audit event. No direct membership insert, role/schema change or owner/admin elevation was used. The operation was explicitly authorized; it is **operator provisioning**, not proof of an owner UI enrollment workflow.

A separate transaction independently read back ACTIVE/AGENT for that ID and a single MEMBER_ADDED audit event at2026-10-18T20:28:08.425Z. The provider ID uses the application's existing raw signed-sub membership convention by source inspection; no staff JWT has yet been issued or qualified.

## Exact remaining boundary

The staff user still needs user-controlled password creation, email verification if requested, and authenticator enrollment. Do not mark an unverified email verified, generate/export a setup seed, request new credentials in chat or send initialization mail without authorization. Credential creation/confirmation/submission must be performed privately by the user. The agent may prepare the existing provider's password setup page and hand over control before any new credential is entered.

Only after setup can real staff sign-in, signed claims/session verification, AGENT permissions, denied owner-only actions, cross-tenant denial, immediate membership/provider revocation and old-JWT reuse be qualified. Existing synthetic role tests and the new database grant do not satisfy that acceptance.

No runtime source changed for this provisioning record; the prior278-test/124-syntax/optimized-build results are retained without a ceremonial rerun. Source manifest is updated for this document. Protected main, production AXIOM, MAIL FABRIC, FMI, Meta receiver/mappings and existing AI policies/UNKNOWN records are unchanged. No customer imports, provider sends, model requests, charges or paid upgrades.

Evidence: `evidence/20261018/approved-staff-provisioning.json`. Earlier accepted workflows: `BOOKING_RESOURCE_ACCEPTANCE_20261018.md` and `ZITADEL_OWNER_ACCEPTANCE_20261018.md`.
