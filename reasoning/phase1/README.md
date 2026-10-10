# AXIOM Reasoning Kernel — Phase 1

Phase 1 implements the smallest complete executable reasoning system: **typed AXIOM-IR → deterministic runtime → verification → signed certificate → offline replay**.

This is not a chatbot and does not depend on an LLM. A model may propose an AXIOM program later, but Phase 1 makes the program independently executable and auditable.

## Run

Requires Node 24.12+.

```sh
npm run conformance
npm run gate
```

Execute a JSON program and emit a signed certificate:

```sh
node src/cli.ts execute fixtures/xau-risk-program.json > certificate.json
```

Replay it independently:

```sh
node src/cli.ts replay certificate.json
```

Replay exits `0` on `MATCH` and `2` on `MISMATCH`.

## Architecture

```text
Structured Problem
      ↓
 AXIOM Compiler
      ↓
 Typed AXIOM-IR DAG
      ↓
Operation Registry ── implementation/version manifest
      ↓
Deterministic Runtime
      ↓
Type + Unit + Constraint Verifiers
      ↓
Execution Hash + Input Merkle Root
      ↓
Ed25519 Reasoning Certificate
      ↓
Offline Replay → MATCH / MISMATCH
```

## Numeric integrity

Statistical operations use a versioned binary64 execution profile. Money and position-risk calculations use explicit fixed-decimal values backed by BigInt arithmetic and deterministic half-even rounding. No implicit type or unit conversion is allowed.

## Current scope

Phase 1 is deliberately single-machine and stateless. It does not include persistent world state, distributed execution, tenant policy administration, model compilation, or autonomous external actions. Those are Phase 2 concerns.

The bundled XAU fixture is non-live test data and must not be presented as a current market signal or a guarantee of profit.
