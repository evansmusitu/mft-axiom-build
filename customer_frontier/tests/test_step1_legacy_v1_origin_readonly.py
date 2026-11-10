"""Offline adversarial tests: no provider network, no owner self-certification."""
import contextlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock
from urllib.parse import parse_qs, urlsplit

script=Path(__file__).resolve().parents[1]/"qualification/step1_legacy_v1_origin_readonly.py"
spec=importlib.util.spec_from_file_location("step1_legacy_v1",script)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class Response:
    status=200
    def __init__(self,payload):self.payload=payload
    def __enter__(self):return self
    def __exit__(self,*args):return None
    def read(self,n):return json.dumps(self.payload).encode()

class Provider:
    def __init__(self,events,db_name="test-stage-d1",bad_uuid=False):
        self.events=events;self.db_name=db_name;self.bad_uuid=bad_uuid;self.methods=[]
    def open(self,request,timeout):
        self.methods.append(request.get_method())
        parsed=urlsplit(request.full_url)
        if parsed.path.endswith("/d1/database/"+mod.D1):
            return Response({"success":True,"result":{"uuid":"wrong" if self.bad_uuid else mod.D1,
                "name":self.db_name,"created_at":"2026-09-06T16:47:39.419Z"}})
        if parsed.path.endswith("/audit_logs"):
            page=int(parse_qs(parsed.query)["page"][0])
            return Response({"success":True,"result":self.events if page==1 else []})
        raise AssertionError("Unapproved path")

@contextlib.contextmanager
def harness(events,**kwargs):
    provider=Provider(events,**kwargs)
    oldcwd=os.getcwd()
    with tempfile.TemporaryDirectory() as directory:
        os.chdir(directory)
        try:
            with mock.patch.dict(os.environ,{"CLOUDFLARE_API_TOKEN":"FAKE_LOCAL_UNIT_TEST"}):
                with mock.patch.object(mod,"NAME_SHA",mod.sha(provider.db_name)):
                    with mock.patch.object(mod.urllib.request,"build_opener",return_value=provider):
                        yield provider
        finally:os.chdir(oldcwd)

def event(ident="evt-001",uuid=mod.D1,at="2026-09-06T16:47:39.419Z",actor="private-actor"):
    return {"id":ident,"when":at,"action":{"type":"create_database","result":True},
            "resource":{"id":uuid,"type":"database"},
            "actor":{"id":actor,"type":"user","email":"private@example.invalid","ip":"192.0.2.101"},
            "newValue":"private should never persist"}

class Step1LegacyOrigin(unittest.TestCase):
    def test_exact_resource_is_not_qualified_owner(self):
        with harness([event()]) as provider:
            rc=mod.run()
            receipt=json.loads(Path("axiom_stage_d1_legacy_v1_origin_20261110.json").read_text())
        self.assertEqual(rc,0)
        self.assertEqual(receipt["provider_v1_pages_read"],2)
        self.assertEqual(receipt["provider_v1_possible_create_events"],1)
        self.assertEqual(receipt["provider_v1_exact_resource_successful_events"],1)
        for key in ("historical_ownership_qualified","source_reuse_authorized",
                    "step_2_authorized","release_authority","current_backup_qualified"):
            self.assertFalse(receipt[key])
        self.assertEqual(provider.methods,["GET","GET","GET"])
        self.assertNotIn("private@example.invalid",str(receipt))
        self.assertNotIn("192.0.2.101",str(receipt))
        self.assertNotIn("private should never persist",str(receipt))
    def test_other_database_origin_not_a_match(self):
        with harness([event(uuid="different-d1")]):
            mod.run();receipt=json.loads(Path("axiom_stage_d1_legacy_v1_origin_20261110.json").read_text())
        self.assertEqual(receipt["provider_v1_possible_create_events"],0)
        self.assertFalse(receipt["step_2_authorized"])
    def test_wrong_uuid_fails_closed(self):
        with harness([event()],bad_uuid=True):
            rc=mod.run();receipt=json.loads(Path("axiom_stage_d1_legacy_v1_origin_20261110.json").read_text())
        self.assertEqual(rc,2)
        self.assertEqual(receipt["reason_code"],"D1_UUID_MISMATCH")
    def test_duplicate_event_id_fails_closed(self):
        with harness([event(),event()]):
            rc=mod.run();receipt=json.loads(Path("axiom_stage_d1_legacy_v1_origin_20261110.json").read_text())
        self.assertEqual(rc,2)
        self.assertEqual(receipt["reason_code"],"LEGACY_EVENT_DUPLICATE")
    def test_out_of_window_fails_closed(self):
        with harness([event(at="2026-09-10T01:00:00Z")]):
            rc=mod.run();receipt=json.loads(Path("axiom_stage_d1_legacy_v1_origin_20261110.json").read_text())
        self.assertEqual(rc,2)
        self.assertEqual(receipt["reason_code"],"LEGACY_EVENT_OUT_OF_WINDOW")

if __name__=="__main__":
    unittest.main()
