# AXIOM-IR 0.1

AXIOM-IR is the Phase-1 typed executable representation for deterministic reasoning programs.

## Program contract

An `AxiomProgram` has an `irVersion`, human-readable `objective`, explicit `assumptions`, provenance-carrying `inputs`, a directed acyclic graph of `nodes`, hard/soft `constraints`, and one boolean `decisionNodeId`.

Nodes are one of `Transform`, `Hypothesis`, `Verify`, `Optimize`, or `Decision`. Each node calls exactly one versioned operation from the runtime registry. Inputs reference external program inputs, prior nodes, or typed literals.

## Types

- `number(unit)` — IEEE-754 binary64 numeric analytics. Non-finite values are forbidden by canonical serialization.
- `decimal(unit, scale)` — fixed-decimal value represented as a base-10 string. Scale is explicit and validated. Money/risk sizing uses this type.
- `boolean`
- `string`
- `series<T>`
- `record{...}`

Units are semantic identifiers, not presentation labels. Operations must reject incompatible units; no implicit unit coercion is permitted.

## Provenance

Every external program input requires:

- `source`
- optional `observedAt`
- `contentHash`

`contentHash` is SHA-256 of canonical JSON for the value. Compilation rejects missing or mismatched provenance.

## Canonicalization

Canonical JSON recursively sorts object keys, preserves array order, normalizes `-0` to `0`, and rejects non-finite numbers. SHA-256 hashes are taken over UTF-8 canonical JSON.

Node declaration order is not semantic. Compilation performs a deterministic topological ordering using node IDs, so semantically identical DAGs with different source order produce the same compiled program hash.

## Operation contract

Each operation exposes:

- stable operation ID
- semantic version
- implementation hash derived from the actual executable functions plus algorithm identifier
- input type inference/validation
- output type
- deterministic execution function

Phase-1 operations include arithmetic, comparisons, boolean logic, descriptive statistics, moving averages, returns, OLS index regression, z-score, drawdown, rolling volatility, fixed-decimal risk sizing, and bounded optimization.

## Failure codes

Compiler failures are explicit and non-coercive. Core codes include:

- `UNSUPPORTED_IR_VERSION`
- `MISSING_OBJECTIVE`
- `MISSING_PROVENANCE`
- `PROVENANCE_HASH_MISMATCH`
- `DUPLICATE_NODE`
- `CYCLE_DETECTED`
- `MISSING_INPUT`
- `MISSING_NODE_REFERENCE`
- `UNKNOWN_OPERATION`
- `TYPE_MISMATCH`
- `UNIT_MISMATCH`
- `INVALID_PARAMETER`
- `INVALID_DECISION_NODE`
- `INVALID_CONSTRAINT_NODE`

## Numeric profiles

Statistical analytics currently execute with versioned JavaScript/Node binary64 semantics. Monetary risk sizing executes with BigInt fixed-decimal arithmetic and half-even division rounding to an explicit output scale. A certificate records the operation versions and implementation hashes used, so a numeric or algorithm implementation change is replay-visible.
