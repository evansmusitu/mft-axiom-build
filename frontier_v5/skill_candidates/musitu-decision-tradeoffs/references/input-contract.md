# Finite decision input

Supply `states: [{id, probability}]`, `actions: [{id, utilities: {state_id:
number}}]`, `utility_unit`, nonempty `assumptions` and `evidence_refs` (a list that
may be empty only when the declared inputs are assumptions). Supply every state
utility for every action. State and action identifiers must be unique ASCII
letters, digits, underscore, period, colon or hyphen. Priors sum to one within
1e-10. Each collection has at most 100 rows; unknown fields are rejected.

Optional `signal_model: {signals: [{id, likelihoods: {state_id: number}}]}`
contains P(signal | state). Sum likelihoods over signals to one for each state.
Optional nonnegative `information_cost` requires a signal model and uses the
same utility unit. Do not reverse conditional likelihoods and posteriors.

Probabilities, utilities, costs and arithmetic results must be finite. Integer
values outside JavaScript's safe integer range are rejected consistently across
the two runtimes. The commitment normalizes row order and binds all accepted
input fields using big-endian IEEE-754 numeric encodings; it is separate from
verification of referenced source bytes by the surrounding execution contract.

Outputs include expected utilities, tied recommendations, regret by state,
minimax regret, EVPI and optional EVSI, net EVSI and per-signal policy. Every
result sets `recommendation_only:true`, `authority_granted:false` and
`source_evidence_verified:false`.

Example: a launch returns 100 in a favorable state (probability .6) and -80
otherwise (.4); waiting returns zero. Launch expected utility is 28, perfect
information value is 60 and EVPI is 32. A signal with P(positive | favorable)=.8
and P(positive | unfavorable)=.25 gives EVSI 12; information cost 3 gives net
EVSI 9. These are illustrative assumptions, not observed business performance.

The shared six-case oracle corpus is
`frontier_v5/fixtures/decision_analysis_v1.json`; it includes independent and
perfect signals, negative utilities, tied actions and a zero-probability signal.
