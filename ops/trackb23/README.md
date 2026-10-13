# MUSITU AXIOM B23 — S0 causal outcome join (isolated, no production)

**Parent:** verified B22 branch `frontier/axiom-trackb-b22-crash-journal-s0-20261013`, SHA `e4760d2042fa511bde576d5ffc8505e4ce4172eb`. Original complete B14 whole-product handoff SHA `a325eaf3229e01603c50d039f442b18905a5cf18d7426c73c956caf9af4a767d` verified separately. Do not touch `main`, draft PR #1 or frozen OpenAI submission.

This adds a five-object S0 outcome record (`Project`, `Work`, `Agent`, `Artifact`, `Evidence`) joining B19 real native OpenHands SDK callback events, B20 causal IDs, B22 Workerd signed quota reservations, B22 durable journal status, and the B22 gateway's model-admission receipts. Each native tool action/observation must correspond to a distinct model admission and a matching quota reservation + journal operation. Same agent/tenant, request ID, model payload digest and grant are enforced. No missing/duplicated/cross-tenant records are tolerated. A journal in `ISSUED` or `UNKNOWN` status yields **INCOMPLETE_NOT_PROVEN**, never synthetic success.

No Workerd storage is simulated for end-to-end qualification: the CI producer is instructed to read the **actual Workerd SQLite files** after shutting down an isolated `wrangler dev --local` instance. Missing or duplicate SQLite backing stores fail closed. The signed native B19 envelope is checked using the inherited exact original B19 verifier; its ephemeral self-contained signing public key is **not** an independent production trust anchor. The independent CI consumer does not run the SDK again, does not have model or signer credentials, and recomputes every source-dependent outcome digest from the evidence it receives.

`python3 -m unittest discover -v -s ops/trackb23/test -p 'test_*.py'` tests signed native events, causal links, immutable artifact hashes, quota and journal joins, cross-agent and cross-tenant substitutions, incomplete outcomes and corruption. Synthetic fixtures are explicitly synthetic: **only** the separate GitHub-native job can earn the label `REAL_WORKERD_NATIVE_JOURNAL_JOIN_S0_PASS`.

Known unearned gates: independent signer identity, provider-certified account-wide remaining Free Neurons, actual provider transport receipts, multi-region recovery, outbox reconciliation, customer data isolation, autonomous code verification at scale, device evidence, security external review, world superiority, release rollback proof and production promotion. Never self-certify them.

## B23 S0 exact SDK-byte binding hardening (observed red/green)

The first B23 real Workerd run established a six-operation causal join, but
its bridge transcript identified operations only by agent/ordinal and derived
provider body digest. A reviewer showed that this permitted consistent but
unrelated B19 native events to be paired with a fabricated B22 transcript.

The follow-up clones only the synthetic B22 root-side `gated_b12.py` into the
B23 scope, leaving B22 unchanged. The copy records a SHA-256 of the exact raw
SDK request bytes before calling Workerd (six `B23_SDK_ORIGINAL_REQUEST_SHA256`
receipts). Workerd independently hashes the submitted raw SDK bytes and
constructs the exact B17 synthetic model body. The B23 verifier rebuilds the
B17 canonical JSON body from the SDK SHA, worker identity and audited
`b22-synthetic-gated` model ID, then independently checks its SHA-256 against
the Workerd gateway receipt, quota reservation hash and durable journal hash.

Two focused tests previously failed with `AssertionError: JoinDenied not raised`;
following correction the full suite has 35 local tests. This **still does not
prove external event-source authenticity** because the bridge, issuer and
runtime all inhabit an isolated, synthetic CI trust domain. It cannot be used
to authorize live provider execution or production promotion.
