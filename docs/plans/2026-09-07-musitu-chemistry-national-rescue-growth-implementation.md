# MUSITU Chemistry National Rescue Growth Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and launch the privacy-safe MUSITU Chemistry Rescue 2026 national growth loop for Zimbabwean A-Level Chemistry students without changing the verified payment, licence, APK, or Phase 3 field-evidence boundaries.

**Architecture:** Extend the existing deterministic storefront bundle with a dedicated Rescue module and coarse allowlisted growth-source events. Reuse the existing aggregate-only `chemistry_field_aggregate` D1 table and same-origin telemetry endpoint; do not create user/session/referral identity rows. Add lightweight teacher, school and ambassador web kits plus a self-hosted launch-content pack, then certify the exact Worker candidate through source, commerce, privacy, accessibility, Lighthouse, guarded deployment, and independent live verification.

**Tech Stack:** Cloudflare Worker ES modules, Node.js `node:test`, Python deterministic bundler (`commerce/chemistry/patch_storefront.py`), D1 aggregate storage, self-hosted storefront CSS/JS, GitHub Actions, axe-core, Playwright/Chromium, Lighthouse.

## Global Constraints

- Work only on `chemistry-national-rescue-growth-20260907`, derived from verified Phase 3 head `505d3f3bff72273bd874b1dc6a51831084cd373e`; do not modify Axiom `main`.
- Preserve live predecessor Worker SHA-256 `1134a2581d423547b9876fe8a680ef99ca949edbdbfd6757624150a23d049bec` until a guarded cutover passes.
- Preserve `VERIFIED_SETTLEMENT_EVIDENCE -> SIGNED_MUSITU_ENTITLEMENT`, server-authoritative prices, six plan IDs, payment-authority binding, Paynow transport binding, production P-256 key ID, and raw-Paynow-key exclusion.
- Preserve APK bytes `5314934` and APK SHA-256 `055b63f271c18faab540985faefb970f472ea55ba9cb3495db459797902b790d`.
- Preserve strict same-origin CSP with no `unsafe-inline` or `unsafe-eval`, `Referrer-Policy: no-referrer`, GPC/DNT suppression, and no synthetic valid field telemetry.
- Growth attribution is coarse and allowlisted only. No name, phone, school, email, IP, Device ID, payment reference, licence token, full URL/query string, referrer, contact-book access, user/session identifier, or arbitrary campaign string may enter growth telemetry storage.
- A share-control activation is an intent event, not proof of a successful referral. Peer-attributed visits/starts are counted separately.
- No guaranteed-pass, grade-prediction, fake endorsement, fabricated testimonial, fake scarcity, or ZIMSEC-affiliation claims.
- Free Rescue access remains the primary campaign CTA; Premium remains visible but subordinate until value is delivered.
- Public field Core Web Vitals remain withheld until the existing 100-real-sample threshold is naturally met.

---

### Task 1: Add coarse Rescue source and funnel contracts

**Files:**
- Modify: `commerce/chemistry/storefront/field-experience.mjs`
- Modify: `commerce/chemistry/storefront/field-experience.test.mjs`
- Create: `commerce/chemistry/storefront/rescue-growth.mjs`
- Create: `commerce/chemistry/storefront/rescue-growth.test.mjs`

**Interfaces:**
- Consumes: existing `normalizeTelemetryBatch(req)`, `routeClass(pathname)`, aggregate D1 schema, same-origin `/chemistry/telemetry/v1`.
- Produces: `normalizeGrowthSource(value) -> one of wa_student|wa_teacher|school|creator|meta|tiktok|ambassador|direct`; `rescueEntrySource(url) -> allowlisted source`; new allowlisted events `rescue_visit`, `rescue_start`, `rescue_share`, `rescue_peer_start`, `premium_intent`, `teacher_kit`, `school_kit`, `ambassador_kit`; route class `rescue`; growth event details limited to the eight source classes.

- [ ] **Step 1: Add the focused failing tests**

Assert:
- `/chemistry/rescue` classifies as `rescue`.
- valid source strings normalize exactly; unknown, mixed-case arbitrary, oversized, or injected values normalize to `direct`.
- telemetry accepts Rescue growth events only with allowlisted source detail.
- telemetry rejects email/phone/reference/URL/referrer/session/user fields and arbitrary source detail.
- existing plan-detail events still accept only existing plan IDs.
- source normalization never returns the raw untrusted query value.

- [ ] **Step 2: Verify the relevant failure**

