"""Generate and check an offline, unsigned 2099 movie-integrity receipt.

This is only a local post-FFprobe artifact-integrity manifest. It cannot prove
Blender authored the scene, camera quality, Cloudflare/provider authenticity,
film contents, signed owner approval, or an actual GPU render. No upload or
network access is performed. Receipt is created atomically, never replaced.
"""
from __future__ import annotations

import hashlib
import json
import os
import pathlib
import re
import stat
import sys
import tempfile

SCHEMA = 'musitu.studio.v03.godmode-local-release.v1'
EXPECTED = {'preview': (360, 640), 'final': (1080, 1920)}
MAX_ASSET_BYTES = 8 * 1024 ** 3
HASH = re.compile(r'^[0-9a-f]{64}$')
RECORD_KEYS = frozenset(('schema', 'mode', 'source_only', 'provider_verified',
    'owner_signature_verified', 'media_probe_authenticated', 'declared_fps',
    'declared_frame_count', 'declared_duration_seconds', 'declared_width',
    'declared_height', 'scene', 'video'))

def no_duplicate_json_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('STUDIO_2099_RECEIPT_DUPLICATE_KEY')
        result[key] = value
    return result


def reject_symlink_path(path: pathlib.Path) -> None:
    """Reject a linked path *component*, not merely a linked leaf filename."""
    p = pathlib.Path(path)
    if '..' in p.parts or any(component.is_symlink() for component in (p, *p.parents)):
        raise ValueError('STUDIO_2099_RECEIPT_SYMLINK_REJECTED')


def verified_file(path: pathlib.Path) -> dict:
    """Stream SHA-256 through a bounded memory buffer, disallowing symlinks."""
    p = pathlib.Path(path)
    reject_symlink_path(p)
    try:
        fd = os.open(p, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) |
                     getattr(os, 'O_CLOEXEC', 0))
        with os.fdopen(fd, 'rb') as stream:
            before = os.fstat(stream.fileno())
            if (not stat.S_ISREG(before.st_mode) or before.st_size < 1 or
                    before.st_size > MAX_ASSET_BYTES):
                raise ValueError('STUDIO_2099_RECEIPT_ASSET_INVALID')
            h = hashlib.sha256()
            total = 0
            while data := stream.read(1024 * 1024):
                h.update(data)
                total += len(data)
                if total > MAX_ASSET_BYTES:
                    raise ValueError('STUDIO_2099_RECEIPT_ASSET_TOO_LARGE')
            after = os.fstat(stream.fileno())
            if total != before.st_size or after.st_size != before.st_size or after.st_mtime_ns != before.st_mtime_ns:
                raise ValueError('STUDIO_2099_RECEIPT_ASSET_MUTATED')
    except OSError:
        raise ValueError('STUDIO_2099_RECEIPT_ASSET_UNREADABLE') from None
    return {'file_name': p.name, 'bytes': total, 'sha256': h.hexdigest()}


def emit(mode: str, scene: pathlib.Path, video: pathlib.Path, receipt: pathlib.Path) -> dict:
    if mode not in EXPECTED:
        raise ValueError('STUDIO_2099_RECEIPT_PRESET_INVALID')
    for file in (scene, video, receipt):
        reject_symlink_path(file)
    if receipt.exists():
        raise ValueError('STUDIO_2099_RECEIPT_EXISTS')
    if receipt.parent != video.parent:
        raise ValueError('STUDIO_2099_RECEIPT_DIRECTORY_INVALID')
    if receipt.name != video.name + '.verified.json':
        raise ValueError('STUDIO_2099_RECEIPT_NAME_INVALID')
    scene_info = verified_file(scene)
    movie_info = verified_file(video)
    width, height = EXPECTED[mode]
    record = {'schema': SCHEMA, 'mode': mode, 'source_only': True,
              'provider_verified': False, 'owner_signature_verified': False,
              'media_probe_authenticated': False, 'declared_fps': 30,
              'declared_frame_count': 360, 'declared_duration_seconds': 12,
              'declared_width': width, 'declared_height': height,
              'scene': scene_info, 'video': movie_info}
    encoded = (json.dumps(record, sort_keys=True, separators=(',', ':')) + '\n').encode('utf8')
    descriptor, temp_path = tempfile.mkstemp(prefix='.musitu_2099_receipt_',
                                            suffix='.tmp', dir=receipt.parent)
    try:
        with os.fdopen(descriptor, 'wb') as f:
            os.fchmod(f.fileno(), 0o600)
            f.write(encoded)
            f.flush()
            os.fsync(f.fileno())
        try:
            os.link(temp_path, receipt)
        except FileExistsError:
            raise ValueError('STUDIO_2099_RECEIPT_EXISTS') from None
    finally:
        pathlib.Path(temp_path).unlink(missing_ok=True)
    return record


