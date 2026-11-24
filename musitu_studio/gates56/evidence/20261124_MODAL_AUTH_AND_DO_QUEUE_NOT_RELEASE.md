# MUSITU Studio — Gate 5/6 authenticated Modal readback and offline Durable Object schema

Date: 2026-11-24 UTC. Classification: SOURCE-ONLY / NOT A GATE APPROVAL.
Provider readback completed through a one-shot, branch-scoped GitHub Actions
workflow. No secrets, workspace names, user identifiers, invoices, usage costs
or artifacts from a real tenant are included in this public source receipt.

## Observed evidence

- Offline source CI (Modal read-only SDK observer + proposed DO queue schema +
  existing ledger and local artifact boundary):
  https://github.com/evansmusitu/mft-axiom-build/actions/runs/45354699091
  result SUCCESS; 39 source-only Python/SQLite tests, 0 failures.
- Isolated proposed new DO schema (unapplied):
  `musitu_studio/gates56/durable_queue_schema.sql`.
  This is NOT proof of cross-worker durability in Cloudflare.
- The original Modal probe (run 45354344710) established that GitHub Secrets
  provided credentials, but it did not hydrate the lazy SDK Workspace.
- The sanitized diagnostic probe (run 45354445983) localized the failure to
  attempted workspace name access before SDK hydration.
- Revised and authenticated LIVE read-only Modal probe:
  https://github.com/evansmusitu/mft-axiom-build/actions/runs/45354737670
  Provider result:
  `credentials_provided=true`,
  `workspace_authenticated=true`,
  `billing_usage_readable=true`,
  `expected_workspace_bound=false`,
  `provider_hard_cap_verified=false`,
  `compute_enabled=false`, `render_jobs_spawned=false`,
  `provider_settings_mutated=false`.
  GitHub Actions overall result is intentionally FAIL because an unbound
  workspace must not qualify Studio production admission.

## Remaining externally controlled evidence

1. Independent owner/custodian must identify the exact intended MUSITU Studio
   Modal Workspace and configure the private or non-sensitive
   `MUSITU_STUDIO_MODAL_WORKSPACE` Actions variable through reviewed control.
   Do not infer it from a username or silently bind any authenticated account.
2. The Modal Workspace budget must be independently confirmed as an actual
   provider-enforced hard cap for the exact workspace and billing cycle.
   The documented Modal Python SDK workspace billing summary confirms usage
   but DOES NOT disclose the enforced budget or fresh remaining headroom.
   This is not solved by a screenshot claimed to be a live API attestation.
3. Separately qualify Gemini/model spend limits, retries, storage and potential
   slow billing-posting exposure under one owner-approved worst-case envelope.
4. Only after independent G5 budget admission, create a separately approved
   NEW Durable Object service/binding, deploy a bounded CPU renderer, test
   cross-worker queue crash/cancel/dedup and real authenticated call results,
   reconcile provider cost, private bytes and customer credits.
5. Obtain independent G5+G6 acceptance records. Both gates remain OPEN.

## Scope and prohibited shortcuts

The source branch is
`experiments/studio-g56-budgeted-render-20261122`; do not merge into
`main` or Studio PR38, deploy paid compute, switch QA enrollment, touch the
protected 73-byte Storage object, start render jobs, or issue customer credits.
The SDK observer's `__call__` fails closed with
`MODAL_HARD_CAP_NOT_ATTESTED`; even authenticated billing success cannot arm it.
