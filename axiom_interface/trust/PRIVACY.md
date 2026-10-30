# Axiom privacy architecture

Status: candidate documentation for independent review. This is not an external privacy audit.

## Data handling

The current interface stores structured preview data in browser-local IndexedDB. It does not claim cloud synchronization, cross-device memory, automated provider upload, or production data processing. Media controls require explicit browser permission; the qualified base layer does not claim cloud media upload or general model understanding.

## Memory and user control

Memory is consent-scoped and provenance-linked. Supported scopes include private, project-only, organization-wide, temporary, permanent, and do-not-use. Corrections are append-only, expiration is explicit, and revocation is non-destructive so an audit record remains while recalled content is suppressed.

## Providers and secrets

Provider/model identifiers are recorded only when actually captured. Missing versions remain `NOT_CAPTURED`. Symbolic credential handles never contain plaintext credentials. Retrieved instructions are data-only and cannot raise their own authority.

## Retention and deletion boundary

The product must distinguish user-content deletion from immutable security/evaluation history. This preview implements evidence-history retention and memory revocation semantics, but it does not claim a production retention service, legal-hold workflow, regional residency, or verified deletion across external providers.

## Telemetry

Operational traces contain identifiers, timing, routes, policy decisions, tool metadata, evidence coverage, and recovery signals. Prompts, credentials, secrets, and private hidden reasoning are excluded by contract. No cloud telemetry backend is claimed.

