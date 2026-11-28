"""Audit workflow credential boundaries without reading any credential values."""
import json
import pathlib
import re

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[2]


def audit(root=ROOT):
    errors = []
    files = sorted((root / '.github/workflows').glob('*.y*ml'))
    for path in files:
        workflow = yaml.safe_load(path.read_text())
        events = workflow.get('on', workflow.get(True, {}))
        if any(event in events for event in ('pull_request_target', 'workflow_run')):
            errors.append(f'{path.name}: privileged cross-workflow trigger requires explicit review')
        if workflow.get('permissions') in (None, 'write-all'):
            errors.append(f'{path.name}: explicit scoped token permissions required')
        if 'concurrency' not in workflow:
            errors.append(f'{path.name}: concurrency control missing')
        for job_name, job in workflow.get('jobs', {}).items():
            credentialed = 'secrets.' in yaml.safe_dump(job) or 'secrets.' in str(workflow.get('env', {}))
            if credentialed:
                guard = job.get('if', '')
                expected = ("github.ref == 'refs/heads/main'", 'github.ref_protected == true',
                            "github.repository_id == '1356837528'", "github.actor_id == '285482095'",
                            "github.event_name == 'workflow_dispatch'")
                if not all(part in guard for part in expected):
                    errors.append(f'{path.name}/{job_name}: protected-main credential guard missing')
                if path.name != 'musitu-corporate-bing-readonly.yml' and 'pull_request' in events:
                    errors.append(f'{path.name}: credentialed pull-request workflow')
            for step in job.get('steps', []):
                action = step.get('uses', '')
                if action and not action.startswith('./'):
                    if not re.fullmatch(r'(actions|aws-actions)/[A-Za-z0-9_-]+@[0-9a-f]{40}', action):
                        errors.append(f'{path.name}: unpinned or unreviewed action')
                if action.startswith('actions/checkout@') and step.get('with', {}).get('persist-credentials') is not False:
                    errors.append(f'{path.name}: checkout retains credentials')
                if action.startswith('actions/upload-artifact@'):
                    config = step.get('with', {})
                    paths = str(config.get('path', '')).splitlines()
                    if not paths or any(p.strip() in ('.', './', '**', '**/*') for p in paths):
                        errors.append(f'{path.name}: artifact root upload')
                    approved_handoff = (path.name == 'musitu-whole-product-continuation-export.yml' and
                                        config.get('path') == '${{ runner.temp }}/musitu-clean-whole-product-20261027/')
                    if config.get('include-hidden-files') is True and not approved_handoff:
                        errors.append(f'{path.name}: hidden artifact upload')
    return {'workflow_count': len(files), 'errors': errors, 'passed': not errors}


if __name__ == '__main__':
    result = audit()
    print(json.dumps(result, sort_keys=True))
    raise SystemExit(0 if result['passed'] else 1)
