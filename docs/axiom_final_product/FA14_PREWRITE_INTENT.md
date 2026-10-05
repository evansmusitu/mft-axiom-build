# FA-14 — Research / Analyze / Twin / Artifact Engine — Pre-write Intent

Status: AUTHORITY_FROZEN_FOR_IMPLEMENTATION

## Frozen source authority
Authoritative final-product program defines FA-14 as:
- Class: Implementation.
- Scope: Evidence-native Research, Analysis workspace, Simulation / Twin Lab, Universal Artifact Engine.
- Gate: **Research claims must bind to evidence.**

Authoritative continuation handoff:
- `MUSITU_AXIOM_FINAL_PRODUCT_WHOLE_PLANNING_CONTINUATION_HANDOFF_20260915_0733_GOVERNED_V2_AUTHORITATIVE.zip`
- verified ZIP size: `267945` bytes
- verified ZIP SHA-256: `bc95a13e665f4d8d01e3f070bea347bfd95e82638767d901e4bc10d9bf3f7f9c`
- verifier result: `PASS (36 files)`

Live FA-14 implementation parent:
- branch: `frontier/axiom-final-product-fa13-20260915`
- commit: `4c99c4ccbc4a9e34f4e446f30c31f4d428359818`

FA-13 has separately completed governed S4 production promotion. That production approval is **not** reusable for FA-14 and does not authorize any FA-14 production mutation.

## Naming / phase truth boundary
Final-app program **FA-14** is distinct from historical legacy interface **Phase 14**.
Historical Phase 14 remains `INCOMPLETE/UNEARNED` because required physical-tablet evidence is missing. Implementing or verifying FA-14 must not relabel that historical phase.

`WOLFRAM_PARITY=NOT_CERTIFIED` and `SUPERIORITY=NOT_CERTIFIED` remain unchanged.

## Implementation contract
FA-14 must compose with the permanent objects:
`Project · Work · Agent · Artifact · Evidence`.

It must not replace or narrow Home, Projects, Work, Agents, Engineering Command Center, Computer, Live, Automations, Evidence, Trust, Developer, Marketplace or Enterprise governance.

### Research
Implement the first-class flow:
`Question → Research Plan → Sources → Notes → Claims → Contradictions → Synthesis → Outcome Artifact`.

Required invariants:
- material claims cannot pass the research gate without claim→source bindings;
- source locator/span is retained;
- freshness state and source permission are explicit;
- conflicting evidence is preserved rather than silently collapsed;
- retrieved content is `DATA_ONLY` and has no instruction authority;
- export retains citations and provenance;
- no research package executes public publication itself.

### Analyze
Support heterogeneous analysis records with:
- source lineage;
- exact transformation/formula history;
- exact capability identity and qualification state;
- uncertainty;
- budget/limits metadata;
- reproducibility metadata.

A `DISCOVERED_CANDIDATE`, `FRONTIER_EXPERIMENTAL` or unknown capability cannot be presented as a qualified analysis path merely because it exists in a registry.

### Twin / Scenario Lab
Scenario output must expose:
- assumptions;
- input sources;
- model/tool identity;
- uncertainty bounds/method;
- calibration when available;
- `SIMULATED_SCENARIO` classification;
- `observed_reality=false`;
- `certification=NOT_CERTIFIED` unless a later independent certification authority changes that state.

FA-14 must fail closed against relabelling simulation as observed reality.

### Universal Artifact Engine
Artifact lifecycle:
1. draft from objective/work;
2. bind supporting evidence;
3. attach provenance;
4. version content;
5. pass policy/approval gate;
6. hand an export/publication intent to a governed executor;
7. retain lineage in Project/Evidence.

Artifact UI or package creation is not proof of external publication. Public/production publication remains outside FA-14 and requires the independent authorization/release path for its risk class.

## Security and authorization boundary
FA-14 is browser-local candidate implementation. It does not grant:
- production credentials;
- repository mutation authority;
- host shell authority;
- unrestricted network access;
- public publication authority;
- deployment authority;
- permission for retrieved sources to override policy.

S0-S5 authorization, least privilege, independent security/verifier roles and existing FA-11/FA-12/FA-13 gates remain authoritative.

## Required adversarial verification
Before FA-14 can be considered implementation-verified, a read-only repository gate must prove at minimum:
1. every material research claim must bind to an existing permitted source with exact locator;
2. required freshness cannot be bypassed by a stale or undated source;
3. denied sources cannot satisfy the claim gate;
4. source text cannot promote itself from data to authority;
5. contradictions remain represented in the outcome package;
6. citations survive research export;
7. analysis records retain lineage, transformations, capability qualification and reproducibility;
8. unqualified capability states cannot masquerade as qualified analysis;
9. Twin results always expose assumptions, sources and uncertainty;
10. Twin simulation cannot be relabelled as observed/certified output;
11. artifact packages require evidence, provenance and version history;
12. S4/S5 publication approval cannot be self-granted by the artifact engine;
13. artifact packaging itself never executes an external publication;
14. Home remains outcome-first and AXIOM breadth is preserved;
15. historical legacy Phase 14 truth is unchanged;
16. protected `mcp/`, `auth/`, submission/publication surfaces are unchanged;
17. `main` and PR #1 governance remain unchanged;
18. CI and independent verifier jobs have read-only repository permission and no deploy credentials.

## Builder / verifier separation
Required order:
`BUILDER → TESTS → SECURITY/ADVERSARIAL REVIEW → INDEPENDENT VERIFIER → POLICY GATE → RELEASE`.

The builder may implement and produce candidate evidence. It may not certify itself, weaken the gate, invent external evidence, or promote FA-14 to production using the completed FA-13 S4 authority.
