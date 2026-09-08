# MUSITU Chemistry 1.3.0 Frontier — Universal Release Certification Packet

**Status:** PRIVATE CERTIFICATION CONTROL — NOT AUTHORIZED FOR PUBLICATION  
**Prepared:** 2026-09-09  
**Repository:** `evansmusitu/mft-axiom-build`  
**Release-control branch:** `chemistry-frontier-universal-20260908`  
**Baseline release-control head:** `d71c19465a4bb3f2c317f439c1c29e04093812cd`

## 1. Immutable candidate identities

### Android side-by-side carrier
- File: `MUSITU_Chemistry_1.3.0-frontier-sidecar-rc1_PRIVATE_RELEASE_SIGNED.apk`
- SHA-256: `4ba442122d9c86a0c3cef660334fe337c6ea9ae6fe853c964b5e94961245babd`
- Bytes: `5,892,286`
- Application ID: `com.musitu.chemistry`
- Legacy repaired application ID: `com.mft.chemistry`
- Native Activity retained: `com.mft.chemistry.MainActivity`
- MUSITU Android signing certificate SHA-256: `d4455ac3ec74a6d7cd7993ca640f554a83bba95dfd01ef508f7637b6bc72c0d8`
- Signatures: v1 PASS / v2 PASS / v3 PASS
- Non-signature payload equality against verified unsigned sidecar: PASS
- Publication authorization: NO

### Reproducible universal web/PWA carrier
- File: `MUSITU_Chemistry_1.3.0-frontier-universal-repro-web.zip`
- SHA-256: `1445074e87e8c4a9a15281baa586855fe31f92c06dd393a11458adce9821ec30`
- Core files: 27
- Runtime target: browser + installable PWA/standalone carrier
- Publication/deployment authorization: NO

### Preserved product lineage
- Repaired customer base SHA-256: `f0c00c616b359b3ccd112ca55901ef4dc6c8b162f7a3d4add1c213f8a149614a`
- Android unsigned sidecar SHA-256: `d5cb434021027498c473fbfb2b4ac4d4862e72ad218071a7a453012fee10b4db`
- Study state: `mftChemistryFrontierStateV2`, import envelope `schemaVersion: 2`
- Commerce state remains separate and must never be cloned as learner-state migration.

## 2. Global release rule

A Frontier release is GREEN only when every mandatory platform gate below is evidenced against the immutable candidate hashes above, or is explicitly marked not applicable by the gate itself. Static/source evidence cannot substitute for a physical/device/browser observation where the gate requires one.

Passing this packet does **not** authorize publication. Publication requires a separate explicit user instruction after certification.

No test in this packet requires a real-money payment.

---

## Gate A — Android installation, identity, coexistence and lifecycle

1. Keep the existing repaired `com.mft.chemistry` application installed and verify it opens.
2. Export learner progress from the old application and retain the JSON safely.
3. Verify the private 1.3.0 APK SHA-256 before installation.
4. Install `com.musitu.chemistry` without uninstalling `com.mft.chemistry`.
5. Confirm Android reports no package/signature collision.
6. Confirm both applications remain independently launchable.
7. Cold-launch the new application.
8. Warm-launch/relaunch the new application.
9. Send the app to background for at least 15 seconds and resume; verify no blank/locked screen or state loss.
10. Exercise Android system Back from at least Home -> chapter, More -> Help, Premium/paywall -> prior surface; navigation must remain coherent.
11. Rotate portrait -> landscape -> portrait where rotation is supported; verify state and controls remain usable.
12. Trigger the native share/export bridge and confirm the Android share/file surface opens correctly.
13. Trigger import and confirm the Android file picker/import bridge opens correctly.
14. Enter text into at least one answer/equation field using the on-screen keyboard; IME appearance/dismissal must not strand controls behind the keyboard.

**PASS:** all applicable observations above pass; old app remains installed throughout migration verification.

## Gate B — learner-state migration and persistence

