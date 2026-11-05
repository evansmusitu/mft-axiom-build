"""Independent final-source validation; no repository writes or hosted access."""
import hashlib
import json
import pathlib
import subprocess
import sys

root = pathlib.Path('/workspace/scratch/cf664c251767/axiom-source')
sys.path.insert(0, str(root / 'customer_frontier/tests'))
from test_oauth_identity_upgrade import migration as m, fixture, link, snapshot

manifest = json.loads((root / 'auth/oauth_identity_v1_trigger_manifest.json').read_text())
raw = subprocess.check_output(['git', 'show', manifest['source_commit'] + ':' + manifest['source_path']], cwd=root)
assert hashlib.sha256(raw).hexdigest() == manifest['source_sha256']
expected = [s for s in m.statements(raw.decode()) if s.startswith('CREATE TRIGGER')]
assert expected == manifest['triggers']
print('PINNED_PR66_MANIFEST_EXACT_MATCH', len(expected), 'triggers')
print('FINAL_MIGRATION_SHA256', hashlib.sha256((root / 'auth/oauth_identity_upgrade_v2.py').read_bytes()).hexdigest())
print('FINAL_PLAN_SHA256', m.build_plan()['plan_sha256'])


def unknown(d):
    d.execute('DROP TRIGGER oauth_token_link_requires_active_identity')
    d.execute("CREATE TRIGGER oauth_token_link_requires_active_identity BEFORE INSERT ON oauth_identity_token_links BEGIN SELECT RAISE(ABORT,'external_policy_hold'); END")


def dirty(d):
    d.execute('PRAGMA ignore_check_constraints=ON')
    d.execute("UPDATE oauth_identity_links SET state='invalid-state',revoked_at='corrupt'")
    d.execute('PRAGMA ignore_check_constraints=OFF')


def literal(d):
    for table in ['oauth_identity_code_links', 'oauth_identity_token_links', 'oauth_identity_links']:
        d.execute('DROP TABLE ' + table)
    sql = next(s for s in m.statements((root / 'auth/keyless_customer_link_candidate.sql').read_text()) if s.startswith('CREATE TABLE'))
    d.execute(sql.replace("'active'", "'ACTIVE'"))


def checks_off(d):
    link(d, parent='key-b')
    d.execute('PRAGMA ignore_check_constraints=ON')


for name, change in [('unknown-trigger', unknown), ('invalid-state', dirty), ('literal-drift', literal), ('checks-off', checks_off)]:
    d = fixture()
    change(d)
    before = snapshot(d)
    try:
        m.upgrade(d)
    except Exception as error:
        assert snapshot(d) == before, name
        print('FINAL_REPRO_DENIED_UNCHANGED', name, type(error).__name__)
    else:
        raise AssertionError(name + ' accepted')
    d.close()
