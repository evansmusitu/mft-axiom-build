# Independent monotonic ledger candidate

This is a deployable candidate and an opt-in Axiom execution guard. It has not
been deployed to, or accepted by, an independent custodian. Local signatures,
different role names and separate storage directories do not prove separate
ownership, key custody or recovery administration. The release gate remains open.

The service uses one SQLite-backed Cloudflare Durable Object, separate from
Axiom's D1 database. A transaction binds one immutable grant to one tenant/Work,
its admission hash, an approved execution artifact hash and an epoch. Each action
consumes the next slot and its declared call budget before a signed permit is
returned. A duplicate action, old slot, replacement grant for the same Work,
revoked grant, stale epoch or changed contract is refused. A lost response or
signing failure retains the consumption. Readback returns evidence with
`dispatch_allowed:false`; it never reissues a permit.

## Trust and restore limits

- The supported restore test deletes/restores the **builder's** database and
  rebuilds its client while the authority retains its own state. The local test
  also restarts the authority from its separately persisted store. No further
  callback is authorized after the builder restore.
- Missing authority storage holds until explicit operator bootstrap. The app has
  no bootstrap, grant, epoch, recovery or revocation credential. There is no reset,
  deletion, refund or arbitrary SQL endpoint.
- An authority administrator restoring an older authority store, redeploying
  modified code or re-bootstrapping the same genesis can defeat its own history.
  This candidate has no independent anchor that detects that root-level rollback.
  Destructive authority-store replay tests and independent recovery/key custody
  evidence are still required. Do not represent these local tests as that proof.
- A pinned artifact hash records the operator's approved code identity. It is not
  remote attestation that every provider request ran those bytes. Direct provider
  access outside the governed artifact is outside this component's enforcement.
- Revocation fences a new consume transaction. A permit already issued may remain
  usable for its 15-second lifetime; this service cannot cancel provider work that
  has already started. Final provider usage requires provider evidence.

## Operator review bundle

Use the repository's pinned Node 24 and esbuild 0.25.9. The build does not create
keys, deploy or access an account. An explicit output directory must be empty.
Supply the SHA-256 of the execution artifact the independent operator actually
reviewed; a fixture/source hash does not establish a deployed artifact identity.

```sh
node integrations/independent-ledger/build.mjs \
  --output-dir /operator/review/ledger-dist \
  --execution-artifact-sha256 APPROVED_RUNTIME_ARTIFACT_SHA256
```

Review `ledger-worker.mjs`, `ledger-build-manifest.json`, the source hashes and
the client/server changes. The manifest lists all inputs, including analytical
modules parsed through the common integrity module; those analytical exports are
tree-shaken from the authority bundle. Both custody/qualification fields remain
false. Build twice into different empty directories and compare the bundle and
manifest hashes before deployment.

The operator copies `wrangler.example.toml` into its own deployment project,
places the reviewed bundle at `dist/ledger-worker.mjs`, sets its own account and
namespace, and provisions these secrets through its own secret manager:

| Secret | Required contents |
| --- | --- |
| `LEDGER_CONFIG_JSON` | Exactly `ledger_id`, `genesis_id`, `key_id`, `execution_artifact_sha256` |
| `LEDGER_SIGNING_JWK` | Operator-generated private Ed25519 JWK; never shared with the builder |
| `LEDGER_PRINCIPALS_JSON` | Token hash registry described below |

Registry keys are `sha256Json(token)` from `protocol.mjs`: SHA-256 of the
canonical JSON string, **including JSON string quoting**, not raw token bytes.
Use independently generated 32–200 character `[A-Za-z0-9_-]` tokens. Each record
has exactly `{subject,tenant_id,roles}` and exactly one role from `bootstrap`,
`grant`, `consume`, `read`, `revoke`. Consumer records require an exact tenant.
Operator records may use `tenant_id:null`; tenant-scoped read credentials cannot
read another tenant. Different tokens alone do not prove different custodians.

