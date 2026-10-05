# MUSITU Axiom Level-5 External Evaluation Execution — 2026-09-12

## Authority and scope

This package starts from earned Track-B head `a9dc4e5a01d1e285945c9e9578f840d25b49cfb7`.

It does **not** modify sealed `main`, frozen Track A, the OpenAI reviewer surface, or PR #1.

Its purpose is to convert real provider-origin execution receipts/exports into the exact evidence objects already required by `ExternalEvidenceGate.level5`. The package deliberately cannot issue its own external attestation receipts. Independent evaluator-held attestation remains mandatory.

## Current frontier comparison set

The target matrix is `frontier_review_safe/level5_target_matrix_20260912.json`.

It tracks OpenAI, Anthropic, Google, and Microsoft because the repository's broad/global claim boundary requires all four organizations. The public model labels are discovery targets only. At execution time, the exact model/version identity reported by the provider execution must be pinned into the baseline registration and provider evidence. Never infer or silently substitute an alias.

Level 5 retains its hard floor of three independent providers. A three-provider PASS is Level-5 evidence only; it does not satisfy four-provider global frontier coverage.

## Evidence required for a real Level-5 PASS

For every provider run, the external executor must supply one `musitu.axiom.provider-execution-evidence.v1` object containing exact provider organization/product/version/access mode, candidate Git SHA, sealed case-set and constraint hashes, permissions/configuration/account-scope hashes, raw result and provider receipt/export hashes, provider request and response IDs, provider execution provenance, baseline registry/registration binding, and finite metrics.

Raw sealed prompts, answers, API keys, bearer tokens, and provider secrets must not be committed.

For each normalized run, an evaluator independent of all Level-5 providers must issue a `musitu.axiom.external-attestation.v1` receipt over the exact run fingerprint. The evaluator verifier secret must remain outside the candidate repository.

## Execution contract

Create a private populated contract outside the repository from `frontier_review_safe/level5_execution_contract_template_20260912.json`. The checked-in template is intentionally invalid until all placeholders are replaced with real values.

## Build the immutable baseline registry

```bash
python -m frontier_review_safe.level5_external_eval registry \
  --contract /secure/level5-contract.json \
  --output /secure/level5-baseline-registry.json
```

Record the emitted registry fingerprint before external runs start. Provider runs executed before registration, after expiry, or against any changed product/version/configuration/account scope fail closed.

## Provider execution capture

The external executor must run the exact same sealed case set and constraints for every registered provider and save a JSON array of provider execution evidence objects.

For API provenance, `provider_receipt_hash` must hash provider-origin response/receipt bytes and `provider_request_id` / `provider_response_id` must come from the provider execution path. Client-invented IDs are not substitutes. If an API does not expose sufficient execution identity, use an authenticated provider export that does, or classify the run as insufficient. Never fabricate fields.

## Independent attestation

An evaluator organization independent of OpenAI, Anthropic, Google, Microsoft, and the candidate execution team must verify the provider-origin evidence and issue one external attestation receipt per run. Its HMAC secret remains outside this repository. This package contains verification code only and intentionally exposes no command to issue evaluator receipts.

Verifier secret file format is JSON mapping key ID to base64-encoded secret bytes. Trust-root format is JSON mapping evaluator organization to a list of trusted verifier key IDs.

## Run Level 5

```bash
python -m frontier_review_safe.level5_external_eval assess \
  --contract /secure/level5-contract.json \
  --executions /secure/provider-executions.json \
  --receipts /secure/external-attestation-receipts.json \
  --verifier-secrets /secure/verifier-secrets.json \
  --trust-root /secure/trust-root.json \
  --target-matrix frontier_review_safe/level5_target_matrix_20260912.json \
  --output /secure/level5-assessment.json
```

Exit code 0 means the repository Level-5 gate returned PASS. Exit code 2 means it failed.

## Claim boundary

A Level-5 PASS proves only that the exact candidate has at least the required number of independently attested, registry-bound provider executions on an identical sealed case set under identical constraints.

It does **not** by itself prove superiority over a provider, statistically positive paired comparison, Level-6 independent reproduction, Level-7 longitudinal durability, or global/world-best/frontier-leading status. Comparative claims still require paired sealed results and `ClaimBoundary`. Broad/global claims also require all four frontier organizations plus all later evidence gates.

## Current external blocker

No OpenAI, Anthropic, or Google provider API credential wiring is present in the repository, and Microsoft MAI-Thinking-1 access may be restricted. Real external runs therefore cannot be truthfully manufactured from the current GitHub state.

The next external action is to execute the registered sealed suite through real provider accounts and deliver provider-origin receipts/exports to an independent evaluator. Until those bytes exist, Level 5 remains externally unearned even though this verifier package can be code-tested.
