from pathlib import Path
import hashlib,json,sys,zipfile
root=Path(sys.argv[1])
rows=[]
for p in sorted(root.glob('*.zip')):
    b=p.read_bytes()
    with zipfile.ZipFile(p) as z:
        members=sorted((i.filename,i.file_size) for i in z.infolist() if not i.is_dir())
    rows.append({'archive':p.name,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest(),'member_count':len(members),'members':members})
out={'schema':'musitu.revenueguard.public_holdout_archives.v1','archives':rows}
out['manifest_sha256']=hashlib.sha256(json.dumps(out,sort_keys=True,separators=(',',':')).encode()).hexdigest()
(root/'ARCHIVE_MANIFEST.json').write_text(json.dumps(out,indent=2,sort_keys=True)+'\n')
print(json.dumps({'manifest_sha256':out['manifest_sha256'],'archives':[{'archive':x['archive'],'member_count':x['member_count']} for x in rows]},indent=2))
