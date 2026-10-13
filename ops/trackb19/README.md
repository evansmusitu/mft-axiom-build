# MUSITU AXIOM Track B19 — genuine native OpenHands event journal (S0 candidate)

Parent authority: B18 `da9a926a69d58e0ca1542137eb608b9de1868df2` on isolated `frontier/axiom-trackb-b18-integrated-workerd-gateway-s0-20261013`, not main. Requires verified original B14 whole-product ZIP, which passed full verification in current continuation.

The goal is to preserve genuine **native SDK-emitted callback metadata** from unchanged previously verified `ops/trackb12/b12_runner.py`. It runs two distinct unprivileged OpenHands workers under a synthetic loopback-only model provider. A separate root-owned post-run verifier ingests callback metadata into a durable SQLite WAL hash chain, proves source-byte binding, reopens/replays evidence without running models again, and seals that journal with an ephemeral synthetic Ed25519 key.

**Claims deliberately withheld:** This is not a cryptographically authenticated SDK event origin. The unprivileged worker could theoretically lie to its callback. Post-run ingestion doesn't eliminate losses if a worker is killed before callback metadata is flushed. Signer lives in the same trusted CI orchestration context and isn't an external policy gateway. Linked native `tool_call_id` causal ancestry is not yet certified, and the event metadata schema is a deliberately narrow subset; preserve full replay verification as a further gate. No B18 quota broker is connected to SDK inference in this stage. Crash-recovery of *an agent's work* is NOT proven by journal-reopen safety.

No live model, public endpoint, production mutation, long-term secrets, external accounts, new paid resources or GPUs. No provider subscription/rate-limit evidence. This is a **bounded S0 qualification candidate**.

## Local

`cd ops/trackb19 && python3 -m unittest -v test_journal`

## CI

The separate B19 job enforces no provider secrets, pins source B12 blob SHA before staging, installs real `openhands-agent-server==1.51.0` (SDK resolves transitively), sets UID network limits for each worker, exercises `native_qualification.py`, and records only bounded event metadata / receipts. Success requires an independent fresh CI run. Failure cannot be labeled pass. Production always blocked.

## Next qualification

1. Capture complete native event envelope under trusted immutable observer without exposing prompts/secrets.
2. Verify actual linked action/observation identifiers with independent replay engine.
3. Bind B18 Workerd durable reservation to real OpenHands model requests without violating free quotas.
4. Prove killed-worker partial evidence and true agent-work recovery (not only journal restart).
5. Independent security verification and external release gates.

## B19 S0 portable evidence / separate verification job (2026-10-13)

The initial genuine CI event journal passed on run `38413292861` at B19 parent
`ad82e4e42e00900eca8f50dc0583d90f4aa4aef4`, observing 12 native events
(3 actions, 3 observations, one finish per worker), correct independently
hashed source, persisted SQLite journal replay, and a tamper-rejection proof.
That first run printed only the terminal digest and discarded the actual event
journal after its synthetic process, limiting post-run auditability.

The next candidate revision fixes **evidence portability** without enabling any
live provider calls. `portable.py` serializes exact ordered SDK callback metadata,
worker identities, native source hashes, and GitHub source commit; the root
coordinator signs the payload using the same ephemeral local-CI key and prints
base64 as a bounded Actions job output. The separate, credentialless verifier
job validates each event, rebuilds the hash chain, checks signatures, exact
source hashes/counts and commit identity, and runs 25 independent local unit
and adversarial tests. The RED implementation intentionally rejected all
portable receipts as unimplemented; the GREEN local suite passed 25/25.

**Limitations remain binding:** The signer-generated public key is embedded in
the same payload; this is an internally integrity-checked synthetic proof,
**not** a trusted independent public-key anchor. A malicious producer that
regenerates the entire envelope can forge a new signer's identity. GitHub's
read-only job separation and source SHA mitigate accidental corruption but do
not certify external event origin or security policy. Native tool-call ancestry
and crash recovery of an interrupted agent have not been demonstrated.
