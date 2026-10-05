# Axiom evaluation methodology

Status: pre-review methodology for the Evidence Observatory. It does not authorize external-comparative or superiority claims.

## Evidence record

Every published evaluation identifies its definition, exact candidate version, baseline versions, sealed-test identities, evaluation date, environment/hardware, methodology, failures, scores, confidence intervals where appropriate, external attestations, and artifact digests.

## Integrity and history

Definitions, evaluations, and lifecycle events are append-only and SHA-256 linked. Existing identities cannot be overwritten. Failed, retired, and contaminated evaluations remain visible. Corrections append a new record rather than editing history.

## Qualification

Local implementation claims require an exact-head passing runtime/security and browser envelope with retained artifacts. External-comparative evidence additionally requires current named system versions, authorized access, sealed cases, equivalent constraints, authenticated external provenance, retained failures, and independent validation.

Repository-local booleans, provider names, URLs, hashes, or self-authored attestations cannot authenticate external execution. Synthetic fixtures can test the validator but never qualify the candidate.

## Claim boundary

The Observatory displays whether a claim is authorized and why. External-comparative, global-superiority, production-security, and WCAG-conformance claims remain blocked until their independent evidence requirements are satisfied. Missing evidence is displayed, not inferred.

