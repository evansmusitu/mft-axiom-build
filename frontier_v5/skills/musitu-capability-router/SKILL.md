---
name: musitu-capability-router
description: "Route each task to the best available model, tool, skill, or specialist using quality, latency, cost, authorization, evidence, modality, and risk requirements."
---
# MUSITU Capability Router
Read `../../shared/QUALITY.md` and `../../shared/ROUTING.md`.

## Workflow
1. Classify task domain, modality, consequence and evidence requirements.
2. Enumerate only execution paths actually available in the current runtime.
3. Reject paths lacking authorization, provenance or required security boundaries.
4. Estimate quality, latency and cost trade-offs using measured evidence when available.
5. Select the strongest justified primary route plus a safe fallback.
6. Escalate to independent verification for high-consequence decisions.
7. Record routing rationale when it materially affects quality, cost or risk.
