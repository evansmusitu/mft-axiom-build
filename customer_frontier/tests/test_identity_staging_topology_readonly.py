import importlib.util
from pathlib import Path
import unittest

file=Path(__file__).resolve().parents[1]/"qualification/identity_staging_topology_readonly.py"
spec=importlib.util.spec_from_file_location("identity_staging_topology", file)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

STAGE=m.STAGING_WORKER
DB=m.SOURCE_DB
def setting(*bindings):return {"bindings":list(bindings)}
def service(name, worker):return {"type":"service","name":name,"service":worker}
def d1(name, database):return {"type":"d1","name":name,"id":database}

class HostedTopology(unittest.TestCase):
    def test_unbound_staging_cannot_be_qualified_from_existing_db_tables(self):
        out=m.assess_topology([{"id":STAGE},{"id":"musitu-axiom-zitadel-private"}],
            {STAGE:setting(),"musitu-axiom-zitadel-private":setting(d1("IDP_SESSION_DB",DB))})
        self.assertEqual(out["status"],"IDP_TOPOLOGY_NO_GO")
        self.assertFalse(out["stage_private_browser_binding_present"])
        self.assertEqual(out["idp_session_db_consumers"],["musitu-axiom-zitadel-private"])
        self.assertFalse(out["identity_reuse_authorized"])

    def test_shared_database_used_by_unknown_worker_is_not_isolated(self):
        names=[{"id":STAGE},{"id":"musitu-axiom-zitadel-private"},{"id":"unknown-shared-worker"}]
        bindings={STAGE:setting(service("CUSTOMER_IDP_BROWSER","musitu-axiom-zitadel-private")),
                  "musitu-axiom-zitadel-private":setting(d1("IDP_SESSION_DB",DB)),
                  "unknown-shared-worker":setting(d1("LEGACY_DB",DB))}
        out=m.assess_topology(names,bindings)
        self.assertTrue(out["stage_private_browser_binding_present"])
        self.assertFalse(out["historical_db_exclusive_to_private_identity"])
        self.assertFalse(out["identity_reuse_authorized"])

    def test_zero_corresponding_database_binding_cannot_be_qualified(self):
        out=m.assess_topology([{"id":STAGE},{"id":"musitu-axiom-zitadel-private"}],
            {STAGE:setting(service("CUSTOMER_IDP_BROWSER","musitu-axiom-zitadel-private")),
             "musitu-axiom-zitadel-private":setting()})
        self.assertFalse(out["historical_db_exclusive_to_private_identity"])
        self.assertFalse(out["identity_reuse_authorized"])

    def test_malformed_or_incomplete_worker_metadata_fails_closed(self):
        cases=[
          ([{"id":STAGE}],{}),
          ([{"id":STAGE},{"id":STAGE}],{STAGE:setting()}),
          ([{"id":STAGE}],{STAGE:{"bindings":"not-array"}}),
          ([{"id":STAGE}],{STAGE:setting({"type":"d1","name":"X","id":"not-a-uuid"})}),
          ([{"id":STAGE}],{STAGE:setting(service("CUSTOMER_IDP_BROWSER","missing-worker"))}),
        ]
        for workers,settings in cases:
            with self.subTest(case=workers,settings=settings),self.assertRaises(ValueError):
                m.assess_topology(workers,settings)

    def test_synthetic_ideal_topology_alone_does_not_authorize_live_login(self):
        name="musitu-axiom-zitadel-private"
        out=m.assess_topology([{"id":STAGE},{"id":name}],
            {STAGE:setting(service("CUSTOMER_IDP_BROWSER",name)),
             name:setting(d1("IDP_SESSION_DB",DB))})
        self.assertTrue(out["stage_private_browser_binding_present"])
        self.assertTrue(out["historical_db_exclusive_to_private_identity"])
        self.assertFalse(out["identity_reuse_authorized"])
        self.assertFalse(out["owner_mfa_qualified"])
        self.assertFalse(out["live_staging_login_qualified"])

if __name__=="__main__":unittest.main()
