# MFT Intelligence Mail
The root mailbox preview is a local, in-memory UI with fictional messages and simulated send. Run from musitu-mail-fabric: `python -m http.server 8080 --bind 127.0.0.1`, then visit http://127.0.0.1:8080/src/mailbox/.
The separate `business/` implementation targets `@mftintelligence.com` using Cloudflare Email Routing, private D1/R2 storage, Cloudflare Access and Resend. See [business pilot qualification](business/README.md). No Gmail API or Google OAuth integration is required. Neither UI has been deployed by this branch.
