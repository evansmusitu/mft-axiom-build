# Real external qualification gate — safe operator workflow

This file is a deployment hold, not approval. Current results cover a **local private harness**. Do not use genuine customer data to perform these tests.

## PostgreSQL owner bypass blocker

The separate Neon PostgreSQL 17 qualification project created earlier has only a project-owner role; testing showed that the owner's `rolbypassrls` is true. FORCE ROW LEVEL SECURITY on its synthetic probe tables did **not** prevent that owner from seeing both tenants. That project must not be wired to the SaaS runtime using the owner connection string.

An organization-authorized database administrator must provision dedicated non-owner, non-superuser, `NOBYPASSRLS` service identities, including distinct `musitu_runtime` and `musitu_ingress` roles. Credentials must be stored in a secret manager, **never** in the source archive, chat, log or public issue. This environment's attempted role-creation operations were blocked by execution permissions; no workaround has been used.

The checked-in GitHub Actions qualification workflow is intended for an *entirely new isolated sandbox repository* and a disposable PostgreSQL 17 service. Its script refuses a remote host, a non-`postgres` admin database, missing `PG_ISOLATED_QUALIFICATION=YES`, and pre-existing test roles/database. It can create and drop its own throwaway objects there. **Never run it against the existing Neon project or AXIOM/MMF/FMI systems.**

An authorized security operator must obtain passing native evidence for 15 FORCE-RLS tables, 15 strict tenant policies, four narrowly permitted insert-capable tables, actual row visibility under tenant A/B/unset scope, signed ingestion, cross-tenant denial, concurrent booking conflict, status reconciliation, consent/revocation, service restart, backup/restore and incident response. A simulation is not proof.

## Meta, identity, model and dashboard

A qualified deployment additionally needs official Meta development-account verification, webhook token and secret custody, explicit business/customer opt-out policy and outbound message authorization, live delivery receipts; Keycloak tenant identity, MFA and revocation; privacy-approved real model provider; scoped AXIOM execution credentials; a production dashboard and human inbox; monitoring, backups and independent commercial approval.

The local app deliberately provides no public sending, no payment collection and no public signup. `GET /health/live` is *process-only*; `GET /health/ready` must return HTTP 503. The release gate must continue to exit 2 until a distinct reviewed deployment is approved.

**No release authority is derived from tests, README, version numbers or a modified JSON matrix.**
