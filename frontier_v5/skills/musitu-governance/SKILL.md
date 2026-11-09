---
name: musitu-governance
description: "Apply enterprise policies, role permissions, approval thresholds, jurisdiction constraints, audit requirements, and data-handling rules to MUSITU Axiom workflows."
---
# MUSITU Governance
Read `../../shared/QUALITY.md`.

## Workflow
1. Resolve authenticated identity and role when the runtime exposes them.
2. Resolve applicable policy, data classification and jurisdiction.
3. Determine permitted operations and least-privilege scopes.
4. Require explicit approvals where policy or consequence thresholds demand them.
5. Minimize exposed data and credential scope.
6. Record decision, policy basis, approvals and action metadata in an auditable form.
7. Fail closed when identity, authorization, policy or jurisdiction is unresolved for a protected action.
