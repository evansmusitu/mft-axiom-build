import hashlib, json, pathlib, struct, sys
def verify(directory,expected_sha,device):
    p=pathlib.Path(directory)
    e=json.loads((p/'evidence.json').read_text())
    assert e['schema']=='musitu.blender.job-evidence.v1' and e['result']=='PASS'
    assert e['input_sha256']==expected_sha
    if device=='GPU':
        assert e['renderer']=='CYCLES_CUDA' and e['gpu_verified'] is True and e.get('gpu_device_names')
    else:
        assert e['renderer']=='CYCLES_CPU' and e['gpu_verified'] is False
    assert set(e['files'])=={'scene.blend','scene.glb','preview.png'}
    out={}
    for name in sorted(e['files']):
        f=p/name
        raw=f.read_bytes()
        assert len(raw)==e['files'][name]['bytes'] and len(raw)>1024
        digest=hashlib.sha256(raw).hexdigest()
        assert digest==e['files'][name]['sha256']
        if name=='scene.blend':assert raw.startswith(b'BLENDER')
        if name=='scene.glb':
            assert struct.unpack('<4sII',raw[:12])==(b'glTF',2,len(raw))
        if name=='preview.png':
            assert raw[:8]==b'\x89PNG\r\n\x1a\n'
            assert struct.unpack('>II',raw[16:24])==(320,200)
        out[name]=(raw,digest)
    return out,e
