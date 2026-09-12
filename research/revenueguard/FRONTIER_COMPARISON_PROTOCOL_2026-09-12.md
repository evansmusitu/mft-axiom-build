# MUSITU RevenueGuard Frontier Comparison Protocol — 2026-09-12

Status: PREREGISTERED / NOT YET EXECUTED

This protocol supersedes any earlier RevenueGuard comparison protocol that named stale or unverified frontier references. It does not alter the frozen RevenueGuard V4 candidate or any prior internal/public evidence. It governs only future matched frontier comparison runs.

## Reference set verified 2026-09-12

Primary references to test, subject to official access being available at execution time:

- OpenAI GPT-5.6 Sol, highest-capability supported reasoning/effort setting available to the evaluator.
- Anthropic Claude Fable 5.1 as the primary Claude knowledge/coding reference. If Claude Mythos 5.1 is generally available to the evaluator and positioned by Anthropic as stronger for the tested task class, run it additionally; RevenueGuard must not hide a loss by selecting only the weaker Claude reference.
- Google Gemini 3.8 Flash, current Google reasoning/coding reference verified from Google's 2026-09-02 release.

Official verification sources at preregistration time:
- https://openai.com/index/gpt-5-6/
- https://www.anthropic.com/claude-fable-and-mythos-5-1
- https://blog.google/innovation-and-ai/models-and-research/gemini-models/3-8-flash-and-3-8-flash-cyber/

Frontier Scout rule: immediately before execution, re-check official vendor sources. If a materially stronger generally available model has replaced any reference, this protocol becomes STALE_BEFORE_EXECUTION and a new protocol must be preregistered before seeing competitor outputs.

## Candidate freeze

The RevenueGuard candidate evaluated in a matched campaign must be identified by a complete SHA-256 of its immutable release artifact. No candidate code, weights, thresholds, prompts, solver graph, retrieval settings, or policy may change after the campaign case manifest is frozen. Any change creates a new candidate and requires a new campaign.

## Case populations

Minimum evidence required before a frontier certificate can be considered:

1. >= 200 disjoint public external contract/document cases that were not used to train, tune, select, or debug the candidate.
2. >= 50 real permissioned company cases, with authorization evidence and human finance adjudication.
3. >= 300 matched frontier-comparison cases drawn from frozen manifests and spanning structured contract-to-cash reasoning, long-document clause localization, contract NLI/directionality, evidence grounding, arithmetic/reconciliation, ambiguity/abstention, and adversarial governance.
4. >= 50 genuine blinded human pairwise judgments; AI judges may assist triage but are never decisive evidence for superiority.
5. At least one verified positive real recovery with payment evidence before any commercial-outcome superiority claim.

Synthetic cases may diagnose capability and support causal experiments but may not substitute for public, real-company, human-review, or payment evidence.

## Matched execution

For every head-to-head case:

- All systems receive the same authoritative source material and task instruction.
- No competitor receives hidden context unavailable to RevenueGuard, and RevenueGuard receives no private answer key.
- The evaluator records exact model identifier, configuration/effort, timestamp, input manifest hash, output hash, latency, and metered cost where available.
- Tool use/retrieval is either disabled for all systems or supplied under an explicitly matched policy. A specialized RevenueGuard local parser/retriever is part of the RevenueGuard candidate and is therefore allowed, but competing models must be given the same underlying source documents.
- Outputs are frozen before judging.
- Any refusal, timeout, unsupported-context failure, or abstention is recorded rather than retried selectively.

## Scoring dimensions

Every case is scored on the dimensions relevant to that case:

- task correctness / financial correctness
- evidence grounding and span/source fidelity
- false-grounding rate
- calibrated abstention under ambiguity or missing evidence
- completeness of applicable obligations
- contract directionality/scope correctness
- numerical/reconciliation correctness
- governance/safety correctness
- recovery usefulness to a finance reviewer
- latency and cost as secondary efficiency dimensions

Critical dimensions are correctness, grounding, false grounding, ambiguity handling, and governance. A statistically meaningful loss on any critical dimension prevents a supremacy seal even if aggregate preference is positive.

## Human comparison gate

Pairwise presentations must be blinded and randomized. Reviewers may not be told which output belongs to MUSITU or a competitor. For each primary frontier reference, RevenueGuard must achieve >= 60% blinded human preference on the matched adjudicable set, with >= 50 total genuine human comparisons and no critical-dimension regression.

## Quantitative certification gates

A candidate may be labelled FRONTIER_CERTIFIED only if all of the following are independently evidenced by hashed bundles:

- sovereign/offline core gate PASS
- post-freeze private unseen gate PASS
- public external holdout gate PASS
- real permissioned company gate PASS
- human adjudication evidence present
- verified recovered-cash evidence present
- false grounding <= 2% on the applicable locked external evaluation
- >= 300 matched frontier cases completed
- >= 60% blinded preference against each primary reference individually
- no critical-dimension loss against any primary reference
- clean install/replay of the exact candidate artifact PASS
- evidence chain / manifest verification PASS

Missing required evidence => NOT_CERTIFIED.
Any critical-dimension loss => NOT_SUPREME.
A stale frontier reference set => STALE_PROTOCOL, not certification.

## Claim rule

Until every gate above passes, permitted language is limited to evidence-backed narrower statements such as sovereign, local/offline-capable, deterministic where applicable, or internally/publicly evaluated. "Frontier certified", "better than GPT/Claude/Gemini", "superior", and equivalent claims are prohibited.
