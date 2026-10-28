"""Offline tests: classify branch-scoped GitHub Actions risk without any provider calls."""
import pathlib
import sys
import tempfile
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'ops'))
from studio_v03_workflow_risk_inventory import inventory
BRANCH='experiments/studio-enterprise-v03-sqlite-do-20261018'

QUARANTINED_PROVIDER_WORKFLOWS = {
    'studio-v03-audit-atomicity-release-20261019.yml',
    'studio-v03-cron-pitr-disposable-20261020.yml',
    'studio-v03-dispatch-audit-integrity-release-20261019.yml',
    'studio-v03-do-access-app-20261018.yml',
    'studio-v03-do-access-preflight-20261018.yml',
    'studio-v03-do-audience-20261018.yml',
    'studio-v03-do-final-readback-20261018.yml',
    'studio-v03-do-isolated-restore-20261018.yml',
    'studio-v03-do-private-deploy-20261018.yml',
    'studio-v03-do-protected-domain-20261018.yml',
    'studio-v03-do-quota-rollout-20261018.yml',
    'studio-v03-do-ray-cause-20261018.yml',
    'studio-v03-do-recovery-readiness-release-20261018.yml',
    'studio-v03-do-securitylevel-only-20261018.yml',
    'studio-v03-live-staff-activity-readonly-20261018.yml',
    'studio-v03-modal-spend-readonly-20261018.yml',
    'studio-v03-owner-fingerprint-guarded-activation.yml',
    'studio-v03-pitr-cloud-preflight-20261018.yml',
    'studio-v03-pitr-evidence-channel-readonly-20261021.yml',
    'studio-v03-pitr-private-progress-readonly-20261021.yml',
    'studio-v03-pitr-v2-exact-cleanup-20261021.yml',
    'studio-v03-private-kv-pitr-disposable-20261021.yml',
    'studio-v03-private-kv-pitr-v2-disposable-20261021.yml',
    'studio-v03-render-terminal-integrity-release-20261019.yml',
    'studio-v03-tail-capability-readonly-20261020.yml',
    'studio-v03-workersdev-access-readonly-20261018.yml',
}

