# MUSITU AXIOM Track B — isolated self-hosted OpenHands preflight

**Implementation status:** B1 **authentication/readiness smoke only**. This is a
separate experimental track from the existing blocked OpenHands Cloud API probe.

## Scope and controls

- **Provider:** OpenHands `openhands-agent-server==1.51.0` (version pinned;
  recursive dependency hashes and container digest still need sealing).
- **Host:** 127.0.0.1 on a disposable GitHub Actions runner, no public ingress.
- **Credentials:** fresh ephemeral `OH_SESSION_API_KEYS_0` and `OH_SECRET_KEY`;
  no Cloud API key and no LLM provider key. Secret values never enter logs.
- **Read-only challenge:** GET `/health`, `/ready`, and an API route first without
  a key (must deny) and then with `X-Session-API-Key` (must accept).
- **Never execute an agent/model operation:** this does not establish OpenHands
  execution, tenant isolation, Modal compatibility, external S3 write, rollback,
  scale, release or production qualification.
- **Endpoint restriction:** exact `http://127.0.0.1:<port>`, no HTTP redirects.
  A loopback-only client is not the final production network security policy.
- **Auth gate:** fail closed if unauthenticated `/api/` reads are allowed.

## Tests

```bash
python3 -m unittest discover -s ops/openhands_self_hosted -p 'test_*.py' -v
```

For the real Agent Server challenge, use the gated workflow
`.github/workflows/axiom-trackb-openhands-selfhost-smoke.yml`. CI installs
a pinned upstream package, starts a real loopback server in an ephemeral
directory, challenges authentication, then tears down the process.

## Independent gates not yet met

B1 still requires measured process/container isolation, supply-chain locking,
egress restrictions and workspace lifecycle before running untrusted tasks.
B2 requires finalized FA-11 S3 exact-operation authorization and independent
`HUMAN_APPROVER`. Only **OpenHands itself** may perform a qualification
mutation; AXIOM must independently verify the GitHub-native result,
idempotency, revocation, rollback and adversarial evidence.

Main, PR #1, production and frozen OpenAI submission remain untouched.
