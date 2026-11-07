# JARVIS Enterprise release controls

**Status:** NO-GO for external users; synthetic-only code review.

- GitHub remains PUBLIC until its visibility is actually changed and verified. No credentials, customer datasets, commercial secrets, or provider tokens may be committed.
- Existing AXIOM/Connect/WhatsApp, payment, MT5, mail, Cloudflare and Vercel production are outside this branch's change scope.
- The tests in this branch prove ONLY pure intake and demo-token behavior. They do not verify a deployed app, Neon database, SSO, customer identity, provider messaging or real multi-tenant security.
- Dedicated Neon and Vercel staging require cost guardrails, restricted roles, SSO on all deployments, real cross-tenant negative tests, rate limits, logs, rollback and recovery before allowing customers.
- All external WhatsApp messages, invoices and payments require independent owner approvals and verified implementation.
- Draft PR must remain unmerged until source review and CI pass. No automatic promotion or deployment.