class WorkflowInventoryTests(unittest.TestCase):
    def test_self_edit_deployment_trigger_is_reported_without_exposing_secrets(self):
        with tempfile.TemporaryDirectory() as temp:
            root=pathlib.Path(temp)
            file=root/'risk.yml'
            file.write_text('''name: risky-on-edit
on:
  push:
    branches: [experiments/studio-enterprise-v03-sqlite-do-20261018]
    paths: [.github/workflows/risk.yml]
permissions: {contents: read}
jobs:
  rollout:
    steps:
      - run: npx wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
''')
            report=inventory(root,branch=BRANCH)
            item=report['workflows'][0]
            self.assertTrue(item['branch_push_possible'])
            self.assertTrue(item['self_edit_push_possible'])
            self.assertTrue(item['provider_secrets_referenced'])
            self.assertTrue(item['provider_write_command_present'])
            self.assertEqual(item['risk'],'AUTOMATIC_PROVIDER_MUTATION_POSSIBLE')
            self.assertNotIn('${{',str(report))
            self.assertNotIn('CLOUDFLARE_API_TOKEN',str(report))

    def test_dispatch_only_and_unrelated_branch_never_count_as_isolated_push(self):
        with tempfile.TemporaryDirectory() as temp:
            root=pathlib.Path(temp)
            (root/'manual.yml').write_text('''on:
  workflow_dispatch: {}
jobs:
  a:
    steps:
      - run: npx wrangler deploy
''')
            (root/'other.yml').write_text('''on:
  push:
    branches: [main]
    paths: [.github/workflows/other.yml]
jobs: {}
''')
            report=inventory(root,branch=BRANCH)
            by={v['workflow']:v for v in report['workflows']}
            self.assertFalse(by['manual.yml']['branch_push_possible'])
            self.assertFalse(by['other.yml']['branch_push_possible'])
            self.assertEqual(report['counts']['branch_push_possible'],0)

    def test_safe_push_tests_report_hosted_minutes_but_not_provider_mutation(self):
        with tempfile.TemporaryDirectory() as temp:
            root=pathlib.Path(temp)
            (root/'offline.yml').write_text('''on: [push, workflow_dispatch]
permissions: {contents: read}
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - run: node --test tests/*.test.mjs
''')
            item=inventory(root,branch=BRANCH)['workflows'][0]
            self.assertEqual(item['risk'],'AUTOMATIC_RUNNER_MINUTES_POSSIBLE')
            self.assertTrue(item['branch_push_possible'])
            self.assertFalse(item['provider_write_command_present'])

    def test_invalid_unreadable_trigger_is_treated_as_unqualified_not_safe(self):
        with tempfile.TemporaryDirectory() as temp:
            root=pathlib.Path(temp)
            (root/'unknown.yml').write_text('''name: no-trigger
jobs:
  x: {}
''')
            item=inventory(root,branch=BRANCH)['workflows'][0]
            self.assertEqual(item['risk'],'TRIGGER_UNKNOWN_REVIEW_REQUIRED')

    def test_unsupported_inline_mapping_trigger_is_never_classified_as_manual_safe(self):
        with tempfile.TemporaryDirectory() as temp:
            root=pathlib.Path(temp)
            (root/'mapping.yml').write_text('''on: {push: {branches: [experiments/studio-enterprise-v03-sqlite-do-20261018]}}
jobs: {}
''')
            self.assertEqual(inventory(root,branch=BRANCH)['workflows'][0]['risk'],
                             'TRIGGER_UNKNOWN_REVIEW_REQUIRED')

    def test_repository_wide_provider_risks_remain_visible_outside_v03(self):
        # Never erase an unrelated real risk just to make the Studio CI green.
        # Prove Studio's gate is scoped while overall risk is still reported.
        with tempfile.TemporaryDirectory() as temp:
            root=pathlib.Path(temp)
            (root/'studio-v03-provider-manual.yml').write_text('''on:
  workflow_dispatch: {}
jobs:
  release:
    steps:
      - run: npx wrangler deploy
''')
            (root/'other-project-auto.yml').write_text('''on:
  push:
    branches: [experiments/studio-enterprise-v03-sqlite-do-20261018]
jobs:
  release:
    steps:
      - run: npx wrangler deploy
''')
            report=inventory(root,branch=BRANCH)
            self.assertEqual(report['counts']['provider_mutation_risk'],1)
            by={row['workflow']:row for row in report['workflows']}
            self.assertEqual(by['other-project-auto.yml']['risk'],
                             'AUTOMATIC_PROVIDER_MUTATION_POSSIBLE')
            self.assertEqual(by['studio-v03-provider-manual.yml']['risk'],
                             'MANUAL_OR_OTHER_TRIGGER_ONLY')

    def test_real_repository_inventory_is_read_only_and_reports_historic_self_deploy_risk(self):
        report=inventory(ROOT/'.github/workflows',branch=BRANCH)
        by={x['workflow']:x for x in report['workflows']}
        self.assertGreaterEqual(report['counts']['workflows'],80)
        self.assertFalse(by['studio-v03-do-private-deploy-20261018.yml']['self_edit_push_possible'])
        self.assertTrue(by['studio-v03-do-private-deploy-20261018.yml']['provider_write_command_present'])
        # This Studio branch shares its GitHub repository with older Studio V0.2
        # and unrelated Axiom workflows. Full-repo risk totals must remain
        # visible in the inventory, but they are not V0.3 qualification totals.
        # A CI checkout can contain 255+ workflows; a portable handoff contains
        # only the ~83 approved Studio source workflows.
        v03=[row for row in report['workflows'] if row['workflow'].startswith('studio-v03-')]
        self.assertGreaterEqual(len(v03),40)
        self.assertEqual([row['workflow'] for row in v03
                          if row['risk']=='AUTOMATIC_PROVIDER_MUTATION_POSSIBLE'],[])
        self.assertEqual([row['workflow'] for row in v03
                          if row['risk']=='AUTOMATIC_PROVIDER_ACCESS_POSSIBLE'],[])
        self.assertEqual(sum(row['branch_push_possible'] for row in v03),7)
        self.assertEqual(len(QUARANTINED_PROVIDER_WORKFLOWS),26)
        for name in QUARANTINED_PROVIDER_WORKFLOWS:
            row=by[name]
            self.assertFalse(row['branch_push_possible'],name)
            self.assertIn('workflow_dispatch',row['event_names'],name)
        self.assertEqual(by['studio-v03-offline-security-qualification-20261024.yml']['risk'],
                         'AUTOMATIC_RUNNER_MINUTES_POSSIBLE')
        self.assertFalse(by['studio-complete-new-chat-handoff-20261020.yml']['branch_push_possible'])
        self.assertTrue(by['studio-complete-new-chat-handoff-20261020.yml']['provider_secrets_referenced'])

if __name__=='__main__':unittest.main()
