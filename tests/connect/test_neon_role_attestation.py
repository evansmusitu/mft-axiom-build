import unittest
from qualification.neon_role_attestation import assess_role


def safe():
    return {
      "role_name": "stage_invoker", "rolcanlogin": True,
      "rolsuper": False, "rolcreatedb": False, "rolcreaterole": False,
      "rolreplication": False, "rolbypassrls": False,
      "inherited_role_count": 0,
      "schema_usage": True, "function_execute": True,
      "tenant_select": False, "credential_select": False,
      "event_select": False, "event_insert": False,
      "quota_update": False, "database_create": False,
      "schema_create": False, "any_table_access": False,
    }


class AttestationTests(unittest.TestCase):
    def test_strict_minimal_login_role_qualifies_only_at_role_level(self):
        self.assertEqual(assess_role(safe(), expected_role="stage_invoker"),
                         {"qualified": True, "reason_codes": []})

    def test_neon_created_admin_role_is_disqualified_even_with_execute(self):
        row = safe() | {
            "rolcreatedb": True, "rolcreaterole": True,
            "rolbypassrls": True, "inherited_role_count": 1,
            "credential_select": True, "event_insert": True,
            "quota_update": True, "any_table_access": True,
        }
        result = assess_role(row, expected_role="stage_invoker")
        self.assertFalse(result["qualified"])
        for reason in ("PRIVILEGED_ROLE_ATTRIBUTES", "INHERITED_ROLES", "DIRECT_TABLE_ACCESS"):
            self.assertIn(reason, result["reason_codes"])

    def test_missing_nullable_string_typed_and_mismatched_facts_fail_closed(self):
        for change in ({"role_name": "admin"},{"rolbypassrls": "false"},
                       {"tenant_select": None},{"inherited_role_count": True},
                       {"inherited_role_count": -1},{"function_execute": 1}):
            with self.subTest(change=change):
                self.assertFalse(assess_role(safe() | change, expected_role="stage_invoker")["qualified"])
        self.assertFalse(assess_role({}, expected_role="stage_invoker")["qualified"])

    def test_no_runtime_login_or_no_function_execute_fails(self):
        for change in ({"rolcanlogin": False},{"function_execute": False},
                       {"schema_usage": False},{"database_create": True},
                       {"schema_create": True},{"any_table_access": True}):
            self.assertFalse(assess_role(safe() | change, expected_role="stage_invoker")["qualified"])


if __name__ == "__main__":
    unittest.main()
