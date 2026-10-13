# MUSITU AXIOM B25 — isolated S0 local 2-of-3 synthetic audit quorum

**Parent:** B24 `c489f72b05e102a0affe8233bfb43dfb487698a7` on isolated AXIOM branch. The verified B24 whole-product ZIP (embedded B23 full product → B14 authoritative parent) remains independent source authority.

B24 found an actual SECURITY FAILURE: deleting a single local SQLite journal permits re-admission of an identical checkpoint. B25 demonstrates a **different, strictly bounded local model**, not a repair of global trust or production authorization.

- Three SQLite voter journals on the same local test machine, each with a distinct, synthetic Ed25519 key. A verifier pins three public keys out of band and validates at least two signed matching S0 checkpoint attestations. A proposal or receipt cannot set production authority or provider dispatch permission.
- Each voter atomically records an S0 sequence/nonce digest before signing, with SQLite WAL/FULL. A duplicate local vote is rejected after reopening the DB.
- One **complete replica file deletion** permits that voter to re-vote, but the other two preserved replicas deny a second vote, making it impossible to collect two fresh votes from this local model. This is NOT proof of real cross-host or provider execution protection.
- If TWO local voters' journals are destroyed, a new 2-of-3 audit quorum can be assembled. The permanent negative regression explicitly demonstrates this limitation; this remains a **FAILED B25 majority-compromise rollback resistance gate**.
- Audit receipts remain replayable historical evidence and **must never be treated as model-dispatch tokens**. No live provider transport, customer data, infrastructure account, production secret, deployment, or spending occurs.
- Private keys are dynamically generated in CI test code and are not independent/remote authority. The repo contains no service/private keys.

## Local verification

`cd ops/trackb25 && python3 VERIFY_B25.py`

19 local tests cover signed quorum, replay, forged receipts, self-declared keys, missing voters, day, cross-region root-of-trust and majority loss. Red and green test evidence are captured without provider credentials.

## UNQUALIFIED / next target

A real independent Security/Authorization Gateway with workload identity, authoritative trust roots, key rotation and revocation, non-rollback storage (e.g. quorum across independently controlled failure domains with adversarial disaster recovery), global provider exact free quota evidence, hard $0 cutoff and whole-system rollback proof remain unearned. Do not claim B25 global antirollback, actual external signer independence, true regional quorum, enterprise safety, Wolfram parity or world-best.
