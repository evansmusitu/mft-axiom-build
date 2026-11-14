import importlib.util
import io
import json
import os
import pathlib
import sys
import unittest
from unittest import mock

SRC = pathlib.Path("qualification/mcn072_pg_binding_probe_readonly.py") if pathlib.Path("qualification/mcn072_pg_binding_probe_readonly.py").exists() else pathlib.Path("/mnt/data/mcn072_live_authority_audit/worker_bindings_probe.py")
# When in the GitHub checkout, use the repo-local qualification probe.
if not SRC.exists(): SRC = pathlib.Path('qualification/mcn072_pg_binding_probe_readonly.py')
spec=importlib.util.spec_from_file_location('mcn072_binding_probe', SRC)
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)


class TestSafeSanitizer(unittest.TestCase):
    def test_does_not_serialize_plaintext_or_secret_content(self):
        raw=[{'name':'DATABASE_URL','type':'secret_text','text':'postgresql://password:secret@private'},
             {'name':'PG_HOST','type':'plain_text','text':'internal.endpoint'}]
        out=p.binding_summary(raw)
        s=json.dumps(out)
        for fragment in ['password','secret@','private','internal.endpoint','DATABASE_URL','PG_HOST']:
            self.assertNotIn(fragment,s)
        self.assertEqual(len(out),2)
        self.assertTrue(all(x['database_name_cue'] for x in out))
    def test_reject_duplicate_names(self):
        with self.assertRaises(p.old.ProbeFailure):
            p.binding_summary([{'name':'X','type':'secret_text'},{'name':'X','type':'plain_text'}])
    def test_reject_bad_binding(self):
        with self.assertRaises(p.old.ProbeFailure):p.binding_summary([{'name':'X'}])
    def test_limit_entries(self):
        with self.assertRaises(p.old.ProbeFailure):p.binding_summary([{'type':'secret_text','name':f'B{i}'} for i in range(129)])
    def test_qualified_never_set_in_blocked_output(self):
        cwd=os.getcwd()
        with mock.patch.dict(os.environ, {'CLOUDFLARE_API_TOKEN':''}), mock.patch.object(p,'OUT',pathlib.Path('/tmp/mcn072-synthetic-test-output.json')):
            try:
                rc=p.main()
                blob=json.loads(p.OUT.read_text())
                self.assertEqual(rc,2)
                self.assertFalse(blob['postgres_scheduler_authenticated'])
                self.assertFalse(blob['mcn072_qualified'])
                self.assertFalse(blob['secret_values_exported'])
            finally:
                p.OUT.unlink(missing_ok=True);p.OUT.with_suffix('.json.sha256').unlink(missing_ok=True)

if __name__=='__main__': unittest.main()
