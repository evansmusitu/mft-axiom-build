# MUSITU Connect — Lossless Partner Mine Mapping (research only)

This Mining Adapter intake utility belongs to **MUSITU Connect**, not the downstream Axiom inference engine. It is a **lossless local field-name mapper** that accepts a separately documented partner sensor inventory and produces research-only canonical telemetry and a source manifest. It does **not** verify real-world sensor equivalence, mine ownership, permission, site independence or safety suitability.

## Source contract

The partner must supply confidential UTF-8 newline-delimited JSON, precisely 1 second between successive timezone-aware timestamps, with 28 independently measured fields corresponding to `connect.mining_telemetry.MINING_TELEMETRY_SENSORS` and one timestamp field. Numeric values must be native finite JSON numbers; `F_SIDE` must use documented native `left`/`right`, `L`/`R`, `0`, `0.5` or `1` states.

The mapping JSON must have `schema: "musitu.connect.mining.partner_sensor_mapping.v1"`, nonempty `source_site_id`, `source_collection_id`, `source_time_field`, `rights_basis`, `authorization_reference`, `provenance_reference`, `state_semantics_reference`, and `source_sampling_interval_seconds: 1`. Set `interpolation_applied`, `missing_values_filled`, and `downsampling_applied` to `false`.

Each of its **28** `bindings` must contain exactly one `source_field`, a distinct `canonical_sensor` from the contract, `transform: "identity"`, `unit_equivalence_reference` and `location_equivalence_reference`. Example of **one** binding:

```json
{
  "source_field": "PARTNER_DOCUMENTED_SENSOR_123",
  "canonical_sensor": "MM263",
  "transform": "identity",
  "unit_equivalence_reference": "PRIVATE_DOCUMENTED_UNITS",
  "location_equivalence_reference": "PRIVATE_DOCUMENTED_SENSOR_POSITION"
}
```

This reference is illustrative: **never invent 27 missing channel readings or copy one channel into multiple canonical fields.** The mapping references are declarations only; actual physical, positional, calibration and safety equivalence requires review by the data owner and qualified engineers. A different sampling rate or missing field fails closed—no interpolation, resampling, scaling, clipping, averaging or imputation.

## Local command

Only run in an access-controlled environment with authorized data. No production secrets or cloud connection are required.

```bash
python -m connect.partner_mine_mapping \
  --source /private/partner-raw.ndjson \
  --mapping /private/partner-mapping.json \
  --output-source /private/new-canonical.ndjson \
  --output-manifest /private/new-canonical-manifest.json

python -m benchmarks.mining_adapter.external_source_preflight \
  --source /private/new-canonical.ndjson \
  --manifest /private/new-canonical-manifest.json \
  --output /private/new-preflight-report.json
```

The converter verifies the entire source stream, checks monotonic **contiguous 1-second** timestamps, finite numeric channels and all sensor/state codes. It refuses existing output files and input/output aliases, checks input-source bytes for mutation, writes intermediate files and publishes only after validation. It never rewrites the original input. A SHA-bound source manifest follows `musitu.axiom.external_source_manifest.v1`. The CLI reports only aggregate evidence and digests, not private raw rows or source-site identifiers.

**The canonical source and manifest contain sensitive customer information. Do not upload them to public GitHub or CI.** No successful conversion authorizes Axiom production use, predicts mine hazards safely, verifies independent sensor semantics or establishes rights.

## CI

`.github/workflows/musitu-connect-partner-mine-contract.yml` uses **generated synthetic telemetry only**, performs adversarial tests for missing/duplicate fields, 15-second cadence, invalid sensor types, unapproved transforms, absent mapping references, and protected output files, and verifies downstream preflight interoperability. It asserts that Connect does not import Axiom benchmark modules.

**PR #9 remains unmerged; sealed `main` unchanged; production Axiom integration blocked.**
