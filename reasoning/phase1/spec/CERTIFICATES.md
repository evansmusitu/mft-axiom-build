# Reasoning Certificate 0.1

A Reasoning Certificate is a signed, self-contained execution evidence object.

The deterministic `core` contains:

- certificate version
- compiled program hash
- input Merkle root
- runtime version and IR version
- operation manifest with versions, operation implementation hashes, and registry-module source hashes
- execution trace hash
- assumptions
- verification results
- deterministic outputs and outputs hash
- execution hash
- decision status

Certificate issuance rejects an execution whose program hash does not match the supplied compiled AXIOM program, and independently recomputes the execution hash before signing.

The replay section contains the compiled AXIOM program required for offline reproduction.

The certificate envelope adds `issuedAt`, the Ed25519 public key, signature, and certificate ID. The Ed25519 signature covers both the deterministic core and issuance time, making envelope metadata tamper-evident. The certificate ID is derived from the signed envelope payload and signature.

Verification has two modes:

- **self-consistency mode** validates the embedded public key, signature, and certificate ID;
- **trusted-signer mode** additionally requires the embedded key to match an externally supplied trusted public key.

Replay returns only `MATCH` or `MISMATCH` plus diagnostics. It compares signature/ID integrity, optional trusted signer, compiled program hash, input Merkle root, execution hash, trace hash, output hash, and operation manifest. A changed input or changed operation implementation/helper source therefore cannot silently replay as the historical execution.
