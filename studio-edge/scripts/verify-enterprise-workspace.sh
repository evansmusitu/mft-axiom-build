#!/usr/bin/env bash
# Reproducible, offline enterprise-workspace qualification. NO deployments.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
command -v node >/dev/null || { echo 'Node.js 22 required' >&2; exit 2; }
command -v python3 >/dev/null || { echo 'Python 3 required' >&2; exit 2; }
node --check studio-edge/enterprise-workspace.mjs
node --check studio-edge/enterprise-client.mjs
node --check studio-edge/client-encrypted-artifact.mjs
node --check studio-edge/worker.mjs
python3 studio-edge/tests/enterprise_release_boundary.py
node --test studio-edge/tests/*.test.mjs
python3 studio-edge/tests/enterprise_sqlite_contract.py
python3 studio-edge/tests/enterprise_quota_contract.py
python3 studio-edge/tests/enterprise_mutation_budget.py
echo 'PASS: offline enterprise SDK, signed-tenant D1, security, quotas and release fence; NOT LIVE'
