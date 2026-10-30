# MUSITU Axiom browser application

This directory is the isolated Phase‑1 implementation of the authoritative Axiom interface blueprint. It is intentionally dependency-light and does not modify the sealed OpenAI review surface, frozen Track A, OAuth/MCP production workers, or canonical Track B.

## Run locally

```bash
python -m http.server 4173 --directory axiom_interface
```

Open `http://127.0.0.1:4173/#/home`. The root serves the full application directly; no installer or package download participates in normal launch.

## Browser launch contract

- The canonical public application URL is `https://app.mftintelligence.com/`; the exact in-app entry is `https://app.mftintelligence.com/#/home`, and hash deep links survive refresh without a host-specific rewrite.
- No apex route is claimed by this isolated AXIOM workstream. The unrelated `mftintelligence.com` apex authority remains unchanged; Open/Launch targets the canonical application subdomain directly.
- `https://axiom.mftintelligence.com` remains the protected API edge and must not be repurposed as the static application host.
- The global Cloudflare zone security policy remains unchanged. One configuration rule is scoped exactly to `app.mftintelligence.com`, suppressing the zone-level browser interstitial only where the browser application must load. The Worker's active-account validation, per-source authentication rate limiting, CSRF checks, signed Secure HttpOnly session, response hardening and API-origin isolation remain enforced.
- Identity is restored only from `/.well-known/axiom-session` on the dedicated application origin using a signed, Secure, HttpOnly cookie. Account keys are checked server-side against active canonical AXIOM D1 account records behind a per-source Cloudflare Worker rate-limit binding and are never returned to browser JavaScript or stored in the session cookie. Missing, offline, malformed, redirected, cross-origin or secret-bearing responses fail closed to a usable guest workspace.
- Open/Launch is inline HTML navigation. PWA installation uses only the browser install pathway. No verified Android, iOS or desktop distribution URL exists in this source, so none is fabricated.

The machine-readable contract is `browser-app.json`.


## Production deployment evidence

Status: **PRODUCTION_DEPLOYED_VERIFIED**.

The green implementation head is `5fc86d83efd650de0ca2a0ce9a3973ebd7278b52`. GitHub Actions run `34849605955` completed the full runtime/security, inherited browser-regression, static-build, and production-deployment envelope successfully. The deployment evidence SHA-256 is `288ac1d23817214f0f80b86a4f0046eeaf79e1f514de7c615a1c1730ee2dd0ce`; exact job, artifact, size, and provider-reported ZIP-digest bindings are recorded in `browser-app.json` and `surface-map.json`.

Live HTTP verification bound the application root, health contract, and guest session contract to the green implementation SHA. The hosted browser job verified browser launch, deep-link/refresh behavior, responsive viewports, PWA behavior, session boundaries, security regressions, and inherited Phase 1–14 candidate coverage. This production seal does not add `qualified_phase13_sha` or `qualified_phase14_sha`, and it does not claim either phase earned.


The tracked Cloudflare Worker in `ops/axiom_browser_application_worker.mjs` owns only the dedicated app hostname. Deployment is fail-closed on any existing DNS or Worker-domain conflict and runs only after the inherited browser/runtime qualification jobs pass.

Build an integrity-inventoried static deployment directory (the build output is not a user launch download):

```bash
python frontier_v5/scripts/build_browser_application.py --output /tmp/axiom-browser-application-dist
```

## Boundaries

- Phase‑1 is a **workspace shell**, not a claim that downstream product capabilities are fully wired.
- Composer submission creates a local inspectable **preview only**. It does not call external tools or systems.
- The trace ledger records allow-listed operational metadata only. It never records composer content, secrets, or private chain-of-thought.
- Draft recovery uses local storage only for the text draft; do not place credentials in the composer.
- Existing evidence, security, governance, OAuth, MCP and review-safe gates remain authoritative.

## Tests

```bash
PYTHONPATH=. python -m unittest discover -s axiom_interface/tests -p 'test_*.py' -v
python axiom_interface/tests/run_browser_phase1.py
python axiom_interface/tests/run_browser_application.py
```
