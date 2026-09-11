#!/usr/bin/env python3
"""Retired one-time browser-presentation deployment harness.

The original implementation attempted to PUT the raw multipart body returned by
Cloudflare's Worker GET endpoint as a rollback snapshot. Cloudflare does not
accept that representation for rollback. Production recovery was completed by
reconstructing and uploading the exact certified module set instead.

Do not reuse this file for production mutation. The successful production
browser-presentation state is certified in:
  evidence/musitu-store/MUSITU_STORE_BROWSER_PRESENTATION_HOTFIX_PRODUCTION_CERTIFICATION_20260911.json

Future Phase-2 deployment must use module-root rollback, not raw GET multipart
replay.
"""

raise SystemExit(
    "RETIRED: invalid raw multipart rollback path. Use the guarded Phase-2 "
    "module-root deployment transaction instead."
)
