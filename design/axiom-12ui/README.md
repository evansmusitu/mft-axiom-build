# AXIOM 12ui Isolated Redesign

## Purpose
This workspace redesigns the canonical MUSITU Axiom application surface at https://axiom.mftintelligence.com using ChatGPT's current web UX and official OpenAI documentation as reference architecture, while preserving an original AXIOM identity.

## Hard isolation boundary
- Branch: `design/axiom-12ui-isolated-20260919`
- No production deploy.
- No calls to AXIOM production APIs, MCP, OAuth, billing, Cloudflare production, or customer data.
- No protected-branch mutation.
- No live Axiom credentials.
- All prototype data/actions are mocked or sandboxed.
- Integration into real AXIOM requires explicit user authorization after review.

## Current AXIOM surfaces to preserve and improve
Home, Projects, Work, Agents, Artifacts, Research, Analyze, Build, Create, Live, Computer, Automations, Developer, Trust, Settings, command/search, session controls, Context/Evidence/Activity inspector, and persistent composer.

## 12ui workflow
1. Generate at least four Draft candidates using the canonical concept brief.
2. Inspect actual PNG candidates.
3. Select the strongest coherent direction.
4. Expand with `12ui branch execute --scope site --convert html --prototype`.
5. Validate responsive desktop/mobile routes and key states.
6. Use `12ui improve` against approved targets before any AXIOM integration.
7. Store only design/prototype artifacts. No deployment.

## Required private prerequisite
The CI job requires repository secret `TWELVE_UI_API_KEY`. It is used only by the isolated design workflow. Do not place the key in source or logs.
