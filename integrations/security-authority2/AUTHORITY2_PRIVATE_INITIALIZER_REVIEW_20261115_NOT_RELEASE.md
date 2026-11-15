# Private Authority 2 initializer and retirement review contract

**DRAFT / NOT_RELEASE. No hosted deployment or genesis performed.** The serving
Worker and its reviewed bundle remain unchanged. The original independent
operator ceremony still governs actual custody, approval and hosted operation.

The new temporary controller is a concrete candidate for separate review. Its
HTTP entry point always returns 404, including when a caller knows the private
control token. The review TOML enables no workers.dev URL, preview URL, custom
route or cron trigger. The Durable Object exposes only a private authenticated
once-only initialization path during this temporary version. Ordinary append
and readback handlers exist only after the original serving code is restored.

The scheduled controller requires an exact operator-approved cron expression,
a current scheduled timestamp, an execution window of at most 15 minutes, a
separate private control token and the approved public commitment hash. It calls
the provider's `noRetry()` before initialization. It proves the configured
Ed25519 signing key against the approved public JWK and checks distinct read/
write role hashes before reaching any DO state. No signer is generated here.

The genesis algorithm now checks the operator deadline before the pending
transaction, before an irreversible R2 write and before promoting the final DO
tip. An expired or ambiguous attempt can retain R2 history and pending; it
cannot be made successful by a late acknowledgement or a repeated trigger.
Pending state is not an authorization to reset, retry or clear the barrier.

## Actual operator execution remains gated

Before any private upload, separately qualify administrator/recovery control,
builder credential restrictions, signer custody and independent source review.
The actual ledger ID, namespace, key ID and Ed25519 public JWK must be approved
with the consumer. Do not repurpose the backup X25519 recipient key. The nonce,
immutable checkpoint, cron/window and private tokens in tests are synthetic.
They are not production configuration and must not be reused.

Original settings remain private and operator-owned:
`HW_CONFIG_JSON`, `HW_ROLE_TOKEN_SHA256_JSON`, `HW_SIGNING_JWK`.
The temporary version additionally needs operator-owned
`HW_GENESIS_CONTROL_JSON`, `HW_GENESIS_CONTROL_TOKEN` and
`HW_GENESIS_GITHUB_READ_TOKEN`. The control JSON contains the exact schema
`musitu.axiom.authority2.private-genesis-control.v1`, `approved_cron`, integer
`not_before_ms`/`not_after_ms`, `expected_commitment_sha256`, `anchor_pin`,
`commitment` and `anchor_proof`. It accepts no self-declared approval field.

An independently approved operator must first retain the actual temporary
upload/version receipt and verify private bindings and routes. Only then may a
reviewed trigger be configured for the approved window. The absence of a cron
in this review config is intentional. Neither a dry-run nor this document
performs or authorizes the actual deployment/trigger. An unknown outcome stops
admission and requires independent readback; it must not be automatically retried.

## Mandatory retirement before any authority admission

After independently checking genuine genesis evidence:

1. Remove all cron triggers for the authority Worker.
2. Restore the exact separately reviewed serving bundle and original SQLite DO
   configuration, preserving the same object namespace and all existing state.
   Never call `deleteAll`, drop the DO class, delete the bucket or alter retention.
3. Remove all three temporary control/checkpoint settings. Retain only the five
   original DO/R2/secret bindings. Restore one approved serving version at 100%.
4. Run the GET-only retirement metadata check with the exact version ID and
   opaque script ETag from independently retained reviewed upload evidence.
   `verifyAuthority2InitializerRetirement` checks the active deployment before
   and after, exact current and version-specific bindings, only `fetch` handlers,
   no cron triggers, and disabled workers.dev/preview URLs. It rejects metadata
   drift, split deployment, missing fields or leftover initializer capabilities.
5. Separately qualify actual deployed source bytes, custom-route absence,
   signer custody and independent review. The metadata checker explicitly
   returns those claims as false. A provider ETag is not assumed to equal the
   bundle's SHA-256. No metadata-only PASS can close Gate 3.
6. On disposable approved authority resources only, qualify signed sequence-zero
   bootstrap, distinct-role readback, replay, stale restore, ambiguous commits,
   credential revocation and independent recovery. Preserve actual provider
   responses and independent reviewer acceptance before changing release state.

## Evidence boundaries

The controller tests use ephemeral test keys. Local workerd tests exercise the
actual scheduled handler, SQLite DO and R2; the GitHub provider/custody boundary
is synthetic. One test retires the temporary code and private settings, restarts
the local runtime on the unchanged serving code, and proves the first ordinary
signed append plus replay denial. The temporary code is absent from that final
serving bundle's dependency graph.

The retirement checker tests use simulated provider metadata. Its six bounded
GETs cannot qualify provider state until actually run with an independently
held read-only capability outside builder CI. No operator token or signer is
made available to the builder by this candidate. The connected private AXIOM
provider router reports UNAVAILABLE and no production execution authority; it
cannot substitute for independent review or custody acceptance.

The all-state rollback counterexamples and fatal B27/PR83 vetoes are preserved.
These additions close an implementation gap, not the hosted security gate.
