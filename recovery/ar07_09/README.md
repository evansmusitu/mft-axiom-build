# AR-07 through AR-09 candidate track

This package is a bounded, provider-independent recovery candidate. It extends
the AR-03--AR-06 runtime through one same-origin application service, controlled
local adversarial probes, and controlled local reliability probes.

It does **not** carry production authority, execute provider operations, earn a
formal phase gate, modify the protected vNext runtime, or claim live SLO proof.

## Orchestration authority

AXIOM is the orchestration authority for this candidate. External design or
implementation providers are optional bounded capabilities rather than a
single-vendor dependency. Provider output never overrides the candidate's
authority, evidence, accessibility, security, or independent-verification
gates.

## Local application

The only executable composer operation is `arithmetic.evaluate`. Task progress,
tool activity, approvals, artifacts, and memory all come from the authenticated
durable runtime; the browser does not manufacture progress or tool receipts.
Unavailable research, browser, enterprise, automation, and multimodal
capabilities are shown as limitations and fail closed.

To run the local server from the repository root:

```bash
python -m recovery.ar07_09.run_local --database /tmp/axiom-ar07-09.sqlite3
```

Open `http://127.0.0.1:8087`. The generated local secret is process-scoped and
is not printed. This launcher is for local evaluation only.

## Verification

```bash
python -m unittest discover -s recovery/ar07_09/tests -p 'test_*.py' -v
python recovery/ar07_09/verify_candidate_builder.py
python recovery/ar07_09/verify_candidate_independent.py
```

AR-08 reports controlled local coverage of the eleven named attack domains.
AR-09 reports controlled local concurrency, transient-fault, restart,
corruption-detection, and restore samples. Independent real-surface testing and
live production observation remain explicit blockers.
