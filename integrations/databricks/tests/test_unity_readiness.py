"""Unit tests: Databricks Unity MCP feasibility probe must be read-only."""
import unittest
from unity_readiness import build_path, classify_response, summarize

class UnityReadinessTests(unittest.TestCase):
    def test_only_three_readonly_routes(self):
        self.assertEqual(build_path("catalogs"), "/api/2.1/unity-catalog/catalogs")
        self.assertEqual(build_path("builtin_mcp"), "/api/2.1/unity-catalog/mcp-services?parent=schemas%2Fsystem.ai&view=BASIC&page_size=20")
        self.assertEqual(build_path("pilot_mcp"), "/api/2.1/unity-catalog/mcp-services?parent=schemas%2Fmain.default&view=BASIC&page_size=20")
        with self.assertRaises(ValueError):
            build_path("create_service")

    def test_status_classification(self):
        self.assertEqual(classify_response(200), "ACCESSIBLE")
        self.assertEqual(classify_response(403), "FORBIDDEN")
        self.assertEqual(classify_response(404), "NOT_FOUND")
        self.assertEqual(classify_response(401), "UNAUTHENTICATED")
        self.assertEqual(classify_response(429), "RATE_LIMITED")
        self.assertEqual(classify_response(500), "REMOTE_ERROR")

    def test_summary_does_not_copy_catalog_or_identity_or_tokens(self):
        result = summarize({
            "catalogs": (200, {"catalogs": [{"name":"private-financial-records"},{"name":"main"}], "email":"hidden"}),
            "builtin_mcp": (200, {"mcp_services": [{"name":"secret-service"}], "token":"secret-value"}),
            "pilot_mcp": (403, {"message":"sensitive-internal-message"}),
        })
        self.assertEqual(result["catalogs_status"], "ACCESSIBLE")
        self.assertTrue(result["main_catalog_visible"])
        self.assertEqual(result["built_in_mcp_count"], 1)
        self.assertEqual(result["pilot_mcp_status"], "FORBIDDEN")
        self.assertFalse(result["can_claim_registration_ready"])
        self.assertNotIn("private-financial-records", str(result))
        self.assertNotIn("secret-value", str(result))
        self.assertNotIn("sensitive-internal-message", str(result))

    def test_no_mcp_service_is_not_authorization_to_create_one(self):
        result = summarize({
            "catalogs": (200, {"catalogs": [{"name":"main"}]}),
            "builtin_mcp": (200, {"mcp_services": []}),
            "pilot_mcp": (200, {"mcp_services": []}),
        })
        self.assertFalse(result["can_claim_registration_ready"])
        self.assertEqual(result["built_in_mcp_count"], 0)

    def test_failed_calls_do_not_expose_response_body(self):
        result=summarize({
            "catalogs": (401, "super-secret-response"),
            "builtin_mcp": (404, "super-secret-response"),
            "pilot_mcp": (500, "super-secret-response"),
        })
        self.assertNotIn("super-secret", str(result))
        self.assertEqual(result["catalogs_status"], "UNAUTHENTICATED")


if __name__=="__main__":
    unittest.main()
