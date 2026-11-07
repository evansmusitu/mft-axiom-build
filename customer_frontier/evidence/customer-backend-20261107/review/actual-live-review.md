# Independent live observation: controlled backend run

**Bounded live controlled-backend evidence accepted. No inconsistency found in the observed job result and cleanup.** [Hosted run42342396830](https://github.com/evansmusitu/mft-axiom-build/actions/runs/42342396830), job128312735103, completed SUCCESS at05:22:16UTC on2026-11-07. Event head `a85c707296f0db89a7cce171330aa529e224adc9`; reviewed checkout `8bd16133acb9e09bd3d050c1d523ed54950e9de3`.

Independent GitHub reads confirm the published workflow still exactly matches admitted blob `1fe7933edffba85d54113f0175589bd8ce9f9202` and SHA256 `ef45f1b8…`. Immutable admission, SQLite tests, locked install and nativeworkerd tests all succeeded before the credentialed fixture step. The fixture step, separate deactivation/cleanup and artifact preservation then succeeded.

The live driver emitted PASS_CONTROLLED_FIXTURES_ONLY and phasePASS_DISABLED. Logged flags confirm server-side tenant binding, selected project/work isolation, CSRF denial, closed payment admission, concurrent budget/reservation replay and hold-finalization checks, durable session/budget restart, controlled logout and membership revocation. Eleven qualifier POSTs (ten phases plus final disable) returned200. Old operator access returned401; owned Worker deletion returned200 and its final readback404. Separate REST cleanup reports fixture_authority_disabled=true, temporary_worker_removed=true and database_deleted=false.

All real_identity, production_ownership, onboarding, ChatGPT continuity, payment, hosted_restore, production_oauth_changed, full customer_acceptance and release flags remain false. This is the controlled-principal composition reviewed earlier, not real IdP/ownership/payment certification or every customer API/role/device acceptance.

Parallel [candidate CI42342396728](https://github.com/evansmusitu/mft-axiom-build/actions/runs/42342396728), job128312734731, independently logged227Node,134Python and18workerd tests passed.

| Fresh decoded log | Bytes | SHA256 |
| --- | ---: | --- |
| Hosted42342396830 | 35,204 | `4c6ba3dd5f55dcbdeecaae4d05e31065d4211cfc24092e85233d2b6517fa6ac5` |
| CI42342396728 | 153,258 | `5a289ebfbeb53b287d25f49c11e79da925b516dd3eaf32556cdfdc3be5bab544` |

Exact fresh logs, metadata and extracted safe JSON are retained as `actual-hosted-42342396830.log`, `actual-ci-42342396728.log`, `actual-live-result.json` and `actual-live-verification.json`. These can be compared with root's later evidence commit. The final report retains the last assigned prepared-statement counter17, not each actual phase counter; all successful phases ran under the reviewed hard48counter guard. Do not restate local per-phase counts as individually retained hosted measurements.

This reviewer made only GitHub reads and local evidence checks: no Cloudflare account call, provider execution, customer key/private database/custody access or root-source mutation. The observation accepts the actual bounded fixture backend checks and cleanup at job completion. It does not close real customer identity/ownership/onboarding/continuity, production OAuth upgrade, real checkout/settlement/device, execution/finalusage, hosted restore, custody/anti-rollback, integration, production deployment or release gates. Preserve PR1,$0,Paynow,customer/q06 data,rollback origin and B27/parity/final-usage authority.
