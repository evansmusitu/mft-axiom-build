# Axiom security architecture

Status: candidate documentation for independent review. This is not a production security certification.

## Current architecture boundary

The qualified interface substrates through Phase 11 and the Phase 12 candidate are browser-local previews. IndexedDB holds project, run, memory, operator, developer, and evidence-preview records on the current browser profile. Consequential external execution, arbitrary external-site control, production credentials, remote MCP binding, outbound webhook delivery, billing settlement, and untrusted marketplace code execution are outside the qualified scope.

The browser modules use explicit allow-lists, exact SHA-256 approval bindings, append-only event chains, least-privilege permissions, symbolic credential handles, and deny-by-default external-network policies. Hidden reasoning and plaintext secrets are excluded from evidence and observability records.

## Identity and access

The enterprise control plane is a browser-local SSO/SCIM/RBAC/ABAC preview. It demonstrates policy behavior but is not a production identity provider, directory service, or externally certified access-control deployment. Production identity claims remain blocked.

## Data protection

Application records are integrity-bound with SHA-256 where specified. The preview does not claim application-managed encryption at rest; it relies on the browser and operating-system storage boundary. No production server transport or data-residency guarantee is claimed.

## Incident response and continuity

Errors must disclose impact, completed work, failed work, data-loss status, retry state, and recovery guidance. Failed evaluations and incidents remain visible. Browser-local export is the current continuity mechanism; cloud recovery, multi-region failover, and production restoration objectives are not claimed.

## Responsible disclosure

Security findings should identify the exact commit, route, reproduction steps, affected policy boundary, and whether any external system or credential was involved. A report is not considered independently resolved until its fix and inherited regression envelope pass at exact head.