1. Import the old app export into the new app.
2. Verify route/profile.
3. Verify bookmarks.
4. Verify confidence/mastery values.
5. Verify diagnostic history/result where present.
6. Verify exam history where present.
7. Verify FSRS/review scheduling where present.
8. Verify streak/study-day data where present.
9. Close/relaunch and verify the imported state persists.
10. Export from the new app and confirm a valid `schemaVersion: 2` backup can be produced.

**PASS:** no expected learner-state field is silently lost or replaced by commerce state.

## Gate C — core learner interactions

Exercise at least one real interaction for each applicable free surface:
- Home navigation
- diagnostic question interaction and result path
- Chapter 1 open/read
- Chapter 2 open/read
- bookmark toggle
- confidence update
- review/retrieval interaction
- 5-minute foundation exam start, answer, finish and history
- More
- About
- Help
- progress export

No control may be inert, open a blank surface, produce an uncaught runtime error, or silently lose state.

## Gate D — Frontier Scientific Response / Prove layer

1. Verify first-launch `Diagnose -> Revise -> Prove` onboarding where applicable.
2. Open Prove / Scientific Response.
3. Equation entry.
4. Ink/drawing stroke.
5. Molecular/structural representation.
6. Mechanism representation.
7. Graph or graph-data representation.
8. Apparatus or particle representation.
9. Scientific argument field.
10. Accessibility description/representation.
11. Create at least one cross-representation relation.
12. Finish response; editing must lock.
13. Close/relaunch; finalized state must remain finalized.
14. Reopen; editing must become available again.
15. Confirm certified expression mode provides no generated answer completion, correctness hint, automatic equation balancing, hidden retrieval, remote AI inference, or client-side marking authority.
16. With repeated drawing/representation use, verify touch input remains responsive and no obvious state corruption occurs.

## Gate E — Android accessibility and resilience

1. Increase Android font/display size one step; critical navigation and study controls remain reachable and legible.
2. Enable TalkBack (or the platform accessibility screen reader) and verify critical Home, Learn, Review/Exam, Prove, Premium and Help navigation has meaningful focus/labels.
3. Verify visible keyboard focus when a hardware/Bluetooth keyboard is available; otherwise record `not_available_on_device` rather than fabricating PASS.
4. Verify touch targets are usable with coarse touch on primary navigation and answer controls.
5. Verify reduced-motion preference where exposed by the device/WebView does not break navigation or hide state changes.
6. Repeat background/resume after a completed learner action and after a Scientific Response edit; state must survive.
7. Perform at least 15 minutes of mixed navigation/study/Prove interaction; no progressive slowdown, blank WebView or irreversible stuck state.

## Gate F — offline behavior

1. Open required free/study content online once.
2. Disable mobile data and Wi-Fi / enable airplane mode.
3. Relaunch.
4. Locally packaged academic content still opens.
5. Learner-state changes persist locally.
6. A previously activated signed Premium entitlement verifies locally without requiring the network merely to validate its token.
7. Checkout/payment initiation must not fabricate payment success or entitlement while offline.
8. Reconnect and verify normal network-linked surfaces recover.

## Gate G — commerce and entitlement boundary

1. Free state exposes only diagnostic, Chapters 1–2 and 5-minute foundation exam.
2. Chapters 3–18 fail closed without Premium.
3. 15/30/90-minute exams fail closed without Premium.
4. Chemistry Tools and Final 48 fail closed without Premium.
5. Device ID is visible/copyable.
6. Checkout handoff targets the trusted hosted MUSITU Chemistry checkout; do not complete payment for this smoke.
7. Return/back-out from checkout safely.
8. Premium transfer/reissue, where testing an existing paid user, is performed legitimately for the **new Device ID**. Never copy the old commerce store manually.
9. Activated Premium survives relaunch.
10. Activated Premium survives offline restart.
11. Remove licence and verify Premium fails closed again while learner progress remains intact.
12. Reset study progress and verify it does not silently erase a separately valid commerce entitlement.

## Gate H — iPhone/iPad Safari and installed PWA

This gate must use the exact 1.3.0 universal carrier bytes on an authorized HTTPS origin. Do not publish or expose a new customer origin merely to satisfy this packet.

