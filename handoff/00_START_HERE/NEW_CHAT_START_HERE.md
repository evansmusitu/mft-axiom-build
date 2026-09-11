# MUSITU CHEMISTRY REVENUE CONTINUATION — NEW CHAT START HERE

Status: AUTHORITATIVE HANDOFF FOR CONTINUATION
Date: 2026-09-11
Scope: MUSITU Education Nexus — Chemistry Mastery / Chemistry Rescue 2026 + current commerce/revenue execution.

THIS IS A CONTINUATION, NOT A RESTART, REDESIGN, SUMMARY-ONLY EXERCISE, OR PERMISSION TO RECONSTRUCT FROM MEMORY.

## 1. Verification rule

Before using this package, verify the ZIP SHA-256 against the sibling checksum file. If the checksum does not match, STOP. Do not continue from an unverified package.

Read this file first. Then follow `handoff/99_READ_ORDER.txt`.

## 2. Exact source-of-truth anchors

Repository: `evansmusitu/mft-axiom-build`

Authoritative current Chemistry/revenue working branch at handoff:
`chemistry-direct-paynow-fallback-20260911`

Exact source HEAD captured in this package:
`fff60ebac1dd4cf28210d86976f87c7864c041e2`

Sealed `main` MUST remain unchanged at:
`d6a846f6bbe0bccac1758713eb4de167caf07113`

The packaging branch is only a handoff transport branch. Do not treat it as the live product branch.

A complete repository source snapshot of the exact authoritative source HEAD is included under `01_SOURCE/mft-axiom-build/` inside the ZIP.

## 3. Current production commerce state

Live Worker: `musitu-chemistry-commerce`
Current verified production Worker SHA-256:
`a2da15a78e6d685fe644d22fdc6f68a02e3dad3f7b3e263d360082e13afee4a5`

Guarded direct-Paynow fallback deploy:
- workflow run: `34594648101`
- job: `103247470726`
- result: PASS
- previous Worker SHA: `7e3b9b188a9e69399e120f0a36b90bc63ac37e5bae87a2b731e67b565ee3573c`
- current Worker SHA: `a2da15a78e6d685fe644d22fdc6f68a02e3dad3f7b3e263d360082e13afee4a5`
- rollback used: false
- direct Paynow fallback active: true
- entitlement mode: `manual_verified_settlement_only`
- payment created by deploy: false
- payment submitted by deploy: false
- final public verification: PASS
- artifact ID: `10262265281`
- artifact ZIP SHA-256: `714a0ea47ef6eb43f29ac335445dbb433e27389d56f1938cb644fbf277369c6d`

Commercial invariant remains non-negotiable:
`VERIFIED_SETTLEMENT_EVIDENCE -> SIGNED_MUSITU_ENTITLEMENT`

Do not issue Premium entitlement merely because an order exists, a checkout was started, a Paynow page was reached, or a payment status is pending.

## 4. Live catalog / exact current prices

Verified by the production deploy gate:
- term: US$4.99, 1 seat, 4 months
- annual: US$9.99, 1 seat, 12 months
- lifetime: US$19.99, 1 seat, lifetime
- family: US$24.99, 4 seats, 12 months
- tutor: US$39.00, 10 seats, 12 months
- school: 12 months, server-authoritative quote/no fixed public amount in the verified catalog

Primary public Rescue URL:
`https://payments.mftintelligence.com/chemistry/rescue?src=direct`

Universal install URL:
`https://payments.mftintelligence.com/chemistry/install`

Example checkout entry:
`https://payments.mftintelligence.com/chemistry/checkout/start?plan=annual`

## 5. Current funnel evidence — read-only aggregate snapshot

Latest verified snapshot:
- workflow run: `34595772436`
- job: `103251048638`
- artifact ID: `10262292177`
- artifact ZIP SHA-256: `78374d0a7dc7019f944fb2d9b1014cef11a2efdba17f0d831596f3aa55b26112`
- captured UTC: `2026-09-11T11:48:10Z`

Current aggregate totals:
- Rescue page views: 52
- `rescue_visit`: 52
- `rescue_start`: 14
- `rescue_share`: 2
- `rescue_peer_start`: 0
- `premium_intent`: 2
- `teacher_kit`: 0
- `school_kit`: 0
- `ambassador_kit`: 0

Delta from the sealed 2026-09-07 baseline:
- page views: +49
- rescue visits: +49
- rescue starts: +14
- rescue shares: +2
- peer starts: +0
- premium intent: +2

All observed growth events in this snapshot are source-class `direct`.

These are aggregate events, not certified unique learners or customers.

## 6. Current order-state evidence — NOT revenue

