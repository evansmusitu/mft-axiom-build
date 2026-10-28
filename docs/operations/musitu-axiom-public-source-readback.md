# MUSITU Axiom — encrypted live source readback reconciliation

The 28 October 2026 read-only Cloudflare readback produced an encrypted
source snapshot and a separately readable `manifest.json` in GitHub
[run 40763491334](https://github.com/evansmusitu/mft-axiom-build/actions/runs/40763491334).
Do **not** commit or print the encrypted payload, transport key or plaintext
Worker source.

The offline-only `qualification/verify_axiom_public_source_readback.py`
reads a **privately obtained** manifest, compares the reported public MCP
`index.mjs` module digest and byte count with the checked-in
`mcp/musitu_axiom_plugin_gate_v4.mjs` source, and creates an exclusive
sanitized report. It does no network I/O, resource mutation, token handling,
decryption or release promotion.

Run, from the repository root, against an **authorized local** manifest:

```sh
python qualification/verify_axiom_public_source_readback.py \
  --manifest /private/readback/manifest.json \
  --output /private/readback/new-reconciliation-report.json
```

The SHA-256/byte-size mismatch reported by the available manifest is an
**unreconciled source/build difference**, not proof of an unauthorized
deployment; bundling/transformation or an approved newer Worker revision may
explain it. Even byte identity cannot itself certify OAuth security,
production acceptance, support, billing, or OpenAI submission.

The current production `4.0.2` public health still conflicts with the
approved `4.0.0` readiness contract. Independent provenance, Cloudflare
deployment authority, external authentication/security/negative-case checks
and a separate source approval remain required.

No commercial GA, customer admission or methane safety claim is authorized
by this tool. All project-level research and operational guards remain.
