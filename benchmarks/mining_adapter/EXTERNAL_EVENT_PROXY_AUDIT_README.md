# Axiom methane: diagnostic window-overlap proxy audit

This addition does **not** represent independent mine validation or an additional
qualified forecasting model. It adds constant-memory, fail-closed diagnostic
summaries to the existing **frozen-model** external-data research evaluator.

## Semantics and limits

- A positive example means the original frozen model's *future label* is true.
  A continuous union of its `t+180` to `t+360` projected time intervals is a
  **positive forecast-window overlap group**. These groups **are not actual
  observed physical methane incidents**, distinct hazards or independent events.
- A false-positive prediction is a positive warning on a negative future-label
  window. Adjacent false positives on exactly successive 30-second prediction
  windows form **false-alert prediction streaks**. Streak counts are not
  operational alarm episodes, person-hours, cost, or unique operator pages.
- Reports provide counts of forecast-window proxy groups detected/missed,
  observed hard-warning group detection, false-alert prediction streaks and
  exact per-window SHA-256 trace commitments. The digest includes timestamps
  and decision bits and is **not proof of data provenance or authenticity**.
  No raw rows or detailed timestamp series are included in the output.
- Changes in proxy counts are supplemental *descriptive* research evidence.
  They are NOT additional model-admission criteria, and they cannot replace
  independent mine incident annotations, credible site provenance or the
  frozen four-fold development gate.

## Fail-closed behavior

The evaluator's unchanged hard-warning rule remains mandatory and each
prediction goes through `EventProxyAudit.observe`. It rejects a suppressed
observed methane warning, malformed timestamps, unsorted data, non-boolean
outcomes and forecasting horizons other than the frozen 360-second end.

`external_validation_gate.assess_external_evidence` now requires audit metadata
and independently checks confusion-matrix agreement for the number of samples,
positive examples, false positives, hard observed warnings and proxy group
bounds. It always blocks production admission and rejects a claim that window
proxies are unique physical incidents.

## Verification

```bash
python -m unittest tests.connect.test_external_event_proxy_audit tests.connect.test_external_validation_gate -v
python -m unittest tests.connect.test_frozen_model_bundle tests.connect.test_frozen_mine_evaluator -v
```

CI: `.github/workflows/musitu-axiom-external-event-proxy-audit.yml` downloads
the **exact SHA-pinned native model** from successful research run
`37882474024`, and replays generated 2,400-record synthetic telemetry through
the production-code feature builder, frozen model, evaluator and research gate.
CI archives only aggregate synthetic summaries, never mine telemetry.

**No model retraining or threshold recalibration occurs during evaluation.
PR #9 remains open/unmerged; sealed `main` and production Axiom integration
remain untouched and blocked.**
