import unittest
from studio_usage_forensics import summarize_edge_groups, summarize_access_logs

class UsageForensicsTests(unittest.TestCase):
    def test_redacts_job_id_and_only_known_api_action_device(self):
        uuid='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
        groups=[{'count':2,'dimensions':{'clientRequestPath':f'/api/jobs/{uuid}/dispatch',
                'clientRequestHTTPMethodName':'POST','clientDeviceType':'mobile','edgeResponseStatus':202,
                'clientIP':'192.0.2.9','userAgent':'private-Android-UserAgent'}},
                {'count':1,'dimensions':{'clientRequestPath':'/api/session',
                'clientRequestHTTPMethodName':'GET','clientDeviceType':'desktop','edgeResponseStatus':200}}]
        result=summarize_edge_groups(groups)
        self.assertEqual(result['mobile_post_dispatch_sampled_count'],2)
        self.assertEqual(result['session_get_sampled_count'],1)
        for prohibited in (uuid, '192.0.2.9', 'private-Android-UserAgent'):
            self.assertNotIn(prohibited,str(result))
        self.assertFalse(result['browser_origin_proven'])

    def test_access_logs_emit_counts_only(self):
        logs=[{'app_domain':'studio.mftintelligence.com','allowed':True,
              'created_at':'2026-10-18T06:34:00Z','user_email':'private@example.org','ip_address':'198.51.100.4'},
              {'app_domain':'unrelated.example.org','allowed':True,'created_at':'2026-10-18T06:34:00Z'},
              {'app_domain':'studio.mftintelligence.com','allowed':False,'created_at':'2026-10-18T06:35:00Z'}]
        result=summarize_access_logs(logs)
        self.assertEqual(result['studio_allowed_logins_in_window'],1)
        self.assertEqual(result['studio_denied_logins_in_window'],1)
        self.assertNotIn('private',str(result))
        self.assertNotIn('198.51.100.4',str(result))

if __name__=='__main__':unittest.main()
