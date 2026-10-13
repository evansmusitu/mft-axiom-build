# AXIOM Track B20 — authentic native OpenHands causal linkage (S0 candidate)

Parent: verified B19 `e95f8ac45e035d102a9a808e6680c8656f1fcdcd`, inheriting the separate two-job B19 OpenHands real SDK qualification and B14–B18 bounded tests. This is an isolated product-engineering evidence phase, not a full-product release.

The earlier B19 job recorded 12 **actual SDK ActionEvent / ObservationEvent** callback records (six per worker) with action IDs, tool-call IDs, and observation `action_id` references. The separate job validated the complete portable receipt and commit/source digest. Run `38414539835` reported `B19_PORTABLE_SHA256=805769640d8a9690275734baa259c3e8afc6ef656f1699d947166dfdb4d8b3a2` and a chain digest `d2bb53dd4a9c1f61f6acb69503c73644786711d1d69e2df4465228872c7e91de`.

B20 verifies the original **signed receipt read back from that specific GitHub Actions log**, not reconstructed OpenHands events. Each native action must have exactly one later matching observation with the same `tool_call_id`, `tool_name`, and `observation.action_id == action.id`. It rejects cross-agent aliasing, duplicate action or event IDs, missing or extra observations, unexpected tools, early finish, post-finish activity and changed order. Requires exactly two workers, each with two file_editor actions and one finish action with matching observation.

S0 only: no model inference, backend deployment, new paid resources, secret handling, public endpoints or protected branch changes. No external cryptographic trust anchor exists for the ephemeral signing key, and callbacks were recorded in workers before independent post-run verification. This proof does not establish unforgeability of a malicious worker, execution graph state durability during crash, authenticated real broker dispatch, or release authority.

The verification fixture must have the **exact** originally logged base64 JSON decoded to canonical bytes, preserving GitHub's recorded 256-bit envelope digest. The CI gate fails rather than approximating events if the original receipt is unavailable.
