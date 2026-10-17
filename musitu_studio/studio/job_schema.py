"""Untrusted declarative job validator for Blender Studio demo integrations.

This module intentionally uses only the Python standard library. It must run
before importing bpy; it rejects free-form executable code and file paths.
"""
import json
import math
import re
from pathlib import Path

SCHEMA = 'musitu.blender.job.v1'
NAME = re.compile(r'^[A-Za-z][A-Za-z0-9_\-]{0,47}$')
PALETTE = frozenset(('teal', 'copper', 'ivory', 'graphite', 'blueglass', 'rubber', 'wood'))
PRIMITIVES = frozenset(('cube', 'cylinder', 'sphere'))
AXES = frozenset(('X', 'Y', 'Z'))
MAX_JOB_BYTES = 64 * 1024


def _err(msg):
    raise ValueError(msg)


def _fields(value, required, optional, where):
    if type(value) is not dict:
        _err(f'{where} must be an object')
    missing = set(required).difference(value)
    extra = set(value).difference(set(required) | set(optional))
    if missing or extra:
        _err(f'{where}: missing={sorted(missing)}, unsupported={sorted(extra)}')


def _text(s, where):
    if not isinstance(s, str) or not NAME.fullmatch(s):
        _err(f'{where} must be a restricted identifier (1-48 chars)')
    return s


def _num(n, where, min_val, max_val):
    if type(n) not in (int, float) or not math.isfinite(n) or not min_val <= n <= max_val:
        _err(f'{where} must be a finite number in [{min_val}, {max_val}]')
    return n


def _vec3(v, where, lower, upper, positive=False):
    if type(v) is not list or len(v) != 3:
        _err(f'{where} must be a three-element array')
    a = [_num(x, f'{where}[{i}]', lower, upper) for i, x in enumerate(v)]
    if positive and any(x <= 0 for x in a):
        _err(f'{where} dimensions must be positive')
    return a


def validate_job(job):
    _fields(job, ['schema', 'job_id', 'objects'], ['animations', 'frame_end'], 'job')
    if job['schema'] != SCHEMA:
        _err('unsupported schema')
    _text(job['job_id'], 'job_id')
    objects = job['objects']
    if type(objects) is not list or not 1 <= len(objects) <= 30:
        _err('objects must be an array of 1 to 30 objects')
    object_names = set()
    for idx, item in enumerate(objects):
        where = f'objects[{idx}]'
        _fields(item, ['name', 'type', 'location', 'dimensions', 'material'], [], where)
        name = _text(item['name'], f'{where}.name')
        if name in object_names:
            _err('duplicate object name: ' + name)
        object_names.add(name)
        if item['type'] not in PRIMITIVES:
            _err(f'{where}.type unsupported')
        _vec3(item['location'], where + '.location', -20, 20)
        _vec3(item['dimensions'], where + '.dimensions', 0, 12, positive=True)
        if item['material'] not in PALETTE:
            _err(f'{where}.material unsupported')
    frame_end = job.get('frame_end', 24)
    if type(frame_end) is not int or not 2 <= frame_end <= 120:
        _err('frame_end must be an integer between 2 and 120')
    animations = job.get('animations', [])
    if type(animations) is not list or len(animations) > 16:
        _err('animations must be an array of <=16 items')
    seen = set()
    for idx, anim in enumerate(animations):
        where = f'animations[{idx}]'
        _fields(anim, ['object', 'axis', 'degrees', 'start', 'end'], [], where)
        if anim['object'] not in object_names:
            _err(f'{where}.object does not reference an existing object')
        if anim['axis'] not in AXES:
            _err(f'{where}.axis unsupported')
        key = (anim['object'], anim['axis'])
        if key in seen:
            _err(f'{where} duplicates rotation track')
        seen.add(key)
        _num(anim['degrees'], f'{where}.degrees', -720, 720)
        if type(anim['start']) is not int or type(anim['end']) is not int:
            _err(f'{where}.frames must be integers')
        if not 1 <= anim['start'] < anim['end'] <= frame_end:
            _err(f'{where}.frames out of permitted range')
    return job


def load_job(path):
    path = Path(path)
    if path.stat().st_size > MAX_JOB_BYTES:
        _err('job file exceeds 64 KiB')
    # reject duplicate JSON keys instead of silently accepting last-write-wins
    def reject_duplicates(pairs):
        d = {}
        for k, v in pairs:
            if k in d:
                _err('duplicate JSON property: ' + str(k))
            d[k] = v
        return d
    def reject_constant(s):
        _err('non-finite JSON constant not permitted: ' + s)
    job = json.loads(path.read_text(encoding='utf-8'),
                     object_pairs_hook=reject_duplicates, parse_constant=reject_constant)
    validate_job(job)
    return job
