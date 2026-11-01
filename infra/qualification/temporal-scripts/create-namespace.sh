#!/bin/sh
set -eu

NAMESPACE=${DEFAULT_NAMESPACE:-default}
TEMPORAL_ADDRESS=${TEMPORAL_ADDRESS:-temporal:7233}
MAX_ATTEMPTS=${TEMPORAL_HEALTH_CHECK_MAX_ATTEMPTS:-30}
SLEEP_SECONDS=${TEMPORAL_HEALTH_CHECK_SLEEP_SECONDS:-5}
SERVER_HOST=$(echo "$TEMPORAL_ADDRESS" | cut -d: -f1)
SERVER_PORT=$(echo "$TEMPORAL_ADDRESS" | cut -d: -f2)

attempt=1
while ! nc -z -w 10 "$SERVER_HOST" "$SERVER_PORT"; do
  if [ "$attempt" -ge "$MAX_ATTEMPTS" ]; then
    echo "Temporal server port did not become available"
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep "$SLEEP_SECONDS"
done

attempt=1
while ! temporal operator cluster health --address "$TEMPORAL_ADDRESS"; do
  if [ "$attempt" -ge "$MAX_ATTEMPTS" ]; then
    echo "Temporal server did not become healthy"
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep "$SLEEP_SECONDS"
done

if temporal operator namespace describe -n "$NAMESPACE" --address "$TEMPORAL_ADDRESS" >/dev/null 2>&1; then
  echo "Namespace '$NAMESPACE' already exists"
  exit 0
fi

attempt=1
while ! temporal operator namespace create -n "$NAMESPACE" --address "$TEMPORAL_ADDRESS" >/dev/null 2>&1; do
  if [ "$attempt" -ge "$MAX_ATTEMPTS" ]; then
    echo "Failed to create namespace '$NAMESPACE'"
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep "$SLEEP_SECONDS"
done

echo "Namespace '$NAMESPACE' created"