Run: `node --test commerce/chemistry/storefront/field-experience.test.mjs commerce/chemistry/storefront/rescue-growth.test.mjs`
Expected: failures for missing Rescue route/source/events while all pre-existing Phase 3 assertions remain intact.

- [ ] **Step 3: Implement the minimum behavior**

Create `rescue-growth.mjs` as a pure module with a frozen source allowlist and no persistence. Extend `field-experience.mjs` with `rescue` route classification and an explicit event-to-detail policy: plan events accept plan IDs; Rescue growth events accept source classes; other events require empty detail. Do not alter D1 columns or create referral rows.

- [ ] **Step 4: Verify the focused pass**

Run: `node --test commerce/chemistry/storefront/field-experience.test.mjs commerce/chemistry/storefront/rescue-growth.test.mjs`
Expected: all focused tests pass.

- [ ] **Step 5: Run the affected integration check**

Run: `node --test commerce/chemistry/storefront/*.test.mjs`
Expected: all current storefront/field tests plus Rescue tests pass; no existing privacy contract regresses.

- [ ] **Step 6: Commit the passing deliverable**

```bash
git add commerce/chemistry/storefront/field-experience.mjs commerce/chemistry/storefront/field-experience.test.mjs commerce/chemistry/storefront/rescue-growth.mjs commerce/chemistry/storefront/rescue-growth.test.mjs
git commit -m "feat: add privacy-safe Rescue growth contracts"
```

### Task 2: Build the Rescue landing and viral/share loop

**Files:**
- Create: `commerce/chemistry/storefront/rescue-render.mjs`
- Create: `commerce/chemistry/storefront/rescue-render.test.mjs`
- Modify: `commerce/chemistry/storefront/assets.mjs`
- Modify: `commerce/chemistry/storefront/render.mjs`
- Modify: `commerce/chemistry/patch_storefront.py`
- Modify: `commerce/chemistry/storefront/storefront.test.mjs`
- Modify: `commerce/chemistry/storefront/worker-contract.test.mjs`

**Interfaces:**
- Consumes: `normalizeGrowthSource`, existing `shell(...)`, `RELEASE`, plan views, `/chemistry/download/...apk`, Phase 3 field client.
- Produces: GET `/chemistry/rescue`; same-origin rendered Rescue page; privacy-safe WhatsApp share intent; `data-field-event` markers for Rescue funnel; sitemap/footer Rescue link; canonical campaign URL `/chemistry/rescue`.

- [ ] **Step 1: Add the focused failing tests**

Assert the Rescue page:
- has exactly one H1 and main landmark;
- headline is `MUSITU Chemistry Rescue 2026` and primary promise is `How ready are you for A-Level Chemistry? Find out free.`;
- primary CTA is `Start Free Rescue Check` and reaches the existing verified APK/free path;
- secondary CTA invokes WhatsApp sharing with a prewritten message and canonical MUSITU Rescue URL;
- never includes sender name, school, score, phone, payment reference, licence token, or grade prediction;
- accepts only normalized `src` classes and never reflects raw query values into HTML/JS;
- marks `rescue_visit`, `rescue_start`, `rescue_share`, and `premium_intent` with normalized source detail;
- keeps Premium visible below the free Rescue value proposition;
- appears in sitemap and global footer/navigation without removing existing trust/legal links;
- Worker route returns strict Phase 3 CSP/referrer headers.

- [ ] **Step 2: Verify the relevant failure**

Run: `node --test commerce/chemistry/storefront/rescue-render.test.mjs commerce/chemistry/storefront/storefront.test.mjs commerce/chemistry/storefront/worker-contract.test.mjs`
Expected: missing Rescue renderer/route/share assertions fail.

- [ ] **Step 3: Implement the minimum behavior**

Render a lightweight server-side Rescue page. The share control uses a user-initiated `https://wa.me/?text=...` navigation only; do not load WhatsApp SDKs, pixels, third-party scripts, or contact APIs. Source class is normalized server-side from `src`, embedded only as one of eight fixed strings in event metadata, and discarded otherwise. Use existing same-origin CSS/JS; add only bounded Rescue styles/behavior.

- [ ] **Step 4: Verify the focused pass**

Run the Step 2 command.
Expected: all Rescue/storefront/Worker assertions pass.

- [ ] **Step 5: Run the affected integration check**

Build from the sealed source archive with `python commerce/chemistry/patch_storefront.py`, then run `node --check commerce/chemistry/index.storefront-v3.mjs` and `node --test commerce/chemistry/storefront/*.test.mjs`.
Expected: deterministic Worker builds, syntax passes, all tests pass.

- [ ] **Step 6: Commit the passing deliverable**

