# MUSITU Axiom MCP public health — read-only incident diagnosis

The independent [post-merge issue](https://github.com/evansmusitu/mft-axiom-build/issues/36)
records a failure in the existing OpenAI submission-readiness check:
`RuntimeError: live MCP v4 health drift` on 27 October 2026, reproduced after a
failed-job rerun. **Do not relax the original publication readiness gate.**

`qualification/diagnose_axiom_public_health.py` performs a bounded public
`GET https://mcp.mftintelligence.com/health` with no authentication or mutation.
It verifies status 200 and the precise four-field v4 contract (`ok=true`,
`server_version=4.0.0`, `submission_safe_commerce_profile=true`,
`oauth_enforced=true`). The report contains only fixed field-failure codes;
it cannot copy unknown JSON fields, credentials or arbitrary response bodies.
Responses over 8 KiB, transport errors and non-object JSON fail closed.
For a mismatched server version only, the report may include an
`observed_server_version` value exclusively when the public value consists of
three dot-separated decimal components, each 1–4 digits (for example
`4.1.7`). Non-numeric strings, free-form text and excessive lengths are not
echoed. This public-version hint helps investigate drift without relaxing
the v4.0.0 requirement or exposing arbitrary server response text.

Run locally or in the dedicated non-enabling GitHub Actions workflow:

```sh
python -m unittest discover -s tests/connect -p test_axiom_public_health_diagnostics.py -v
python qualification/diagnose_axiom_public_health.py --output mcp-public-health-diagnostic.json
python qualification/diagnose_axiom_public_health.py --strict
```

Non-strict mode generates diagnostics even when an external endpoint is down;
**exit 0 in this mode is not a health success claim**. Inspect the report's
`ready` boolean and `failed_checks`. Strict mode exits nonzero on drift.
The workflow publishes a sanitized JSON artifact and step summary, but never
issues OAuth tokens or invokes production POST. It does not certify directory
submission, payment readiness, general commercial availability, mining safety,
or production customer admission. Only the original strict readiness workflow
and independently verified operational evidence can qualify those claims.
