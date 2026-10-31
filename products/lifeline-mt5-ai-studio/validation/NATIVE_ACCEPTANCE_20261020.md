# LIFELINE MT5 AI Studio — Verified Native Windows Acceptance

Date: 2026-10-20
Stage: 0.3 (isolated research/development)
Branch: `product/lifeline-mt5-fivecloud-isolated-20261020`
PR: https://github.com/evansmusitu/mft-axiom-build/pull/30 (DRAFT; DO NOT MERGE)
Native run: https://github.com/evansmusitu/mft-axiom-build/actions/runs/39472075489
Agent cross-platform run: https://github.com/evansmusitu/mft-axiom-build/actions/runs/39471863153

## Verified, directly evidenced
- Windows GitHub-hosted build agent acquired temporarily, NOT a 24/7 persistent host.
- Official MetaQuotes installer downloaded and Authenticode signer validated: `CN=MetaQuotes Ltd., O=MetaQuotes Ltd., S=Lemesos, C=CY`.
- Installed real terminal64.exe and MetaEditor; vendor signatures verified.
- Native MQL5 Expert Advisor compiled into EX5 with an actual `Result: 0 errors, 0 warnings` compiler log.
- EX5 SHA256: `0861437d4b1281f3e90e4d2e995ba0027a0ded9ddddb8d662ad8487585ba6482`.
- Native MT5 Strategy Tester launched in **mathematical calculations/optimization mode**, which requires neither a broker account nor historical quotes. A named-input (InpProbeValue) result-bearing report was found and structurally checked.
- Report SHA256: `eff2376321d8a1c10c4d2a731d9314cada48cddd29a16a4ef598671842491cee`.
- 13 Windows + 13 Linux automated signed-agent/nonce/at-most-once security tests PASS.
- Login attempted: NO. Real trades: NO. Spending: NONE initiated in this stage.
- Original proof file and compiler log downloadable as GitHub Actions workflow artifacts from native run.

## Not yet verified (cannot be truthfully marked complete)
- Price-history-dependent EURUSD or XAUUSD trading-strategy backtest and profit metrics (requires verified broker demo/history); math optimization is **not** a market backtest.
- Persistent Windows agent host online 24/7. GitHub-hosted Windows runners are ephemeral; a verified persistent host needs a user-owned Windows machine or approved cost/payment.
- Live signed outbound polling service, Cloudflare Access identity, dedicated Neon staging DB and verified tenant RLS, private Modal runtime, protected Vercel deployment. Previous commits contain architecture source only, NOT proof of end-to-end cloud operation.
- Public ChatGPT plugin listing/acceptance, customer revenue, autonomous financial trading.

## Artifacts and security controls
- `windows/Invoke-MT5Native.ps1`: official source vendor-signature validation, native no-trade compile, strict proof and tester.
- `windows/LifelineSmoke.mq5`: deterministic no-order EA, includes `OnTester` for no-history mathematical optimization.
- `windows/agent.py`: signed allowlisted development job protocol, exact file hashes, path confinement and durable SQLite at-most-once claim semantics. Not a network-connected deployed agent.
- `windows/test_agent.py`: 13 protocol security tests across Windows and Linux.
- `.github/workflows/lifeline-mt5-native-compile.yml`: native acceptance.
- `.github/workflows/lifeline-mt5-agent-tests.yml`: cross-platform security acceptance.
- Do not store broker credentials on public GitHub runners. Avoid any live financial transactions from ChatGPT.
- Never reuse production Axiom/WhatsApp/Neon secrets or Cloudflare app resources.

## Operational gate
Keep staging isolated. Before production, attach a permitted durable Windows machine and an isolated, authenticated cloud task queue; prove broker demo historical backtests, end-to-end receipts, enterprise access control, quotas and rollback. Explicit consent and platform/law compliance are required for any future financial transactions outside ChatGPT.
