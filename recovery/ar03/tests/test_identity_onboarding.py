import tempfile
import unittest
from pathlib import Path

from recovery.ar03.identity_authority import AuthenticationError, AuthorizationError, IdentityAuthority


class IdentityOnboardingTests(unittest.TestCase):
    def test_ar03_end_to_end_gate_foundation(self):
        with tempfile.TemporaryDirectory(prefix="axiom-ar03-") as td:
            db=Path(td)/"identity.sqlite3"
            a=IdentityAuthority(db)
            reg=a.signup("new@example.test","CorrectHorseBatteryStaple!","Synthetic Labs")
            self.assertTrue(db.is_file())
            self.assertEqual(reg["role"],"owner")
            self.assertIn("axiom.safe_task.execute",reg["entitlements"])

            session=a.login("new@example.test","CorrectHorseBatteryStaple!")
            projects=a.list_projects(session["session_token"])
            self.assertEqual(len(projects),1)
            self.assertEqual(projects[0]["id"],reg["project_id"])

            link=a.link_oauth(session["session_token"],"chatgpt","subject-123")
            self.assertEqual(link["provider"],"chatgpt")

            key=a.issue_api_key(session["session_token"],"test-key")
            self.assertTrue(key["secret_once"].startswith("axk_"))
            row=a.db.execute("SELECT secret_hash FROM api_keys WHERE id=?",(key["key_id"],)).fetchone()
            self.assertNotEqual(row["secret_hash"],key["secret_once"])

            task=a.execute_safe_task(session["session_token"],reg["project_id"],"arithmetic.evaluate",{"expression":"40+2"})
            self.assertEqual(task["result"],42)
            self.assertEqual(task["risk_class"],"S0")

            history=a.audit_history(session["session_token"])
            kinds={x["event_type"] for x in history}
            self.assertTrue({
                "identity.signup","organization.created","project.created","identity.login",
                "oauth.linked","key.issued","task.executed"
            } <= kinds)

            recovery=a.request_recovery("new@example.test")
            self.assertTrue(recovery["token_once"])
            a.complete_recovery(recovery["token_once"],"EvenStrongerPassword!2026")
            with self.assertRaises(AuthenticationError):
                a.authenticate(session["session_token"])
            session2=a.login("new@example.test","EvenStrongerPassword!2026")
            self.assertEqual(session2["user_id"],reg["user_id"])
            a.close()

    def test_tenant_and_entitlement_fail_closed(self):
        with tempfile.TemporaryDirectory(prefix="axiom-ar03-") as td:
            a=IdentityAuthority(Path(td)/"identity.sqlite3")
            u1=a.signup("one@example.test","LongPasswordOne!2026","Org One")
            u2=a.signup("two@example.test","LongPasswordTwo!2026","Org Two")
            s1=a.login("one@example.test","LongPasswordOne!2026")["session_token"]
            s2=a.login("two@example.test","LongPasswordTwo!2026")["session_token"]

            with self.assertRaises(AuthorizationError):
                a.execute_safe_task(s1,u2["project_id"],"arithmetic.evaluate",{"expression":"1+1"})

            a.db.execute(
                "UPDATE entitlements SET status='revoked' WHERE organization_id=? AND capability='axiom.safe_task.execute'",
                (u1["organization_id"],)
            )
            a.db.commit()
            with self.assertRaises(AuthorizationError):
                a.execute_safe_task(s1,u1["project_id"],"arithmetic.evaluate",{"expression":"1+1"})

            self.assertEqual(
                a.execute_safe_task(s2,u2["project_id"],"arithmetic.evaluate",{"expression":"3*7"})["result"],
                21
            )
            a.close()

    def test_no_manual_schema_provisioning_required_and_reopen_is_idempotent(self):
        with tempfile.TemporaryDirectory(prefix="axiom-ar03-") as td:
            path=Path(td)/"identity.sqlite3"
            a=IdentityAuthority(path)
            reg=a.signup("idempotent@example.test","LongPassword!2026","Org")
            a.close()

            b=IdentityAuthority(path)
            s=b.login("idempotent@example.test","LongPassword!2026")
            self.assertEqual(b.list_projects(s["session_token"])[0]["id"],reg["project_id"])
            tables={r[0] for r in b.db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            self.assertTrue({
                "users","organizations","memberships","entitlements","sessions",
                "api_keys","oauth_links","recovery_tokens","projects","audit_events"
            } <= tables)
            b.close()


if __name__=="__main__":
    unittest.main()
