# MUSITU Axiom — OpenAI Public Plugin Publication Execution Packet

Status date: 2026-09-06

## 1. Authoritative state

MUSITU Axiom is production-admitted and its public ChatGPT/Plugin distribution surface is automation-ready, but it has **not** been submitted to or published in the universal OpenAI Plugins Directory.

Highest automated gate:

- Gate: `MUSITU_AXIOM_OPENAI_SUBMISSION_AUTOMATION_PASS`
- GitHub Actions run: `34015027121`
- Job: `101437203176`
- Evidence SHA-256: `764b07286345c2f59cd44f1a0b55df93e0ddc97dd877b9d0df241a7f76686e2e`
- Directory state: `NOT_SUBMITTED`
- Public MCP tools: `108`
- Certified mapped runtime operations: `74`
- Business-facing quantitative products: `30`
- Positive review tests: `5`
- Negative review tests: `3`
- Real-money E2E: certified
- Production admission: PASS
- `WOLFRAM_PARITY=NOT_CERTIFIED`
- `SUPERIORITY=NOT_CERTIFIED`

Additional sealed gates:

- Public Plugin v4 evidence: `dfb4b615adf612b32c09db64c66eafc71b991f192326993a9c31a4115f6d3935`
- OAuth UserInfo v2 evidence: `55af99a2b0cc7ed9f61a6d0a9590ee42effc1e7a223a6f73c0f7b27e364b316a`
- Public HTML docs evidence: `4018c0b58a0afe8004d1360ce5263cdb067200833c3fe64cd71b6af6fc71240b`
- Current submission import JSON SHA-256: `e54351fac1c140da8dc4f463795a281eeb9c9ee61e804a0a993ea82a8e7f5e0d`

Do not claim OpenAI submission, approval, verification, directory publication, Wolfram parity, or superiority unless a later sealed gate proves it.

## 2. Official OpenAI entry points

Current public submission documentation:

- `https://developers.openai.com/plugins/deploy/submission`

OpenAI Plugin submission portal:

- `https://platform.openai.com/plugins`

OpenAI organization role settings:

- `https://platform.openai.com/settings/organization/people/roles`

OpenAI organization settings / publisher verification:

- `https://platform.openai.com/settings/organization/general`

OpenAI currently requires the submitter to have **Apps Management: Write** in the publishing organization. Organization owners already have the required submission permission. Every public submission must select a verified developer or business identity.

## 3. Create the draft

In `https://platform.openai.com/plugins`:

1. Select the OpenAI organization that will own the public MUSITU Axiom listing.
2. Confirm the submitting identity has `Apps Management: Write`.
3. Confirm the developer/business identity is verified in the same organization.
4. Select **Create plugin**.
5. Choose **With MCP**.
6. Save as a draft until every item in this packet is complete.

MUSITU Axiom is an MCP-only public submission in this version; custom UI resources are not exposed.

## 4. Info tab — exact production values

Use these values; do not rename the product or substitute the unrelated public plugin named “Axiom”.

- Plugin name: `MUSITU Axiom`
- Subtitle: `Quantitative analysis`
- Category: `FINANCE`
- Logo source in repository: `branding/musitu-axiom-app-icon.svg`
- Website: `https://mcp.mftintelligence.com/docs`
- Support: `https://github.com/evansmusitu/mft-axiom-build/issues`
- Privacy policy: `https://mcp.mftintelligence.com/privacy`
- Terms of use: `https://mcp.mftintelligence.com/terms`

Short description:

> Run quantitative finance, statistics, optimization, time-series, verification, and mathematical calculations through MUSITU Axiom in ChatGPT.

Long description:

> MUSITU Axiom gives ChatGPT users access to a production quantitative runtime for finance, statistics, optimization, time-series analysis, verification, and mathematical computation. Users connect an existing MUSITU Axiom account through OAuth. The public ChatGPT surface does not place investment trades, transfer money, or initiate digital-subscription checkout.

Developer Identity must be selected from the identity actually verified by the publisher in OpenAI Platform. Do not fabricate or mismatch a company identity.

## 5. MCP tab — exact server and authentication values

