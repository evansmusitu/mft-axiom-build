# MFT Intelligence Mail — isolated MVP
Run from musitu-mail-fabric: `python -m http.server 8080 --bind 127.0.0.1`, then visit http://127.0.0.1:8080/src/mailbox/.
This is a local, synthetic-data UI with in-memory drafts and simulated sending. No email is sent or retained on reload. Do not serve this from the existing protected worker or use it for real email.
Run focused tests: `node --test test/mmf-mailbox-mvp.test.mjs test/mmf-gmail-read.test.mjs`.
The server-only Gmail read adapter is separate and unwired. It supports bounded list/search and metadata requests against the authenticated user's Gmail mailbox. It does not request or store credentials, perform OAuth, download attachments, read full MIME bodies or make any provider mutations.
Before staging integration: implement tenant-bound OAuth session/consent and secure token storage/refresh/revocation; obtain appropriate Gmail API scopes and required Google verification; connect the server-side adapter through authenticated routes with rate limits and no-store responses; verify cross-tenant denial, CSRF, real browser behavior and actual Gmail read access. Full mailbox persistence, inbound mail, sending, domain authentication, attachments and AI remain out of scope for this preview.
Existing MMF worker, flags, billing, DNS and deployment configuration remain unchanged.
