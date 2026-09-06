# MUSITU Chemistry Mastery — Phase 3 Field Experience Continuation

Date: 2026-09-06

## Authoritative state

MUSITU Chemistry Mastery 1.2.0-commercial-rc3 is at the **VERIFIED_FIELD_EXPERIENCE_COLLECTION_BASELINE**.

The authoritative release manifest is `commerce/chemistry/RELEASE_BASELINE_20260906.json`, schema `musitu.chemistry.release_baseline.v5`.

Live storefront: `https://payments.mftintelligence.com/chemistry/`

Direct APK: `https://payments.mftintelligence.com/chemistry/download/MUSITU_Chemistry_Mastery_1.2.0.apk`

Live Chemistry Worker SHA-256:

`1134a2581d423547b9876fe8a680ef99ca949edbdbfd6757624150a23d049bec`

Previous recovery-hardened Worker SHA-256:

`d6642aefacc8d6765d17c1d33c2df65df33a9531f843c0bbbc2c304482d3d5f1`

The Axiom `main` branch remains intentionally untouched. Chemistry work remains isolated on `chemistry-field-experience-20260906`.

## Phase 3 capability now live

The production storefront now performs first-party, privacy-minimized field-experience measurement for Core Web Vitals and allowlisted journey actions.

Public surfaces:

- `/chemistry/experience`
- `/chemistry/experience.json`
- `/chemistry/telemetry/v1`
- `/chemistry/assets/web-vitals-6.0.1.iife.js`
- `/chemistry/assets/field-experience.js`

Pinned Web Vitals dependency:

- version: `6.0.1`
- bytes: `8987`
- SHA-256: `6b3e4ac9d6f6abd4ea1810621668bec7d7adb121279570e6870be4fb98ab3909`

Storage model: `aggregate_histogram_only`.

Individual analytics event rows are not retained. Measurement does not use analytics cookies or persistent tracking identifiers and does not store IP addresses, full URLs/query strings, referrers, email addresses, Device IDs, payment references or licence tokens. Global Privacy Control and Do Not Track suppress browser reporting. A browser-level disable control is exposed from the Privacy surface.

The active storefront CSP remains strict same-origin. `connect-src` is `'self'` solely to allow first-party field reports. `unsafe-inline` and `unsafe-eval` are not permitted on the Phase 3 public HTML surfaces. Referrer policy remains `no-referrer`.

## Preflight evidence

Successful strengthened Phase 3 preflight:

- run: `34060650777`
- head SHA: `8d3716c92a9bb44bb5beecaeca87f9157397f335`
- artifact ID: `9997354002`
- artifact ZIP SHA-256: `dc73383949e8b1b036f9a57d1b6ca977fe701f08902130543d5fb8b092dbce89`
- candidate Worker SHA-256: `1134a2581d423547b9876fe8a680ef99ca949edbdbfd6757624150a23d049bec`
- gate: `MUSITU_CHEMISTRY_FIELD_EXPERIENCE_PREFLIGHT_PASS`

Verified in preflight:

- 30/30 Phase 3/storefront/Worker tests
- 8/8 original commerce tests
- Annual and School checkout strict CSP/referrer policy
- static privacy/security invariants
- keyboard, reflow, reduced motion and accessibility-tree gates
- Lighthouse performance 1.00
- Lighthouse accessibility 1.00
- Lighthouse best practices 0.96
- LCP approximately 1207.9 ms
- CLS 0
- TBT 0

These are lab/preflight measurements, not field Core Web Vitals claims.

## Production deployment evidence

Guarded deploy v3:

- run: `34061057589`
- job: `101561547584`
- head SHA: `0d9575d466290c685ec2edbb8d0a368ac607b4c7`
- artifact ID: `9997473613`
- artifact ZIP SHA-256: `fae2bfa30a02e5e5e2fbdf2788b1f8fc3c6c792f3880c1181eb2402c3dc0c3f7`
- gate: `MUSITU_CHEMISTRY_FIELD_EXPERIENCE_DEPLOY_V3_PASS`

The deploy required an exact live-source drift lock against the recovery-hardened predecessor before any mutation. After the content-only upload, it required six consecutive complete public sweeps over 11 customer-critical HTML routes with fresh cache-busting and strict security-header validation. The required 6/6 streak passed. The deploy then verified health, the exact six-plan catalogue, APK bytes/hash, licence key ID, payment-authority and transport bindings, recovery hardening, self-hosted field assets, and cross-origin telemetry rejection.

Rollback was available and was not used in the successful v3 deployment.

## Independent live seal

Independent read-only verification:

- run: `34061132108`
- job: `101561752175`
- head SHA: `e028553abbfb975f837766564a1aee5e4d7187d3`
- artifact ID: `9997492963`
- artifact ZIP SHA-256: `f81b0bab6417c7e2a8b2a4d138458639552b15723b1cb16bfea030c237f02824`
- gate: `MUSITU_CHEMISTRY_FIELD_EXPERIENCE_INDEPENDENT_LIVE_VERIFY_PASS`

The read-only verifier independently re-read the Cloudflare Worker source and proved the exact live SHA-256 `1134a2581d423547b9876fe8a680ef99ca949edbdbfd6757624150a23d049bec`. It then completed four consecutive full public sweeps over the same 11 critical HTML routes. The independent sweeps observed Cloudflare `ORD` edge rays, whereas the deployment convergence evidence observed `DFW` rays.

The independent verifier made no production mutation and wrote no synthetic valid telemetry.

## Superseded rollback-safe deployment attempts

Two earlier production attempts are forensic history only:

- v1 run `34060564482`: post-upload verification failed; automatic rollback restored the predecessor; subsequent read-only v4 verification passed.
- v2 run `34060769008`: a transient edge rollout mix caused a repeated Annual checkout probe to observe the predecessor after an initially successful sweep; automatic rollback restored the predecessor; subsequent read-only v4 verification passed.

Neither failed attempt is authoritative. Do not rerun them.

## Commercial invariants preserved

- APK SHA-256: `055b63f271c18faab540985faefb970f472ea55ba9cb3495db459797902b790d`
- APK bytes: `5314934`
- production licence key ID: `chem-lic-2026-6783aa7535d1`
- exact plan IDs: `term, annual, lifetime, family, tutor, school`
- payment authority binding preserved
- Paynow transport binding preserved
- raw Paynow key remains absent from the product Worker
- recovery bare `/chemistry/return` link remains absent
- entitlement rule remains `VERIFIED_SETTLEMENT_EVIDENCE → SIGNED_MUSITU_ENTITLEMENT`

## Evidence boundaries — do not overclaim

Current `/chemistry/experience.json` status at sealing: `insufficient_field_sample`.

Minimum public sample: `100` per metric.

Therefore:

- field-experience collection live: **true**
- field INP observed: **false**
- field INP claimed: **false**
- publishable field Core Web Vitals evidence available: **false**
- real-money settlement observed: **false**
- real-money settlement claimed: **false**

Do not infer a field INP/LCP/CLS result from Lighthouse. Do not manufacture or seed synthetic valid telemetry to reach the publication threshold. Only actual visitor measurements may advance the field-evidence state.

## Exact next evidence milestone

The next field-experience milestone is reached only when the aggregate dataset naturally meets the minimum sample threshold. At that point, read `/chemistry/experience.json`, verify the p75 evidence and sample counts, and seal a new evidence state before making any field-performance claim.

The separate commercial milestone remains a genuinely settled real-money transaction independently verified for exact reference, exact amount, paid status and resulting signed entitlement.