Latest verified aggregate order-state snapshot:
- workflow run: `34596023006`
- job: `103251843492`
- artifact ID: `10262462653`
- artifact ZIP SHA-256: `1cdc0f18ac027620352390d2c824a97294df3a0903fbcb97d4720428e9528705`
- captured UTC: `2026-09-11T11:51:18Z`

All-time order records:
- total order intents: 40
- cancelled: 26
- pending: 14
- summed nominal order-intent amount: 150,576 cents

Since 2026-09-07 Rescue launch:
- order intents: 24
- cancelled: 10
- pending: 14
- summed nominal order-intent amount: 94,978 cents

Since direct-Paynow fallback production deploy:
- order intents: 0 at the snapshot time

CRITICAL: these amounts are order-intent totals, NOT verified revenue. No paid/settled status was observed in this aggregate snapshot. Do not claim sales, revenue, settlement, paid customers, ROI, or conversion-to-paid from these records.

## 7. Paynow live-mode blocker

Paynow Integration ID: `26343`

Existing successful TEST evidence:
- Paynow reference: `60480278`
- result: `Paid (TESTING: Faked Success)`
- test date: 2026-09-05

Support thread:
- original request sent: 2026-09-09
- follow-up sent: 2026-09-11
- Gmail thread ID: `1a0851d1b9ad9f75`
- latest follow-up message ID: `1a0900d469f36356`

At handoff, the thread contains only the two outbound MFT messages and no human Paynow support reply.

Do not send another immediate duplicate follow-up. In the new chat, first re-read this Gmail thread to see whether Paynow has replied since handoff.

## 8. Organic acquisition state

Day-1 LinkedIn founder post is already externally proven published:
`https://www.linkedin.com/feed/update/urn:li:share:7502708694757974016`

Observed Metricool analytics at handoff:
- impressions: 158
- unique impressions: 127
- engagement: 0.0
- click/comment/reaction/share fields returned null, so do NOT rewrite null as zero without new evidence.

Scheduled LinkedIn organic posts are recorded in `handoff/01_STATE/METRICOOL_SCHEDULED_POSTS_20260911.json`.

At handoff there are five pending posts:
- 2026-09-11 15:00 Africa/Harare — pH arithmetic
- 2026-09-12 11:00 — anode sign trap
- 2026-09-14 11:00 — primary alcohol -> aldehyde
- 2026-09-16 11:00 — parent revision-focus message
- 2026-09-19 11:00 — catalyst/equilibrium misconception

All use `src=direct`; all are organic; no paid boost is authorized by this handoff.

## 9. Acquisition policy that must survive the chat shift

Do not optimize from impressions/likes alone. Primary funnel is:
Rescue visit -> Rescue start -> share/peer start -> Premium intent -> checkout progression -> independently verified settlement.

No paid media yet unless BOTH are true:
1. product/checkout/support health is stable; and
2. at least two organic creatives show useful downstream action.

Teacher outreach is only to known/opted-in/relevant teacher contacts. School outreach is only through legitimate manually selected institutional channels. No scraped contacts, automated cold messaging, repeated messaging to non-engagers, fake testimonials, fake adoption numbers, grade guarantees, or implied ZIMSEC endorsement.

## 10. Exact next execution priority

The new chat should continue revenue execution, not resume parked Store certification engineering.

Priority order:
1. Re-verify exact GitHub branch HEAD and sealed main before changing anything.
2. Re-read the Paynow Gmail thread for a reply. If Paynow replied, act on the exact requirement; if not, do not spam another duplicate immediately.
3. Check whether the scheduled LinkedIn posts have published and capture external publication evidence.
4. Pull fresh Metricool post analytics after enough time has elapsed for each post.
5. Run/read a fresh aggregate funnel snapshot before major marketing decisions.
6. Keep paid media at US$0 until the campaign gate is genuinely met.
7. Do not call pending/cancelled order intents revenue; require verified settlement evidence.
8. If a verified real settlement occurs, follow the existing settlement-verification -> signed-entitlement path exactly.

## 11. Scope isolation

This handoff is for MUSITU Chemistry Mastery / Chemistry Rescue revenue execution. Do not silently merge it with MUSITU Store, Axiom, FMI, Financial Fabric, or other projects.

MUSITU Store work is parked at its truthful evidence boundary and is NOT the next action here.

## 12. Secret boundary

This package intentionally contains NO raw Paynow key, NO Cloudflare secret, NO private signing material, and NO credentials. Continue using existing connected services and repository secrets without exposing them.

## 13. Governing principle

Use newer verified GitHub, production, Gmail, Metricool, or payment evidence when it supersedes this snapshot. Preserve all evidence boundaries. Never manufacture completion, settlement, customers, revenue, adoption, endorsements, or exam outcomes.
