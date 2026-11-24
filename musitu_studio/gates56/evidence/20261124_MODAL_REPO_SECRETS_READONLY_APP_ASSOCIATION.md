# MUSITU Studio Gate 5 — Modal repository-secret account association proof

UTC date: 2026-11-24. Classification: PRIVATE PRODUCT ENGINEERING RECORD,
PUBLIC SOURCE WITHOUT SECRETS, ACCOUNT IDENTIFIERS OR BILLING AMOUNTS.

## Owner direction

Use the already configured `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET` GitHub
Actions secrets from repository `evansmusitu/mft-axiom-build`. Do not request
raw tokens from the owner and do not print or copy them into source artifacts.

## Fresh verified live read-only evidence

- GitHub Actions run:
  https://github.com/evansmusitu/mft-axiom-build/actions/runs/45451042484
- Isolated workflow:
  `.github/workflows/studio-g56-modal-repo-secrets-inventory-20261124.yml`
- Run head:
  `bb11ba70e4d0ce7fc532a8661ebb399fb23db793`
- Result: **SUCCESS**.
- Authenticated Modal Python SDK `Workspace.from_context().hydrate()`: **TRUE**.
- Authenticated workspace billing summary readback: **TRUE**.
- Existing app `musitu-studio-v02` readable under those repo credentials:
  **TRUE**.
- Existing `musitu-studio-v02/render_cpu_pull` function readable:
  **TRUE**.
- Association observed: the repository credentials authenticate to a
  Modal Workspace in which the existing Studio CPU app/function can be read.
- New Modal functions invoked: **NONE**.
- Modal deployment/settings changes: **NONE**.
- Payment or render initiated: **NONE**.

No token values, account workspace name, invoices, usage totals, or customer
identifiers were printed, copied or committed.

## Still not independently verified

- The intended owner-approved Workspace binding stored in a reviewed
  `MUSITU_STUDIO_MODAL_WORKSPACE` Actions variable: NOT VERIFIED.
  A known app association supports identification but is not a substitute
  for owner-approved target scoping.
- Modal Workspace provider-*enforced* budget amount and remaining headroom:
  NOT VERIFIED. The SDK billing summary is usage, not an enforced cap
  attestation.
- Gemini and storage spending controls, exact credits settlement,
  cloud worker cancellation, standalone Durable Object deployment:
  NOT VERIFIED.
- No paid render, GPU, new app deployment, public launch or user billing
  is authorized by the successful account readback.

**GATE 5 OPEN; GATE 6 OPEN; PAID RENDERING OFF; PUBLIC LAUNCH NO-GO.**

Official reference: https://modal.com/docs/guide/budgets
