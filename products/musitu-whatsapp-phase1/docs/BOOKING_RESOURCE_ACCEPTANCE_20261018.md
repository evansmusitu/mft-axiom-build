# Named booking resources and owner knowledge acceptance — 18 October 2026

Phase 1 remains **INCOMPLETE**. This continuation closes the resource-selection gap recorded in `ZITADEL_OWNER_ACCEPTANCE_20261018.md`; it does not attest the full release matrix.

## Change and validation

Previously, creating a resource succeeded but exposed no usable identifier in the booking form, requiring an operator database lookup. The booking view now reads bookings and named resources together through the existing authenticated tenant endpoints. A native required selector supplies the resource identifier. No API permissions, identity checks, schema, provider configuration or booking-conflict rules changed.

Both reads must succeed and match the requested tenant before anything is published to the view. Malformed/duplicate resource identifiers and invalid labels are rejected. Existing request-generation checks discard late replies. Business/view changes, new loads, logout and access denial clear resources and selection. Reservation is disabled until an opened business has a selected resource. Resource creation refreshes the choices.

Fresh local checks: **278/278 tests**, syntax for **124 MJS files**, optimized Next build PASS. Four focused contract tests cover matching resources, denied/unavailable reads without partial publication, either foreign-tenant response, and malformed/duplicate resources. These are synthetic HTTP-boundary tests, separate from the browser evidence below. The prior gap is demonstrated by the retained genuine owner acceptance requiring operator lookup; no artificial red-test claim is made.

Runtime source `4ffd3f2163c5eac9998ec5a453963d96c4fb7306` is READY on private staging deployment `dpl_EXTsUtoBdMdjVDFsoYs1M3ftrw53`. The explicit product root, Node24 and normal PostgreSQL qualification plus Next build are preserved. SSO remains enabled on all deployments and `live=false`.

The hosted PostgreSQL report was independently retrieved: run `aae54dd0-d596-47e7-8f96-3abdd7ed6c39`, **26 passed, zero failed**, REAL_POSTGRES_SYNTHETIC_MESSAGES_NO_META_NO_IDP. No provider/model/message sends occur in that suite.

## Genuine desktop browser acceptance

The existing administrator completed a fresh username/password/TOTP challenge through secure entry. Real application authentication admitted protected reads and commands in synthetic tenant `f7453f47-9790-4ae9-8661-61ea8cad9300`.

1. Opened Bookings and loaded the existing named resource. Create/reserve controls were disabled before an owned view was loaded; reservation stayed disabled without selection.
2. Created “Synthetic selector acceptance resource 20261018” through the UI. It appeared as an option. Selected it **by label only**, entered 2027-01-02 10:00–10:30 Harare, and reserved successfully. No operator query or manually copied UUID was needed for this workflow.
3. Re-selected the same name and submitted a new operation for the occupied slot. The UI denied it with “This action conflicts with an existing record.” Independent scoped SQL confirms resource `3c5bcbb2-0c1c-41a1-87d9-3ec8c3b3815e` has **exactly one CONFIRMED booking**, 08:00–08:30 UTC. The tenant has two bookings total, including the prior fixture on January1.
4. After full canonical app navigation, reopened Bookings and read back both appointments and both named resources. An unexpected navigation to provider Loginname occurred during the first screenshot attempt; returning to the canonical app restored the existing authenticated view. That login screenshot is not product/mobile acceptance proof. A later inspected screenshot shows the actual persisted booking view and selector.
5. Changing the business identifier immediately removed the previous records/options and disabled reservation. Opening foreign tenant `00000000-0000-4000-8000-00000000000a` was denied with zero booking articles and no retained resource choices. Restoring the owned tenant returned both bookings and resources, separating membership denial from a general auth/transport failure.
6. In Knowledge, saved the synthetic approved question “What is this private acceptance resource?” and its synthetic-only answer after checking explicit approval. UI readback and independent SQL confirm source `faf1d623-0afe-4092-a274-c1dfc06a2032`. Audit displayed KNOWLEDGE_APPROVED at15:38:36.721 UTC and the resource addition at15:34:13.954 UTC. No AI policy was enabled and no model was called.

The first independent booking readback used incorrect timestamp column names and failed without mutation; the corrected schema-based query succeeded. No failure was converted into acceptance.

## Meta and remaining gates

The existing MUSITU AI Employee Dev app `1096094346481018` was inspected read-only and remains Unpublished. Its existing test WABA/phone IDs are unchanged. No token was generated or exported; Send message/Check test webhooks were not invoked. At15:42:33.973 UTC, the dedicated synthetic Meta tenant `986eb904-7296-46a9-9e9b-94074db9b547` still has its one VERIFIED test-channel mapping but **zero accepted inbound events, zero accepted status events and zero persisted messages**. Do not map this channel again to the owner QA tenant or count dashboard samples as genuine delivery. Meta end-to-end remains unqualified.

Separate actual staff identity/roles, provider revocation/old-JWT reuse/JWKS, mobile/desktop matrix breadth, genuine Meta inbound/development delivery/receipts, full authenticated governed AI and authorized AXIOM transport, expiring Groq replacement, operations schedules/alerts/full recovery/second custodian and independent approval remain open. No new staff access was granted in this continuation.

The local release gate freshly remains PHASE1_RELEASE_BLOCKED (exit2). Its inherited broad attestations are not automatically updated by dated sub-check evidence; no release attestation was changed. Main, production AXIOM, MAIL FABRIC, FMI, Meta receiver/subscriptions, original database mappings, AI UNKNOWN/quota/idempotency evidence and disabled fixture policies are preserved. No public launch, unsolicited messages, customer imports, Meta sends, model requests, charges or paid upgrades.

Evidence: `evidence/20261018/booking-resource-browser-acceptance.json`, `booking-resource-postgres-qualification.json`, and `booking-resources-{tests,syntax,build,release-gate}.log`.
