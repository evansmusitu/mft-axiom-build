# Exact next revenue execution

This handoff exists so a new chat can continue without re-planning the project.

## Execute in this order

1. Verify the handoff ZIP checksum and read `00_START_HERE/NEW_CHAT_START_HERE.md` first.
2. Re-read connected GitHub branch `chemistry-direct-paynow-fallback-20260911` and compare its HEAD with captured `fff60ebac1dd4cf28210d86976f87c7864c041e2`. Newer verified branch state supersedes the captured source.
3. Confirm sealed `main` remains `d6a846f6bbe0bccac1758713eb4de167caf07113`. Do not mutate it.
4. Re-read Gmail thread `1a0851d1b9ad9f75`. If Paynow has replied, act on the exact requirement. If not, do not send another immediate duplicate support email.
5. Check Metricool scheduled-post state and whether each pending LinkedIn post has published. Capture immutable public URL/platform ID and rendered copy for any newly published post.
6. Pull fresh LinkedIn analytics only after sufficient time has passed. Treat null metric fields as unknown, not zero.
7. Use the existing read-only aggregate funnel workflow/pattern to compare current Rescue visits, starts, shares, peer starts and Premium intent with the 2026-09-07 baseline.
8. Use the existing read-only aggregate order-state workflow/pattern to inspect order statuses without reading PII. Do not call order-intent amounts revenue.
9. If verified real settlement evidence appears, follow the existing settlement-verification -> signed MUSITU entitlement path. Never bypass it.
10. Keep paid-media spend at US$0 until product/checkout/support health is stable AND at least two organic creatives show useful downstream action. Only then consider the staged US$40–US$80 first paid creative signal test defined in `growth/chemistry-rescue/budget-operations.md`.

## What not to do

- Do not restart Store Phase 1/2 work; it is parked and outside this handoff.
- Do not invent a Store Phase 3.
- Do not merge Axiom, FMI, Financial Fabric, or other MUSITU programs into this continuation.
- Do not scrape teacher/student contacts or mass-message strangers.
- Do not claim official ZIMSEC affiliation.
- Do not promise grades, pass rates, or exam outcomes.
- Do not manufacture testimonials, school adoption, customers, revenue, settlement, ROI, or paid conversion.
- Do not expose Paynow, Cloudflare, signing, or other secrets.
- Do not mutate sealed main.

## Decision metrics

Primary decision path:
`Rescue visit -> Rescue start -> share/peer start -> Premium intent -> checkout progression -> verified settlement`

Supporting diagnostics:
impressions, unique impressions, reactions, comments, shares, engagement.

Do not optimize from reach alone.

## Current evidence threshold for paid media

At handoff, downstream evidence exists in aggregate (`14` starts, `2` shares, `2` Premium-intent events), but it is not yet evidence that at least two distinct creatives independently produced useful downstream action. Therefore the paid-media gate is NOT declared passed by this package.

Wait for per-publication evidence and fresh funnel movement before opening paid spend.
