#!/usr/bin/env python3
"""Build one owner-local Windows readback script; includes no credential."""
import argparse,base64,datetime,hashlib,json,re,secrets
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
def build(output,source_commit,now=None):
    if not re.fullmatch(r'[0-9a-f]{40}',source_commit):
        raise ValueError('SOURCE_COMMIT_REQUIRED')
    now=now or datetime.datetime.now(datetime.timezone.utc)
    module=(ROOT/'customer_frontier/qualification/gate3_owner_custody_readback.mjs').read_text()
    original="from '../customer_control_plane/zitadel_provider_tokens_candidate.mjs'"
    if module.count(original)!=1:
        raise ValueError('PARSER_IMPORT_CHANGED')
    module=module.replace(original,"from './owner_custody_json.mjs'").encode()
    parser=(ROOT/'customer_frontier/customer_control_plane/zitadel_provider_tokens_candidate.mjs').read_text()
    start=parser.index('export function parseIdentityJson(raw){')
    end=parser.index('\nfunction tokenJson',start)
    parser=("const fail=()=>{throw Error('OWNER_PROVIDER_JSON_INVALID');};\n"+parser[start:end]+'\n').encode()
    challenge=dict(schema='musitu.axiom.gate3.owner-custody-challenge.v1',nonce=secrets.token_hex(16),repository='evansmusitu/mft-axiom-build',account_id='67469478aa9349fa0a57fe3a72da200a',
                   issued_at_utc=now.isoformat().replace('+00:00','Z'),expires_at_utc=(now+datetime.timedelta(days=2)).isoformat().replace('+00:00','Z'),source_commit=source_commit,gate3_closed=False,release_status='NOT_RELEASE')
    challenge=json.dumps(challenge,sort_keys=True,separators=(',',':')).encode()
    template=(ROOT/'customer_frontier/qualification/gate3_owner_custody_readback.template.ps1').read_text()
    replacements={'SOURCE_COMMIT':source_commit}
    for label,data in [('MODULE',module),('PARSER',parser),('CHALLENGE',challenge)]:
        replacements[label+'_SHA']=hashlib.sha256(data).hexdigest()
        replacements[label+'_B64']=base64.b64encode(data).decode()
    for key,value in replacements.items():
        marker='@@'+key+'@@'
        if template.count(marker)!=1:
            raise ValueError('TEMPLATE_MARKER_CHANGED')
        template=template.replace(marker,value)
    if '@@' in template:
        raise ValueError('TEMPLATE_MARKER_REMAINS')
    output=Path(output);output.parent.mkdir(parents=True,exist_ok=True)
    output.write_bytes(template.encode('utf-8'))
    return dict(path=str(output.resolve()),bytes=output.stat().st_size,sha256=hashlib.sha256(output.read_bytes()).hexdigest(),source_commit=source_commit,
                module_sha256=replacements['MODULE_SHA'],parser_sha256=replacements['PARSER_SHA'],challenge_sha256=replacements['CHALLENGE_SHA'],private_credentials_included=False,gate3_closed=False,release_status='NOT_RELEASE')

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--out',required=True);p.add_argument('--source-commit',required=True);a=p.parse_args()
    print(json.dumps(build(a.out,a.source_commit)))
