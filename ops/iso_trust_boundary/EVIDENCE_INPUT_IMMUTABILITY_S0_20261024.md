# MUSITU AXIOM ISO — S0 in-process input mutation regression (NOT RELEASE)

## Source authority and scope

Parent: `build/axiom-iso-temporal-coherence-s0-20261024` at `ea9f41d7931f380a1a729deb0b17c6a314063a8e` (require live verification). New isolated development branch: `build/axiom-iso-evidence-mutation-s0-20261024`.

This bounded change is an S0 read-only evidence integrity repair. It does not create a signer, a reservation, a network listener, provider ingress/egress, a credential broker, any spending, any identity provisioning, or S3/S4/S5 authority. No main or production modification. All returns explicitly remain `execution_allowed=false` and `reservation_issued=false`.

## Verified defect and adversarial attack

Before this change, `S0PreconsumptionReviewer.review` verified signed receipt, revocation snapshot, and checkpoint in order, but then calculated the apparent common signed validity period directly from **caller-owned mutable dictionaries**. A caller-controlled `clock()` callback of a later verifier can mutate an already validated earlier signed record or budget inputs after those checks. Thus the reviewer could falsely report reconcilable signed validity periods or safe zero-cost inputs although the signed bytes or inputs had changed between checks.

The isolated test fixture signed three genuine ephemeral test-key envelopes. Six distinct mutation tests **failed on the exact previous source**, and the unmutated evidence-only control passed (RED). A second bounded **30-case mutation matrix** yielded **19 incorrectly reconciled local evidence results on the baseline** (still no execution authority), and **0 incorrectly reconciled results after the repair**. These are deterministic same-process synthetic attacks, not evidence of hostile-host, remote-provider or independent gateway certification. The mutated fields included receipt validity period, revocation validity period, S0 provider dispatch boolean, quoted cost, signed receipt nonce, and expected nonce.

## S0 repair

Bound the canonical JSON serialization of all ten caller-supplied inputs (operation, financial, expected, actor, signed receipt, signature, both anchors, both envelopes) to 32,768 bytes. Compute SHA-256 before sub-verifier evaluation and again before constructing the result, holding on any mismatch or non-serializable/circular input. The check uses existing Python stdlib, no secret or external API. It makes *static evidence-input integrity* stronger; it is not a lock and is not atomic with a remote provider or an external globally durable security system.

The tests assert that these mutations are rejected with `INPUT_MUTATED_AFTER_REVIEW` and an unchanged valid synthetic fixture still yields evidence only, with global antirollback `FAILED_IN_SYNTHETIC_ATTACK`.

## Local reproducibility

`python -m unittest ops.iso_trust_boundary.test.test_preconsumption_mutation -v`

`python -m unittest ops.iso_trust_boundary.test.test_input_mutation_matrix -v`

`python -m unittest discover -s ops/iso_trust_boundary/test -p 'test_*.py' -v`

`python3 ops/trackb27/VERIFY_B27_LOCAL.py`

Local source was constructed from the previously verified branch snapshot. A live GitHub CI run on an exact commit is required before calling the branch test suite verified. Preserve RED baseline and GREEN evidence and never relabel B27.

## Unchanged independent security blockers

Separate operator custody and independent roots remain NOT PROVEN. Revocation freshness, durable single-use global reservation, genuine cross-host destructive rollback denial, attested independent verification and provider-account-wide USD 0 hard spending ceiling remain NOT PROVEN/FAILED as recorded. OpenHands Cloud S2 remains BLOCKED_CREDENTIAL_NOT_AVAILABLE. No claims of parity, superiority, real security certification or product release. AXIOM retains Project, Work, Agent, Artifact and Evidence and the full objective-to-outcome loop with all major surfaces.

## Future attack work

Mutation-after-snapshot by untrusted clocks must also be considered at any future *live* trust gateway. To achieve independent execution qualification, use immutable message ingestion, authoritative external custody, atomic append-once replay/sequence service, pin provenance, independent authorization, kill/revoke, resource and network policy, human approval at higher risk, and destructive multi-host rollback tests. This candidate is not that gateway.
