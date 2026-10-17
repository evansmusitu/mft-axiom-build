"""Consistent SQLite + job/asset export to an independently verifiable ZIP.

For disaster recovery, copy the ZIP to enterprise-controlled separate storage.
Restore must target a new, empty directory; never overwrite live production state.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
import tempfile
import time
from zipfile import ZipFile, ZIP_DEFLATED


def sha(data): return hashlib.sha256(data).hexdigest()


def write_backup(root, dest):
    root=Path(root).resolve()
    dest=Path(dest).resolve()
    if not (root/'studio.sqlite3').is_file():raise ValueError('No Studio database')
    if dest.is_relative_to(root):raise ValueError('Backup must be outside source data root')
    if dest.exists():raise ValueError('Refusing to overwrite existing backup')
    dest.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory() as d:
        snapshot=Path(d)/'studio.sqlite3'
        source=sqlite3.connect(str(root/'studio.sqlite3'))
        target=sqlite3.connect(str(snapshot))
        try:
            source.backup(target)
        finally:
            target.close();source.close()
        files={'studio.sqlite3':snapshot.read_bytes()}
        for folder in ('jobs','runs'):
            path=root/folder
            if not path.exists():continue
            for f in sorted(path.rglob('*')):
                if f.is_symlink():raise ValueError('Symlink encountered in data, aborting backup')
                if not f.is_file():continue
                if f.stat().st_size>80*1024*1024:raise ValueError('Oversized artifact: '+str(f))
                name=f.relative_to(root).as_posix()
                files[name]=f.read_bytes()
        manifest={name:{'bytes':len(data),'sha256':sha(data)} for name,data in files.items()}
        report={'schema':'musitu.studio.backup.v1','created_unix':int(time.time()),
                'entries':manifest,'gpu_verified':False}
        with ZipFile(dest,'x',compression=ZIP_DEFLATED,compresslevel=6) as archive:
            for name,data in files.items():archive.writestr(name,data)
            archive.writestr('MANIFEST.json',json.dumps(report,sort_keys=True,indent=2)+'\n')
        return {'file':str(dest),'sha256':sha(dest.read_bytes()),'entries':len(files)}


def check_backup(src):
    with ZipFile(src) as z:
        names=z.namelist()
        if len(names)!=len(set(names)) or 'MANIFEST.json' not in names:
            raise ValueError('Missing manifest or duplicate ZIP entry')
        manifest=json.loads(z.read('MANIFEST.json'))
        if manifest.get('schema')!='musitu.studio.backup.v1':raise ValueError('Unknown backup schema')
        entries=manifest['entries']
        if set(names)!=(set(entries)|{'MANIFEST.json'}):raise ValueError('Backup contents differ from manifest')
        total=0
        for name,info in entries.items():
            parts=Path(name).parts
            if name.startswith('/') or '..' in parts or not parts or name.startswith('\\'):
                raise ValueError('Unsafe ZIP entry path')
            if name!='studio.sqlite3' and parts[0] not in ('jobs','runs'):
                raise ValueError('Unexpected backup file')
            if z.getinfo(name).file_size>80*1024*1024:raise ValueError('Oversized backup entry')
            data=z.read(name)
            total+=len(data)
            if total>2*1024*1024*1024:raise ValueError('Backup exceeds 2 GiB restore ceiling')
            if len(data)!=info['bytes'] or sha(data)!=info['sha256']:
                raise ValueError('Backup integrity mismatch: '+name)
        return {'verified':True,'entries':len(entries),'bytes':total,'manifest':manifest}


def restore_backup(src,dest):
    dest=Path(dest).resolve()
    if dest.exists() and any(dest.iterdir()):raise ValueError('Restore target must be empty')
    verified=check_backup(src)
    dest.mkdir(parents=True,exist_ok=True)
    with ZipFile(src) as z:
        for name in verified['manifest']['entries']:
            target=dest/name
            target.parent.mkdir(parents=True,exist_ok=True)
            with target.open('xb') as dst:dst.write(z.read(name))
    db=sqlite3.connect(str(dest/'studio.sqlite3'))
    try:
        db.execute('BEGIN IMMEDIATE')
        for jid,path in db.execute('SELECT id,input_path FROM jobs').fetchall():
            new=dest/'jobs'/f'{jid}.json'
            if not new.exists():raise ValueError('Missing recovered job: '+jid)
            db.execute('UPDATE jobs SET input_path=? WHERE id=?',(str(new),jid))
        # Treat interrupted jobs as failures, never blindly reexecute after restore.
        db.execute('DELETE FROM sessions')
        db.execute("UPDATE jobs SET state='FAILED',failure='RESTORED_RUNNING_JOB_REQUIRES_NEW_APPROVAL' WHERE state='RUNNING'")
        db.commit()
    except BaseException:
        db.rollback()
        raise
    finally:db.close()
    return {'restored':True,'destination':str(dest),'entries':verified['entries']}


def main():
    p=argparse.ArgumentParser()
    subs=p.add_subparsers(dest='action',required=True)
    x=subs.add_parser('create');x.add_argument('--data',required=True);x.add_argument('--out',required=True)
    x=subs.add_parser('verify');x.add_argument('archive')
    x=subs.add_parser('restore');x.add_argument('archive');x.add_argument('--data',required=True)
    a=p.parse_args()
    if a.action=='create':r=write_backup(a.data,a.out)
    elif a.action=='verify':r=check_backup(a.archive)
    else:r=restore_backup(a.archive,a.data)
    print(json.dumps(r,sort_keys=True,default=str))

if __name__=='__main__':main()
