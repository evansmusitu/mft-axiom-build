"""Provider-free safety contract tests for the one-use corporate maintenance controller."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

MODULE=Path(__file__).resolve().parents[1]/"scripts"/"corporate_soft404_maintenance_control.py"
spec=importlib.util.spec_from_file_location("corp404control",MODULE)
control=importlib.util.module_from_spec(spec)
spec.loader.exec_module(control)

SECURITY={"content-security-policy":"default-src 'none'",
          "x-content-type-options":"nosniff"}


class MaintenanceControllerTests(unittest.TestCase):
    def test_exact_site_project_source_and_recovery_are_frozen(self):
        self.assertEqual(control.PROJECT,"musitu-corporate")
        self.assertEqual(control.CORPORATE,"https://mftintelligence.com")
        self.assertEqual(control.SOURCE_SHA,"6b1643ab2d3b03628104b617435db1d364076aa9")
        self.assertEqual(control.BASELINE,"a2426a81-b0cb-4a46-a90c-493f871c9775")
        self.assertNotEqual(control.BASELINE,control.HISTORIC_ROLLBACK)

    def test_cloudflare_rejects_unapproved_api_paths_and_methods_without_network(self):
        with self.assertRaisesRegex(RuntimeError,"Unexpected Cloudflare GET"):
            control.cloudflare("/accounts/different/project")
        with self.assertRaisesRegex(RuntimeError,"Unexpected Cloudflare method"):
            control.cloudflare("/deployments",method="DELETE")
        with self.assertRaisesRegex(RuntimeError,"Unexpected Cloudflare rollback request"):
            control.cloudflare("/deployments/not-approved/retry",method="POST")

    def test_unauthorized_target_cannot_be_rolled_back(self):
        with patch.object(control,"active_new_deployment_id",return_value="11111111-1111-4111-8111-111111111111"), \
             patch.object(control,"cloudflare") as provider:
            with self.assertRaisesRegex(RuntimeError,"unqualified target"):
                control.rollback_to("22222222-2222-4222-8222-222222222222")
            provider.assert_not_called()

    def test_real_http_404_requires_noindex_and_no_canonical_on_all_unknown_routes(self):
        html=b'<html lang="en"><head><meta name="robots" content="noindex,nofollow"></head></html>'
        with patch.object(control,"get_public",return_value=(404,SECURITY,html)) as get:
            control.verify_unknown(404)
            self.assertEqual(get.call_count,3)
        bad=b'<html lang="en"><head><meta name="robots" content="index,follow"><link rel="canonical" href="https://mftintelligence.com/"></head></html>'
        with patch.object(control,"get_public",return_value=(404,SECURITY,bad)):
            with self.assertRaisesRegex(RuntimeError,"noindex"):
                control.verify_unknown(404)

    def test_legacy_200_soft404_state_is_detectable_before_maintenance(self):
        home=b'<html lang="en"><head><link rel="canonical" href="https://mftintelligence.com/"></head></html>'
        with patch.object(control,"get_public",return_value=(200,SECURITY,home)):
            control.verify_unknown(200)
        with patch.object(control,"get_public",return_value=(404,SECURITY,home)):
            with self.assertRaisesRegex(RuntimeError,"HTTP status"):
                control.verify_unknown(200)

    def test_current_sitemap_is_bounded_to_33_routes_and_never_phase03(self):
        locs=[control.CORPORATE+"/"]+[control.CORPORATE+f"/route-{n}/" for n in range(32)]
        def responses(path,*args,**kwargs):
            if path=="/sitemap.xml":
                data=('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
                      +''.join('<url><loc>'+u+'</loc></url>' for u in locs)+'</urlset>').encode()
                return 200,SECURITY,data
            if path=="/robots.txt":
                return 200,SECURITY,('User-agent: *\\nAllow: /\\nSitemap: '+control.CORPORATE+'/sitemap.xml').encode()
            raise AssertionError(path)
        with patch.object(control,"get_public",side_effect=responses), \
             patch.object(control,"check_indexable_route",return_value=True) as page:
            control.verify_sitemap_and_pages()
            self.assertEqual(page.call_count,33)
        locs[-1]=control.CORPORATE+"/fr/"
        with patch.object(control,"get_public",side_effect=responses):
            with self.assertRaisesRegex(RuntimeError,"sitemap changed"):
                control.verify_sitemap_and_pages()

    def test_a_failed_build_preflight_never_sends_rollback(self):
        with patch.object(control,"project",return_value={"canonical_deployment":{"id":control.BASELINE}}), \
             patch.object(control,"rollback_to") as rollback:
            control.recovery_on_failure()
            rollback.assert_not_called()

    def test_an_unknown_live_production_identity_is_never_blindly_rolled_back(self):
        p={"canonical_deployment":{"id":"00000000-0000-4000-8000-000000000001"}}
        with patch.object(control,"project",return_value=p), \
             patch.object(control,"active_new_deployment_id",side_effect=RuntimeError("unknown")), \
             patch.object(control,"rollback_to") as rollback:
            with self.assertRaisesRegex(RuntimeError,"no blind rollback"):
                control.recovery_on_failure()
            rollback.assert_not_called()


if __name__=="__main__":
    unittest.main()
