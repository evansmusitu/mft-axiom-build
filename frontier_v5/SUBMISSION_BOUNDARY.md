# v5 Submission Boundary

The current public MUSITU Axiom OpenAI submission remains a finance/quantitative application. Frontier capabilities must be divided into two profiles:

## Profile A — OpenAI submission-safe Axiom skills

Only skills directly supported by the current public MCP surface or by ordinary model reasoning with no undeclared external execution dependency belong here. Examples: quantitative analysis, company analysis, valuation, forecasting, optimization, risk, statistical inference, data quality, market sizing, KPI analysis, executive reporting, verification, scenario analysis and research synthesis.

## Profile B — private/direct frontier skills

Profile B currently holds the 12 frontier skills listed under `frontier_skills` in `MANIFEST.json`: proof ledger, temporal memory, causal/counterfactual analysis, digital twin, agent society, uncertainty calibration, instruction firewall, adversarial simulation, self-evolving evals, continual learning, capability router and governance. None of them grants computer control, deployment or design-tool access today.

If capabilities such as computer control, software deployment, Figma manipulation, arbitrary code execution, engineering operations, private enterprise integrations or transaction-adjacent operations are added later, they also belong in Profile B. They stay private/direct until their required tools, permissions, security model and OpenAI submission policy have been separately proven.

A skill file must never pretend to grant a tool that the runtime does not expose.

The purpose of parity research is to ensure Axiom has an implementation path for every valuable capability, not to misrepresent unsupported functions in the current public listing.
