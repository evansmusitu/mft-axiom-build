# Studio V0.3 — 2099 local receipt path binding and bounded offline qualification

25 October 2026. **Isolated Studio source branch only. NO production migration, provider invocation, customer mutation, paid GPU or real Blender rendering.**

## Reproduced receipt-integrity failures

The 2099 checksum verifier previously accepted a valid SHA-256 receipt after it had been (a) relocated to a different directory, (b) renamed independently of the MP4, or (c) reached by traversing a symlinked ancestor directory. In all three synthetic tests `verify` incorrectly returned exit code 0 despite referring to a misleading delivery location. All three tests were observed failing before the implementation was updated. The same three tests now pass by requiring:

- The receipt to sit in the **same directory** as the supplied video and be named exactly `<video-name>.verified.json`, in both `emit` and `verify`.
- Every component of the supplied scene, video, and receipt path to be free of symlinks or parent traversal. Checking only the final path leaf with `O_NOFOLLOW` was insufficient for a symlinked ancestor.
- Existing byte-level SHA-256, no-overwrite hard-link publication, exact schema, strict flags and ordinary regular-file requirements to remain intact.

This local receipt still **does not authenticate** Blender output or FFprobe, real render quality, owner identity, Cloudflare providers, production acceptance or anything remotely deployed. A matching hash proves only a local file-content relationship at the time of verification.

## Completed qualification and reliability

The current God Mode release/mock modules had **39 tests**, all passing in seven explicitly bounded serial groups (`6+6+6+6+6+6+3`); full continuous and parallel invocations were interrupted by CPU/filesystem runner contention. Per-group logs are included in the private handoff. The two timing failures during a parallel attempt passed independently, so the parallel attempt is explicitly **not** reported as a complete run.

Added `ops/studio_v03_bounded_2099_qualification.py`, an offline-only serial group runner that discovers `test_god_mode_2099_*.py`, refuses missing/duplicated tests, enforces group limits and counts from actual unittest summaries, and never emits complete qualification if a group fails or times out. Its subprocess isolation uses a fresh POSIX process group and kills the **whole group** on timeout; a descendant mock worker cannot leave standard-output pipes open and hang the qualification itself. Six bounded-runner contract tests pass, including an actual nested-process timeout. There is no GitHub Actions dispatch, network use, Blender invocation, or paid provider interaction by this tool itself. Current mocks intentionally replace Blender/FFmpeg with local synthetic fixtures.

### Offline reproduction

From the checked-in repository root:

```bash
python -m unittest discover -s ops/tests -p 'test_god_mode_2099_release_receipt_20261025.py' -v
python -m unittest discover -s ops/tests -p 'test_studio_v03_bounded_2099_qualification_20261025.py' -v
python ops/studio_v03_bounded_2099_qualification.py
```

The third command can take several minutes on a low-resource runner and deliberately exits nonzero on interrupted batches. The source-only workflow test suites remain separate from hosted exact-commit CI; they are **not** proof that any current GitHub Actions job succeeded.

## Remaining blockers

Real 360-frame 12-second Blender movie is not rendered. Production remains blocked on verified provider-origin R2 provenance/version pinning, signed Android owner acceptance, private Neon transport, hosted restore and rollback, provider-enforced zero-out-of-pocket hard stops, controlled preview and independently verified hosted CI. Keep production SQLite DO authoritative and Studio V0.2/Axiom production unchanged.
