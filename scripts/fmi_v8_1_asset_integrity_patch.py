import hashlib,json,os,pathlib,sys

PATH=pathlib.Path(os.environ.get('V8_SOURCE_PATH','/tmp/fmi-v8-runtime/edge/fmi-global/worker.js'))
EXPECTED_IN=os.environ.get('EXPECTED_V8_BASE_EDGE_SHA','00fa486ddf3f51f3c435b8db33c5ec1d1c42d6b175abc95f4e1ad9328e40f2b3')
EXPECTED_OUT=os.environ.get('EXPECTED_V8_EDGE_SHA','27ea84793c78f24091e0154836d6330678f3386db97b43f864f117c28ebebcd9')

def sha(b):return hashlib.sha256(b).hexdigest()

def main():
    raw=PATH.read_bytes()
    got=sha(raw)
    if got!=EXPECTED_IN:raise RuntimeError(f'Fail-closed V8 base edge SHA mismatch: {got}')
    s=raw.decode('utf-8')
    a='function workspaceJs(){return `'
    b='function workspaceJs(){return String.raw`'
    tail="if(key())connect(key())})();`}\nexport default"
    fixed_tail="if(key())connect(key())})();`+'\\n'}\nexport default"
    if s.count(a)!=1:raise RuntimeError(f'workspaceJs template start count={s.count(a)}')
    if s.count(tail)!=1:raise RuntimeError(f'workspaceJs template tail count={s.count(tail)}')
    s=s.replace(a,b,1).replace(tail,fixed_tail,1)
    out=s.encode('utf-8'); out_sha=sha(out)
    if out_sha!=EXPECTED_OUT:raise RuntimeError(f'Fail-closed V8.1 edge SHA mismatch: {out_sha}')
    PATH.write_bytes(out)
    ev={'schema':'musitu-fmi.v8.1-asset-integrity-patch.v1','gate':'PASS','input_edge_sha256':got,'output_edge_sha256':out_sha,'fixes':['RAW_TAGGED_WORKSPACE_TEMPLATE','PRESERVE_FINAL_NEWLINE'],'semantic_reason':'Prevent template-literal escape rewriting of the tested workspace JavaScript','workspace_source_changed':False}
    pathlib.Path('fmi-v8-1-asset-integrity-patch-evidence.json').write_text(json.dumps(ev,indent=2,sort_keys=True)+'\n')
    print(json.dumps(ev,sort_keys=True))

if __name__=='__main__':
    try:main()
    except Exception as e:
        print('FAIL '+type(e).__name__+' '+str(e),file=sys.stderr);sys.exit(1)
