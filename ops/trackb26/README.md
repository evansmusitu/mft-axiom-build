# MUSITU AXIOM — B26 independent-witness interface, bounded synthetic S0

**THIS IS A PROTOCOL CANDIDATE, NOT EXTERNAL SECURITY CERTIFICATION OR A PRODUCTION RELEASE.**

Source authority: verified B25 whole-product handoff SHA-256
`33864872b6ba9dde409da4e8f8314e1b4d5386e1cbedff7ff2b986b8e33eda14`
and live GitHub B25 isolated branch head `ee4f31c3fd547dd7e160e330875ba955edfc32bc`.
Parent B25's two-journal rollback failure is preserved. The original B25 code is
referenced unchanged, not overwritten or elevated to authority.

## What this actually builds

`witness_gate.py` implements a **fail-closed client protocol**:

1. Verify a B25 2-of-3 quorum against three *pre-pinned* public keys and exact
   S0 work/checkpoint/nonce/day digest.
2. Require a **separate, pre-pinned witness public key**, distinct from each
   voter key; the witness private key is not accepted in or transmitted by this
   module.
3. The witness independently re-verifies the exact B25 signed voter receipts against
   its own configured voter pin map before opening any journal. It recomputes
   both digests rather than trusting a potentially compromised broker. Its
   private signer key must be distinct from all voter issuer keys.
4. Invoke a trusted injected `witness.commit(...)` boundary; there is **no
   local quorum-only fallback** if the witness is missing, offline, replaying,
   or returns an invalid receipt.
5. Verify a separately signed Ed25519 receipt that binds canonical proposal
   bytes and all B25 voter receipts, their identity and sequence, and S0-only
   nonproduction scope. Neither this receipt nor its verifier grants dispatch.
6. Require voter pins even when verifying historic receipts. Caller-supplied
   keys included in the receipt are never accepted as trust roots.

`synthetic_witness.py` is **only a local SQLite stand-in** for an independently
operated high-water append_once service, not a deployable witness. It commits
monotonic records before issuing a signature. Lost commit replies are treated
as uncertain and must not authorize automatic reissue or provider delivery.

The separate 8-process test confirms local atomicity at one SQLite file, NOT
network or cross-host consensus. All test keys are ephemeral and synthetic.

## Permanent negative evidence / unearned security gates

The test `test_witness_loss_and_two_voter_rollbacks_still_break_simulated_antirollback`
**demonstrates an actual weakness:** deleting the simulator's witness journal
and two voter journals allows a second audit receipt. The test passes because
this known failure is reproduced intentionally. Hence:

- `MAJORITY_ROLLBACK_RESISTANCE=FAILED_IN_SYNTHETIC_ATTACK` if the witness can
  be rolled back alongside local voters.
- `EXTERNAL_WITNESS_INDEPENDENCE=NOT_PROVEN`.
- `REAL_CROSS_HOST_MONOTONIC_AUTHORITY=NOT_PROVEN`.
- `PROVIDER_EXACT_FREE_CAPACITY=NOT_PROVEN`.
- `HARD_ZERO_CASH_PRODUCTION_ENFORCEMENT=NOT_PROVEN`.
- `PRODUCTION_GATEWAY=NOT_CERTIFIED`.
- `PRODUCTION_AUTHORITY=false` and `provider_dispatch_allowed=false` **always**.

External S3/S4/S5 steps need separately owned authorization and vault-backed
short-lived identities, actual independent storage authority, observable
failover and rollback proofs, revocation/rotation/high-water semantics,
verified budget and provider quota evidence, and explicit user release approval.
The user-authorized $0 budget forbids unapproved paid services. This candidate
never calls providers, never reads Cloudflare/LLM secrets, and never deploys.

Whole AXIOM remains Project/Work/Agent/Artifact/Evidence with its broader
product surfaces and governance; Track B stage numbers are NOT product phases.

## Reproduction

From repository root:

```
python3 -m venv /tmp/axiom-b26-s0
/tmp/axiom-b26-s0/bin/pip install --only-binary=:all: 'cryptography==45.0.7'
/tmp/axiom-b26-s0/bin/python ops/trackb26/VERIFY_B26_LOCAL.py
```

Or with installed cryptography, run `python3 ops/trackb26/VERIFY_B26_LOCAL.py`.
Original B26 19-test passing CI source is preserved in GitHub commit
`9e38abf3d9f8eab3ed6d6a8fad0036f58ac2a1bb` (run `38478254296`).
Follow-up red/green tests revealed and repaired a direct witness API bypass:
without independent quorum verification the simulator signed broker-supplied
claims, and it allowed signer key reuse with a voter. Those failures are
preserved in `EVIDENCE_RED_BROKER_BYPASS.log` and
`EVIDENCE_RED_WITNESS_KEY_REUSE.log`. See `EVIDENCE_GREEN_S0_21_TESTS.log`.

Trusted time remains injected in this test-only simulator; an actual service
must own its own clock, keys and monotonic state. Neither caller-supplied
`pinned_voters` nor `trusted_now` as tested here proves independent service
ownership. External authority continues as NOT CERTIFIED.

Historical evidence: `EVIDENCE_RED_*.log`, `EVIDENCE_GREEN_*.log`,
`EVIDENCE_B25_ROLLBACK_FAILURE.md`.
