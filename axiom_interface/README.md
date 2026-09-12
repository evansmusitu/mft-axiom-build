# MUSITU Axiom Interface — Phase 1

This directory is the isolated Phase‑1 implementation of the authoritative Axiom interface blueprint. It is intentionally dependency-light and does not modify the sealed OpenAI review surface, frozen Track A, OAuth/MCP production workers, or canonical Track B.

## Run locally

```bash
python -m http.server 4173 --directory axiom_interface
```

Open `http://127.0.0.1:4173/`.

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
```