For at least one current iPhone and one iPad form factor where available:
1. Open in Safari and verify dedicated MUSITU Chemistry identity.
2. Verify safe-area layout around notch/home indicator where applicable.
3. Follow Add to Home Screen flow.
4. Launch from the installed icon and verify standalone app identity/launch target.
5. Complete first-launch onboarding.
6. Exercise Home, Learn, Review/Exam, Prove, Premium and Help.
7. Test equation/text input with iOS keyboard.
8. Test an ink gesture in Scientific Response.
9. Background/resume and relaunch; local state persists.
10. After initial online load, disable network and verify offline-ready study behavior.
11. Confirm checkout/settlement/claim authority is not synthesized offline.
12. Reconnect; hosted links recover.
13. For iOS non-Safari/in-app browser, verify the product gives correct handoff guidance instead of falsely claiming direct installation support.

## Gate I — desktop cross-browser

Against the exact 1.3.0 carrier on an authorized isolated HTTPS preview or explicitly authorized final origin, run at minimum:
- Chromium/Chrome
- Microsoft Edge
- Firefox
- Safari on macOS when available; otherwise record `not_available_in_certification_environment` and keep the gate open for Safari.

For each browser:
1. Load application with zero uncaught startup errors.
2. Verify Home/Learn/Review/Exam/More navigation.
3. Verify keyboard navigation and visible focus on critical controls.
4. Verify diagnostic interaction.
5. Verify chapter interaction/bookmark/confidence.
6. Verify 5-minute exam lifecycle.
7. Verify Scientific Response equation plus one structured representation.
8. Verify Finish -> reload -> Reopen persistence.
9. Verify responsive layout at a narrow and wide viewport.
10. Verify Premium/Help views.
11. Verify offline-capable behavior where the browser supports the installed/service-worker contract.
12. Confirm no hidden answer generation or remote AI in certified expression mode.

## Gate J — hosted product/trust layer and final-origin contract

Current hosted production compatibility may be verified GET-only before deployment, but that does not certify the undeployed 1.3.0 carrier itself.

After explicit authorization for an isolated preview or final deployment:
1. `/chemistry/`
2. `/chemistry/app`
3. `/chemistry/install`
4. `/chemistry/plans`
5. `/chemistry/verify`
6. `/chemistry/support`
7. `/chemistry/privacy`
8. `/chemistry/terms`
9. `/chemistry/experience`
10. `/chemistry/rescue`
11. `/chemistry/manifest.webmanifest?v=2`
12. `/chemistry/sw.js`
13. strict headers/CSP
14. dedicated app identity and install handoff
15. server-authoritative prices
16. payment/settlement/licence authority remains server-side
17. unpaid/failure states remain fail-closed
18. offline worker never fabricates checkout, settlement, claims, plans or entitlement
19. record immutable GET-only provenance when the probe is read-only

## Gate K — release integrity and evidence capture

Record for every physical/browser run:
- date/time and tester
- OS/version
- device manufacturer/model or browser/version
- screen/viewport and orientation
- candidate SHA-256 or deployed source SHA
- cold/warm launch
- console/WebView/runtime errors
- blank/inert controls
- migration result
- offline result
- Scientific Response result
- accessibility result
- Premium transfer result if performed
- screenshots or screen recording for failures and key PASS checkpoints where practical

A failure creates a defect; it must not be converted into a PASS by reducing the requirement.

## Release decision

**Android carrier GREEN:** Gates A-G pass on a real Android device, including applicable Premium restore/reissue checks.  
**iOS/PWA GREEN:** Gate H passes for the required Apple form factors.  
**Desktop GREEN:** Gate I passes for all available required browsers; unavailable Safari remains explicitly open rather than silently waived.  
**Hosted final-origin GREEN:** Gate J passes against the exact authorized preview/final carrier.  
**Universal Frontier GREEN:** Android + iOS/PWA + Desktop + Hosted gates are all GREEN and Gate K evidence is sealed.

Even when Universal Frontier is GREEN, **publication remains NO until the user explicitly authorizes publication**.
