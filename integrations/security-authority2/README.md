# MUSITU AXIOM Security Authority 2 — B27 candidate

Account ID **67469478aa9349fa0a57fe3a72da200a** is **user-attested**. Provider-origin independent administration, account identity, MFA, signer and recovery control remain unverified by this engineering branch.

This isolated candidate is based on the existing PR #55 external ledger and GitHub immutable checkpoint controls. It is NOT a release, NOT deployed, and NOT a completed B27 fix.

## Guarded protocol

- One externally designated Durable Object serializes a global `sequence/head` CAS with distinct append/readback bearer roles and an Ed25519 signature.
- Consumer and authority pin account ID, ledger/namespace/key ID, HTTPS origin, independent verification key, action digest and event continuity.
- At the *existing ledger*: immutable GitHub checkpoint is published first; a pending transaction is persisted; a fresh Security Authority 2 append + signed readback must succeed before any local ledger write or signed permit. Unknown result leaves pending and HOLD; no retry.
- At the *Axiom client*: verify signed ledger receipt and immutable GitHub checkpoint, independently verify signed witness commit bound to the exact ledger payload SHA-256 and perform a fresh separate-role readback. An absent/mismatched proof denies execution.
- Sequence-zero (genesis) has prior sequence -1; independent genesis provisioning is deliberately NOT exposed to product clients or deployment APIs. The witness starts in HOLD without a provider-controlled, externally witnessed initial state.

## Secrets (operator-owned; do not place in builder GitHub)

`HW_CONFIG_JSON`: account_id, ledger_id, namespace, key_id (all exact and the account_id above).
`HW_ROLE_TOKEN_SHA256_JSON`: SHA256 of RAW, separately random 32-200-character write/read tokens. Reader and writer may not share values.
`HW_SIGNING_JWK`: privately generated Ed25519 key, held outside builder; the public half is the client pin.
`LEDGER_HIGHWATER_PIN_JSON`: public six-field pin account_id, ledger_id, namespace, key_id, HTTPS origin, public_key_jwk.
`LEDGER_HIGHWATER_WRITE_TOKEN` and `LEDGER_HIGHWATER_READ_TOKEN`: authority-side distinct credentials.
`AXIOM_HIGHWATER_READ_TOKEN`: client-side READ-ONLY credential; builder receives no append/write privilege.

Only for approved staging: enable `LEDGER_EXTERNAL_HIGHWATER_REQUIRED=true` on the independent ledger AND `AXIOM_HIGHWATER_REQUIRED=true` on the customer server with a matching pinned configuration; both require the existing immutable GitHub checkpoint pin. Production remains blocked.

## Evidence and veto

Local test suite: `node --test integrations/security-authority2/*.test.mjs`. This is synthetic serialized-transaction simulation. It is NOT real workerd, remote Cloudflare, independent custodian or separate-host qualification.

**Known falsifier:** A destructive restore of the witness's *own* pre-commit snapshot allows the old sequence to be issued again. The test intentionally demonstrates this flaw and must remain. An external operator-controlled non-rollbackable/WORM checkpoint is still needed to prevent all-state restoration. Two independent provider-runner hosts and reviewer-signed destructive reports are not yet available.

No user account, broker, payment, customer data, Cloudflare secrets, live provider dispatch, production D1 or release is changed by this branch. Do not merge or deploy until the external B27 failure is resolved and a separate reviewer approves.
