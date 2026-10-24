# START HERE — LIFELINE MT5 AI STUDIO COMPLETE HANDOFF

This is the **portable, clean source-and-evidence handoff** for LIFELINE MT5 AI Studio from the actual isolated GitHub branch, not a reconstructed description. The source content is under `source/` and preserves its original GitHub repository-relative paths.

**2026-10-24 IMPORTANT:** Previously uploaded v1.3/v1.4 portable ZIPs are **older snapshots**, not the latest GitHub implementation. The authoritative GitHub draft PR #30 contains newer live audits, 6/10 Cloudflare binding evidence and the unresolved shared-Modal-workspace proxy-token isolation blocker. Read latest `validation/SECURE_SCOPE_GATE_20261024.md` from the actual branch first, compare source SHAs, and never overwrite it with old ZIP source.\n\n**First in a fresh conversation:** read `handoff/CURRENT_STATE_AND_NEXT_STEPS.md`, `handoff/SOURCE_MANIFEST.json`, `handoff/VALIDATION_REPORT.txt`, `handoff/SECURITY_EXCLUSIONS.md`, `SHA256SUMS.txt`, and `handoff/CONTINUATION_PROMPT.txt`. Then examine the source, tests, validation reports and workflows. The authoritative Git commit is recorded in `handoff/SOURCE_MANIFEST.json`; re-read GitHub HEAD before any write to avoid clobbering later work.

**Authority:** GitHub repo `evansmusitu/mft-axiom-build`, branch `product/lifeline-mt5-fivecloud-isolated-20261020`, draft PR #30. Protected main and other products must remain untouched. The package contains no current credentials, tokens, broker passwords, private OIDC/MFA secrets or Windows host keys. A real cloud deployment is NOT represented by this portable source package.

**Never treat a new chat as authorization to bypass Cloudflare Access MFA, deploy unrestricted MCP/trading tools, rotate credentials, merge PRs or spend money.** Budget is $0. All financial order execution and unreviewed remote shell are disabled.

## Quick file map

- `source/products/lifeline-mt5-ai-studio/README.md`: project README and current operational truth.
- `source/products/lifeline-mt5-ai-studio/windows/`: Windows MetaEditor compiler, native MCP read-only adapter, bridge/agent, tests, instructions.
- `source/products/lifeline-mt5-ai-studio/infra/`: Cloudflare Worker/Access, private Modal service, Neon SQL, Vercel interface.
- `source/products/lifeline-mt5-ai-studio/validation/`: chronological acceptance records v0.4–v1.2.
- `source/.github/workflows/lifeline*.yml`: all tracked LIFELINE GitHub workflow automation.
- `evidence/native-compiler/`: short-lived verified sample EX5/log/proof (if the 2026-10-21 GitHub artifact was retrievable at packaging time).
- `handoff/SOURCE_MANIFEST.json`: exact pinned SHA, inclusions, exclusions and per-file hashes.
- `SHA256SUMS.txt`: SHA-256 per included payload file.

The ZIP is a source and continuation artifact. The actual customer-facing MT5 control loop and owner LIFELINE app-specific login are not yet qualified. See next steps.
