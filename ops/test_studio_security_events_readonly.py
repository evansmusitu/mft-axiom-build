import unittest
from studio_security_events_readonly import query_payload, summarize_response

class StudioEventTests(unittest.TestCase):
    def test_graphql_query_is_exact_ray_and_short_window(self):
        r = query_payload("zone-123", "a4c53d53abad646a")
        self.assertEqual(r["variables"]["zoneTag"], "zone-123")
        self.assertEqual(r["variables"]["filter"]["rayName"], "a4c53d53abad646a")
        self.assertEqual(r["variables"]["filter"]["datetime_geq"], "2026-10-18T05:44:30Z")
        self.assertEqual(r["variables"]["filter"]["datetime_leq"], "2026-10-18T05:47:00Z")
        for forbidden in ("clientIP", "userAgent", "clientRequestQuery"):
            self.assertNotIn(forbidden, r["query"])

    def test_only_exact_ray_matches_and_no_private_provider_values(self):
        response = {"data":{"viewer":{"zones":[{"firewallEventsAdaptive":[
            {"rayName":"a4c53d53abad646a","action":"managed_challenge","source":"bic",
             "ruleId":"abc123def456abc123def456abc123de","datetime":"2026-10-18T05:45:54Z",
             "clientIP":"192.0.2.1","userAgent":"super-secret-agent","clientRequestQuery":"?token=secret"},
            {"rayName":"another-ray","action":"block","source":"waf","clientIP":"192.0.2.2"}
        ]}]}}}
        r = summarize_response(response, "a4c53d53abad646a")
        self.assertEqual(r["matching_event_count"], 1)
        self.assertEqual(r["matching_events"][0]["source"], "bic")
        self.assertEqual(r["matching_events"][0]["action"], "managed_challenge")
        self.assertEqual(r["matching_events"][0]["rule_id"], "abc123def456abc123def456abc123de")
        for private in ("secret", "192.0.2.", "super-secret-agent"):
            self.assertNotIn(private, str(r))

    def test_missing_events_are_not_misreported_as_no_security_rule(self):
        r = summarize_response({"data":{"viewer":{"zones":[{"firewallEventsAdaptive":[]}]}}}, "a4c53d53abad646a")
        self.assertEqual(r["matching_event_count"], 0)
        self.assertEqual(r["outcome"], "no_event_returned_sampling_or_coverage_unknown")

    def test_provider_errors_do_not_leak_untrusted_details(self):
        r = summarize_response({"errors":[{"message":"Authorization failed: token private-secret"}]}, "a4c53d53abad646a")
        self.assertFalse(r["query_usable"])
        self.assertNotIn("private-secret", str(r))

if __name__ == "__main__":
    unittest.main()
