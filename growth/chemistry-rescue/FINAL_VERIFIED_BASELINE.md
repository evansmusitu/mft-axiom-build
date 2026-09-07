# MUSITU Chemistry Rescue 2026 — Final Verified Production Baseline

Status: **VERIFIED_NATIONAL_RESCUE_GROWTH_BASELINE**

This file is the compact continuation pointer for the sealed MUSITU Chemistry Rescue 2026 production baseline. It records evidence identities only; it does not expand any claim beyond the underlying run artifacts and release manifest.

## Canonical production identity

- Repository: `evansmusitu/mft-axiom-build`
- Branch: `chemistry-national-rescue-growth-20260907`
- Canonical release manifest: `commerce/chemistry/RELEASE_BASELINE_20260906.json`
- Manifest schema: `musitu.chemistry.release_baseline.v6`
- Manifest Git blob SHA: `e6e98b8f94a8a7ecbc18857e8560a762dca57848`
- Manifest SHA-256: `18367e854bd363c2f932d62e2d2d9abe7389fc6a32abe97fbdb143b0dd2c15d5`
- Live commerce Worker: `musitu-chemistry-commerce`
- Live Worker SHA-256: `7b17d37b514913a59a66fa1339ced59ab0b06ff9759ef51cd5ec16d4e5e20af0`
- Verified predecessor Worker SHA-256: `1134a2581d423547b9876fe8a680ef99ca949edbdbfd6757624150a23d049bec`

## Public surfaces

- Storefront: `https://payments.mftintelligence.com/chemistry/`
- Rescue: `https://payments.mftintelligence.com/chemistry/rescue`
- Teacher kit: `https://payments.mftintelligence.com/chemistry/rescue/teachers`
- School kit: `https://payments.mftintelligence.com/chemistry/rescue/schools`
- Ambassador kit: `https://payments.mftintelligence.com/chemistry/rescue/ambassadors`
- Experience evidence: `https://payments.mftintelligence.com/chemistry/experience`
- APK: `https://payments.mftintelligence.com/chemistry/download/MUSITU_Chemistry_Mastery_1.2.0.apk`

APK identity:
- bytes: `5314934`
- SHA-256: `055b63f271c18faab540985faefb970f472ea55ba9cb3495db459797902b790d`

Production licence key ID:
`chem-lic-2026-6783aa7535d1`

## Evidence chain

### National launch content QA

- Run: `34077657825`
- Result: success
- Scope: complete 30-day calendar, short-video scripts, paid-media copy, content QA, budget operations, teacher/parent/school/creator/ambassador distribution material.

### Full read-only product preflight

- Run: `34078053435`
- Job: `101607925083`
- Gate: `MUSITU_CHEMISTRY_RESCUE_FULL_PREFLIGHT_PASS`
- Candidate Worker SHA-256: `7b17d37b514913a59a66fa1339ced59ab0b06ff9759ef51cd5ec16d4e5e20af0`
- Artifact ID: `10002756931`
- Artifact SHA-256: `d39cf1cd50281268a0b00ba82712450c721367f38a4412127044c66fc5936c0d`
- Production mutation: false

Verified in preflight:
- 40/40 storefront/privacy/Worker/Rescue tests
- 8/8 original commerce tests
- sealed-base negative control
- fail-closed source normalization
- axe/WCAG gate
- keyboard/skip-link gate
- 320px reflow
- reduced motion
- accessibility-tree landmarks
- strict CSP/security headers
- byte budgets
- secret-marker scan
- core + Rescue Lighthouse budgets

Measured Lighthouse on both core and Rescue:
- Performance: `1.00`
- Accessibility: `1.00`
- Best practices: `0.96`
- LCP: approximately `1.21 s`
- CLS: `0`
- TBT: `0`

Field INP was not available from a qualifying real-user dataset and was not claimed.

### Guarded production deployment

- Run: `34078264681`
- Job: `101608519717`
- Gate: `MUSITU_CHEMISTRY_RESCUE_GUARDED_DEPLOY_PASS`
- Artifact ID: `10002817712`
- Artifact SHA-256: `f32fe7ce17489232f0360b72f02209634016d710cb0e89fbb032d652af0002cc`
- Required consecutive edge sweeps: `6`
- Achieved consecutive edge sweeps: `6`
- Rollback available: true
- Rollback used: false

The deploy required the exact verified Phase 3 predecessor before mutation, preserved bindings, uploaded content only, verified the exact candidate hash, checked core and Rescue routes/source classes/privacy/catalog/APK/health, and would have restored the exact predecessor on failure.

### Independent read-only live verification

- Run: `34078349117`
- Job: `101608752658`
- Gate: `MUSITU_CHEMISTRY_RESCUE_INDEPENDENT_LIVE_VERIFY_PASS`
- Artifact ID: `10002843618`
- Artifact SHA-256: `fe2f0e9d391cd4ead340be64eb2c6c0d64dc092fc448d8f6c718c44d1712313e`
- Independent route sweeps: `4`
- Production mutation: false

This verifier independently re-read the live Cloudflare Worker, matched the exact Worker SHA-256, re-swept the public edge, checked all source classes, hostile-source collapse, sitemap, print asset, telemetry privacy, health, catalog and exact APK identity.

### Final baseline seal

- Run: `34078568494`
- Job: `101609353220`
- Gate: `MUSITU_CHEMISTRY_RESCUE_FINAL_BASELINE_SEAL_PASS`
- Artifact ID: `10002911168`
- Artifact SHA-256: `9952c0b5b048a4efb64145d6adc61e00490f4c51727b651a72f6232170361f66`
- Production mutation: false

The final seal binds the canonical manifest blob and SHA-256 to the content-QA, preflight, deploy and independent-live evidence identities, then independently verifies the live Worker, public surfaces, commerce health, catalog and APK.

## Growth attribution contract

Allowed coarse source classes only:
- `wa_student`
- `wa_teacher`
- `school`
- `creator`
- `meta`
- `tiktok`
- `ambassador`
- `direct`

Unknown or hostile source input collapses to `direct`.

Growth events:
- `rescue_visit`
- `rescue_start`
- `rescue_share`
- `rescue_peer_start`
- `premium_intent`
- `teacher_kit`
- `school_kit`
- `ambassador_kit`

Measurement remains aggregate-only and inherits GPC/DNT/browser opt-out suppression. No personal referral identifiers are permitted in Rescue source attribution.

## Commercial and evidence boundaries

Canonical entitlement invariant:
**VERIFIED_SETTLEMENT_EVIDENCE → SIGNED_MUSITU_ENTITLEMENT**

At this baseline:
- real-money settlement observed: **false**
- real-money settlement claimed: **false**
- field INP observed: **false**
- field INP claimed: **false**
- organic distribution outcomes observed/claimed: **false**
- paid-media spend observed/claimed: **false**
- paid-media spend at seal: **US$0**
- approved experimental paid-media envelope: **US$200–US$500 total**, but paid scale requires real organic-funnel evidence first
- official ZIMSEC affiliation claimed: **false**
- guaranteed exam outcome claimed: **false**

## Continuation rule

Treat this baseline and the canonical release manifest as authoritative unless a newer verified GitHub state advances them. Do not infer growth, revenue, settlement, field-performance or adoption claims from deployment readiness. Before any future production mutation, re-read the live Worker and current GitHub branch, preserve every payment/licence/privacy boundary, and require a new evidence chain appropriate to the change.
