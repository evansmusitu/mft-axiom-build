# MUSITU Axiom Enterprise Meeting & Demo Playbook

Date: 2026-10-03
Status: internal commercial execution aid. No customer-specific confidential data is included.

## Objective

Convert a qualified enterprise/OEM conversation into a measurable proof-of-value path without overclaiming Axiom capabilities.

The meeting is not a feature tour. It must prove one decision workflow.

## 30-minute meeting structure

### 0–5 minutes — economic problem
Ask:
1. Which recurring analytical decision consumes the most senior analyst/reviewer time?
2. What is the annual economic value influenced by that decision?
3. Where do errors, rework or review bottlenecks occur?
4. What governance/evidence is mandatory?
5. Who owns the business outcome and who owns the technical/data boundary?

Do not mention capability counts unless asked.

### 5–10 minutes — define the baseline

Capture:
- elapsed cycle time;
- analyst/reviewer hours;
- number of scenarios tested;
- error/rework rate;
- evidence/audit completeness;
- systems/data sources involved;
- approval chain.

Do not invent missing baseline values.

### 10–18 minutes — live Axiom proof

Use only synthetic data unless the buyer has explicitly authorized its data.

#### Live Test 1 — capital/investment decision

Operation:
`finance.npv`

Synthetic input:
- rate = 0.12
- cashflows = [-1000000, 300000, 350000, 400000, 450000]

Verified connected-Axiom result on 2026-10-03:
- NPV = 117570.23440753826
- kernel_version = 1.0.0

Narrative:
"Axiom is executing the financial calculation through its runtime rather than asking a language model to improvise arithmetic."

Then replace with buyer assumptions only when authorized.

#### Live Test 2 — driver / forecasting relationship

Operation:
`statistics.regression`

Synthetic input:
- x = [1,2,3,4,5,6]
- y = [1.9,4.2,5.8,8.1,10.1,12.2]

Verified result:
- slope = 2.0428571428571427
- intercept = -0.09999999999999964
- rvalue = 0.9992965520413641
- pvalue = 7.42084499010508e-7
- stderr = 0.038332593900001384

Narrative:
"The value proposition is not this toy regression; it is that the same governed runtime can be applied to the buyer's actual analytical workflow with evidence and review controls."

#### Live Test 3 — risk parameter discipline

Operation:
`finance.var_parametric`

Supported confidence parameter:
`alpha`

Synthetic returns:
[0.012,-0.007,0.004,0.016,-0.011,0.006,0.009,-0.004,0.013,-0.008]

Input:
- alpha = 0.95

Verified result:
- VaR = 0.013097544524382339
- alpha = 0.95
- method = normal

Important:
Do not use `confidence` or `confidence_level` as aliases. Exploratory calls showed these fields are ignored and the operation falls back to alpha=0.99.

Narrative:
"This is exactly why governed parameter contracts and evidence matter. We retain discrepancies rather than hiding them."

### 18–23 minutes — governance/evidence

Show only evidence actually in the repository:
- enterprise identity/RBAC;
- organization/workspace boundaries;
- audit lineage;
- entitlement controls;
- procurement evidence gate;
- external comparative claim boundary;
- benchmark registry governance;
- fail-closed promotion rules.

State explicitly:
Axiom's historical engineering objective gate is verified for its cited evidence set. Global superiority is not certified.

### 23–27 minutes — design the buyer proof

A proof must have:
1. one workflow;
2. one executive owner;
3. one technical/data owner;
4. authorized dataset or synthetic equivalent;
5. baseline;
6. three to five success metrics;
7. evidence and security boundary;
8. commercial decision path if successful.

Example metrics:
- 40% lower cycle time;
- 30% lower analyst/reviewer effort;
- 2x more scenarios reviewed;
- complete calculation/evidence lineage;
- fewer material rework events.

The percentages are examples only. Buyer and MUSITU must agree the actual thresholds.

### 27–30 minutes — commitment close

Direct enterprise:
"If the proof meets the success thresholds we agree now, is there a defined approval path to a founding enterprise deployment?"

OEM/platform:
"If the integration and economics clear the sealed evaluation, are you willing to move to an OEM/strategic term sheet with a minimum commitment rather than an indefinite unpaid pilot?"

## Buyer-class variants

### Banking — Temenos, nCino, Ecobank, Stanbic, Absa
Best initial workflows:
- credit/portfolio scenario analysis;
- liquidity/treasury analysis;
- capital-allocation cases;
- CIB modelling/research verification;
- finance/FP&A decision packs.

Avoid:
- autonomous lending decisions;
- moving money;
- executing trades;
- representing regulatory compliance not actually certified.

### Financial-data / workflow platforms — FactSet, S&P Global
Best initial workflows:
- governed quantitative execution adjacent to licensed data;
- model verification;
- scenario and valuation workflows;
- auditable research synthesis;
- OEM analytical runtime.

Strategic framing:
Axiom complements authoritative data/workflow platforms rather than competing for ownership of their customer/data layer.

### Telecom / platform distribution — MTN, Safaricom, Liquid
Best initial workflows:
- capital allocation;
- demand/revenue forecasting;
- enterprise planning;
- fintech risk/scenario analysis;
- OEM/co-sell enterprise analytics.

Strategic framing:
Axiom can serve as a reusable governed intelligence layer across many enterprise customers if the first proof works.

### Investment / insurance — Old Mutual
Best initial workflows:
- portfolio/risk analysis;
- scenario modelling;
- investment appraisal;
- research verification;
- executive decision packs.

## Proof-to-contract gate

Never offer an open-ended free pilot.

Preferred sequence:
QUALIFIED
-> MEETING
-> measurable paid proof proposal
-> proof executed
-> decision
-> enterprise/OEM term sheet
-> procurement evidence
-> executed contract
-> invoice
-> cash

## Buyer objections

### "Why not just use ChatGPT/Claude/Gemini?"
Answer:
"The foundation model can remain your preferred model. Axiom's proposition is the governed analytical execution, evidence, verification, permissions and reusable workflow layer around high-value decisions."

### "Are you claiming Axiom is better than every AI system?"
Answer:
"No. The current repository explicitly blocks unsupported global-superiority claims. We propose proving performance on your workflow under agreed constraints."

### "Can you integrate with our platform?"
Answer:
"Axiom already has an MCP distribution surface and an enterprise integration architecture. We only promise a specific integration after technical diligence confirms the required auth, data and platform boundary."

### "What ROI can you guarantee?"
Answer:
"We do not guarantee an ROI before measuring your baseline. The proof exists to quantify the economic result before a larger commitment."

### "Who owns the technology?"
Answer:
"MUSITU retains the Axiom core IP. Customer-specific rights, configuration and integrations are negotiated in the commercial agreement."

## Evidence discipline

Never state:
- a company is a customer when it is only a prospect;
- a proposal is contracted revenue;
- an LOI is cash;
- a historical test is a current production certification;
- a self-authored benchmark proves leadership;
- an unsupported compliance certification.

Every claim in a meeting should be traceable to:
1. a live run;
2. repository evidence;
3. an external authoritative source; or
4. clearly labeled commercial proposal language.
