"""Human-only public-data CLI for AXIOM isolated custody enrollment review.

Never accepts private signing keys, performs no external writes/requests, cannot
qualify an independent provider, and always DENIES execution/release.
"""
import argparse
import json
import sys
import time
from pathlib import Path

from .custodian_enrollment import (
    CustodianEnrollmentHold, inspect_key_possession, make_challenge,
    qualification_report,
)


def _read_public_json(path):
    p=Path(path)
    # Never read arbitrary large files or any credential/vault artifacts.
    if not p.is_file() or p.stat().st_size>8192:
        raise CustodianEnrollmentHold('AXIOM_CUSTODY_S0_HOLD:NO_PUBLIC_JSON_EVIDENCE')
    try:
        raw=p.read_text(encoding='utf-8')
        result=json.loads(raw)
    except (OSError,UnicodeError,ValueError):
        raise CustodianEnrollmentHold('AXIOM_CUSTODY_S0_HOLD:INVALID_PUBLIC_JSON') from None
    if type(result) is not dict:
        raise CustodianEnrollmentHold('AXIOM_CUSTODY_S0_HOLD:INVALID_PUBLIC_JSON')
    return result


def _parser():
    p=argparse.ArgumentParser(
        description='AXIOM offline S0 public-key possession review. Never grants independent authority.',
        epilog='Public-only operator credential: --operator-public-hex; no private keys accepted.')
    sub=p.add_subparsers(dest='command',required=True)
    for command in ('issue','inspect'):
        q=sub.add_parser(command,help='public only; no secrets, provider calls or release')
        q.add_argument('--project',required=True)
        q.add_argument('--custodian',required=True)
        q.add_argument('--operator-public-hex',required=True)
        q.add_argument('--witness-public-hex',required=True)
        q.add_argument('--policy-sha256',required=True)
        if command=='inspect':
            q.add_argument('--challenge',required=True,help='path to public JSON challenge')
            q.add_argument('--proof',required=True,help='path to public JSON signature proof')
    return p


def main(argv=None):
    a=_parser().parse_args(argv)
    k=dict(project_id=a.project,custodian_id=a.custodian,
           operator_public_key_hex=a.operator_public_hex,
           witness_public_key_hex=a.witness_public_hex,
           policy_sha256=a.policy_sha256)
    try:
        if a.command=='issue':
            payload=make_challenge(**k,now=int(time.time()))
        else:
            inspection=inspect_key_possession(
                _read_public_json(a.challenge),_read_public_json(a.proof),
                **k,now=int(time.time()))
            payload=qualification_report(inspection)
            payload['possession_review']=inspection['status']
    except (CustodianEnrollmentHold,OSError,ValueError,TypeError) as e:
        print('AXIOM_CUSTODY_S0_HOLD:'+str(e).split(':')[-1],file=sys.stderr)
        return 2
    print(json.dumps(payload,sort_keys=True,separators=(',',':')))
    return 0


if __name__=='__main__':
    raise SystemExit(main())
