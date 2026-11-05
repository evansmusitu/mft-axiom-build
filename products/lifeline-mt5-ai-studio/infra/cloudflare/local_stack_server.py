"""Offline test fixture only: real FastAPI staging bridge over loopback.

No Modal SDK, Cloudflare credentials, Neon connection, Windows host, broker or
public internet listeners. Used only by the cross-language CI acceptance test.
"""
from __future__ import annotations
import os
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
MODAL = ROOT / "infra" / "modal"
if str(MODAL) not in sys.path:
    sys.path.insert(0, str(MODAL))

from bridge import SQLiteQueue
from staging_api import create_local_app

TEST_AGENT_ID = "lifeline-offline-agent"
TEST_TENANT = "lifeline_offline_tenant"
TEST_AGENT_KEY = b"TEST_ONLY_HMAC_FOR_OFFLINE_INTEGRATION_DO_NOT_USE"
TEST_EDGE_KEY = "TEST_ONLY_EDGE_SECRET_FOR_OFFLINE_INTEGRATION"
FIXTURE_ROOT = tempfile.TemporaryDirectory(prefix="lifeline-offline-stack-")
database = SQLiteQueue(Path(FIXTURE_ROOT.name) / "stage.sqlite")
api = create_local_app(
    database, {TEST_AGENT_ID: TEST_AGENT_KEY}, {TEST_AGENT_ID: TEST_TENANT}, TEST_EDGE_KEY
)

@api.get("/__offline_ready")
def offline_ready():
    return {"offline_only": True, "trading_enabled": False, "persistent_windows": False}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(api, host="127.0.0.1", port=19234, log_level="error", access_log=False)
