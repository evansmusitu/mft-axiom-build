"""Owned staging IdP topology readback. GET-only, no token or secret values retained.
NO production login, historical D1 adoption, ownership proof or release authority.
"""
ACCOUNT = "93f395f5121954671f92fffa453d6b61"
SOURCE_DB = "ccc473f1-fbb5-4b8d-8a24-45f3696ac10f"
STAGING_WORKER = "musitu-axiom-customer-staging"

def assess_topology(workers, settings, *, database_id=SOURCE_DB):
    # RED control: intentionally not yet implemented.
    return None
