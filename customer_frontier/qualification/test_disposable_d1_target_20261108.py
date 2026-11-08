import unittest
import disposable_d1_target_20261108 as m
UUID='12345678-aaaa-4aaa-8aaa-123456789abc'

def l(items):return {'success':True,'result':items,'result_info':{'total_count':len(items),'count':len(items)}}
def item(name=m.NAME, uuid=UUID):return {'name':name,'uuid':uuid}

class StrictOneTarget(unittest.TestCase):
    def test_expected_empty_create_verified(self):
        seen=[]
        def fetch(kind):
            seen.append(kind)
            return l([]) if seen==['list'] else {'success':True,'result':item()} if kind=='create' else l([item()])
        out=m.qualify(fetch)
        self.assertEqual(seen,['list','create','list'])
        self.assertEqual(out['status'],'ONE_EMPTY_DISPOSABLE_TARGET_CREATED_AND_LIST_VERIFIED')
        self.assertEqual(out['write_operations'],1)
        self.assertFalse(out['customer_data_imported'])
        self.assertFalse(out['full_restore_qualified'])
        self.assertFalse(out['release_authority'])

    def test_nonempty_account_never_posts(self):
        seen=[]
        def fetch(k):seen.append(k);return l([item('foreign-real')])
        with self.assertRaisesRegex(m.Rejected,'TARGET_ACCOUNT_NOT_EMPTY'):m.qualify(fetch)
        self.assertEqual(seen,['list'])

    def test_ambiguous_list_never_posts(self):
        seen=[]
        def fetch(k):
            seen.append(k);return {'success':True,'result':[],'result_info':{'total_count':1,'count':0}}
        with self.assertRaisesRegex(m.Rejected,'D1_LIST_PAGINATION_OR_DRIFT'):m.qualify(fetch)
        self.assertEqual(seen,['list'])

    def test_unexpected_created_identity_is_not_accepted(self):
        seen=[]
        def fetch(k):
            seen.append(k)
            return l([]) if len(seen)==1 else {'success':True,'result':item('wrong-name')}
        with self.assertRaisesRegex(m.Rejected,'CREATED_IDENTITY_UNKNOWN_NO_RETRY'):m.qualify(fetch)
        self.assertEqual(seen,['list','create'])

    def test_unauthorized_post_is_not_retried(self):
        seen=[]
        def fetch(k):
            seen.append(k)
            if k=='create':raise m.Rejected('CREATE_FORBIDDEN_WRITE_SCOPE')
            return l([])
        with self.assertRaisesRegex(m.Rejected,'CREATE_FORBIDDEN_WRITE_SCOPE'):m.qualify(fetch)
        self.assertEqual(seen,['list','create'])

    def test_failed_readback_not_retried_or_promoted(self):
        seen=[]
        def fetch(k):
            seen.append(k)
            return l([]) if len(seen)==1 else {'success':True,'result':item()} if k=='create' else l([item(uuid='12345678-aaaa-4aaa-8aaa-333333333333')])
        with self.assertRaisesRegex(m.Rejected,'POST_CREATE_D1_LIST_DRIFT'):m.qualify(fetch)
        self.assertEqual(seen,['list','create','list'])

if __name__=='__main__':unittest.main()