Bootstrap requires the operator-only role and `LEDGER_ALLOW_BOOTSTRAP=true`.
After verifying the genesis response, disable bootstrap, remove that registry
entry and destroy its credential through the operator's own controls. Deployments
and recovery must preserve the same Durable Object namespace and reviewed code.
Do not restore authority state from a builder-controlled backup or reuse a genesis
after loss; stop until the independent recovery authority establishes a safe
transition and external high-water evidence. Automated key rotation is absent;
  the environment loader pins one authority/key and has no multi-key migration.
  Retain historical public pins and use a separately reviewed trust transition.

## Axiom server configuration

Apply `ops/axiom_execution_contract_schema.sql` before the new server code, then
reapply `ops/axiom_evidence_lifecycle_schema.sql` for its additive atomic guard.
Existing contracts keep their original hashes when no external guard is enabled.
This is migration-dependent code even when the guard is disabled. Do not enable a
new protected deployment until its isolated D1 migration checks actually pass.

Set `AXIOM_EXTERNAL_LEDGER_REQUIRED=true` in trusted server configuration.
`AXIOM_EXTERNAL_LEDGER_CONFIG_JSON` has exactly:

```json
{"origin":"https://OPERATOR-HOST.example","ledger_id":"OPERATOR_LEDGER","genesis_id":"OPERATOR_GENESIS","key_id":"OPERATOR_KEY","execution_artifact_sha256":"APPROVED_64_HEX_SHA256","public_key_jwk":{"kty":"OKP","crv":"Ed25519","x":"OPERATOR_PUBLIC_KEY"}}
```

`AXIOM_EXTERNAL_LEDGER_CONSUMERS_JSON` is secret, tenant-indexed configuration:

```json
{"TENANT_ID":{"token":"TENANT_CONSUMER_TOKEN","read_token":"SEPARATE_TENANT_READ_TOKEN","grants":{"WORK_ID":{"grant_id":"OPERATOR_APPROVED_GRANT","epoch":1}}}}
```

The app receives consumer/read credentials and public pins only. A user request
cannot select the ledger, supply an operator credential or turn the guard off.
Missing or inconsistent required configuration holds execution. Keep each old
Work's grant/epoch and public pin for historical receipt verification after an
epoch advance; readback of a signed old receipt never authorizes fresh dispatch.

The operator approves a grant ID/epoch first. Axiom admits the corresponding
immutable Work; its server binding exposes `admission_sha256`. The operator
verifies the reviewed Work/admission and provisions `/v1/operator/grants` with
that hash, tenant, Work, artifact, call caps, expiry and a fresh challenge. No
action can run before that grant exists. The app never provisions its own grant.
All operator endpoints take canonical JSON, server bearer authentication and a
64-hex challenge. They are not browser or model tools.

Lifecycle control uses the existing separately authorized server-only
`createD1EvidenceLifecycle` seam with this pinned client. It verifies external
proofs, blocks unresolved consumes and requires signed readback of revocation or
epoch invalidation before logical erasure. Consumption proofs and completion
snapshots contain identifiers, action/call metadata and commitments, and are
retained with explicit hashes. They contain no objectives, source excerpts or
model outputs. Logical erasure does not delete authority history or certify
external erasure. The app cannot exercise operator revocation itself.

## Required external qualification

The owner skipped the independent human verification/signoff requirement on
2 November 2026; see
`qualification/whole-system-20261029/OWNER_INDEPENDENT_VERIFICATION_WAIVER_20261102.md`.
Independent verification remains unqualified and must not be claimed as passed.
Technical qualification still requires authenticated provider/anchor evidence
for the approved bundle and runtime hashes, account/namespace identity,
signing-key controls, recovery, readback and revocation. Exercise
cross-tenant denial, simultaneous consumes, dropped acknowledgements, cold
processes, grant/epoch revocation, builder restore and authority restore/replay.
Preserve signed readbacks, raw evidence and the previous B27 counterexample.
This repository provides no authenticated acceptance or external high-water
anchor on the operator's behalf.

Run the local component checks without credentials or provider calls:

```sh
python3 qualification/whole-system-20261029/run_checks.py --with-local-d1
```

These tests use synthetic credentials and independent local stores on one host.
They do not spend OpenAI credits, create hosted D1 capacity, prove separate key
custody, reconcile the old aborted stream, or close the public release gate.
