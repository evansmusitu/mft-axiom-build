# AXIOM native Cloudflare qualification — 2026-10-09

**Public customer inference: NOT AUTHORIZED.** The account's existing scoped token `CLOUDFLARE_API_TOKEN` successfully authenticated with `Authorization: Bearer`, not the older Global API Key. Existing GitHub secret `CLOUDFLARE_GLOBAL_API_KEY` returned HTTP 403, Cloudflare native error 9103. DO NOT rotate, copy or echo any secret.

## Earned
1. Live AXIOM zone/account and 3 complete account subscription records verified through read-only Cloudflare API (GitHub Actions run 37975739096).
2. No Workers Paid account subscription reported; user's Workers Free confirmation aligns with native evidence. Do not extend this to independently audited finance/charge-proof.
3. Exactly one real, synthetic, no-customer-data GLM-4.7-Flash inference returned nonempty text (run 37976063344).
4. D1 account total 11, compared to documented Workers Free cap 10 (run 37976426413). No production database mutated.

## FAILED / NOT PROVEN
- Isolated D1 creation returned HTTP 403 (run 37976232537). Free D1 slot unavailable; D1 Write permission independently NOT PROVEN. There is no safe unilateral workaround. No D1 quota ledger or customer authentication tested live.
- The first model probe (37975942693) returned HTTP 200 but its outdated parser expected a `result.response` field, while GLM uses `result.choices[0].message.content`. The corrected 37976063344 probe succeeded. Preserve the failure as a response-shape regression.
- External model execution alone does not prove a secure customer-serving backend.
- Independent identity/capability issuer, security attack review, S4 release approval and rollback-proof remain outstanding.

## Binding resolution order
A. Never delete an unidentified D1 database, never modify main/PR1, existing production or frozen OpenAI submission.
B. Prefer a separately reviewed **SQLite-backed Durable Object** on Workers Free as a prospective strongly consistent global quota ledger when D1 is full; prove Cloudflare token's Workers Scripts Write scope and add dedicated namespace, SQLite transactionSync admission, replay/negative tests, no public traffic, independent verifier and rollback proof. This is a target, not an earned implemented capability.
C. Alternatively the account owner can separately establish unused D1 databases through native metadata and approve their S5 deletion/backup; this is NOT authorized by this handoff.
D. Only after an independent, production-quality authorization issuer and all security/rollback gates pass should the user approve S4 public customer release.

Provider-native Free limits documented Oct 2026: Cloudflare Workers AI 10,000 Neurons/day, Free overage fails; D1 Free 10 databases; SQLite Durable Objects available on Workers Free; provider rate limiting binding is local/eventually consistent and CANNOT replace a precise global ledger.

**Evidence level:** GitHub Actions live provider-native reads/inference, no external verifier certification. Budget remains USD 0.00.