```bash
git add commerce/chemistry/storefront/rescue-render.mjs commerce/chemistry/storefront/rescue-render.test.mjs commerce/chemistry/storefront/assets.mjs commerce/chemistry/storefront/render.mjs commerce/chemistry/patch_storefront.py commerce/chemistry/storefront/storefront.test.mjs commerce/chemistry/storefront/worker-contract.test.mjs
git commit -m "feat: add MUSITU Chemistry Rescue viral entry"
```

### Task 3: Add teacher, school and ambassador distribution kits

**Files:**
- Create: `commerce/chemistry/storefront/rescue-kits.mjs`
- Create: `commerce/chemistry/storefront/rescue-kits.test.mjs`
- Modify: `commerce/chemistry/patch_storefront.py`
- Modify: `commerce/chemistry/storefront/storefront.test.mjs`
- Create: `growth/chemistry-rescue/teacher-whatsapp.txt`
- Create: `growth/chemistry-rescue/parent-whatsapp.txt`
- Create: `growth/chemistry-rescue/school-outreach.txt`
- Create: `growth/chemistry-rescue/creator-brief.md`
- Create: `growth/chemistry-rescue/ambassador-rules.md`

**Interfaces:**
- Consumes: canonical `/chemistry/rescue`, source allowlist, existing shell/CSP.
- Produces: GET `/chemistry/rescue/teachers`, `/chemistry/rescue/schools`, `/chemistry/rescue/ambassadors`; printable browser views; source-coded share links `wa_teacher`, `school`, `ambassador`; operational outreach templates.

- [ ] **Step 1: Add the focused failing tests**

Assert each kit page has one purpose, one primary Rescue CTA, a printable layout, source-coded allowlisted link, no official-ZIMSEC-affiliation claim, no purchase requirement, no fake testimonial, and no third-party tracking. Assert ambassador rules prohibit spam, fabricated accounts and unverified result claims.

- [ ] **Step 2: Verify the relevant failure**

Run: `node --test commerce/chemistry/storefront/rescue-kits.test.mjs commerce/chemistry/storefront/worker-contract.test.mjs`
Expected: missing kit renderer/routes fail.

- [ ] **Step 3: Implement the minimum behavior**

Create three same-origin server-rendered kit pages and plain-text/Markdown outreach assets. Use browser print CSS rather than introducing a PDF generation dependency. All share links resolve to the Rescue page with one of the fixed source classes. Teacher participation is free; School Premium remains optional after interest; ambassador rewards are described as recognition/limited legitimate rewards only, with anti-spam rules.

- [ ] **Step 4: Verify the focused pass**

Run the Step 2 command.
Expected: all kit/route assertions pass.

- [ ] **Step 5: Run the affected integration check**

Run: `python commerce/chemistry/patch_storefront.py && node --check commerce/chemistry/index.storefront-v3.mjs && node --test commerce/chemistry/storefront/*.test.mjs`
Expected: deterministic build and full storefront suite pass.

- [ ] **Step 6: Commit the passing deliverable**

```bash
git add commerce/chemistry/storefront/rescue-kits.mjs commerce/chemistry/storefront/rescue-kits.test.mjs commerce/chemistry/patch_storefront.py commerce/chemistry/storefront/storefront.test.mjs growth/chemistry-rescue
git commit -m "feat: add Rescue teacher school and ambassador kits"
```

### Task 4: Create the 30-day national launch content system

**Files:**
- Create: `growth/chemistry-rescue/30-day-calendar.md`
- Create: `growth/chemistry-rescue/short-video-scripts.md`
- Create: `growth/chemistry-rescue/ad-copy.md`
- Create: `growth/chemistry-rescue/content-qa.md`
- Create: `growth/chemistry-rescue/budget-operations.md`
- Create: `growth/chemistry-rescue/README.md`

**Interfaces:**
- Consumes: approved campaign hooks, canonical Rescue route, source classes, US$200–500 monthly budget.
- Produces: launch-ready copy/scripts with one primary CTA; source-coded channel links; weekly operating cadence; paid test/stop/scale rules.

- [ ] **Step 1: Add the focused failing validation**

Create `content-qa.md` as a deterministic review contract requiring every launch asset to have exactly one primary CTA, no guaranteed pass/grade prediction/ZIMSEC endorsement/fake scarcity, an explicit source class, and no unsolicited bulk-messaging instruction.

- [ ] **Step 2: Verify the relevant failure**

Run a repository text scan that fails when the required six growth files are absent or contain prohibited phrases such as `guaranteed pass`, `official ZIMSEC partner`, or instructions to scrape/bulk-message student numbers.
Expected: failure until the launch pack exists.

