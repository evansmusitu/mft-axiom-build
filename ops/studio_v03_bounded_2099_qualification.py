#!/usr/bin/env python3
"""Run *all* offline 2099 mock tests serially in bounded subprocess groups.

No Blender, provider access, customer data or billable cloud operations are
requested by this runner. The known test modules inject fake Blender/FFmpeg
binaries; their source must be audited before use on untrusted branches.
Unlike a successful partial group, a qualification result is emitted only
when every discovered test finishes with a complete unittest summary.
"""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import unittest

SCHEMA = 'musitu.studio.v03.godmode-bounded-offline-tests.v1'
TEST_GLOB = 'test_god_mode_2099_*.py'
SUMMARY = re.compile(r'(?m)^Ran (\d+) tests? in [0-9]+(?:\.[0-9]+)?s\s*\n\nOK\s*$')


def _cases(suite):
    for item in suite:
        if isinstance(item, unittest.TestSuite):
            yield from _cases(item)
        else:
            yield item.id()


def discover_cases(root: Path) -> list[str]:
    root = Path(root)
    directory = root/'ops/tests'
    if root.is_symlink() or not directory.is_dir() or directory.is_symlink():
        raise ValueError('STUDIO_2099_TEST_SOURCE_INVALID')
    paths = sorted(directory.glob(TEST_GLOB))
    if not paths or len(paths)>30:
        raise ValueError('STUDIO_2099_TEST_SOURCE_INVALID')
    cases = []
    for path in paths:
        if path.is_symlink() or not path.is_file() or path.stat().st_size>100000:
            raise ValueError('STUDIO_2099_TEST_SOURCE_INVALID')
        try:
            spec = importlib.util.spec_from_file_location(path.stem, path)
            if spec is None or spec.loader is None:
                raise ValueError('STUDIO_2099_TEST_IMPORT_FAILED')
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            loaded = list(_cases(unittest.defaultTestLoader.loadTestsFromModule(module)))
        except Exception:
            raise ValueError('STUDIO_2099_TEST_IMPORT_FAILED') from None
        if not loaded:
            raise ValueError('STUDIO_2099_TEST_EMPTY_MODULE')
        cases.extend(loaded)
    if len(cases)!=len(set(cases)) or len(cases)>1000:
        raise ValueError('STUDIO_2099_TEST_DUPLICATE_OR_EXCESSIVE')
    return sorted(cases)


def _bounded_process_group(command, *, cwd, env, capture_output, text, timeout):
    """Kill the entire mock subprocess group if an individual suite stalls.

    Killing only the Python test runner process leaves Blender-mock children
    holding stdout/stderr pipes open, so a simple subprocess.run timeout can
    itself hang. A fresh process group prevents such orphan test workers.
    """
    if os.name != 'posix':
        raise ValueError('STUDIO_2099_QUALIFICATION_POSIX_REQUIRED')
    process = subprocess.Popen(command, cwd=cwd, env=env,
                               stdout=subprocess.PIPE,stderr=subprocess.PIPE,
                               text=True,start_new_session=True)
    try:
        out,err = process.communicate(timeout=timeout)
        return subprocess.CompletedProcess(command,process.returncode,out,err)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid,signal.SIGKILL)
        except ProcessLookupError:
            pass
        try:
            process.communicate(timeout=3)
        except subprocess.TimeoutExpired:
            # The test group is already signalled; qualification still fails.
            pass
        raise


def qualify(root: Path, *, group_size:int=6, timeout_seconds:int=90, runner=None) -> dict:
    if type(group_size) is not int or not 1<=group_size<=12 or \
       type(timeout_seconds) is not int or not 10<=timeout_seconds<=180:
        raise ValueError('STUDIO_2099_TEST_LIMIT_INVALID')
    root = Path(root).resolve(strict=True)
    cases = discover_cases(root)
    env = dict(os.environ)
    env['PYTHONPATH'] = str(root/'ops/tests')
    # Ignore ambient PYTHONPATH and Python user sitepackages for deterministic
    # import selection of the two checked-in, offline-only unittest modules.
    env['PYTHONNOUSERSITE'] = '1'
    run = runner or _bounded_process_group
    results=[]
    for start in range(0,len(cases),group_size):
        group = cases[start:start+group_size]
        command = [sys.executable,'-m','unittest',*group,'-v']
        try:
            outcome = run(command,cwd=root,env=env,capture_output=True,
                          text=True,timeout=timeout_seconds)
        except subprocess.TimeoutExpired:
            raise ValueError('STUDIO_2099_QUALIFICATION_TIMEOUT') from None
        except (OSError,TypeError):
            raise ValueError('STUDIO_2099_QUALIFICATION_RUNNER_FAILED') from None
        if outcome.returncode != 0:
            raise ValueError('STUDIO_2099_QUALIFICATION_FAILED')
        report = SUMMARY.search(outcome.stderr)
        if not report or int(report.group(1))!=len(group):
            raise ValueError('STUDIO_2099_QUALIFICATION_INCOMPLETE')
        results.append({'case_count':len(group),'status':'pass'})
    return {'schema':SCHEMA,'source_only':True,'provider_verified':False,
            'hosted_ci_verified':False,'real_blender_rendered':False,
            'complete':True,'tests_passed':len(cases),'groups':results}


if __name__=='__main__':
    try:
        print(json.dumps(qualify(Path(__file__).resolve().parents[1]),sort_keys=True))
    except (ValueError,OSError) as exc:
        print(str(exc),file=sys.stderr)
        raise SystemExit(1)
