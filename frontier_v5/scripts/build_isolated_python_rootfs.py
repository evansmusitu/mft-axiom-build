#!/usr/bin/env python3
"""Create a *disposable* no-secret Python namespace fixture rootfs; NOT a prod image."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
from frontier_v5.runtime.linux_namespace_sandbox import rootfs_digest


def build(output: Path, python_binary: Path) -> dict:
    output=output.resolve()
    if output.exists() and any(output.iterdir()):
        raise SystemExit('Refuse nonempty or shared rootfs target')
    output.mkdir(parents=True,exist_ok=True)
    python_binary=python_binary.resolve(strict=True)
    info=json.loads(subprocess.check_output([str(python_binary),'-S','-c',
            'import json,sysconfig; print(json.dumps({"stdlib":sysconfig.get_path("stdlib")}))'],text=True))
    stdlib=Path(info['stdlib']).resolve(strict=True)
    dest=output/'usr/bin/python3';dest.parent.mkdir(parents=True,exist_ok=True)
    shutil.copy2(python_binary,dest)
    ldd=subprocess.check_output(['ldd',str(python_binary)],text=True)
    for path in re.findall(r'/[^\s()]+',ldd):
        p=Path(path)
        if p.is_file():
            dest=output/p.relative_to('/');dest.parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(p,dest)
    shutil.copytree(stdlib,output/stdlib.relative_to('/'),symlinks=False,dirs_exist_ok=True,
        ignore=shutil.ignore_patterns('__pycache__','test','tests','idlelib','tkinter','ensurepip','turtledemo'))
    result={'schema':'musitu.axiom.frontier.namespace-fixture.v1',
            'rootfs':str(output),'python':'/usr/bin/python3','rootfs_sha256':rootfs_digest(output),
            'claim':'LOCAL_TEST_FIXTURE_NOT_CERTIFIED', 'network':'UNSHARE_NET_NO_VETH',
            'host_mounts':'NONE_PROVISIONED'}
    (output.parent/(output.name+'-manifest.json')).write_text(json.dumps(result,sort_keys=True,indent=2)+'\n')
    return result

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--output',required=True);p.add_argument('--python',default='/usr/bin/python3')
    x=p.parse_args();print(json.dumps(build(Path(x.output),Path(x.python)),sort_keys=True))