- MCP URL type: `Universal`
- Production MCP Server URL: `https://mcp.mftintelligence.com/mcp`
- OAuth issuer: `https://auth.mftintelligence.com`
- OAuth protected-resource metadata: `https://mcp.mftintelligence.com/.well-known/oauth-protected-resource`
- OAuth authorization-server metadata: `https://auth.mftintelligence.com/.well-known/oauth-authorization-server`
- UserInfo endpoint: `https://auth.mftintelligence.com/oauth/userinfo`
- Execution scope: `axiom.execute`
- Identity scopes: `openid email`
- Dynamic client registration: enabled
- PKCE: `S256`

Security boundary already proven:

- `openid email` alone does not authorize compute.
- `axiom.execute` is required for Axiom execution.
- UserInfo returns verified email only when an explicit MUSITU email-verification record exists.
- Legacy `axiom.execute` remains compatible.
- OAuth refresh/revocation remains fail-closed.
- Public Plugin surface does not expose subscription checkout tools, execute investment trades, or transfer money.

## 6. Domain verification — secret-safe procedure

OpenAI requires MCP-host control verification. When the Plugin portal displays **Domain not verified**, it generates an exact token that must be returned alone from:

`https://mcp.mftintelligence.com/.well-known/openai-apps-challenge`

The Worker route is already implemented. The portal token is intentionally **not** stored in this repository.

Never paste the OpenAI challenge token into source code, a commit message, an issue, an artifact, or a public chat.

Secret-safe install procedure:

1. Copy the exact token from the OpenAI submission portal.
2. In GitHub, open repository `evansmusitu/mft-axiom-build` → **Settings** → **Secrets and variables** → **Actions**.
3. Create/update repository secret named exactly `OPENAI_APPS_CHALLENGE` with the portal token as its value.
4. Open Actions workflow `.github/workflows/axiom-openai-domain-challenge-install.yml` (`MUSITU Axiom OpenAI Domain Challenge Installer`).
5. Run it manually with **Run workflow**.
6. Require logical gate `MUSITU_AXIOM_OPENAI_DOMAIN_CHALLENGE_PASS` before returning to the portal.
7. The installer writes the token to Cloudflare using the encrypted Worker Secrets API, reads back only binding metadata, and verifies that the public challenge endpoint byte-matches the secret. It never includes the token in its evidence artifact.
8. Return to OpenAI Platform and complete Domain verification.

Current installer readiness source commit: `ed15b69670ac7dbff836511cda30834b452f417b`.

Until the portal issues a token, domain verification remains `PORTAL_TOKEN_REQUIRED` and must not be claimed complete.

### Challenge preservation rule

Once the OpenAI challenge secret is installed, do not run an older direct-upload MCP workflow during submission/review unless that deploy path explicitly preserves `secret_text` bindings or the challenge is reinstalled and reverified immediately afterward. Keep the challenge stable through review unless OpenAI instructs otherwise.

## 7. Scan Tools

After MCP URL, OAuth, and domain verification are accepted:

1. Select **Scan Tools**.
2. Require exactly `108` public tools.
3. Require `74` unique mapped Axiom operations.
4. Require `30` business-facing quantitative products.
5. Confirm these commerce tools are not in the public scan:
   - `musitu_axiom_plans`
   - `musitu_axiom_recommend_plan`
   - `musitu_axiom_start_checkout`
   - `musitu_axiom_checkout_status`
6. Confirm every scanned tool has explicit `readOnlyHint`, `openWorldHint`, and `destructiveHint` values.
7. Confirm all `108` tools have output schemas.
8. Do not accept scan output that exposes auth credentials, debug payloads, internal secrets, raw Modal endpoints, or unnecessary personal data.
9. If OpenAI reports a metadata problem, fix production source, redeploy through a proven path, rerun the applicable gate, then **Scan Tools** again. Do not override a true scanner finding with listing copy.

Submission import file: `chatgpt-app-submission.json`.

Its sealed SHA-256 must remain:

`e54351fac1c140da8dc4f463795a281eeb9c9ee61e804a0a993ea82a8e7f5e0d`

If the file changes, regenerate and reseal the submission package before using it.

## 8. Starter prompts

Use these five production prompts:

