# MUSITU AXIOM ISO — S0 pinned-verifier configuration integrity (NOT RELEASE)

## Authority and scope

Parent: `build/axiom-iso-evidence-mutation-s0-20261024` at
`f566a1901a1e14ea3fcd8e17b058fbe337fb0935` (verify LIVE before commit).
New isolated branch: `build/axiom-iso-pin-coherence-s0-20261024`.

This is a bounded same-process, evidence-only S0 repair, NOT an independent
Security/Authorization Gateway. It creates no issuer, agent admission, reservation,
network listener, gateway endpoint, credential broker, provider billing or
production capability. The operator, revocation, witness and finance objects are
supplied by the local caller. They do not have independently proven custody.

## Observed RED and repair

The previous reviewer checked that four verifier configurations agreed **only
in the constructor**. All four Python verifier objects expose mutable pin,
policy and local-tool-allowlist fields. Untrusted test callbacks used as
clocks can alter the reviewer's trust configuration **after a prior verifier
has validated a signed input**, without changing the already-protected JSON
request inputs. The existing input-fingerprint check alone does not detect
this drift. As a result, the S0 reconciliation could return a misleading
positive *evidence-only* status, although it never authorized execution.

Red baseline: 8 regression cases; 7 correctly failed to observe the required
config-drift HOLD, 1 unchanged control passed. Later refined one probe from
changing an as-yet unverified witness key (already safely rejected) to
changing an already-used receipt verifier object after signature validation.
No assertion was weakened to make a formerly vulnerable path pass.

The S0 patch captures a tuple of verifier object identities, exact public pins,
actual verification key bytes, operator/witness identity and epochs, pinned
policies, and financial local tool allowlist after constructor cross-checks.
It checks this tuple at entry and after all downstream verifiers, before
composing evidence. Mutation results in `PINNED_VERIFIER_CONFIG_DRIFT` HOLD.

Local GREEN: 8/8 focused tests. The reconstructed local test workspace also
passed 144 tests in discovery and the historical B27 verifier, but is **not
an exact live Git checkout**. Only a new GitHub Actions run on the new branch
can establish CI verification of the actual remote source tree.

## What this does not solve

A malicious or compromised Python process can replace runtime code, alter
private attributes outside the checked window, spoof callbacks, or forge local
anchors and fixtures. Snapshots do not establish independent trust-root custody
or revocation freshness. The admitted caller-supplied clocks are explicitly
NOT independent. No transactional provider dispatch or monotonic externally
durable single-use reservation is implemented here.

B27 global destructive rollback must remain `FAILED_IN_SYNTHETIC_ATTACK`.
OpenHands Cloud S2 remains `BLOCKED_CREDENTIAL_NOT_AVAILABLE`.
Provider-account-wide hard zero-cost remains `NOT_PROVEN`.
`WOLFRAM_PARITY` and global superiority remain `NOT_CERTIFIED`.
No S3 autonomous mutation, S4/S5 action, production launch, protected main
change, PR #1 merge, force push or paid provider use is authorized.

## Reproduction

```sh
python -m unittest ops.iso_trust_boundary.test.test_pinned_config_integrity -v
python -m unittest discover -s ops/iso_trust_boundary/test -p 'test_*.py' -v
python3 ops/trackb27/VERIFY_B27_LOCAL.py
```

Keep Project, Work, Agent, Artifact, Evidence; objective→context→governed plan→
capability routing→execution→artifacts→verification→memory/evidence→outcome.
Keep ALL whole-product surfaces. This local trust-boundary repair is additive.
