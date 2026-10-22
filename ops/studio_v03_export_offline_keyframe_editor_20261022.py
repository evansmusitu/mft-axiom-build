#!/usr/bin/env python3
"""Generate a fully offline, single-file Studio scene editor from tracked source.

No network or provider credentials. The generated file deliberately omits
all authenticated staff, job-submission, database and rendering endpoints.
"""
import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / 'musitu_studio' / 'edge' / 'public_v03'
SCENE = ROOT / 'musitu_studio' / 'examples' / 'approved_demo.json'
DEFAULT_FILE = 'MUSITU_STUDIO_V03_OFFLINE_KEYFRAME_ANIMATION_EDITOR.html'


def render() -> str:
    full = (WEB / 'index.html').read_text(encoding='utf-8')
    stylesheet = (WEB / 'studio.css').read_text(encoding='utf-8')
    logic = (WEB / 'scene-preview.mjs').read_text(encoding='utf-8')
    glb = (WEB / 'glb-export.mjs').read_text(encoding='utf-8')
    import_line = "import {parsePreviewScene,poseAtFrame,previewMeshTriangles} from './scene-preview.mjs';"
    if glb.count(import_line) != 1:
        raise ValueError('GLB module imports changed: fail closed')
    glb = glb.replace(import_line, '', 1)
    logic += '\n' + glb
    assert 'http://' not in logic and 'https://' not in logic
    assert '</script' not in logic.lower() and '</style' not in stylesheet.lower()
    start = full.index('<section class="panel" id="editor">')
    end = full.index('<section class="panel" id="jobs">', start)
    editor = full[start:end].strip()
    editor, count = re.subn(r'<form id="job-form"><div class="row">.*?</div><label class="label">Scene JSON',
                            '<form id="job-form"><label class="label">Scene JSON', editor,
                            flags=re.S)
    if count != 1 or editor.count('</form>') != 1:
        raise ValueError('Offline editor extraction layout changed')
    if 'Submit for controlled approval →</button>' not in editor:
        raise ValueError('Submission control changed: fail closed')
    editor = editor.replace('Submit for controlled approval →</button>',
                            'Validate locally (no submission)</button>')
    editor = editor.replace('<span class="chip">CPU ONLY</span>',
                            '<span class="chip">OFFLINE ONLY</span>')
    if 'id="scene-track-set"' not in editor or 'id="scene-undo"' not in editor:
        raise ValueError('Missing offline animation controls')
    demo = json.loads(SCENE.read_text(encoding='utf-8'))
    assert demo.get('schema') == 'musitu.blender.job.v1'
    bootstrap = (
        'document.querySelector("#scene").value=' + json.dumps(json.dumps(demo, indent=2)) + ';\n'
        "document.querySelector('#job-form').addEventListener('submit',event=>{\n"
        ' event.preventDefault();document.querySelector("#offline-submit-status").textContent=\n'
        " 'Offline only. No cloud render or job submission is available.';\n"
        '});')
    page = f'''<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0c1322">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>MUSITU Studio V0.3 — Offline Keyframe Scene Editor</title>
<style>{stylesheet}
.content{{max-width:1000px}}.offline-banner{{background:#213b34;border:1px solid #3b907c;padding:13px 16px;border-radius:12px;margin:18px 0 20px;color:#b5ffed;font-size:13px}}.panel{{margin-bottom:25px}}</style></head>
<body><main class="content"><header><div><div class="eyebrow">MUSITU / ENTERPRISE STUDIO V0.3</div>
<h1>Interactive 3D scene workbench</h1><p class="sub">3D perspective · touch orbit · rotation keyframe editor · Blender declarative scenes</p></div>
<span class="badge">OFFLINE DEMO</span></header>
<div class="offline-banner"><strong>Completely offline.</strong> Nothing here authenticates staff, submits jobs, starts GPU/CPU rendering, contacts a server, or incurs provider charges. This is an isolated scene editor, not the protected production Studio.</div>
{editor}
<div id="offline-submit-status" role="status"></div><footer>Export approved scene JSON for future authenticated Studio submission. No scripts, arbitrary file loads, remote asset loading, or Python execution.</footer>
</main><script>{bootstrap}</script><script type="module">{logic}</script></body></html>'''
    if '<script src=' in page or 'connect-src \'none\'' not in page:
        raise ValueError('Generated scene editor cannot use external sources')
    if len(page.encode('utf-8')) > 131072:
        raise ValueError('Offline editor exceeded safety size cap')
    return page


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=Path(DEFAULT_FILE))
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(render(), encoding='utf-8')
    print(f'STUDIO_OFFLINE_KEYFRAME_EXPORT=PASS bytes={args.output.stat().st_size} path={args.output}')


if __name__ == '__main__':
    main()
