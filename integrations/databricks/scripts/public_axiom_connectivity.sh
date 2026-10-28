#!/usr/bin/env bash
set -euo pipefail
set +x
host='https://mcp.mftintelligence.com'
echo 'MUSITU_AXIOM_PUBLIC_NETWORK_DIAGNOSTIC_BEGIN'
probe() {
  local name="$1" method="$2" path="$3" body="${4:-}"
  local status='' exit_code=0
  if [[ "$method" == 'POST' ]]; then
    status="$(curl --proto '=https' --tlsv1.2 --silent --show-error \
      --connect-timeout 8 --max-time 15 --retry 0 --output /dev/null --write-out '%{http_code}' \
      --header 'Content-Type: application/json' \
      --header 'Accept: application/json, text/event-stream' \
      --data "$body" "$host$path")" || exit_code=$?
  else
    status="$(curl --proto '=https' --tlsv1.2 --silent --show-error \
      --connect-timeout 8 --max-time 15 --retry 0 --output /dev/null --write-out '%{http_code}' \
      "$host$path")" || exit_code=$?
  fi
  # No body, credentials, DNS address or internal headers enter logs.
  printf 'MUSITU_AXIOM_PUBLIC_NETWORK name=%s http=%s curl_exit=%s\n' \
    "$name" "${status:-000}" "$exit_code"
}
probe health GET /health
probe oauth_metadata GET /.well-known/oauth-protected-resource
probe public_initialize POST /mcp '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"musitu-github-public-probe","version":"1.0"}}}'
echo 'MUSITU_AXIOM_PUBLIC_NETWORK_DIAGNOSTIC_COMPLETE'
