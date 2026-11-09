# MUSITU JARVIS Enterprise — Governed integration

**Repository:** evansmusitu/mft-axiom-build  
**Branch:** feature/musitu-jarvis-enterprise-staging-20261107  
**Status:** synthetic development only; not deployed; not customer-ready.

This subdirectory isolates the JARVIS enterprise white-label lead qualification prototype from AXIOM, MUSITU Connect, WhatsApp and other production projects. It contains the deterministic intake core and permission checks, plus an initial schema and tests. No real WhatsApp messages, customer data, credentials, deployed workers or financial transactions are included.

## Why this branch exists

The owner requested this existing repository as the common source environment and plans to change it from **public to private**. **Until GitHub confirms that visibility has changed, everything committed here is publicly visible.** Commit only non-secret synthetic code; never include customer assets, unannounced commercial plans, API credentials or regulated data. Switching visibility later does not undo earlier public exposure or prior clones.

## Verify the current code

Run `node --test products/musitu-jarvis/tests/*.test.js` from the repository root, or `npm test` in this directory. The core uses Node built-ins. Runtime targets Node 24, consistent with the existing Vercel team.

## Planned hosted integration — not yet wired

1. Bring the separate Next.js/Vercel source bundle into this directory **only after checking full source, license, dependency locks and repo disclosure**.
2. Prepare and validate an isolated Neon PostgreSQL stage with restricted non-owner role and enforced tenant RLS; never point the staging app at an AXIOM or WhatsApp database.
3. Run CI, `npm ci`, Next build, live tenant isolation, consent/opt-out, audit/restore and access protection tests.
4. Establish a new SSO-protected Vercel Preview, with separate environment variables and no public customer access.
5. Qualify payment, identity, Meta/WhatsApp and any AXIOM integration separately.

**Production deployment, existing workflow edits, and PR merge are excluded from this branch.** Full local staging candidate is retained separately for gated import.
