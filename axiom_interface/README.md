# MUSITU Axiom browser application

This directory is the isolated Phase‑1 implementation of the authoritative Axiom interface blueprint. It is intentionally dependency-light and does not modify the sealed OpenAI review surface, frozen Track A, OAuth/MCP production workers, or canonical Track B.

## Run locally

```bash
python -m http.server 4173 --directory axiom_interface
```

Open `http://127.0.0.1:4173/#/home`. The root serves the full application directly; no installer or package download participates in normal launch.

## Browser launch contract

- The canonical deployment path is `/` on a dedicated AXIOM application origin; the exact in-app entry is `/#/home` and hash deep links survive refresh without a host-specific rewrite.
- `https://musitu.ai/axiom` remains the authoritative public entry from the blueprint. No production app origin or deployment is claimed in this source.
- `https://axiom.mftintelligence.com` remains the protected API edge and must not be repurposed as the static application host.
- A deployment may restore identity only from `/.well-known/axiom-session` on the same origin using an HttpOnly cookie. Missing, offline, malformed, redirected, cross-origin or secret-bearing responses fail closed to a usable guest workspace.
- Open/Launch is inline HTML navigation. PWA installation uses only the browser install pathway. No verified Android, iOS or desktop distribution URL exists in this source, so none is fabricated.

The machine-readable contract is `browser-app.json`.

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
