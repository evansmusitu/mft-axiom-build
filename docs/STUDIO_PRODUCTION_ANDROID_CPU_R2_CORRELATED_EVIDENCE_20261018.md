# MUSITU Studio — Real production CPU/R2 and Android-UA API evidence (2026-10-18)

## Source and boundary
Canonical fully verified handoff pinned at `9439cdae2fbb8073c6300558ae01441d12d1425d`; working branch `experiments/studio-remote-r2-modal-e2e-20261017`. This continuation is **read-only against all production providers**. No Modal job was submitted, R2 object written, Cloudflare Access/WAF configuration modified, Studio Worker deployed, or default/Axiom branch changed. Only source and diagnostics were committed on the isolated Studio branch.

## Newly verified, previously missing provider proof

### Real dedicated production Studio R2 state, 2026-10-18 06:41:39 UTC
[Run 39104926990](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39104926990) **SUCCESS**, 5/5 privacy/integrity tests PASS; remote GET of real `musitu-studio-v02-assets/studio-control/v1/state.json` (NOT the historical QA-only key) found:
- 1 project; 1 job, CPU device; 1 COMPLETED, 0 FAILED, 0 RUNNING, revision 6, six audit events.
- Job created **2026-10-18 06:34:36.361 UTC** and finished **06:35:48.024 UTC**.
- Stored audit action types: `PROJECT_CREATED → JOB_SUBMITTED → JOB_APPROVED → DISPATCH_STARTED → DISPATCH_ACCEPTED → RENDER_COMPLETED`.
- Read-only remote R2 GET for **all three exact completed-job objects**: `scene.blend`, `scene.glb`, `preview.png`, each **byte-length + SHA-256 + artifact header valid**. No raw binary, customer titles, job UUID, staff identity or scene data was retained in Actions artifacts.
- This live production object was not part of the earlier isolated QA flow and was not created or changed by this audit.

### Cloudflare Access + Android mobile/API telemetry, 2026-10-18 06:45 UTC
[Run 39105161248](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39105161248) **SUCCESS**, 2/2 privacy unit tests PASS. Cloudflare Access authenticated login audit API HTTP 200 and exact-zone GraphQL HTTP analytics HTTP 200, for narrow target time windows:
- Exactly **one allowed Studio Access login** during 06:00–06:45 UTC, no denied Studio login in this window.
- GraphQL sampled 23 relevant `/api/` requests in 06:34–06:37 UTC, including mobile POST successful job submission, approval, dispatch and sync paths.
- No names, email addresses, IPs, User-Agent strings, state contents, request URLs with UUIDs, cookies or tokens exported.

### Exact completed-job correlation to successful Android-UA requests
[Run 39105413239](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39105413239) **SUCCESS**, 3/3 tests PASS. An ephemeral R2 read extracted the completed CPU job identifier privately, then joined it to **exact same-job** successful mobile POST approval, dispatch and sync paths from Cloudflare GraphQL **restricted to `userAgent_like: "%Android%"`**, a successful mobile POST job submission and the preceding allowed identity-bearing Cloudflare Access login. All three resulting objects were remotely GET-verified again for SHA-256, byte-size and format.
- Correlation predicate `mobile_access_cpu_r2_provider_correlated = true` was earned, with no job IDs or identities leaked.
- Cloudflare Access/HTTP analytics were **sampled**, and the login and per-request traffic are temporally correlated, **not cryptographically linked as one named session**. Mobile/Android User-Agent and device-category strings are **not physical handset attestation**. No screenshot, device-held browser certificate or physical-device proof was received. Therefore **do not change `physical_android_attested = false`** or claim a signed end-user-device certificate.

### Android asset-download completion still incomplete as of latest query
[Run 39105561833](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39105561833) **SUCCESS**, 4/4 tests PASS: same-job Android-UA mobile GETs with successful HTTP statuses observed for `scene.blend` and `preview.png`; **no qualifying `scene.glb` GET sampled in the checked 06:33:00–06:37:30 UTC window**. That is **not proof that the download never happened**; analytics are sampled and later clicks may fall outside this window. All three files **exist and have valid real R2 hashes**. `all_three_assets_downloaded_from_android_ua = false` is the only supported download-telemetry classification for the checked window.

## Evidentiary status — exact, not inflated

**Earned:** Real production R2 CAS persisted a CPU job from approval through render COMPLETED; all three real remote R2 assets independently pass SHA-256/size/format checks; narrowly correlated Cloudflare Access allowed human-identity login and Android-UA mobile successful API calls on the **same completed job path**. This is substantial genuine production-provider-backed evidence, not historical Wrangler-local QA alone.

**Not earned:** cryptographically bound single staff Access session to job, trusted physical Android-device attestation, proven complete Android download of all three files, independent per-job Modal provider-execution record beyond deployed Worker lifecycle result, transactional D1 queue, Modal GPU T4 entitlement, enterprise multiuser certification.

**Existing safeguards:** Cloudflare staff-only Access and signed Worker session, exact-host Security Level skip (not global), BIC on, Axiom rules preserved, GPU execution off, one R2 single-admin CAS pilot. Do not weaken these.

## Test/release inventory
- TDD red `python -m unittest -v test_studio_r2_live_audit` exit 1 (4 assertions); green exit 0 (4/4); extended 5/5 green. GitHub intentional pre-green red [39104913490](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39104913490) then [39104926990](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39104926990) GREEN.
- TDD red `python -m unittest -v test_studio_usage_forensics` 2 KeyErrors; green 2/2; [39105161248](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39105161248) GREEN.
- TDD red `python -m unittest -v test_studio_browser_chain` 3 KeyErrors; green 3/3; Android asset GET extension red 1 KeyError, green 4/4. GitHub intentional red [39105549123](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39105549123) then [39105561833](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39105561833) GREEN.
- New production-provider releases this continuation: **NONE**. New Cloudflare configuration or Modal compute spend this continuation: **NONE initiated**. New source and GET-only verification workflows on isolated Studio branch only. Retained production R2 objects are pre-existing.

## Next safe action
A real approved staff member should use the Android browser on `https://studio.mftintelligence.com/` to download the `scene.glb` output for the completed job (and re-download all if needed). Do not share Access credentials, callback URLs, bearer tokens or real job UUID in chat. After that, rerun **read-only Cloudflare analytics with a wider time window** and same-job strict join if available. If physical-device origin must be formally certified, design a separate user-confirmed browser attestation and record a cryptographically session-bound audit receipt in a reviewed source-only change; do not fake retrospectively. D1 Create permission and GPU billing entitlement remain independent blockers.

### Follow-up extended remote read (no browser simulation)
[Run 39105771333](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39105771333) **SUCCESS**, 4/4 tests PASS. The exact-job Android-UA mobile GET observation window was extended from 06:37:30 to **06:53:00 UTC**, covering 20 minutes. The sampled provider analytics still reported **one GET each for `scene.blend` and `preview.png`, zero for `scene.glb`**. This remains a bounded observation and is not proof the third file never downloaded. A genuine human Android download is still needed to qualify complete browser download evidence. No test request was sent to production as a browser impersonation.
