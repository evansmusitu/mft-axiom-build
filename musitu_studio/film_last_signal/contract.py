import re
TOTAL=5400
BATCH=12
def ranges(): return [(a,min(a+BATCH-1,TOTAL)) for a in range(1,TOTAL+1,BATCH)]
def validate_receipt(record,a,b):
    if (record.get('start'),record.get('end'),record.get('renderer'),record.get('device'))!=(a,b,'CYCLES_CUDA','Tesla T4'): raise ValueError('GPU or range mismatch')
    frames=record.get('frames',[])
    if [f.get('frame') for f in frames]!=list(range(a,b+1)): raise ValueError('missing or duplicate frame')
    for f in frames:
        if not re.fullmatch(r'[0-9a-f]{64}',f.get('sha256','')) or not isinstance(f.get('bytes'),int) or f['bytes']<1024: raise ValueError('invalid frame metadata')
