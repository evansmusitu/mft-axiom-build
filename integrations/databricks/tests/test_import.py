import base64
import unittest

from databricks_import import make_import_payload, validate_username, run_import


class PayloadTests(unittest.TestCase):
    def test_nonoverwriting_source_notebook(self):
        source = b'# Databricks notebook source\nprint(123)\n'
        out = make_import_payload('/Users/test@example.com/MUSITU_AXIOM_PRIVATE_PILOT_20261027/01_musitu_axiom_selfcontained', source)
        self.assertEqual(out['format'], 'SOURCE')
        self.assertEqual(out['language'], 'PYTHON')
        self.assertIs(out['overwrite'], False)
        self.assertEqual(base64.b64decode(out['content']), source)

    def test_reject_path_injection_and_bad_identity(self):
        for username in ('../../Shared', '/Users/foo', 'person@x.com/dir', 'person@x.com\\bad', '', '.env'):
            with self.subTest(username=username):
                with self.assertRaises(ValueError):
                    validate_username(username)

    def test_reject_tampered_notebook_header(self):
        with self.assertRaises(ValueError):
            make_import_payload('/Users/test@example.com/MUSITU_AXIOM_PRIVATE_PILOT_20261027/book', b'print(123)')

    def test_existing_notebook_fails_closed_and_does_not_import(self):
        events=[]
        def api(method,path,payload=None,params=None):
            events.append((method,path))
            if path.endswith('/Me'):
                return {'userName':'tester@example.com'}
            if path.endswith('/get-status'):
                return {'object_type':'NOTEBOOK','object_id':123}
            raise AssertionError('Unexpected API call')
        with self.assertRaisesRegex(RuntimeError, 'already exists'):
            run_import(api, b'# Databricks notebook source\npass\n')
        self.assertFalse(any(x[0]=='POST' for x in events))

    def test_success_stays_within_approved_endpoint_allowlist(self):
        events=[]
        def api(method,path,payload=None,params=None):
            events.append((method,path,payload,params))
            if path.endswith('/Me'):
                return {'userName':'tester@example.com'}
            if path.endswith('/get-status'):
                if len([e for e in events if e[1].endswith('/get-status')])==1:
                    return None
                return {'object_type':'NOTEBOOK','language':'PYTHON','object_id':301}
            if path.endswith('/mkdirs') or path.endswith('/import'):
                return {}
            raise AssertionError(f'Unexpected API call {path}')
        result=run_import(api, b'# Databricks notebook source\npass\n')
        self.assertEqual(result['object_id'],301)
        self.assertEqual(result['status'],'IMPORTED_AND_VERIFIED')
        self.assertEqual([e[1] for e in events],[
            '/api/2.0/preview/scim/v2/Me',
            '/api/2.0/workspace/get-status',
            '/api/2.0/workspace/mkdirs',
            '/api/2.0/workspace/import',
            '/api/2.0/workspace/get-status',
        ])
        self.assertFalse(events[3][2]['overwrite'])


if __name__=='__main__':
    unittest.main()
