"""Validate and package the complete public plugin without account secrets."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile
import yaml

ROOT=Path(__file__).resolve().parents[1]
PLUGIN=ROOT/'plugins/musitu-axiom'
def validate():
    manifest=json.loads((PLUGIN/'plugin.json').read_text());assert manifest['version']=='2.0.5'
    interface=manifest['extensions']['com.openai']['interface'];assert interface['supportURL']=='https://support.mftintelligence.com/'
    mcp=json.loads((PLUGIN/'mcp.json').read_text());assert 'https://mcp.mftintelligence.com/mcp' in json.dumps(mcp)
    review=manifest['extensions']['com.openai']['review'];assert review['commerce'] is False
    assert len(review['test_cases']['positive'])==5 and len(review['test_cases']['negative'])==3
    skills=sorted((PLUGIN/'skills').glob('*/SKILL.md'));assert len(skills)==18
    contracts=set()
    for skill in skills:
        raw=skill.read_text();assert raw.startswith('---\n');meta=yaml.safe_load(raw.split('---',2)[1]);assert meta['name']==skill.parent.name and meta['description']
        contracts.add((skill.parent/'references/COMMERCIAL.md').read_text())
        assert (skill.parent/'agents/openai.yaml').is_file()
    assert len(contracts)==1
    contract=contracts.pop();assert 'Do not display subscription plans or prices' in contract and 'Do not collect passwords' in contract
    assert 'Surface paid/team/API access' not in (PLUGIN/'skills/musitu-command-center/SKILL.md').read_text()
    assert 'Keep selling subordinate' not in (PLUGIN/'skills/musitu-commercial-expansion/SKILL.md').read_text()
    files=sorted(p for p in PLUGIN.rglob('*') if p.is_file());assert len(files)==147
    assert all(not p.is_symlink() and '.pyc'!=p.suffix and '__pycache__' not in p.parts for p in files)
    return files
def main():
    cli=argparse.ArgumentParser();cli.add_argument('--output',type=Path);args=cli.parse_args();files=validate()
    result={'version':'2.0.5','skills':18,'files':len(files),'positive_tests':5,'negative_tests':3,'commerce':False}
    if args.output:
        args.output.parent.mkdir(parents=True,exist_ok=True)
        with zipfile.ZipFile(args.output,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
            for p in files:
                info=zipfile.ZipInfo(str(p.relative_to(PLUGIN)),date_time=(2026,10,28,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100644<<16;z.writestr(info,p.read_bytes())
        with zipfile.ZipFile(args.output) as z:assert z.testzip() is None and len(z.namelist())==147
        result.update(zip_sha256=hashlib.sha256(args.output.read_bytes()).hexdigest(),zip_bytes=args.output.stat().st_size)
    print(json.dumps(result,sort_keys=True))
if __name__=='__main__':main()
