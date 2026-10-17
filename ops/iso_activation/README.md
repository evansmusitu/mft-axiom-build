# MUSITU AXIOM — Operator appointment activation preflight, S0

**This is a fail-closed historical status check, NOT a production runtime policy gateway, independent audit, or ISO activation.**

On 2026-10-17 the user appointed Evans Musitu as AXIOM's security operator. An appointment does not equal independent custody, signer control, or external review. The connected Neon organization continued to show a single administrator and organization-wide MFA was not required. The GitHub repository owner was an administrator. The B27 synthetic destructive replay remained a known failure. The current repo cannot independently attest real custody; even a green CI run cannot change these facts.

## Snapshot construction

`OBSERVED_STATE.json` is a dated, read-only record of earlier live GitHub/Neon and Drive reads, not a live API client. `preflight.py` pins the exact snapshot digest and known authorities, checks strict typing/schema, and always outputs `production_authority=false`, `provider_dispatch_allowed=false`, and `status=BLOCKED`. It refuses attempts to relabel the known B27 attack, fabricate MFA, or invent a second verifier. **Repo administrators can edit both source and expected digests: GitHub Actions is not an independent trust anchor.**

## Local reproducible checks

```shell
python3 -m unittest discover -s ops/iso_activation/test -p 'test*.py' -v
python3 ops/iso_activation/preflight.py
```

No cloud credentials, provider inference, paid infrastructure, public signature publication, or production mutation is required or permitted. The GitHub workflow uses `contents:read`, no CI secrets, no external dependencies, and two separate regression jobs (still controlled by same GitHub authority).

## Operator-controlled activation procedure — real actions, not simulated

1. **Evans directly:** create or designate a separately administered, operator-only account/tenant, with MFA and recovery controlled outside AXIOM/ChatGPT-connected identities. Do not paste credentials, secrets, recovery codes, MFA codes or private keys here; do not connect the operator account to AXIOM's agents. A second Neon project under the current organization is NOT separate custody.
2. **Custody evidence:** document resource IAM memberships and service-account grants; remove AXIOM/CI builders from administrator roles for the witness. Operator retains the sole security-policy administrator, clients have request-only credentials. Independently attest effective permissions and data-deletion controls. Provide only public trust roots and redacted attestations to AXIOM.
3. **Independent person:** appoint a **different actual human/organization** as independent verifier, record their acceptance and separately held signing identity. Neither Evans alone nor ChatGPT/AXIOM may be both builder and independent reviewer/certifier.
4. **Protected witness:** implement an atomic append-once reservation ledger with recovery anchor insulated from the builder and witness-host compromise; design irreversible duplicate denial on rollback and primary deletion, and fail-closed unknown recoveries.
5. **Adversarial evidence:** let the independent verifier run the documented destructive rollback/replay/key-compromise tests against a separate isolated environment and sign the results; do not delete historical B27 failure records. A test that demonstrates replay is **FAILED**, even if the regression test itself passes.
6. **Finance and production:** require verified provider-account-wide hard $0 caps and predispatch enforcement. Then complete all whole-product staging/accessibility/device/resilience/canary/rollback gates and obtain explicit final user release authorization. No operator appointment substitutes for these.

## Machine-verifiable outcome at this checkpoint

**OPERATOR APPOINTED / CUSTODY NOT PROVEN / INDEPENDENT VERIFIER NOT APPOINTED / GLOBAL ANTIROLLBACK FAILED IN SYNTHETIC ATTACK / PRODUCTION BLOCKED.**

Prior GitHub refs `main=bc48ab8a`, `B27=c57cf850`, preflight `141da5c8` and PR #1 OPEN/DRAFT/UNMERGED are historical observations, not an invitation to modify them. Everything is isolated under this `ops/iso_activation` directory and a dedicated S0 workflow. Source files intentionally contain no operator secrets or private account details.
