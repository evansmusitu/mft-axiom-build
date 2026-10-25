#!/usr/bin/env python3
"""Offline, deliberately conservative GitHub Actions trigger/risk inventory.

This is a source-only static risk inventory, NOT a GitHub workflow-run query,
a provider permission test, a billing estimate or evidence of any deployment.
No YAML dependencies, network access, tokens or provider writes required.
"""
from __future__ import annotations
import fnmatch
import json
from pathlib import Path
import re
import sys

SCHEMA = 'musitu.studio.v03.workflow-risk-inventory.v1'
BRANCH = 'experiments/studio-enterprise-v03-sqlite-do-20261018'
TRIGGER = re.compile(r'''^(?:on|["']on["']):\s*(.*)$''')
EVENT = re.compile(r'''^  ([a-z_]+):(?:\s*(.*))?$''')
KEY = re.compile(r'''^    ([a-z-]+):\s*(.*)$''')
PROVIDER_WRITE = re.compile(
    r'(?i)\b(?:wrangler\s+(?:deploy|delete|publish|secret\s+put)|'
    r'modal\s+(?:deploy|run)|neonctl\s+(?:delete|migrate|branches\s+create)|'
    r'kubectl\s+(?:apply|delete)|terraform\s+apply|'
    r'http(?:s)?\.request\([^\n]{0,200}(?:POST|PATCH|PUT|DELETE))')
PROVIDER_SECRET = re.compile(r'(?i)(?:secrets\.|CLOUDFLARE_API_TOKEN|CF_API_TOKEN|NEON_API_KEY|MODAL_TOKEN)')
AUTOMATIC = {'push','pull_request','pull_request_target','schedule','workflow_run',
             'repository_dispatch','issue_comment','release','create','delete',
             'deployment','deployment_status','check_run','check_suite',
             'status','merge_group','workflow_dispatch_auto'}


def _items(value: str) -> list[str]:
    """Parse only simple scalar/inline-list values; uncertain syntax stays risky."""
    value = value.split('#',1)[0].strip()
    if not value:
        return []
    if value.startswith('[') and value.endswith(']'):
        return [x.strip().strip('"\'') for x in value[1:-1].split(',') if x.strip()]
    if value.startswith('[') or '{' in value:
        return ['*']  # unqualified dynamic syntax never proves branch safety
    return [value.strip('"\'')]


def _trigger_data(source: str) -> tuple[set[str],dict[str,dict[str,list[str]]]]:
    lines=source.splitlines()
    start=next((i for i,line in enumerate(lines) if TRIGGER.match(line)),None)
    if start is None:return set(),{}
    raw=TRIGGER.match(lines[start]).group(1).strip()
    events:set[str]=set()
    settings:dict[str,dict[str,list[str]]]={}
    if raw and raw not in ('{}','null','~'):
        events.update(_items(raw))
    if raw and raw not in ('{}','null','~'):
        return events,settings
    current=None
    current_list=None
    for line in lines[start+1:]:
        if line and not line[0].isspace() and not line.lstrip().startswith('#'):
            break
        e=EVENT.match(line)
        if e:
            current=e.group(1)
            current_list=None
            events.add(current)
            settings[current]={}
            continue
        if not current:continue
        key=KEY.match(line)
        if key:
            current_list=key.group(1)
            settings[current][current_list]=_items(key.group(2))
            continue
        if current_list and re.match(r'^      -\s+',line):
            value=line.split('-',1)[1].strip().split('#',1)[0].strip().strip('"\'')
            settings[current][current_list].append(value)
    return events,settings


def _scope(branch: str,conf: dict[str,list[str]]) -> bool:
    positive=conf.get('branches')
    negative=conf.get('branches-ignore',[])
    if positive and not any(fnmatch.fnmatchcase(branch,p) for p in positive):return False
    if any(fnmatch.fnmatchcase(branch,p) for p in negative):return False
    return True


