"""Offline adversarial guard tests: never claim a provider event is owner custody."""
import importlib.util
import pathlib
import unittest

p=pathlib.Path(__file__).resolve().parents[1]/"qualification/step1_historical_d1_audit_readonly.py"
spec=importlib.util.spec_from_file_location("audit",p)
audit=importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


def event(uid="event00000000001", *, database=audit.DATABASE, actor="private-actor-123", kind="create", result="success", method="POST", date="2026-10-20T12:00:00Z"):
    return {"id":uid,"account":{"id":audit.ACCOUNT},"resource":{"id":database,"product":"d1"},"action":{"type":kind,"result":result,"time":date},"actor":{"id":actor,"type":"user","context":"api_token","email":"PRIVATE@example.com","ip_address":"192.0.2.1","token_id":"PRIVATE_TOKEN"},"raw":{"method":method,"uri":"/accounts/"+audit.ACCOUNT+"/d1/database","status_code":200}}


def page(events, cursor=None):
    return {"success":True,"result":events,"result_info":{"count":str(len(events)),"cursor":cursor}}


class AuditQualification(unittest.TestCase):
    def test_exact_database_name_digest_pinned(self):
        with self.assertRaisesRegex(audit.NoGo,"NAME_MISMATCH"):
            audit.check_metadata({"success":True,"result":{"uuid":audit.DATABASE,"name":"Mail Fabric"}})
        with self.assertRaisesRegex(audit.NoGo,"UUID_MISMATCH"):
            audit.check_metadata({"success":True,"result":{"uuid":"wrong","name":"name"}})
    def test_creation_event_is_not_self_certifying_owner(self):
        out=audit.inspect_logs([page([event()])])
        self.assertEqual(out["status"],"HISTORICAL_PROVIDER_EVENT_OBSERVED_NOT_OWNER_ADMITTED")
        self.assertEqual(out["successful_create_events"],1)
        self.assertFalse(out["historical_ownership_qualified"])
        self.assertFalse(out["source_reuse_authorized"])
        self.assertFalse(out["step_2_authorized"])
        self.assertFalse(out["release_authority"])
        self.assertNotIn("PRIVATE", str(out))
        self.assertNotIn("192.0.2.1",str(out))
    def test_empty_complete_history_cannot_grant_reuse(self):
        out=audit.inspect_logs([page([])])
        self.assertEqual(out["status"],"HISTORICAL_PROVENANCE_INCOMPLETE_NO_GO")
    def test_wrong_resource_or_account_rejected(self):
        with self.assertRaisesRegex(audit.NoGo,"WRONG_ACCOUNT_OR_DATABASE"):
            audit.inspect_logs([page([event(database="different")])])
        item=event();item["account"]["id"]="wrong"
        with self.assertRaisesRegex(audit.NoGo,"WRONG_ACCOUNT_OR_DATABASE"):
            audit.inspect_logs([page([item])])
    def test_non_d1_resource_cannot_qualify(self):
        item=event();item["resource"]["product"]="mail_fabric"
        with self.assertRaisesRegex(audit.NoGo,"PRODUCT_UNCONFIRMED"):
            audit.inspect_logs([page([item])])
    def test_no_pagination_false_positive(self):
        with self.assertRaisesRegex(audit.NoGo,"TRUNCATED"):
            audit.inspect_logs([page([event()],cursor="more")])
        with self.assertRaisesRegex(audit.NoGo,"TRUNCATED"):
            audit.inspect_logs([page([event()]),page([])])
    def test_duplicated_event_id_or_create_event_rejected_or_uncertified(self):
        with self.assertRaisesRegex(audit.NoGo,"DUPLICATED"):
            audit.inspect_logs([page([event(),event()])])
        out=audit.inspect_logs([page([event(),event("event00000000002")])])
        self.assertIsNone(out["creation_actor_sha256"])
        self.assertFalse(out["source_reuse_authorized"])
    def test_delete_prevents_false_positive(self):
        out=audit.inspect_logs([page([event(),event("event00000000002",kind="delete",method="DELETE")])])
        self.assertEqual(out["status"],"HISTORICAL_PROVENANCE_INCOMPLETE_NO_GO")
    def test_malformed_sensitive_event_fails_closed(self):
        for bad in (None,{}, {"result":[]},event(date="2027-01-01T00:00:00Z")):
            with self.subTest(bad=repr(bad)[:60]),self.assertRaises(audit.NoGo):
                audit.inspect_logs([page([bad])])
    def test_cannot_attempt_other_resources_or_post(self):
        with self.assertRaisesRegex(audit.NoGo,"PATH_NOT_ALLOWLISTED"):
            audit.get("/d1/database/different", "SECRET", None)
        with self.assertRaisesRegex(audit.NoGo,"QUERY_NOT_ALLOWLISTED"):
            audit.get("/logs/audit?since=2025-01-01&resource_id=different", "SECRET", None)
    def test_unexpected_response_fails_closed(self):
        for response in ({"success":False,"result":[]},
                         {"success":True,"result":[],"result_info":{"count":"1"}},
                         {"success":True,"result":[],"result_info":{"count":"0","cursor":"...\n"}}):
            with self.subTest(response=response),self.assertRaises(audit.NoGo):
                audit.inspect_logs([response])

    def test_unrelated_d1_create_uri_or_unauthenticated_actor_no_go(self):
        e=event();e["raw"]["uri"]="/accounts/"+audit.ACCOUNT+"/workers/scripts"
        out=audit.inspect_logs([page([e])])
        self.assertEqual(out["successful_create_events"],0)
        self.assertEqual(out["status"],"HISTORICAL_PROVENANCE_INCOMPLETE_NO_GO")
        self.assertFalse(out["source_reuse_authorized"])
        e=event();e["actor"]["context"]="unknown"
        with self.assertRaisesRegex(audit.NoGo,"ACTOR_CONTEXT_UNQUALIFIED"):
            audit.inspect_logs([page([e])])
        e=event();e["raw"]["status_code"]=403
        with self.assertRaisesRegex(audit.NoGo,"PROVIDER_STATUS_UNQUALIFIED"):
            audit.inspect_logs([page([e])])
    def test_max_pages_never_claims_history_complete(self):
        responses=[page([event("event%012d"%i)], cursor="opaque%02d"%i) for i in range(audit.MAX_PAGES)]
        with self.assertRaisesRegex(audit.NoGo,"TRUNCATED"):
            audit.inspect_logs(responses)
        with self.assertRaisesRegex(audit.NoGo,"PAGE_COUNT"):
            audit.inspect_logs(responses + [page([])])

    def test_provider_date_only_before_is_inclusive_and_rejected_by_allowlist(self):
        # Hosted evidence 42843937389: 1056 events with `before=2026-09-12`,
        # including eight September 12 entries. RFC3339 midnight yields 1048,
        # correctly excluding all eight. The test never assumes filter syntax.
        import urllib.parse
        start,end=audit.WINDOWS[15]
        self.assertEqual((start,end),('2026-08-10','2026-09-12'))
        params={'since':start,'before':end,'resource_id':audit.DATABASE,
                'direction':'asc','limit':str(audit.PAGE_LIMIT)}
        with self.assertRaisesRegex(audit.NoGo,'AUDIT_QUERY_NOT_ALLOWLISTED'):
            audit.get('/logs/audit?'+urllib.parse.urlencode(params),'TEST_TOKEN',None)
        params['before']=end+'T00:00:00Z'
        class Stub:
            def __init__(self):self.url=None
            def open(self, req, timeout):
                self.url=req.full_url
                raise OSError('NETWORK_DISABLED_TEST')
        stub=Stub()
        with self.assertRaisesRegex(audit.NoGo,'PROVIDER_NETWORK_UNAVAILABLE'):
            audit.get('/logs/audit?'+urllib.parse.urlencode(params),'TEST_TOKEN',stub)
        self.assertIn('before=2026-09-12T00%3A00%3A00Z',stub.url)

    def test_provider_offset_timestamp_normalized_to_utc_boundary(self):
        e=event(date="2026-09-12T00:30:00+02:00")
        parsed=audit.parse_event(e)
        self.assertEqual(parsed["date"],"2026-09-11")
        # A local 12 September timestamp is still within the UTC window
        # ending 12 September, and must not become a false scope failure.
        pages=[[page([])] for _ in audit.WINDOWS]
        pages[15]=[page([e])]
        self.assertEqual(audit.inspect_windows(pages)["event_count"],1)
    def test_bounded_monthly_windows_no_owner_from_partial_evidence(self):
        self.assertEqual(len(audit.WINDOWS),18)
        self.assertEqual(audit.WINDOWS[0][0],"2025-05-11")
        self.assertEqual(audit.WINDOWS[-1][1],"2026-11-11")
        pages=[[page([])] for _ in audit.WINDOWS]
        self.assertFalse(audit.inspect_windows(pages)["step_2_authorized"])
        with self.assertRaisesRegex(audit.NoGo,"COVERAGE_INCOMPLETE"):
            audit.inspect_windows(pages[:-1])
        pages[-1]=[page([event(date="2026-10-20T12:00:00Z")])]
        out=audit.inspect_windows(pages)
        self.assertEqual(out["successful_create_events"],1)
        self.assertFalse(out["historical_ownership_qualified"])
        self.assertFalse(out["source_reuse_authorized"])
    def test_bounded_window_rejects_out_of_range_event_and_conflicting_overlap(self):
        pages=[[page([])] for _ in audit.WINDOWS]
        pages[0]=[page([event(date="2026-10-20T12:00:00Z")])]
        with self.assertRaisesRegex(audit.NoGo,"OUTSIDE_BOUNDED_PROVIDER_WINDOW"):
            audit.inspect_windows(pages)
        # Overlap around 10-11 October 2026 is intentional; exact duplicate
        # provider events are deduplicated, contradictory records are denied.
        pages=[[page([])] for _ in audit.WINDOWS]
        e=event(date="2026-10-11T12:00:00Z")
        pages[-2]=[page([e])]
        pages[-1]=[page([e])]
        self.assertEqual(audit.inspect_windows(pages)["event_count"],1)
        different=event(actor="another-actor",date="2026-10-11T12:00:00Z")
        pages[-1]=[page([different])]
        with self.assertRaisesRegex(audit.NoGo,"OVERLAP_EVENT_CONFLICT"):
            audit.inspect_windows(pages)

if __name__ == "__main__":unittest.main()
