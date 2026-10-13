# MUSITU AXIOM B17 — signed-payload broker dispatch guard (ISOLATED S0)

**NOT LIVE, NOT PRODUCTION-QUALIFIED, NOT A PROVIDER-CREDENTIAL GATE.**

Source parent is **live verified** GitHub branch `frontier/axiom-trackb-b16-workers-vitest-s0-20261013` SHA `744419a1835b560c7f64a1cefdd2478e36119df0`. B16 local Workerd positive/negative qualification earned only its bounded S0 claims. B15 DO ledger is unchanged and still lacks any provider-certified exact account-wide quota evidence. This candidate provides a distinct pre-send broker seam for the AXIOM engineering workforce, not the whole AXIOM product and not a generalized model payload API.

## Threat and scope

B16 verifies a signed **request_sha** against signed workload authorization, but B16 **does not inspect actual outbound model payload bytes**. Without a trusted broker computing the hash from immutable outgoing bytes before reservation, an untrusted model request could be swapped after signing while reusing valid quota authority. Another risk is treating `ALREADY_RESERVED` or malformed quota RPC receipts as fresh permission to send the provider model request.

B17 isolates and fixes these gaps in a synthetic testable boundary:

1. Build deterministic canonical UTF-8 JSON of a constrained, schema-validated model/messages/max_output_tokens body, rejecting unsupported keys, arrays, serialization hooks and malicious object types.
2. Compute SHA-256 of EXACT provider-bound bytes; match signed B16 `request_sha` before entering B16 `routeQuota()`.
3. Use only B16 trusted account/UTC-day routing; keep workload authority and B15 quota verification downstream in the existing ledger.
4. Require explicit well-formed B15 `RESERVED` receipt, correct request ID, matching reserved Neurons and admissible cap/usage; never invoke provider on DENIED, replay, forged receipt or RPC failure.
5. On UTC-day rollover after reservation, refuse external send while **conservatively burning reservation**.
6. On ambiguous provider-side error, mark `UNKNOWN_AFTER_RESERVATION`, never automatically refund or retry.
7. No built-in provider client, credential access, public HTTP route, issuer signing authority, deployment configuration or network calls.

## Verification and failures preserved

- `node --test test/dispatch_guard.test.mjs` — 24 synthetic builder behavior cases.
- `node --test test/independent_security.test.mjs` — 10 independently composed synthetic attacks.
- `sha256sum -c MANIFEST.sha256` — includes referenced live B16 identity source hash.
- Original failing RED captures are under EVIDENCE_RED_*.log, including an intentional broken reference implementation. An initial import mistake was repaired before the meaningful RED cycle. Later two new security contracts were observed failing and repaired. The independent suite originally had one erroneous test setup, corrected before green. No production evidence is claimed from mocks.

## Qualification still missing

- **B17 real Workerd+OpenHands model-proxy integration**: NOT PROVEN.
- True independent workload issuer/gateway authority and service-to-service workload identity: NOT PROVEN.
- Provider-exact remaining Free allocation and independent USD $0 spending gate: NOT PROVEN.
- Persistent global delivery outbox, provider ambiguity reconciliation, crash/replay across regions, real disaster recovery: NOT PROVEN.
- Broader work tool schemas, streaming, multimodal providers, per-tenant token policy and adversarial prompt injection evaluation: NOT PROVEN.
- External formal security review, production scope, device Phase 14, global superiority: NOT CERTIFIED.

**No deployment or protected-branch write.** This isolated source must never be merged/promoted automatically. Continue with a bounded S0 B18 real Workerd integration using the existing qualified B16 durable ledger and an external adversarial verifier, maintaining the complete AXIOM Work/Project/Agent/Artifact/Evidence scope.
