from pathlib import Path
import hashlib,subprocess,sys
root=Path(__file__).resolve().parent
rows=(root/'MANIFEST.sha256').read_text().splitlines()
if len(rows)<4:sys.exit('B25_MANIFEST_INCOMPLETE')
seen=set()
for line in rows:
    digest,sep,rel=line.partition('  ')
    item=(root/rel).resolve()
    if not sep or item in seen or not item.is_relative_to(root) or not item.is_file():sys.exit('B25_MANIFEST_PATH_DENIED')
    seen.add(item)
    if hashlib.sha256(item.read_bytes()).hexdigest()!=digest:sys.exit('B25_MANIFEST_HASH_DENIED:'+rel)
print('B25_SOURCE_MANIFEST_PASS',len(rows),flush=True)
for args in ([sys.executable,'-m','py_compile','quorum.py','test/test_quorum.py'],
             [sys.executable,'-m','unittest','discover','-v','-s','test','-p','test_*.py']):
    p=subprocess.run(args,cwd=root,timeout=35)
    if p.returncode:raise SystemExit('B25_TESTS_FAILED')
print('AXIOM_B25_LOCAL_S0_SYNTHETIC_QUORUM_PASS_NOT_INDEPENDENT_NOT_PRODUCTION')
