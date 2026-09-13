#!/usr/bin/env python3
from __future__ import annotations
import os,subprocess,sys
def run(*args):
 env=os.environ.copy();env['PYTHONPATH']='.';subprocess.check_call([sys.executable,*args],env=env)
def main():
 run('frontier_v5/scripts/run_phase10_regression_gate.py');run('axiom_interface/tests/test_operator_phase11.py');run('frontier_v5/scripts/run_phase11_security_gate.py');print('MUSITU_AXIOM_INTERFACE_PHASE11_RUNTIME_REGRESSION_PASS')
if __name__=='__main__':main()
