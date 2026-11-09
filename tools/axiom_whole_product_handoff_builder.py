#!/usr/bin/env python3
"""Reproducible PUBLIC GitHub MUSITU AXIOM continuation export; no infra writes.

Requires a full Git clone of the canonical repository and the read-only GitHub
Actions token for public repository metadata. No secrets or private customer data
are collected or written. Git refs are frozen to an observed SHA, not assumed live.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

REPO = 'evansmusitu/mft-axiom-build'
ROOTS = ('HANDOFF', 'PRODUCT', 'SOURCE_HISTORY')
PRIOR_SHA256 = '1ae62ab9ec3774e1818d875281e1b1e8922b69b882bf577ed6a2eb75fa8c93bf'
PRIOR_URL = 'https://drive.google.com/file/d/1Qax5FWj9-3CGqN5dTbPdnMdXpYldP2Fh/view'
PRIOR_BUNDLE_SHA256 = '1ad9e1049966038e6af75deefde34fe586d30262a258c8dc236c8e73fe74c1d0'


def run(*cmd, cwd=None, check=True):
    p = subprocess.run(cmd, cwd=cwd, text=True, stdout=subprocess.PIPE,
                       stderr=subprocess.PIPE, check=False)
    if check and p.returncode:
        raise RuntimeError('Command failed (' + str(p.returncode) + '): ' + ' '.join(str(x) for x in cmd) + '\n' + p.stderr[-5000:])
    return p.stdout.strip()


def sha256(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for part in iter(lambda:f.read(1024*1024),b''):
            h.update(part)
    return h.hexdigest()


def dump(path,obj):
    path.write_text(json.dumps(obj,indent=2,sort_keys=True,ensure_ascii=False)+'\n',encoding='utf-8')


def api(path,token):
    req=urllib.request.Request('https://api.github.com'+path,headers={
        'Accept':'application/vnd.github+json',
        'Authorization':'Bearer '+token,
        'X-GitHub-Api-Version':'2022-11-28',
        'User-Agent':'AXIOM-public-only-handoff-readonly',
    })
    try:
        with urllib.request.urlopen(req,timeout=45) as response:
            return json.loads(response.read(12*1024*1024))
    except urllib.error.HTTPError as ex:
        raise RuntimeError(f'GitHub metadata read failed, HTTP {ex.code}, endpoint {path[:130]}') from None


def all_pages(path,token,max_pages=20):
    collected=[]
    sep='&' if '?' in path else '?'
    for p in range(1,max_pages+1):
        records=api(f'{path}{sep}per_page=100&page={p}',token)
        if not isinstance(records,list):raise ValueError('Expected array response from GitHub')
        collected.extend(records)
        if len(records)<100:return collected
    raise ValueError('GitHub pages unexpectedly exceeded safety limit')


def require_sha(value):
    if not isinstance(value,str) or len(value)!=40 or any(c not in '0123456789abcdef' for c in value):
        raise ValueError('Invalid Git object SHA')
    return value


def ensure_git_commit(repo,sha):
    sha=require_sha(sha)
    if run('git','cat-file','-t',sha,cwd=repo,check=False)!='commit':
        # A PR may advance after the branch enumeration; ask GitHub for that
        # exact immutable public SHA, never fabricate history from PR metadata.
        run('git','fetch','--no-tags','origin',sha,cwd=repo)
    if run('git','cat-file','-t',sha,cwd=repo)!='commit':
        raise ValueError(f'Missing commit object {sha}')
    return sha


def safe_git_archive(repo,sha,dest):
    """Use git archive + tar with path traversal refusal; tracked sources only."""
    import tarfile
    import io
    payload=subprocess.run(['git','archive','--format=tar',sha],cwd=repo,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True).stdout
    total=0
    with tarfile.open(fileobj=io.BytesIO(payload),mode='r:') as tar:
        for item in tar:
            if not item.isfile() and not item.isdir():
                raise ValueError('Refusing non-file Git export item: '+item.name)
            target=dest/item.name
            target_resolved=target.resolve()
            if not target_resolved.is_relative_to(dest.resolve()):
                raise ValueError('Unsafe Git archive name')
            if item.isfile():
                total+=1
                target.parent.mkdir(parents=True,exist_ok=True)
                with tar.extractfile(item) as reader, open(target,'wb') as writer:
                    shutil.copyfileobj(reader,writer)
            else:target.mkdir(parents=True,exist_ok=True)
    return total


def build(args):
    if not args.offline and not os.environ.get('GITHUB_TOKEN'):
        raise RuntimeError('Need read-only GitHub token to snapshot latest PRs')
    repo=Path(args.repo).resolve()
    out=Path(args.output).resolve()
    if out.exists():raise FileExistsError('Won\'t overwrite existing handoff: '+str(out))
    out.mkdir(parents=True)
    for root in ROOTS:(out/root).mkdir()
    handoff=out/'HANDOFF'
    now=dt.datetime.now(dt.timezone.utc).isoformat()
    token=os.environ.get('GITHUB_TOKEN','')
    if args.offline:
        inventory=json.loads(Path(args.offline_inventory).read_text())
        prs=inventory['prs'];main_sha=inventory['main_sha']
        issues=inventory.get('issues',{})
        observed_runs=inventory.get('workflow_runs',[])
    else:
        live_main=api('/repos/'+REPO+'/commits/main',token)
        main_sha=require_sha(live_main['sha'])
        raw_prs=all_pages('/repos/'+REPO+'/pulls?state=open',token)
        prs=[{
            'number':p['number'],'title':p['title'],'state':p['state'],
            'draft':p['draft'],'head_sha':require_sha(p['head']['sha']),
            'head_branch':p['head']['ref'],'base_sha':require_sha(p['base']['sha']),
            'base_branch':p['base']['ref'],'created_at':p['created_at'],
            'updated_at':p['updated_at'],'html_url':p['html_url'],
        } for p in raw_prs]
        issues={str(n):{k:v for k,v in api('/repos/'+REPO+'/issues/'+str(n),token).items()
                         if k in ('number','title','state','html_url','updated_at','body')}
                for n in (74,75)}
        # Pin actual exact-head evidence on highest-priority PRs. One per-ref
        # query, no claims about omitted runs or invisible external checks.
        inspect={13,63,76,81,87,99,104,149,157,162,164,175,176,180,181,
                 182,183,184,185,190,192,194,195,196,197,198,199,200,201,202}
        observed_runs=[]
        for p in prs:
            if p['number'] not in inspect:continue
            url='/repos/'+REPO+'/actions/runs?head_sha='+p['head_sha']+'&per_page=50'
            rec=api(url,token)
            observed_runs.append({'pr_number':p['number'],'head_sha':p['head_sha'],
                 'runs':[{'id':x['id'],'name':x['name'],'event':x['event'],
                          'status':x['status'],'conclusion':x['conclusion'],
                          'url':x['html_url'],'created_at':x['created_at']}
                         for x in rec.get('workflow_runs',[])]})
    if not prs:raise ValueError('Refusing empty live pull request inventory')
    if len({p['number'] for p in prs})!=len(prs):raise ValueError('Duplicate PR number')
    if any(p['state']!='open' for p in prs):raise ValueError('Non-open PR in open set')
    # Freeze source by actual content-addressed ref rather than changing names.
    ensure_git_commit(repo,main_sha)
    run('git','update-ref','refs/handoff/frozen-main',main_sha,cwd=repo)
    for p in prs:
        ensure_git_commit(repo,p['head_sha'])
        run('git','update-ref','refs/handoff/pr/'+str(p['number']),p['head_sha'],cwd=repo)
    prs.sort(key=lambda p:p['number'])
    dump(handoff/'OPEN_PULL_REQUESTS.json',prs)
    dump(handoff/'PR_WORKFLOW_RUNS.json',observed_runs)
    dump(handoff/'RELEASE_GATE_ISSUES.json',issues)
    snapshot_targets=[('main',main_sha)]
    for n in [76,81,87,99,104,149,164,185,192,195,197,198,199,200,201,202]:
        p=next((x for x in prs if x['number']==n),None)
        if p:snapshot_targets.append((f'draft-{n}',p['head_sha']))
    snapshot_manifest=[]
    for label,sha in snapshot_targets:
        place=out/'PRODUCT'/label
        place.mkdir()
        count=safe_git_archive(repo,sha,place)
        snapshot_manifest.append({'label':label,'sha':sha,'files':count})
    dump(handoff/'SNAPSHOT_MANIFEST.json',snapshot_manifest)
    # All currently fetched PUBLIC GitHub branches/tags/PR heads, not private
    # GitLab-only metadata or external production backups. Stored as Git bundle.
    bundle=out/'SOURCE_HISTORY'/'public-github-all-refs.bundle'
    run('git','bundle','create',str(bundle),'--all',cwd=repo)
    if run('git','bundle','verify',str(bundle),cwd=repo,check=False)=='':
        # git bundle verify logs some information to stderr; use return code.
        pass
    sub=subprocess.run(['git','bundle','verify',str(bundle)],cwd=repo,
                       stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    if sub.returncode:raise RuntimeError('Git bundle verification failed: '+sub.stderr[-1200:])
    fsck=subprocess.run(['git','fsck','--full','--no-reflogs'],cwd=repo,
                        stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    if fsck.returncode:raise RuntimeError('Git fsck failed: '+fsck.stderr[-1200:])
    refs=run('git','for-each-ref','--format=%(refname)%09%(objectname)',cwd=repo)
    (out/'SOURCE_HISTORY'/'REFS.tsv').write_text(refs+'\n',encoding='utf-8')
    (out/'SOURCE_HISTORY'/'VERIFY.txt').write_text(
        f'git bundle verify: PASS\ngit fsck --full --no-reflogs: PASS\n'
        f'git bundle SHA-256: {sha256(bundle)}\n'
        f'Frozen main commit: {main_sha}\n'
        f'Git refs in archive: {len(refs.splitlines())}\n'
        f'Git commits in archive: {run("git","rev-list","--all","--count",cwd=repo)}\n',encoding='utf-8')
    freeze={
        'schema':'MUSITU_AXIOM_WHOLE_PRODUCT_HANDOFF_20261110_V2',
        'timestamp_utc':now,'repository':REPO,'frozen_main_sha':main_sha,
        'pr_count':len(prs),'draft_open_pr_count':sum(1 for p in prs if p['draft']),
        'ready_open_pr_count':sum(1 for p in prs if not p['draft']),
        'last_pr_number':max(p['number'] for p in prs),
        'snapshot_count':len(snapshot_manifest),
        'full_git_history':'SOURCE_HISTORY/public-github-all-refs.bundle',
        'git_bundle_sha256':sha256(bundle),'prior_verified_zip_url':PRIOR_URL,
        'prior_verified_zip_sha256':PRIOR_SHA256,
        'prior_verified_public_bundle_sha256':PRIOR_BUNDLE_SHA256,
        'production_release':'NO-GO',
        'all_six_independent_gates':'BLOCKED pending real independent acceptance',
        'private_gitlab_archive':'SEPARATE / NOT INCLUDED / DO NOT PUBLICIZE',
        'private_customer_or_owner_backups':'SEPARATE / NOT INCLUDED',
        'no_guaranteed_trading_profits':True,
        'no_infra_writes_from_this_packaging_job':True,
        'snapshot_limitation':'Open PRs/refs are a frozen observed point in time; always re-read live GitHub before changes',
    }
    dump(handoff/'CONTINUATION_STATE.json',freeze)
    (handoff/'README_FIRST.md').write_text(f'''# MUSITU AXIOM — whole-product continuation (2026-11-10)

**Canonical**: live GitHub https://github.com/{REPO}. Frozen snapshot main: `{main_sha}`.
This package is self-contained for **public GitHub** code: complete Git bundle of all fetched branches/tags/PR heads + exact source snapshots, active PR inventory, exact-head CI evidence, release issue records, and the continuation command. Inspect the package **before making changes**. All branch/ref states can change after freeze.

Read IN ORDER:
1. `HANDOFF/README_FIRST.md`
2. `HANDOFF/CONTINUATION_STATE.md`
3. `HANDOFF/CONTINUATION_STATE.json`
4. `HANDOFF/VERIFICATION_MATRIX.md`
5. `HANDOFF/OPEN_PULL_REQUESTS.json`
6. `HANDOFF/PR_WORKFLOW_RUNS.json`
7. `HANDOFF/RELEASE_GATE_ISSUES.json`
8. `HANDOFF/SNAPSHOT_MANIFEST.json`
9. `HANDOFF/SOURCE_MANIFEST.md`
10. `HANDOFF/NEW_CHAT_COMMAND.txt`
11. `HANDOFF/SHA256SUMS.txt`

Verify ZIP integrity, all file SHA256 hashes, Git bundle verification, frozen main SHA, and snapshot Git commit IDs. Always recheck **live** GitHub PR base/head and exact SHA CI before coding. Never merge, squash, force-push or deploy as part of handoff.

No GitLab-private issues/MRs/CI discussion, tokens, customer snapshots, OAuth/D1 private backups, owner secrets, or private security evidence are in this public-only ZIP. Private historical GitLab archive is separate, release gate G6 unresolved. No guarantee of profitable trading signals.
''',encoding='utf-8')
    (handoff/'CONTINUATION_STATE.md').write_text(f'''# Frozen continuation checkpoint

- Snapshot UTC: `{now}`.
- Live canonical repo: https://github.com/{REPO} (do not mistake PR branches for main).
- **Frozen main:** `{main_sha}`; Git HEAD MUST be rechecked before any change.
- Open PR inventory in `OPEN_PULL_REQUESTS.json`: **{len(prs)}** open, **{sum(x['draft'] for x in prs)}** draft, **{sum(not x['draft'] for x in prs)}** not draft (not authorization to merge).
- Bundle of **all fetched public Git refs**, tags, and PR heads: `SOURCE_HISTORY/public-github-all-refs.bundle`. Pinned full source snapshots for critical code areas: `PRODUCT/`.
- Specific read-only recorded workflow observations appear in `PR_WORKFLOW_RUNS.json`; these are not blanket assertions of CI correctness for all PRs and not external production acceptance.
- Priority metering chain: #76 → #81 → #104 → #180 → #182 → #183 → #184 → #185. **Draft and NO-GO.** #99 remains separate Hyperdrive offline preflight. Cross-worker paid-provider protected ledger gate is not independently passed.
- Private-origin chain: #187 → #191 → #193 → #195 → #198 → #199 → #201 (stacked). #198 rejects malformed DNS; #199 rejects encoded IP aliases; #201 rejects secondary shadow Hyperdrive bindings. TDD RED and exact-head GREEN are documented in PR bodies. These tests inspect **synthetic metadata** only, never live TLS/neon/Cloudflare proof.
- Parallel IdP/Paynow review: #197 → #200; separate draft stack; do not confuse with metering or production settlement. Recheck #200 head — it may advance.
- Independent B27 Security Authority 2 highwater work: #192 and children #194/#196 remain draft; historical MUST-FAIL release veto is an intentional blocker, not a passing prod gate.
- Cloudflare D1/production OAuth recovery/PR77 synthetic and hosted readbacks remain separate draft-only evidence; do not place private customer restores, encrypted owner backups or R2 custody artifacts in a public ZIP.
- Production acceptance issue #74 and private GitLab lineage issue #75 remain OPEN at the time of snapshot. All **six** independently signed production release gates **NO-GO**.
- No production deployments, Neon network exception, Cloudflare/D1 or OAuth mutations, real paid-provider spend, merge or freeze-branch updates are authorized merely by loading this ZIP. Routine safe TDD, tests, CI, reviews, documentation and draft PRs are allowed by owner standing instruction; stop for irreversible or real external authorization.
- Older verified 2026-11-08 ZIP: {PRIOR_URL}; SHA256 `{PRIOR_SHA256}`. This latest package supersedes its public code snapshot but not any separate confidential historical archival material.
''',encoding='utf-8')
    (handoff/'VERIFICATION_MATRIX.md').write_text(f'''# Verification matrix — as of frozen packaging snapshot

| Control | Evidence | Status |
|---|---|---|
| Public Github complete fetched Git refs | `SOURCE_HISTORY/REFS.tsv`, Git bundle + fsck | VERIFIED IN PACKAGING; no claim about future refs |
| Git bundle SHA256 | `{sha256(bundle)}` | VERIFIED |
| Frozen canonical main commit | `{main_sha}` | CHECKED THEN; recheck live |
| Pinned source snapshots | `HANDOFF/SNAPSHOT_MANIFEST.json`, `PRODUCT/` | VERIFIED exact commit exports |
| PR inventory | {len(prs)} live open PRs at capture | FROZEN; can change |
| Branch CI | `HANDOFF/PR_WORKFLOW_RUNS.json`, only sampled exact-head runs | OBSERVATIONS; not universal pass |
| G1 protected PostgreSQL paid-provider spend centralization | PR #76/#81/#104/#180-185 synthetic TDD only | NO-GO |
| G2 independently reconciled real vendor invoices/finance | no accepted live finance reconciliation | NO-GO |
| G3 authorized real external target smoke | not independently signed accepted | NO-GO |
| G4 independent penetration retest | no accepted independent retest | NO-GO |
| G5 IAM/SSO/MFA/DR/key/rollback and 10 workstream signoffs | incomplete external acceptance | NO-GO |
| G6 private GitLab issue/MR/CI provenance | retained separately; archive incomplete | NO-GO |
| Private customer backups and secrets | deliberately not included | SEPARATE |
| Guarantee of trading profits | impossible to certify | DO NOT CLAIM |
''',encoding='utf-8')
    (handoff/'SOURCE_MANIFEST.md').write_text(f'''# Sources and scope

1. `SOURCE_HISTORY/public-github-all-refs.bundle`: full Git object history for currently fetched PUBLIC branch, tag and PR head refs; verified SHA256 `{sha256(bundle)}`. Inspect with `git clone --mirror SOURCE_HISTORY/public-github-all-refs.bundle mirror.git`, `git -C mirror.git fsck --full`, and `git -C mirror.git show <sha>`.
2. `SOURCE_HISTORY/REFS.tsv` and `VERIFY.txt` pin recorded ref SHA values and verification commands.
3. `PRODUCT/<label>` are FULL tracked source trees at immutable Git SHAs; see `HANDOFF/SNAPSHOT_MANIFEST.json` (not merely selected code snippets).
4. `HANDOFF/OPEN_PULL_REQUESTS.json`, `PR_WORKFLOW_RUNS.json` and `RELEASE_GATE_ISSUES.json` were read from canonical GitHub API at packaging time; workflows are only observed samples.
5. Previously verified, broader original 2026-11-08 package remains at {PRIOR_URL} with SHA256 `{PRIOR_SHA256}`. This ZIP is independently self-contained for the **public** repository and current open heads.
6. The private GitLab project and encrypted customer data are **not in this archive**; access remains separate and needs actual approval. Never import confidential GitLab metadata into public GitHub.
''',encoding='utf-8')
    cmd='''Continue MUSITU AXIOM from my verified whole-product continuation ZIP in connected Google Drive:

[REPLACE_WITH_ACTUAL_NEW_DRIVE_LINK]

Exact filename: MUSITU_AXIOM_WHOLE_PRODUCT_CONTINUATION_20261110.zip

BEFORE making any changes, fetch and open the ZIP and read these paths IN ORDER: HANDOFF/README_FIRST.md, HANDOFF/CONTINUATION_STATE.md, HANDOFF/CONTINUATION_STATE.json, HANDOFF/VERIFICATION_MATRIX.md, HANDOFF/OPEN_PULL_REQUESTS.json, HANDOFF/PR_WORKFLOW_RUNS.json, HANDOFF/RELEASE_GATE_ISSUES.json, HANDOFF/SNAPSHOT_MANIFEST.json, HANDOFF/SOURCE_MANIFEST.md, HANDOFF/NEW_CHAT_COMMAND.txt, HANDOFF/SHA256SUMS.txt. Verify ZIP CRC, all listed SHA256 file hashes, SOURCE_HISTORY/public-github-all-refs.bundle using git bundle verify and git fsck, and pinned PRODUCT snapshot Git identities.

Treat LIVE GitHub evansmusitu/mft-axiom-build as the canonical engineering/release repository, not the frozen ZIP and not GitLab. Recheck live main, ALL currently open PR head and base SHAs and exact-head GitHub Actions before any write. Latest frozen main was c3c5aaab90e94f1ca84ac9903f9d481c23c4f350; draft #195 → #198 → #199 → #201 were private-origin metadata security hardening; #201 is stacked on #199. The package also records the metering draft stack #76 → #81 → #104 → #180 → #182 → #183 → #184 → #185, independent #99 Hyperdrive staging, #192 B27 custody with #194/#196, #197/#200 Paynow/IdP, and D1/OAuth/PR77 work. Do not rely on stale PR heads: read exact live values. Keep GitLab private historical archive and owner-encrypted backups separate; never publish private materials.

All SIX independent production acceptance gates remain NO-GO (protected central paid-provider spend controls, real vendor invoice reconciliation, approved live external target smoke, independent penetration retest, SSO/MFA/DR/key/owner operational acceptance, and complete private GitLab issue/MR/CI archive). Passing synthetic tests or draft CI does NOT authorize production. No merge, deployment, paid call, Neon public-network exception, Cloudflare/D1/OAuth irreversible action, private-data publication, or guaranteed trading-profit claim without genuine authorization and required evidence.

You have standing approval to continue automatically through safe design, specs, test-first implementation, fixes, security review, documentation, CI and DRAFT PR creation, preserving branches and no squash/force push. Stop only for genuine external authorization or actions outside that mandate. Continue with the next best safe verified increment, and report actual commit hashes, PR links, exact-head tests and remaining blockers; do not repeat questions already answered.
'''
    (handoff/'NEW_CHAT_COMMAND.txt').write_text(cmd,encoding='utf-8')
    # SHA manifest is generated LAST and intentionally excludes itself.
    entries=[]
    for file in sorted(p for p in out.rglob('*') if p.is_file()):
        if file.name=='SHA256SUMS.txt' and file.parent==handoff:continue
        rel=file.relative_to(out).as_posix()
        entries.append(f'{sha256(file)}  {rel}')
    (handoff/'SHA256SUMS.txt').write_text('\n'.join(entries)+'\n',encoding='utf-8')
    if any(x=='GITHUB_TOKEN' for x in entries):raise ValueError('Unexpected token string')
    print(json.dumps({'out':str(out),'git_bundle_sha256':sha256(bundle),
                      'file_count':len(entries),'main_sha':main_sha,'pr_count':len(prs),
                      'snapshot_count':len(snapshot_manifest),'snapshots':snapshot_manifest},indent=2))


if __name__=='__main__':
    ap=argparse.ArgumentParser()
    ap.add_argument('--repo',default='.')
    ap.add_argument('--output',required=True)
    ap.add_argument('--offline',action='store_true')
    ap.add_argument('--offline-inventory')
    args=ap.parse_args()
    try:build(args)
    except Exception as e:
        print('HALT: '+str(e),file=sys.stderr)
        sys.exit(1)
