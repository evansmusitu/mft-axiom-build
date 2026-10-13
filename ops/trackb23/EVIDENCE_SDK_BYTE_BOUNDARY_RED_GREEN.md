# B23 SDK-byte binding hardening: observed S0 red/green evidence

- Parent B22 verified SHA: `e4760d2042fa511bde576d5ffc8505e4ce4172eb`.
- Initial B23 bounded CI Workerd+native event+quota/journal join PASS on run 38442347099, commit `5b4f943e7f82ece44995db2d72e23fbd60c2523b`.
- Adversarial review discovered missing exact hash binding of original OpenHands SDK request bytes to derived Workerd provider model body.
- Focused RED command: `python3 -m unittest discover -v -s test -p test_evidence.py` under `ops/trackb23`; exit 1, 2 tests failed with `AssertionError: JoinDenied not raised` for missing SDK digest and SDK digest substitution.
- Repair: clone original synthetic B22 bridge under `ops/trackb23/gated_b12.py`, emit actual SHA-256 of SDK raw request bytes; check expected B17 canonical synthetic model body SHA equals admitted Workerd, quota and durable journal SHA.
- Local GREEN: `python3 -m unittest discover -q -s ops/trackb23/test -p 'test_*.py'` => `Ran 35 tests`, `OK`; source manifest 8 entries verified.
- Repair commit `cef433d9053f7d9365db3dded6b965f642a7cc88`. Fresh real Workerd+SDK+independent CI verification is required to earn revised PASS; earlier PASS does not certify stronger binding.
- Red/green S0 testing does NOT establish external signer authority, genuine provider receipt or production readiness.
