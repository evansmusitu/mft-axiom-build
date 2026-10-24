# MUSITU Phase 1 — 16 October 2026

Phase 1 remains **INCOMPLETE / PRIVATE STAGING ONLY**. Original v1.7 ZIP provenance, its full manifest and 196-test baseline remain preserved. Protected AXIOM main and all unrelated products are unchanged.

## Confirmed this session

- Groq signed-in account: Free ($0), GPT-OSS 20B account limits verified; Inference APIs Zero Data Retention enabled. No payment method or upgrade added. The user created the dedicated staging credential; encrypted Preview storage only in the protected SaaS project. Observed key expiry is **Never**; the prepared seven-day selection did not carry into the resulting key. The available edit dialog changes the label only. No key rotation/deletion performed.
- Genuine model qualification: **5/5** synthetic-only cases passed, including prompt injection, unknown facts and Shona. Run `d82792fc-54ee-4a7f-92e2-8d2ea5e068e5`, 1,541 reported tokens.
- Governed tenant AI workflow added: owner opt-in; message retrieval from the encrypted tenant ledger; approved FAQ-only selection; a committed reservation before network access; up to five daily reservations per tenant; one unfinished request at a time; replay denial; durable UNKNOWN state; online session recheck and locked membership recheck before persistence; source-change, opt-out and handover checks; human approval for every saved draft. There is no model-to-Meta send path.
- Migration 014: 24 statements passed a deliberate rollback rehearsal, independent read proved objects absent, then the migration committed in the isolated Neon database. Runtime remains non-owner/NOSUPERUSER/NOBYPASSRLS. **21 business relations** now have exact FORCE-RLS tenant policies. The two new ledgers are SELECT-only for runtime; command functions belong to the constrained non-login role.
- Workflow qualification: **14/14 real PostgreSQL checks** passed. Exactly **one additional real Groq call** read a synthetic encrypted message and persisted an approved-source draft with mandatory human approval and 324 reported tokens. Replay during the live request, concurrent replay afterward and a new connection pool caused no additional calls. Revocation, changed knowledge, foreign source, invalid usage, quota toggling and STOP denial passed in actual PostgreSQL. The 429 transport was injected and is explicitly labelled; identity callbacks were synthetic, not OIDC authentication. The unknown result remains in the synthetic tenant ledger, and both fixture policies are disabled, independently read back using the restricted login.
- Current code commit: `cf0fa19f29ec34b77e52a95f53c67b15fac091c6`. Protected workflow deployment: `dpl_JBBBfBbNgp8VeteWsiKH4HxQHWnz`, READY, `https://musitu-whatsapp-phase1-private-20261014-h6abr8ij3-evansmusitu.vercel.app`. This one-off build ran the workflow qualifier and Next build. Normal project build restored to PostgreSQL qualification plus Next build, without live model calls.
- Receiver import closure regenerated for the expanded tenant-policy matrix. New callback deployment `dpl_FZRNPcaRv4GMrmyBqYdfhYBMZT5s`. Meta app subscription changed only from its exact verified former callback to `https://musitu-whatsapp-meta-receiver-20261015-ad7qjgbm7-evansmusitu.vercel.app/api/meta/webhook`. Genuine Meta verification and independent Graph readback matched, active with `messages`; run `86cda95a-4337-4f9d-a5e7-c0d975662c4c`. App remains unpublished; WABA subscriptions and all unrelated app objects unchanged. No messages sent.
- Local tests **241/241**, optimized Next build passed. Initial stale receiver-bundle failure was retained, regenerated and corrected. Source manifest currently 349 files. Chromium rendered the new AI permission form and confirmed business access remains disabled without OIDC. This is UI rendering/access-boundary evidence, not authenticated business acceptance.

## Evidence scope

Six actual Groq requests total this session: 1,562 reported input + 303 output = **1,865 reported tokens**. This is not an invoice or account balance verification. No customer data or WhatsApp sends. Model selection cannot supply generated response text; the server persists the approved database answer. Paraphrase classification from the transport test does not authorize sending.

The workflow stores per-tenant reservations and usage durably. It is not a global multi-provider billing system. An uncertain reservation blocks that tenant until operator investigation; there is intentionally no timeout-based retry. Existing suppression cannot be bypassed by toggling AI permission.

## Remaining acceptance blockers

1. No live isolated Keycloak host/realm/client/users: browser owner/staff login, issuer/audience/JWKS rotation, live introspection/revocation and logout acceptance remain unqualified. Do not replace this with hosting SSO or synthetic identity callbacks. The prior browser login URL-policy block was not bypassed.
2. Meta unpublished app permits dashboard synthetic fixtures only according to its UI. Genuine bound inbound admission, development outbound send/delivery receipts and complete WhatsApp E2E are unverified. The app was not published to bypass that boundary.
3. AXIOM has a genuine arithmetic connector result, but no authorized SaaS service identity/transport is configured. No production AXIOM runtime was modified.
4. Full authenticated dashboard/mobile acceptance, owner/staff onboarding, human inbox decisions and integrated business acceptance remain open.
5. Recovery checkpoint predates migration 014. Offsite encrypted backup, key escrow, scheduled recovery, actual database restart with the new AI ledger, alerts/on-call and independent security review remain unqualified. New-pool recovery is not a database restart.
6. The user-created Groq key has no expiry. Do not represent it as the initially proposed seven-day key. Restrict it to encrypted private staging and arrange a user-approved expiring replacement before release.

No public launch, production-readiness declaration, branch merge, paid upgrade or financial charge was authorized or performed.

## Final regression deployment

Normal PostgreSQL qualification plus Next build passed from the same code commit, deployment `dpl_DQDmNuAVaBfU1eGAp3eWkgoML8iE`, `https://musitu-whatsapp-phase1-private-20261014-rmjopo4jl-evansmusitu.vercel.app`. Run `a6c399b0-4d70-48aa-9823-736b60fb869e` at 05:38 UTC: **26 passed, zero failed**, now covering all 21 business tables. No model calls in this build. Hosting SSO remains enabled for all dashboard deployments. The separate receiver has only its signed webhook boundary and no sending/model capability.

## Identity hosting continuation

No editable Replit app matched Keycloak. Phase Two's current hosting page lists a 30-day trial followed by paid hosting; do not rely on its older free-realm blog as evidence of a current permanent free account. Cloud-IAM documents a Freemium Keycloak realm (100 users, one realm, Keycloak API) and its tutorial says the Freemium path skips payment. Its billing FAQ describes one month without commitment; lifetime/renewal availability must be checked in the real console before provisioning. No paid plan, payment details or subscription conversion may be accepted. Use synthetic users only; Freemium has no backup/SLA and is for qualification, not release.

Primary pages checked 16 October: https://phasetwo.io/pricing/hosting/ ; https://documentation.cloud-iam.com/faq/plan.html ; https://documentation.cloud-iam.com/get-started/complete-tutorial.html ; https://documentation.cloud-iam.com/faq/billing.html ; https://www.cloud-iam.com/pricing .

The inherited local `release:gate` still exits 2 with `PHASE1_RELEASE_BLOCKED`. It reads explicit release attestations and does not discover hosted evidence automatically. Its broad unresolved gates are retained; current model/build/database sub-results above do not constitute an overall release approval.
