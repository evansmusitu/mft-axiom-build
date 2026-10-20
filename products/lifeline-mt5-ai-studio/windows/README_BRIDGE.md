# Windows native agent — no incoming ports

This is a one-iteration, outbound-only Python client. It does not contain broker credentials or a live trading tool. Native MT5 binary processes are only invoked when the host is explicitly trusted and `LIFELINE_ALLOW_NATIVE_DEVELOPMENT=1`.

Requirements: Windows 10/11 or Windows Server x64, Python 3.12+, MetaTrader 5 and MetaEditor signed vendor binaries, safe VM/isolated profile, and a separate Cloudflare-protected HTTPS endpoint.

Set on the *private Windows host*, not in GitHub or the browser: `LIFELINE_EDGE_URL=https://...`, `LIFELINE_AGENT_ID`, `LIFELINE_TENANT`, `LIFELINE_AGENT_SECRET` (32+ random bytes), `LIFELINE_AGENT_WORKDIR` (restricted local directory). Native compiler setup additionally uses `LIFELINE_METAEDITOR`, `LIFELINE_TERMINAL`, and `LIFELINE_ALLOW_NATIVE_DEVELOPMENT=1` only after isolated host review.

Invoke `python poller.py`. It performs **one** authenticated poll, may complete one job, and exits. A separately reviewed Windows Task Scheduler/service supervisor can run repeated bounded invocations. Do not start an infinite loop in a GitHub-hosted Windows runner; those machines are ephemeral and GitHub jobs have limits.

If an agent request is interrupted after a durable native claim, the agent refuses automatic re-execution and requires manual reconciliation; this intentionally sacrifices availability to avoid duplicate side effects. The local SQLite claims database must survive machine restarts, remain private and be backed up securely.

Never expose Windows RDP, MT5 local API ports, Agent HTTP server, or a public MetaEditor compilation endpoint. Future reviewed multi-tenant compilation must have per-tenant Windows isolation and signed source review, because MQL5 code can execute native trading logic.