- [ ] **Step 3: Implement the minimum behavior**

Write a 30-day calendar with at least 3 student challenge videos, 2 misconception posts, 1 teacher post, 1 parent post and 1 WhatsApp asset per week; at least 10 ready-to-record short-video scripts; Meta/TikTok/creator copy variants; teacher/school outreach cadence; and budget rules using a US$300 reference split while supporting the approved US$200–500 range. Every asset points to `/chemistry/rescue` with the appropriate allowlisted source class.

- [ ] **Step 4: Verify the focused pass**

Run the same content scan.
Expected: required assets present; prohibited-claim scan returns zero findings.

- [ ] **Step 5: Run the affected integration check**

Run: `node --test commerce/chemistry/storefront/*.test.mjs`.
Expected: content-only files do not affect product tests.

- [ ] **Step 6: Commit the passing deliverable**

```bash
git add growth/chemistry-rescue
git commit -m "docs: add 30-day Chemistry Rescue launch system"
```

### Task 5: Certify and deploy the national Rescue surface

**Files:**
- Create temporarily: `.github/workflows/chemistry-rescue-growth-preflight.yml`
- Create temporarily after preflight: `.github/workflows/chemistry-rescue-growth-deploy.yml`
- Create temporarily after deploy: `.github/workflows/chemistry-rescue-growth-live-verify.yml`
- Modify after independent verification: `commerce/chemistry/RELEASE_BASELINE_20260906.json`
- Create: `commerce/chemistry/CHEMISTRY_RESCUE_2026_CONTINUATION.md`

**Interfaces:**
- Consumes: exact generated Worker candidate, live predecessor `1134a258...`, existing Cloudflare bindings/secrets, existing APK and licence invariants.
- Produces: sealed preflight artifact; guarded content-only cutover; independent read-only live artifact; next release-baseline schema/state.

- [ ] **Step 1: Add the preflight workflow**

Preflight must reconstruct from the proven source archive, verify dependency hashes, build twice and require identical candidate SHA, run all Rescue/Phase 3/storefront tests plus original 8 commerce tests, run syntax/static secret/privacy scans, start the Worker locally, run axe on Rescue + kit + existing critical pages, verify 320px reflow/keyboard/reduced-motion, and run Lighthouse. It must assert the Rescue page strict CSP/referrer policy and APK/catalogue/licence invariants. Record field-INP as field evidence only; do not seed telemetry.

- [ ] **Step 2: Verify preflight success**

Expected: workflow conclusion `success`, zero serious/critical axe findings, established Lighthouse budget maintained, exact candidate hash sealed in artifact, all commerce tests green.

- [ ] **Step 3: Perform guarded deployment**

Deployment must prove exact successful preflight artifact/head/candidate, re-read Cloudflare source and require predecessor hash `1134a258...` before mutation, upload content-only candidate, require sustained multi-sweep convergence across existing 11 critical routes plus Rescue and three kit routes, reverify CSP/referrer policy, health, six-plan catalogue, APK bytes/hash, licence key, payment bindings, recovery hardening, Experience endpoint and cross-origin telemetry rejection. Automatic rollback to predecessor on any post-upload failure.

- [ ] **Step 4: Independently verify live state**

A separate read-only workflow must re-read the Cloudflare Worker source, prove exact candidate SHA, repeat multi-sweep public verification from a fresh runner, verify Rescue source normalization by testing only GET/render behavior, and make no valid telemetry POST or production mutation.

- [ ] **Step 5: Advance evidence baseline and clean temporary workflows**

Only after independent verification succeeds: update `RELEASE_BASELINE_20260906.json` to the next schema/status recording Rescue growth collection live, exact candidate/deploy/verify run IDs and artifact digests, while keeping field-CWV and real-money-settlement claim boundaries unchanged. Write `CHEMISTRY_RESCUE_2026_CONTINUATION.md`. Remove temporary preflight/deploy workflows after sealing; retain only a read-only verifier if it is useful for future recertification.

- [ ] **Step 6: Commit the passing evidence state**

Commit manifest/continuation/cleanup changes only after all live gates pass.

## Unresolved externally observable decisions

None. The approved design fixes the campaign name, A-Level scope, hybrid free/Premium model, WhatsApp-first distribution, US$200–500 paid range, privacy boundary, canonical Rescue route, and release-gate policy. The implementation recommendation to use printable web kits instead of generated PDFs is intentionally chosen to minimize download weight and dependencies while satisfying the approved Teacher/School kit requirement.
