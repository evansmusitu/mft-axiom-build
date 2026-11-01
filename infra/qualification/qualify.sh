#!/usr/bin/env bash
set -euo pipefail
docker compose -f infra/qualification/docker-compose.yml up -d
trap 'docker compose -f infra/qualification/docker-compose.yml down -v' EXIT
python -m pip install --disable-pip-version-check -r infra/qualification/requirements.txt
python infra/qualification/security_smoke.py
python infra/qualification/smoke.py
python infra/qualification/temporal_smoke.py
