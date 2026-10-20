# LIFELINE MT5 — Windows agent acquisition and deployment contract

Stage contract: no broker credentials, no live orders, and no persistent server on the public CI Windows runner.

## Phase A: immediate zero-cost native build runner
Use **GitHub Actions Windows 2022** on this public repository. This is a **temporary Windows runner**, not an always-on backend. Its job is to qualify Windows x64, filesystem, subprocesses, and later signed installer execution + MetaEditor compile /log, using only disposable source. Never use real trading accounts or secrets on a public-repository runner. Github Actions is free for standard public-repository runners, subject to GitHub policy.

The workflow `.github/workflows/lifeline-mt5-windows-runner.yml` runs on push to this isolated branch and creates a machine-readable GitHub job result, not a public network endpoint. It does NOT download or execute MetaTrader yet; software supply chain validation comes next.

## Phase B: verified native MetaEditor compilation
1. Obtain an official signed MetaTrader 5 Windows setup from MetaQuotes/your licensed broker, check publisher signature and SHA256 pinned per version, and verify redistribution/license rights. No unofficial third-party binaries.
2. On Windows x64, confirm `metaeditor64.exe`; keep source in isolated disposable work directory with no terminal account data.
3. Run `metaeditor64.exe /compile:"C:\path\Expert.mq5" /log`, capture generated log; require explicit no-error evidence and EX5 output, scrub source paths and secrets.
4. Use a dedicated `terminal64.exe /config:"C:\path\tester.ini"` demo/no-account setup and prove Strategy Tester returns an attributable HTML/XML report. Timeout and kill orphaned processes.
5. Ship signed hashes of source, tool version, log, and report to the Cloudflare/Modal/Neon evidence flow.

## Phase C: dedicated Windows host for interactive + durable operation
A Windows PC already under our control, a dedicated Windows VPS, or a self-hosted Windows runner/VM **only after** owner cost/credential authorization. It must stay online, be licensed, and have a non-admin service identity and locked outbound-only registration channel. Never expose RDP, MetaTrader server/MetaTester ports, raw MCP endpoint, or localhost forwarding publicly.

Use **Windows execution agent** on the host with a mutually authenticated outbound queue to Cloudflare gateway, short-lived work leases, signed request provenance, scoped folders, no generic shell command tool, per-job timeouts, quota, two-stage approval for any financial action; keep all ChatGPT-facing actions read-only/research-only. Production trading, if offered by a separate legally compliant service, is disabled until separate consent, broker, risk, jurisdiction and platform approvals.

## Role division
| Platform | Role |
|---|---|
| GitHub | Source, CI, temporary Windows runner, attestations |
| Vercel | Private UI and status |
| Cloudflare | Access, authenticated requests, job control, egress |
| Modal | Linux research, interpretation and analytics (NOT MetaEditor execution) |
| Neon | Tenant-isolated evidence, job status, lease and hashes |
| Dedicated Windows host | Real MT5 terminal, MetaEditor, MQL5 code build, Strategy Tester and market terminal |

## Decision gate
**Do not pay for any Windows VPS or activate a broker.** Acquire the ephemeral Windows runner first; validate native MetaEditor/MT5 installer requirements next; move to a persistent Windows host only when an approved machine or budget is available. Keep main and other projects untouched.