def _self_path(filename: str,conf:dict[str,list[str]]) -> bool:
    path=f'.github/workflows/{filename}'
    patterns=conf.get('paths')
    ignored=conf.get('paths-ignore',[])
    if patterns and not any(fnmatch.fnmatchcase(path,p) for p in patterns if not p.startswith('!')):
        return False
    if any(fnmatch.fnmatchcase(path,p) for p in ignored):return False
    return True


def inventory(workflow_directory:Path,*,branch:str=BRANCH)->dict:
    root=Path(workflow_directory)
    if root.is_symlink() or not root.is_dir() or not branch or any(ord(c)<32 for c in branch):
        raise ValueError('STUDIO_CI_AUDIT_INPUT_INVALID')
    reports=[]
    for file in sorted(root.glob('*.yml'))+sorted(root.glob('*.yaml')):
        if file.is_symlink() or not file.is_file():
            raise ValueError('STUDIO_CI_AUDIT_SYMLINK_UNTRUSTED')
        if file.stat().st_size>1_000_000:
            raise ValueError('STUDIO_CI_AUDIT_FILE_OVERSIZED')
        text=file.read_text(encoding='utf-8')
        events,settings=_trigger_data(text)
        unknown=(not events or '*' in events or any(e not in AUTOMATIC
             and e not in {'workflow_dispatch','workflow_call','page_build','fork'}
             for e in events))
        branch_push='push' in events and _scope(branch,settings.get('push',{}))
        self_push=branch_push and _self_path(file.name,settings.get('push',{}))
        other_auto=bool((events-{'push'}) & AUTOMATIC)
        calls_other='workflow_call' in events
        automated=branch_push or other_auto
        secrets=bool(PROVIDER_SECRET.search(text))
        mutation=bool(PROVIDER_WRITE.search(text))
        if unknown:risk='TRIGGER_UNKNOWN_REVIEW_REQUIRED'
        elif automated and mutation:risk='AUTOMATIC_PROVIDER_MUTATION_POSSIBLE'
        elif automated and secrets:risk='AUTOMATIC_PROVIDER_ACCESS_POSSIBLE'
        elif automated:risk='AUTOMATIC_RUNNER_MINUTES_POSSIBLE'
        elif calls_other:risk='INDIRECT_WORKFLOW_CALL_REVIEW_REQUIRED'
        else:risk='MANUAL_OR_OTHER_TRIGGER_ONLY'
        reports.append({'workflow':file.name,'event_names':sorted(events),
                        'branch_push_possible':branch_push,'self_edit_push_possible':self_push,
                        'other_automatic_event_possible':other_auto,
                        'provider_secrets_referenced':secrets,
                        'provider_write_command_present':mutation,'risk':risk})
    counts={'workflows':len(reports),'branch_push_possible':sum(x['branch_push_possible'] for x in reports),
            'self_edit_push_possible':sum(x['self_edit_push_possible'] for x in reports),
            'provider_mutation_risk':sum(x['risk']=='AUTOMATIC_PROVIDER_MUTATION_POSSIBLE' for x in reports),
            'automatic_provider_access_risk':sum(x['risk']=='AUTOMATIC_PROVIDER_ACCESS_POSSIBLE' for x in reports)}
    return {'schema':SCHEMA,'branch':branch,'source_only':True,
            'workflows_executed_observed':False,'provider_writes_observed':False,
            'billing_verified':False,'production_cutover_authorized':False,
            'limitations':'Conservative static scan: not YAML/Actions evaluator; exact path/if filters, job permissions, external reusable workflows, runner billing and provider identity not verified.',
            'counts':counts,'workflows':reports}


if __name__=='__main__':
    if len(sys.argv)!=2:raise SystemExit('Usage: python ops/studio_v03_workflow_risk_inventory.py REPO_ROOT')
    doc=inventory(Path(sys.argv[1])/'.github/workflows')
    print(json.dumps(doc,sort_keys=True,indent=2))
