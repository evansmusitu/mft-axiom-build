# RevenueGuard ContractNLI semantic failure diagnosis — 2026-09-12

Status: DEV FAILURE MINING ONLY. This is not certification evidence.

## Bound evidence

- Adapted MiniLM simple pair classifier: 76.28% dev accuracy, macro-F1 0.732, 7.33% false grounding.
- Raw adapted classifier: 81.77% accuracy with high-confidence directional errors.
- Policy-conditioned diagnostic heads: 87.46% dev accuracy, macro-F1 0.8150, 4.96% false grounding; gate FAIL.
- Policy-head calibration partition: 90.85% accuracy, macro-F1 0.8759, 1.34% false grounding.
- Training sample geometry for the generalized joint learner: 75.74% NotMentioned, 20.00% Entailment, 4.27% Contradiction.
- Lexical top-14 evidence ceiling: 80.94% any-evidence recall on dev, below the 85% evidence gate. K=24 ceiling 92.35%; K=32 ceiling 95.93%.
- V1 hard-negative context contamination: 10.35%; V1 is rejected.

## Weakest public hypotheses in the policy-head diagnostic

The most persistent low-accuracy policies are not random IDs:

- `nda-1` — Explicit identification: “All Confidential Information shall be expressly identified by the Disclosing Party.”
- `nda-2` — None-inclusion of non-technical information: “Confidential Information shall only include technical information.”
- `nda-4` — Limited use: “Receiving Party shall not use any Confidential Information for any purpose other than the purposes stated in Agreement.”
- `nda-7` — Sharing with third-parties: “Receiving Party may share some Confidential Information with some third-parties (including consultants, agents and professional advisors).”
- `nda-20` — Permissible post-agreement possession: “Receiving Party may retain some Confidential Information even after the return or destruction of Confidential Information.”

## Causal diagnosis

The residual is concentrated in compositional legal semantics:

1. **Quantifier/scope:** all, only, any, some.
2. **Modality/directionality:** may vs shall vs shall not.
3. **Exceptions:** other than, permitted recipients, carve-outs.
4. **Temporal scope:** after termination/return/destruction.
5. **Role binding:** Receiving Party vs Disclosing Party vs third parties.

This is consistent with the failure pattern: policy-specific heads recover substantial signal from the adapted representation, but still fail macro-F1 and false-grounding gates. Therefore the next accepted architecture must bind semantic classification to the exact evidence span and learn under balanced build-only supervision rather than add benchmark-specific heads.

## Locked response

- V3 is the unweighted generalized target-span control.
- V4 is the matched generalized target-span treatment using square-root inverse-frequency class/evidence weights derived from build data only.
- Same seed, encoder, target-span representation, K candidates, calibration split, dev set and gates.
- No hypothesis-specific heads are eligible for the final product.
- No dev-derived curriculum examples may be added to training.
- MAUD remains sealed until a V4.1 candidate freezes.
