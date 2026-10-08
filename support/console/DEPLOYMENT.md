# MUSITU Axiom Support Console — Deployment Handoff

`production_authority: false`

This isolated branch is implementation-ready but **not authorized for production deployment**. The target operator hostname is planned as `support-ops.mftintelligence.com`; the template intentionally contains no Worker route or custom-domain declaration.

## Required release order

1. Obtain separate owner authorization for Support Console production integration and deployment.
2. Revalidate protected `main`, PR #1, frozen OpenAI blobs, and the Claude distribution branch before any write.
3. Create a dedicated Cloudflare Access application for `support-ops.mftintelligence.com` **before attaching the custom domain**. Admission must be restricted to approved human support operators. The Worker independently verifies the Access JWT, issuer, audience, expiry, signature and configured operator binding.
4. Bind the existing `musitu-axiom-support` D1 database only after the isolated schema migration has been dry-run, backed up, and verified. Bind `SUPPORT_DATA_KEY_B64` as a Worker secret; never place its value in Wrangler or GitHub.
5. Configure `SUPPORT_ACCESS_TEAM_DOMAIN`, `SUPPORT_ACCESS_AUD`, and `SUPPORT_OPERATOR_BINDINGS_JSON` from the approved Access application. Operator bindings map authenticated identities to bounded actor references/roles and are not case data.
6. Apply the conversation/governance schema migration. Verify existing case counts and hashes before and after migration.
7. Deploy the separate operator Worker with `workers.dev=false` and `preview_urls=false`; only then attach the exact custom domain `support-ops.mftintelligence.com`.
8. Run authenticated positive tests and unauthenticated/forged-token negative tests, verify customer recovery threads, assignment, internal notes, replies, state transitions, approval separation and metadata-only notification outbox.
9. Only after those gates pass may the console be declared operational.

## Deliberately absent authority

- No production route/custom domain is encoded in the template.
- No production-change executor is connected to approval records.
- No recovery code is available to operators.
- No bulk plaintext case export exists.
- Notification outbox records contain case/event metadata, not case narrative text.
- Public Official Support, frozen OpenAI submission, Claude distribution, main, and PR #1 remain outside this isolated build.

A separate explicit authorization is required to integrate or deploy this console.
