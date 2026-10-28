# MUSITU Axiom public page reachability — not legal qualification

The public OpenAI listing declares fixed privacy, terms, docs and support URLs.
The non-enabling `qualification/diagnose_axiom_public_pages.py` runs one
credential-free GET against each allowlisted public URL, with bounded response
size, a fixed timeout, no redirects, no arbitrary URL input, no response-body
logging, and a sanitized JSON report.

Run `python -m unittest tests.connect.test_axiom_public_pages -v` then
`python qualification/diagnose_axiom_public_pages.py --output /private/new-report.json`.
Non-strict mode generates a diagnostic even if pages are inaccessible. A
`PUBLIC_HTML_OBSERVED_NOT_LEGALLY_APPROVED` status is only proof of basic
HTML reachability from that runner. This cannot verify privacy terms'
substantive adequacy, DPA, deletion/retention, reviewer approval, human
support service levels, customer admission, Cloudflare deployment provenance,
or the separately failed Axiom v4.0.0 public health contract.

The documented current target is full commercial GA, not a pilot/beta release.
The original readiness gate remains strict and must not be bypassed by a
separate non-enabling diagnostic.
