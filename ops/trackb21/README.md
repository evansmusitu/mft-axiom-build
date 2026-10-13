# MUSITU AXIOM B21 S0 — genuine OpenHands SDK calls through local Workerd B18 gate

**S0 local test candidate only. No provider traffic, public service, production
release, paid infrastructure, production issuer or certified global quota.**

Parent is verified B20 SHA `c9ffe06dae6f492d83032b448389044cbebe5d2f`.
`ops/trackb12/b12_runner.py` is reused unchanged by staging the Git blob
`f1ac799d6b00636247c2b773122267031a67aa8f` in the disposable CI job.
`ops/trackb19/native_qualification.py` and B19 portable/ B20 causal verifiers
are reused unchanged. B15/B16/B17 are NOT reconstructed or rewritten.

Architecture of bounded qualification:

1. CI pins the inherited B12 native coordinator, launches actual OpenHands SDK
   agent processes with separate unprivileged UIDs and egress denied except loopback.
2. The model-facing B12 synthetic broker is intercepted by `gated_b12.py`; every
   valid incoming real SDK HTTP model request must receive a **fresh** Workerd
   quota admission receipt before the original B12 scripted model response is
   released. Broker credentials and upstream Workerd test bearer are not shared
   with SDK workers; timeout/replay/denial fails closed.
3. A loopback-only local `wrangler dev --local` instance executes the unchanged
   signed B15 quota / B16 workload gate / B17 digest-bound dispatch pipeline.
   It signs test grants using **published fixture keys** and no live provider.
   It cryptographically binds the entire original SDK JSON to a canonical S0
   synthetic payload, and conservatively burns admitted reservations.
4. B19 journals actual native SDK callbacks, seals portable receipt, and checks
   code changes with an independent grader; B20 independently validates the
   original action-to-observation causal chain in a second CI job without SDK
   or provider access.

**Precise limits:** B21's local Workerd auth bearer is ephemeral and CI-only,
fixture signing keys are deliberately published; neither establishes independent
identity, exact Cloudflare Free remainder, zero-spend global budget, or genuine
production issuer. The scripted B12 model is synthetic; model-proxy output is
not actual live inference. The outer Workerd loopback endpoint is deliberately
not a production network/security interface and MUST NEVER be deployed.

### Fail-closed expectations
- Six genuine OpenHands model requests (three per agent) each get one B18
  signed durable admission, or the entire qualification fails.
- Replay of the same request cannot dispatch twice.
- No admitted request means no agent model response.
- Real native OpenHands file_editor and finish events must causally verify.
- Separate CI verifier does not trust nominal builder success markers alone.
- Missing proof is NOT PROVEN; any actual CI failure is FAILED, preserve it.

### Non-goals
No production, no remote Cloudflare Workers call, no S3 public write, no paid
providers, no end-user product activation. Main and PR1 remain untouched.
