#!/usr/bin/env bash
# Isolated GitHub Actions Postgres16 service ONLY. Never use this stress test
# against a real Neon tenant or unconsenting publisher accounts.
set -euo pipefail
id="$(docker ps -q --filter ancestor=postgres:16 | head -1)"
test -n "$id"
db='storepilot_rate_stress_20261025'
tmp="$(mktemp -d)"
cleanup(){
  rm -rf "$tmp"
  docker exec "$id" psql -U storepilot -d postgres -v ON_ERROR_STOP=1 \
    -c "DROP DATABASE IF EXISTS $db WITH (FORCE)" >/dev/null 2>&1 || true
}
trap cleanup EXIT
# A *separate* disposable DB prevents these intentionally committed synthetic
# concurrency fixtures from contaminating the 0-row immutable journal tests.
docker exec "$id" psql -U storepilot -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $db" >/dev/null
for script in postgres-review-journal.candidate.sql postgres-session-status.candidate.sql postgres-rate-gate.candidate.sql;do
  docker exec -i "$id" psql -U storepilot -d "$db" -v ON_ERROR_STOP=1 \
    < "store/phase1/developer_portal/$script" > /dev/null
done
{
  printf 'BEGIN;\n'
  for n in 1 2 3;do
    printf "INSERT INTO store_publisher_private.principal_enrollments(subject_id,role,publisher_id) VALUES('rate-developer-%03d','developer','rate-test-publisher');\n" "$n"
    printf "INSERT INTO store_publisher_private.portal_sessions(token_id,subject_id,role,publisher_id,issuer_uri,audience,expires_unix) VALUES('rate-token-%07d','rate-developer-%03d','developer','rate-test-publisher','https://issuer.example.org','store-v2-internal',EXTRACT(EPOCH FROM clock_timestamp())::BIGINT+600);\n" "$n" "$n"
  done
  printf 'COMMIT;\n'
} > "$tmp/seed.sql"
docker exec -i "$id" psql -U storepilot -d "$db" -v ON_ERROR_STOP=1 < "$tmp/seed.sql" > /dev/null
# Derive the same SHA-256 scope digests as the real JS adapter; cross-process
# token rotations and actors cannot choose their own fresh scopes.
actor_hash(){ printf 'actor\0https://issuer.example.org\0rate-developer-%03d\0developer' "$1" | sha256sum | cut -d' ' -f1; }
tenant_hash="$(printf 'publisher\0https://issuer.example.org\0rate-test-publisher' | sha256sum | cut -d' ' -f1)"
export id db tenant_hash
export -f actor_hash
# Avoid a natural one-minute rollover within the stress window: an expected
# quota refresh at the boundary is correct production behavior, not a bypass.
second="$(docker exec "$id" psql -U storepilot -d "$db" -Atqc
  'SELECT (floor(EXTRACT(EPOCH FROM clock_timestamp()))::BIGINT % 60)')"
[[ "$second" =~ ^[0-9]+$ ]]
if (( second > 35 ));then sleep "$((62-second))";fi
# 36 independent actual psql connections, up to 16 in parallel. They all hit
# the SAME publisher-wide UPLOAD cap of four and three actor caps of two.
for n in 1 2 3;do
  for _ in $(seq 1 12);do printf '%s\n' "$n";done
done | xargs -P 16 -I@ bash -c '
 set -euo pipefail
 n="$1"
 printf -v subject "rate-developer-%03d" "$n"
 printf -v token "rate-token-%07d" "$n"
 printf -v expquery "SELECT expires_unix FROM store_publisher_private.portal_sessions WHERE token_id=\047%s\047" "$token"
 exp="$(docker exec "$id" psql -U storepilot -d "$db" -Atqc "$expquery")"
 # Build a SQL literal only from script-generated test identifiers and integer
 # timestamps. This is a disposable CI-only concurrency runner, NOT an app query adapter.
 [[ "$exp" =~ ^[0-9]+$ ]]
 actor="$(actor_hash "$n")"
 printf -v q "SELECT CASE WHEN store_publisher_private.claim_portal_rate_permit(\047%s\047,\047https://issuer.example.org\047,\047%s\047,\047developer\047,\047rate-test-publisher\047,\047store-v2-internal\047,%s,\047upload\047,\047%s\047,\047%s\047) THEN \047ALLOW\047 ELSE \047DENY\047 END;" "$token" "$subject" "$exp" "$actor" "$tenant_hash"
 answer="$(docker exec "$id" psql -U storepilot -d "$db" -Atqc "$q")"
 printf "%s:%s\n" "$n" "$answer"
' _ @ > "$tmp/results"
if grep -Ev '^[123]:(ALLOW|DENY)$' "$tmp/results";then
  echo 'Unexpected SQL concurrency output' >&2;exit 1
fi
allows="$(grep -Ec '^[123]:ALLOW$' "$tmp/results" || true)"
denies="$(grep -Ec '^[123]:DENY$' "$tmp/results" || true)"
test "$allows" -eq 4
test "$denies" -eq 32
for n in 1 2 3;do
  used="$(grep -Ec "^${n}:ALLOW$" "$tmp/results" || true)"
  test "$used" -le 2
done
stored="$(docker exec "$id" psql -U storepilot -d "$db" -Atqc "SELECT used FROM store_publisher_private.portal_rate_windows WHERE scope_digest='${tenant_hash}' AND route='upload'")"
test "$stored" = '4'
echo 'MUSITU_STORE_V2_RATE_GATE_CONCURRENT_ACTOR_PUBLISHER_CAP=PASS'
