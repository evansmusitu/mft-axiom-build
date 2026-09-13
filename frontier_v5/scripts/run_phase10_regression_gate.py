#!/usr/bin/env python3
from __future__ import annotations
import os,subprocess,sys
def run(*args):
 env=os.environ.copy();env['PYTHONPATH']='.';subprocess.check_call([sys.executable,*args],env=env)
def main():
 run('frontier_v5/scripts/run_phase9_regression_gate.py');run('axiom_interface/tests/test_memory_phase10.py');run('frontier_v5/scripts/run_phase10_security_gate.py');print('MUSITU_AXIOM_INTERFACE_PHASE10_RUNTIME_REGRESSION_PASS')
if __name__=='__main__':main()