1. `Use MUSITU Axiom to analyze this time series for trend, volatility, and structural changes.`
2. `Use MUSITU Axiom to solve this constrained optimization problem and explain the optimum.`
3. `Use MUSITU Axiom to compare Monte Carlo and closed-form results for this quantitative model.`
4. `Use MUSITU Axiom to verify this quantitative result independently and show the calculation.`
5. `Use MUSITU Axiom to evaluate the risk and return characteristics of these cash flows.`

## 9. Testing tab

Import/use the exact five positive and three negative test cases in `chatgpt-app-submission.json`.

Reviewer authentication requirement:

- Provide a dedicated MUSITU reviewer/demo account credential privately in the OpenAI portal.
- The demo credential must execute every submitted positive authenticated test without MFA, SMS, email confirmation, or private-network access.
- Do **not** commit or publish that credential.
- Do **not** reuse a production customer’s raw credential for review.

Current state: `PRIVATE_PORTAL_CREDENTIAL_REQUIRED`.

No reviewer credential is claimed to exist until it has been provisioned and safely entered into OpenAI Platform.

## 10. Global tab

OpenAI requires the publisher to choose countries/regions where the plugin should be available.

Current state: `PORTAL_SELECTION_REQUIRED`.

Select only jurisdictions where the publisher identity, MUSITU product availability, support process, and legal terms are ready. This packet intentionally makes no worldwide-availability claim and does not select countries on the publisher’s behalf.

## 11. Release notes

Use:

> Initial public MUSITU Axiom ChatGPT submission: 108 public tools backed by 74 certified runtime operations and 30 business-facing quantitative products; OAuth 2.1 account linking with PKCE, refresh/revocation, UserInfo support for explicitly verified email identities, metered execution for existing entitled accounts, response minimization, and no digital-subscription commerce on the public ChatGPT surface.

## 12. Final policy and submission gate

Before selecting **Submit for Review**, require all of the following:

- Apps Management: Write is confirmed for the submitter.
- Publisher/developer identity is verified and selected.
- Info-tab values match this packet.
- Universal MCP URL is exact.
- OAuth connection succeeds with the dedicated reviewer credential.
- `MUSITU_AXIOM_OPENAI_DOMAIN_CHALLENGE_PASS` is sealed after OpenAI issues its token.
- Scan Tools passes against the current live MCP surface.
- 108 tools / 74 operations / 30 business products remain exact unless a deliberately reviewed new version has been resealed.
- Five positive and three negative test cases are present.
- Country availability is deliberately selected by the publisher.
- Release notes are current.
- Required policy attestations are reviewed by the publisher and are truthful.
- `WOLFRAM_PARITY=NOT_CERTIFIED` remains visible internally unless separately certified.
- `SUPERIORITY=NOT_CERTIFIED` remains visible internally unless separately certified.

Then select **Submit for Review**.

Submission starts OpenAI review; it does **not** publish MUSITU Axiom immediately.

## 13. After OpenAI approval

Only after OpenAI reports the submission approved:

1. Recheck production MCP health, OAuth health, legal/support pages, and domain challenge.
2. Confirm the approved snapshot corresponds to the intended MUSITU Axiom version.
3. Select **Publish** in OpenAI Platform.
4. Verify that `MUSITU Axiom` appears in the universal Plugins Directory.
5. Install the published plugin into a clean eligible account and connect OAuth.
6. Verify literal invocation in ChatGPT using `@MUSITU Axiom` when that surface exposes @-mention invocation.
7. Seal a new post-publication evidence gate containing the OpenAI listing identity/version and real end-user invocation proof.

Do not call the project publicly published until steps 3–6 have actually occurred.

## 14. Remaining non-automated blockers

At the time this packet was sealed, the only public-publication actions requiring the OpenAI portal or publisher-controlled secret entry are:

1. `PUBLISHER_IDENTITY_VERIFICATION`
2. `OPENAI_DOMAIN_CHALLENGE_TOKEN`
3. `PRIVATE_REVIEWER_DEMO_CREDENTIAL_ENTRY`
4. `COUNTRY_AVAILABILITY_SELECTION`
5. `FINAL_SUBMIT_AND_PUBLISH_AFTER_APPROVAL`

All other current submission materials are prepared and the automated submission-readiness gate is PASS.