def verify(receipt: pathlib.Path, scene: pathlib.Path, video: pathlib.Path) -> bool:
    for file in (receipt, scene, video):
        reject_symlink_path(file)
    if receipt.parent != video.parent:
        raise ValueError('STUDIO_2099_RECEIPT_DIRECTORY_INVALID')
    if receipt.name != video.name + '.verified.json':
        raise ValueError('STUDIO_2099_RECEIPT_NAME_INVALID')
    if not receipt.is_file() or receipt.stat().st_size > 4096:
        raise ValueError('STUDIO_2099_RECEIPT_INVALID')
    try:
        record = json.loads(receipt.read_text(encoding='utf8'), object_pairs_hook=no_duplicate_json_keys)
    except (OSError, ValueError, UnicodeError):
        raise ValueError('STUDIO_2099_RECEIPT_INVALID') from None
    if (not isinstance(record, dict) or set(record) != RECORD_KEYS or
            record.get('schema') != SCHEMA or record.get('mode') not in EXPECTED):
        raise ValueError('STUDIO_2099_RECEIPT_SCHEMA_INVALID')
    width, height = EXPECTED[record['mode']]
    for key, expected in [('source_only', True), ('provider_verified', False),
                          ('owner_signature_verified', False), ('media_probe_authenticated', False),
                          ('declared_fps', 30), ('declared_frame_count', 360), ('declared_duration_seconds', 12),
                          ('declared_width', width), ('declared_height', height)]:
        if type(record.get(key)) is not type(expected) or record[key] != expected:
            raise ValueError('STUDIO_2099_RECEIPT_CONTRACT_INVALID')
    for category, path in [('scene', scene), ('video', video)]:
        described = record.get(category)
        if not isinstance(described, dict) or set(described) != {'file_name', 'bytes', 'sha256'}:
            raise ValueError('STUDIO_2099_RECEIPT_HASH_INVALID')
        if (not isinstance(described['sha256'], str) or not HASH.fullmatch(described['sha256']) or
                type(described['bytes']) is not int):
            raise ValueError('STUDIO_2099_RECEIPT_HASH_INVALID')
        if described != verified_file(path):
            raise ValueError('STUDIO_2099_RECEIPT_HASH_MISMATCH')
    return True


def main(argv: list[str]) -> int:
    if len(argv) == 6 and argv[1] == 'emit':
        emit(argv[2], pathlib.Path(argv[3]), pathlib.Path(argv[4]), pathlib.Path(argv[5]))
        print('STUDIO_2099_LOCAL_RELEASE_RECEIPT_CREATED')
    elif len(argv) == 5 and argv[1] == 'verify':
        verify(pathlib.Path(argv[2]), pathlib.Path(argv[3]), pathlib.Path(argv[4]))
        print('STUDIO_2099_LOCAL_RELEASE_HASHES_MATCH')
    else:
        raise ValueError('STUDIO_2099_RECEIPT_USAGE_INVALID')
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main(sys.argv))
    except (OSError, ValueError) as e:
        print(str(e), file=sys.stderr)
        raise SystemExit(1)
