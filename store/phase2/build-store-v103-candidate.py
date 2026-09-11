#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import re
import shutil

MODULES=("worker.mjs","render.mjs","assets.mjs","generated-data.mjs")
SIGNED_SHA="9bbb97b928fcd9130a84f333f3ffe48f3829edec474ec19d18a36df289c36081"
SIGNED_BYTES=1692495
V103_ASSET="  '/store/bootstrap/MUSITU_Store_1.0.3.apk':{key:'bootstrap/MUSITU_Store_1.0.3.apk',sha256:'9bbb97b928fcd9130a84f333f3ffe48f3829edec474ec19d18a36df289c36081',bytes:1692495,type:'application/vnd.android.package-archive',name:'MUSITU_Store_1.0.3.apk'},\n"
V102_ANCHOR="  '/store/bootstrap/MUSITU_Store_1.0.2.apk':{key:'bootstrap/MUSITU_Store_1.0.2.apk',sha256:'3a0c4b0f971ec84cd6167a137f8e3d75c7bb20e525c26ab533b3d88044cd0784',bytes:1679340,type:'application/vnd.android.package-archive',name:'MUSITU_Store_1.0.2.apk'},\n"


def sha256(path:pathlib.Path)->str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def replace_export(text:str,name:str,raw:str)->str:
    pattern=rf'^export const {re.escape(name)}=.*;$'
    replacement=f'export const {name}='+json.dumps(raw,ensure_ascii=False,separators=(",",":"))+';'
    updated,count=re.subn(pattern,replacement,text,count=1,flags=re.MULTILINE)
    if count!=1:
        raise SystemExit(f"expected exactly one {name} export, found {count}")
    return updated


def main()->None:
    p=argparse.ArgumentParser()
    p.add_argument('--baseline',required=True,type=pathlib.Path)
    p.add_argument('--candidate',required=True,type=pathlib.Path)
    p.add_argument('--inputs',required=True,type=pathlib.Path)
    p.add_argument('--report',type=pathlib.Path)
    a=p.parse_args()

    for name in MODULES:
        if not (a.baseline/name).is_file():
            raise SystemExit(f"baseline missing {name}")
    if a.candidate.exists():
        shutil.rmtree(a.candidate)
    a.candidate.mkdir(parents=True)
    for name in MODULES:
        shutil.copy2(a.baseline/name,a.candidate/name)

    catalog=(a.inputs/'catalog.json').read_text(encoding='utf-8')
    catalog_sig=(a.inputs/'catalog.sig').read_text(encoding='utf-8')
    bootstrap=(a.inputs/'bootstrap-release.json').read_text(encoding='utf-8')
    c=json.loads(catalog); b=json.loads(bootstrap)
    sc=c['releaseControl']['storeClient']
    expected={
        'version':'1.0.3','versionCode':10003,'packageId':'com.musitu.store',
        'sha256':SIGNED_SHA,'bytes':SIGNED_BYTES,
        'signingCertificateSha256':'43695b6103d7ab57e89166c9a537f1810b7e33053e20332b1d4e7e2e1c612671',
        'unsignedPrebuiltSha256':'fabb197b0ffeac6c69041a93aa3fc9023dccd841758f817ffd28b7dacdf2559f',
        'unsignedPrebuiltBytes':1677040,
    }
    if c.get('revision')!=4 or any(sc.get(k)!=v for k,v in expected.items()):
        raise SystemExit('catalog Store client identity is not the certified 1.0.3 release')
    if b.get('version')!='1.0.3' or b.get('versionCode')!=10003 or b.get('artifactFile')!='MUSITU_Store_1.0.3.apk' or b.get('sha256')!=SIGNED_SHA or b.get('bytes')!=SIGNED_BYTES:
        raise SystemExit('bootstrap release identity is not the certified 1.0.3 release')

    worker_path=a.candidate/'worker.mjs'
    worker=worker_path.read_text(encoding='utf-8')
    if 'MUSITU_Store_1.0.3.apk' in worker:
        raise SystemExit('baseline unexpectedly already contains Store 1.0.3 asset route')
    if worker.count(V102_ANCHOR)!=1:
        raise SystemExit('exact Store 1.0.2 release asset anchor missing or ambiguous')
    worker=worker.replace(V102_ANCHOR,V103_ASSET+V102_ANCHOR,1)
    worker_path.write_text(worker,encoding='utf-8')

    data_path=a.candidate/'generated-data.mjs'
    data=data_path.read_text(encoding='utf-8')
    data=replace_export(data,'CATALOG_RAW',catalog)
    data=replace_export(data,'CATALOG_SIG_RAW',catalog_sig)
    data=replace_export(data,'BOOTSTRAP_RAW',bootstrap)
    data_path.write_text(data,encoding='utf-8')

    if (a.baseline/'render.mjs').read_bytes()!=(a.candidate/'render.mjs').read_bytes():
        raise SystemExit('render.mjs changed unexpectedly')
    if (a.baseline/'assets.mjs').read_bytes()!=(a.candidate/'assets.mjs').read_bytes():
        raise SystemExit('assets.mjs changed unexpectedly')
    if (a.baseline/'worker.mjs').read_bytes()==(a.candidate/'worker.mjs').read_bytes():
        raise SystemExit('worker.mjs did not change')
    if (a.baseline/'generated-data.mjs').read_bytes()==(a.candidate/'generated-data.mjs').read_bytes():
        raise SystemExit('generated-data.mjs did not change')

    report={
      'schema':'musitu.store.v103.candidate_build.v1',
      'result':'PASS',
      'release':{'version':'1.0.3','versionCode':10003,'packageId':'com.musitu.store','signedSha256':SIGNED_SHA,'signedBytes':SIGNED_BYTES},
      'catalog':{'revision':c['revision'],'sha256':hashlib.sha256(catalog.encode()).hexdigest(),'signatureSha256':hashlib.sha256(catalog_sig.encode()).hexdigest()},
      'bootstrapSha256':hashlib.sha256(bootstrap.encode()).hexdigest(),
      'baselineModules':{n:sha256(a.baseline/n) for n in MODULES},
      'candidateModules':{n:sha256(a.candidate/n) for n in MODULES},
      'changedModules':['worker.mjs','generated-data.mjs'],
      'preservedModules':['render.mjs','assets.mjs'],
    }
    if a.report:
        a.report.parent.mkdir(parents=True,exist_ok=True)
        a.report.write_text(json.dumps(report,indent=2,sort_keys=True)+'\n',encoding='utf-8')
    print(json.dumps(report,indent=2,sort_keys=True))
    print('MUSITU_STORE_1_0_3_CANDIDATE_BUILD=PASS')


if __name__=='__main__':
    main()
