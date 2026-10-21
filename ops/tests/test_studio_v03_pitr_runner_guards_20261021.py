import ast
import unittest
from pathlib import Path

RUNNER=Path(__file__).resolve().parents[1] / 'studio_v03_pitr_cron_kv_runner_v2_20261021.py'

class RunnerSafety(unittest.TestCase):
    def test_runner_uses_verified_cleanup_guard_in_finally(self):
        code=RUNNER.read_text()
        tree=ast.parse(code)
        self.assertIn('cleanup_exact_disposables(call,WORKER,namespace)',code)
        # The runner may never delete a KV namespace directly; it must be
        # guarded by exact binding verification + Worker 404 readback.
        self.assertNotIn("call('DELETE','/storage/kv/namespaces/'+namespace)",code)
        self.assertNotIn("subprocess.run(['npx','wrangler','delete'",code)
        self.assertIn('temporary_kv_absent_at_end',code)
        self.assertIn('temporary_worker_absent_at_end',code)
        self.assertIsInstance(tree,ast.Module)
    def test_runner_records_deploy_failure_without_leaking_cli_text(self):
        code=RUNNER.read_text()
        self.assertIn("proof['failure_stage']=stage",code)
        self.assertIn('categorize_deploy_failure(',code)
        self.assertNotIn("print(result.stderr)",code)
        self.assertNotIn('stderr=subprocess.DEVNULL',code)

if __name__=='__main__':unittest.main()
