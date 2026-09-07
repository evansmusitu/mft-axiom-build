# MUSITU Chemistry Rescue — Reproducibility Recertification

Date: 7 September 2026

Status: **VERIFIED REPRODUCIBILITY RECERTIFICATION**

This record is append-only evidence for the MUSITU Chemistry Rescue production system. It certifies that the repaired repository build path reproduces the exact Worker bytes already deployed in production and that the live public Rescue system was independently re-read without production mutation.

It is **not** a real-money settlement certification, adoption certification, campaign-ROI certification, or field-INP certification.

## Repository and execution boundary

- Repository: `evansmusitu/mft-axiom-build`
- Isolated branch: `chemistry-national-rescue-growth-20260907`
- Axiom `main`: untouched by this Rescue recertification
- Repaired deterministic source head: `6d132f94a288850709d23ddf135e36c4f6a274cc`
- Recertification workflow run head: `c54c87af8eb8e37d0bb5f29a1a05fc8f76b06ecf`

## Deterministic build chain

The recertification rebuilt the production candidate from the sealed Chemistry source chain:

1. Sealed source archive SHA-256: `5b2618499eed8dc90261bc4f8260246d5593534500dd2fb145f2d24b5c47754c`
2. Sealed base Worker SHA-256: `848e1cec17ec580822d36e595196cda5978713849e8b45c5bc8dc7fcf9765db8`
3. Phase 3 storefront transform output SHA-256: `f5719c2a66130a6aba9d16a8060f7018459aab46297e3ab2a878361b02e12126`
4. Rescue overlay final candidate SHA-256: `7b17d37b514913a59a66fa1339ced59ab0b06ff9759ef51cd5ec16d4e5e20af0`
5. Independently read live Worker SHA-256: `7b17d37b514913a59a66fa1339ced59ab0b06ff9759ef51cd5ec16d4e5e20af0`

Therefore:

**DETERMINISTIC REPOSITORY CANDIDATE == CURRENT LIVE WORKER BYTES**

No redeploy was performed during this repair because the repaired deterministic candidate already matched the exact live Worker bytes.

## Verification runs

### Focused generated-Worker CI

- Workflow: `MUSITU Chemistry Rescue Growth Focused CI`
- Run: `34079277629`
- Head: `6d132f94a288850709d23ddf135e36c4f6a274cc`
- Result: `success`

This gate reconstructed the Worker from sealed source, applied the Phase 3 builder plus Rescue overlay, performed syntax validation, and ran the focused Phase 3 + Rescue contract suite.

### Full preflight

- Workflow: `MUSITU Chemistry Rescue Full Preflight`
- Run: `34079277627`
- Head: `6d132f94a288850709d23ddf135e36c4f6a274cc`
- Result: `success`

Verified evidence included:

- 40/40 storefront and Rescue tests
- 8/8 original commerce tests
- fail-closed source normalization
- sealed pre-growth source does not expose Rescue
- browser accessibility, keyboard, mobile-reflow and security gates
- Lighthouse: Performance `1.00`, Accessibility `1.00`, Best Practices `0.96`
- observed LCP approximately `1.2 s`
- CLS `0`
- gate: `MUSITU_CHEMISTRY_RESCUE_FULL_PREFLIGHT_PASS`

### Fresh read-only reproducibility recertification

- Workflow: `MUSITU Chemistry Rescue Reproducibility Recertify`
- Run: `34079733211`
- Job: `101612616984`
- Run head: `c54c87af8eb8e37d0bb5f29a1a05fc8f76b06ecf`
- Result: `success`
- Gate: `MUSITU_CHEMISTRY_RESCUE_REPRO_RECERTIFY_PASS`

The recertification used only `GET` operations against the live public system and the Cloudflare Worker source-read endpoint.

Explicit evidence:

- `request_methods_used:["GET"]`
- `telemetry_post_performed:false`
- `payment_intent_created:false`
- `production_mutation:false`
- `candidate_matches_live:true`

## Sealed recertification artifact

- Artifact name: `musitu-chemistry-rescue-repro-recertification`
- Artifact ID: `10003284402`
- Artifact archive SHA-256: `dfb7c9999eb105ae875dc153f208cac28793c0a95e475858d1b2fa6245a7817d`
- Artifact size: `1941` bytes
- Created: `2026-09-07T03:28:07Z`
- Expiry: `2026-12-06T03:27:59Z`
- Expired at recertification time: `false`

## Live public Rescue surface verified

All of the following public routes returned HTTP 200 under strict storefront security headers during the fresh recertification:

- `/chemistry/`
- `/chemistry/plans`
- `/chemistry/privacy`
- `/chemistry/experience`
- `/chemistry/support`
- `/chemistry/verify`
- `/chemistry/releases`
- `/chemistry/terms`
- `/chemistry/rescue`
- `/chemistry/rescue/teachers`
- `/chemistry/rescue/schools`
- `/chemistry/rescue/ambassadors`

The Rescue sitemap coverage and `/chemistry/assets/rescue-print.css` were also reverified.

## Rescue attribution boundary

The exact current coarse source allowlist is:

- `wa_student`
- `wa_teacher`
- `school`
- `creator`
- `meta`
- `tiktok`
- `ambassador`
- `direct`

Unknown or hostile values collapse to `direct` and are not reflected as trusted source state.

The canonical peer-share URL remains:

`https://payments.mftintelligence.com/chemistry/rescue?src=wa_student`

The WhatsApp share loop was verified without writing telemetry during the recertification.

## Commerce and distribution boundaries preserved

Fresh recertification reconfirmed:

- licence key ID: `chem-lic-2026-6783aa7535d1`
- payment authority bound: `true`
- Paynow transport bound: `true`
- raw Paynow key absent from public health evidence
- public plan IDs unchanged: `term`, `annual`, `lifetime`, `family`, `tutor`, `school`
- public plan prices verified unchanged
- APK bytes: `5314934`
- APK SHA-256: `055b63f271c18faab540985faefb970f472ea55ba9cb3495db459797902b790d`
- field-experience public minimum sample: `100`
- current experience status: `insufficient_field_sample`

## Claims deliberately withheld

The recertification explicitly records:

- `adoption_claimed:false`
- `campaign_roi_claimed:false`
- `field_inp_claimed:false`
- `real_money_settlement_observed:false`
- `real_money_settlement_claimed:false`

No inference beyond the verified evidence above is permitted.

## Final recertification statement

MUSITU Chemistry Rescue remains live on the previously sealed production Worker. The repaired repository build path now reproduces those exact production bytes deterministically, the full source/browser/security preflight is green, and a fresh independent GET-only recertification confirms the live public Rescue, lifecycle, commerce metadata, APK provenance, attribution boundary and security headers without any production mutation.

The isolated Rescue growth branch remains separate from Axiom `main` unless an explicit future integration decision is made.
