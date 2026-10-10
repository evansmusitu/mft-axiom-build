# Request for independent security assessment — MUSITU Mail Fabric v0.6

**Assessment has not been commissioned or performed.** This document is a self-prepared scope and evidence index, not a security certification.

## Scope

Product branch: `product/musitu-mail-fabric-isolated-20261009`. The frozen OpenAI submission, protected main and all other MUSITU products must remain out of scope for active attack tests. Evaluators may run only synthetic data in the isolated Mail Fabric harness or a separately authorized staging instance.

### Assessor qualifications

An external reviewer must disclose independence, experience in mail-abuse prevention, cryptographic evidence, multi-tenant authorization and distributed durability. Their written report must name the assessed Git commit and threat model; identify each reproducible issue, severity, exploit impact and recommended remediation; separately list all untested risks; and sign and date the results. Internal tests cannot substitute for this report.

### Attack surface and must-test failures

- Unauthorized sender ownership claims; DNS cache poisoning or challenge reuse; identity spoofing despite DNS control.
- Tenant crossing, forged token, recipient suppression bypass, daily and per-recipient quota bypass under concurrency.
- Queue duplicate/reordering, lost notification, power-loss before/after provider API acceptance, lease expiry, D1/Neon unavailable, provider timeout and duplicate cross-provider failover.
- Unauthenticated webhook, replay collision, delayed/out-of-order delivery reports, feedback lost during pause; ensure a provider claim is not inflated into human read evidence.
- AES-GCM IV uniqueness and AAD, malicious ciphertext, logging private data, exposed secret variables, signing-key rollback, transition trust-head equivocation and historical receipt signing.
- Postal/Resend HTTPS endpoint restrictions and egress SSRF; sensitive data retention and deletion.
- Automated phishing/spam/opt-out abuse, address probing and unexpected marketing/bulk sending.
- Build artifact integrity, dependency provenance, staging account/hostname isolation and default denied network access.

### Baseline reproducible commands

    cd musitu-mail-fabric
    npm run check
    npm test
    npm run demo

Cloudflare local Workerd/Queues and Mailpit integration instructions are in the v0.5/v0.3 docs. Serverless staging tests must use only synthetic records. Before claiming an external pass, request the assessor's signed report and rerun the fixes on the exact commit they reviewed.

### Current status

Automated local regression and prior isolated Cloudflare local runtime tests are passing; real Cloudflare D1 creation hit the free-plan 10-database account limit (7406). A separately isolated Cloudflare Queue and Neon Free PostgreSQL staging project exist but are not wired into customer traffic. Managed production-grade key custody, externally reviewed live email webhooks, genuine outage recovery tests and third-party audit remain unproven.
