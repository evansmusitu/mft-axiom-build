# MUSITU Axiom — Candidate independent-mine source preflight (research only)

This is a **read-only input-integrity preflight**, not independent mine validation, proof of ownership/licensing, forecasting qualification, or mine-safety certification. **No third-party dataset has been admitted by this code.** It processes a locally provided canonical NDJSON telemetry file and a separate locally provided provenance manifest. It does not read credentials, call production services, upload sensor data, train a model, calculate its predictive accuracy, or enable model admission.

## Source format

UTF-8 newline-delimited JSON, **one complete event per line**, strictly increasing timezone-aware `event_time`. The stream must include all 28 channels in `connect.mining_telemetry.MINING_TELEMETRY_SENSORS`, no other keys, and one `event_time`. Numeric channels must be finite JSON numbers; `F_SIDE` is `left`, `right`, `l`, `r`, `0`, `0.5`, or `1`. The source is never cleaned, filled, reordered, clipped, or converted silently. Gaps of more than one second are counted; the existing methane history/future label generator resets on discontinuity. Duplicate or backwards timestamps, missing/extra sensors, invalid values and forged hashes are errors.

A source owner must provide a **separate manifest** (example values only—do not commit customer manifests):

```json
{
  "schema": "musitu.axiom.external_source_manifest.v1",
  "source_format": "canonical_mining_telemetry_ndjson.v1",
  "source_sha256": "<64-character SHA-256 of the exact NDJSON source bytes>",
  "site_id": "<private true mine identifier>",
  "source_collection_id": "<private true collection identifier>",
  "rights_basis": "<documented, authorized research-use basis>",
  "authorization_reference": "<private source-owner permission record>",
  "provenance_reference": "<private acquisition chain-of-custody record>",
  "declared_source_rows": 1234567,
  "declared_start_time": "2025-01-01T00:00:00+00:00",
  "declared_end_time": "2025-01-15T06:56:06+00:00"
}
```

The recorded first and last timestamps and record count must match the actual data; the example above is **illustrative**, not a valid supplied dataset. Rights and independent origin are **declarations only**, not verified proof. The tool explicitly refuses the known public development dataset digest/identifier, but repackaging the same data cannot prove external independence. A human/legal provenance review and a genuine separate mine or site are necessary before independent validation.

## Local command (private authorized environment only)

```bash
python -m benchmarks.mining_adapter.external_source_preflight \
  --source /private/path/authorized-telemetry.ndjson \
  --manifest /private/path/authorized-manifest.json \
  --output /private/path/new-preflight-summary.json
```

The output cannot overwrite an existing file or either input. If scanning/validation fails, the process exits non-zero and emits no success evidence. Output contains source/manifest digests, de-identified aggregates, positive future-window counts, coarse chronological support blocks and failure-to-admit disclosures. It never emits raw sensor rows, site name, rights text or acquisition record. Preserve summaries under your own access policies; source digests and timestamps can still be commercially sensitive.

**Predeclared task:** exactly the existing 600-second history; 180–360-second future threshold label at 1.0 methane; 30-second sampling stride. The four chronological support blocks are **descriptive quarters of the candidate data**, not the original four purged qualification folds and not independently verified mine events. Overlap-connected positive label groups are *not unique hazardous incidents*. The tool cannot decide whether an external site is independent by itself.

## CI contract

`.github/workflows/musitu-axiom-external-source-preflight.yml` exercises adversarial regression tests **only on generated synthetic local records**. It does not fetch/upload mine data and does not produce mine performance claims. New data, when legitimately obtained, must be evaluated in an authorized isolated environment by frozen model artifacts and a predeclared independent evaluation protocol. Passing this preflight does not satisfy the 3/4 methane fold gate or unlock production Axiom integration. PR #9 remains unmerged and sealed `main` unchanged unless explicitly authorized.
