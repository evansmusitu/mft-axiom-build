import unittest
from studio_browser_chain import correlate_mobile_chain

UUID='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
STAMP='2026-10-18T06:34:36.361Z'

def group(path,code=200,count=1,device='mobile'):
    return {'count':count,'dimensions':{'clientRequestPath':path,'clientRequestHTTPMethodName':'POST',
        'clientDeviceType':device,'edgeResponseStatus':code,'clientIP':'192.0.2.10','userAgent':'private'}}

class BrowserChainTests(unittest.TestCase):
    def test_full_android_ua_correlated_job_lifecycle_but_no_device_attestation(self):
        valid=[group('/api/jobs',201), group('/api/jobs/'+UUID+'/approve'),
               group('/api/jobs/'+UUID+'/dispatch',202),group('/api/jobs/'+UUID+'/sync')]
        access=[{'app_domain':'studio.mftintelligence.com','allowed':True,'action':'login',
                 'created_at':'2026-10-18T06:33:30Z','user_email':'PRIVATE_EMAIL@example.org'}]
        out=correlate_mobile_chain(UUID,STAMP,valid,access,True,True)
        self.assertTrue(out['mobile_access_cpu_r2_provider_correlated'])
        self.assertFalse(out['physical_android_attested'])
        self.assertNotIn(UUID,str(out))
        self.assertNotIn('PRIVATE_EMAIL',str(out))
        self.assertNotIn('192.0.2.10',str(out))

    def test_other_job_or_failed_requests_never_correlate(self):
        valid=[group('/api/jobs',201),group('/api/jobs/'+UUID+'/approve'),
               group('/api/jobs/'+UUID+'/dispatch',403),group('/api/jobs/'+UUID+'/sync')]
        access=[{'app_domain':'studio.mftintelligence.com','allowed':True,'action':'login',
                 'created_at':'2026-10-18T06:33:30Z','user_email':'a@example.org'}]
        r=correlate_mobile_chain(UUID,STAMP,valid,access,True,True)
        self.assertFalse(r['mobile_access_cpu_r2_provider_correlated'])
        wrong=[group('/api/jobs',201),group('/api/jobs/'+'b'*8+'-bbbb-4bbb-bbbb-'+'b'*12+'/approve'),
               group('/api/jobs/'+UUID+'/dispatch',202),group('/api/jobs/'+UUID+'/sync')]
        r=correlate_mobile_chain(UUID,STAMP,wrong,access,True,True)
        self.assertFalse(r['mobile_access_cpu_r2_provider_correlated'])

    def test_late_login_and_invalid_artifacts_do_not_certify(self):
        groups=[group('/api/jobs',201),group('/api/jobs/'+UUID+'/approve'),
                group('/api/jobs/'+UUID+'/dispatch',202),group('/api/jobs/'+UUID+'/sync')]
        late=[{'app_domain':'studio.mftintelligence.com','allowed':True,'action':'login',
               'created_at':'2026-10-18T06:35:00Z','user_email':'x@example.org'}]
        self.assertFalse(correlate_mobile_chain(UUID,STAMP,groups,late,True,True)['mobile_access_cpu_r2_provider_correlated'])
        earlier=[dict(late[0],created_at='2026-10-18T06:30:00Z')]
        self.assertFalse(correlate_mobile_chain(UUID,STAMP,groups,earlier,True,False)['mobile_access_cpu_r2_provider_correlated'])

if __name__=='__main__':unittest.main()
