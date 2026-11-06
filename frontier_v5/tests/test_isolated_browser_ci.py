#!/usr/bin/env python3
"""GitHub-run, loopback-only real Chromium evidence. Not a production/full-stack gate.

No external services, Cloudflare credentials, databases or customer sessions are used.
The production browser policy remains closed to local networks; the opt-in is
used only for a disposable 127.0.0.1 fixture in this test process.
"""
from __future__ import annotations

import argparse
from functools import partial
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import threading
import tempfile

from frontier_v5.runtime.fabric import AuthorizationError, FrontierError
from frontier_v5.runtime.fullstack import ArtifactWorkbench, PlaywrightBrowserAdapter


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def deny(action, exception=AuthorizationError):
    try:
        action()
    except exception:
        return
    raise AssertionError(f"missing expected {exception.__name__} rejection")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--static-only', action='store_true')
    args = parser.parse_args()
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=True)

    # Explicit fixture mode must never become the production browser default.
    deny(lambda: PlaywrightBrowserAdapter({'127.0.0.1'})._allow('http://127.0.0.1/app.html'))
    fixture_browser = PlaywrightBrowserAdapter({'127.0.0.1'}, allow_private=True)
    deny(lambda: fixture_browser._allow('http://untrusted.invalid/app.html'))
    deny(lambda: fixture_browser._allow('file:///etc/passwd'))
    assert fixture_browser.allow_private is True
    if args.static_only:
        print('MUSITU_AXIOM_FRONTIER_BROWSER_STATIC_POLICY_PASS_NOT_CERTIFIED')
        return

    sha = os.environ.get('FRONTIER_SOURCE_HEAD', '')
    run_id = os.environ.get('GITHUB_RUN_ID', '')
    if not re.fullmatch(r'[0-9a-f]{40}', sha) or not re.fullmatch(r'[0-9]{1,20}', run_id):
        raise ValueError('CI evidence requires exact source commit and GitHub run identity')

    with tempfile.TemporaryDirectory(prefix='musitu-frontier-browser-') as d:
        root = Path(d)
        app = ArtifactWorkbench.application(root/'app.html', title='MUSITU Axiom Isolated Browser Fixture')
        app_bytes = (root/'app.html').read_bytes()
        assert app['sha256'] == hashlib.sha256(app_bytes).hexdigest()
        handler = partial(Quiet, directory=str(root))
        server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = f'http://127.0.0.1:{server.server_port}/app.html'
        try:
            screenshot = output/'browser-fixture.png'
            result = fixture_browser.run(url, screenshot_path=screenshot, click_selector='#run', expect_text='42')
            assert result.final_url == url
            assert result.title == 'MUSITU Axiom Isolated Browser Fixture'
            assert result.screenshot_sha256 == hashlib.sha256(screenshot.read_bytes()).hexdigest()
            assert screenshot.read_bytes().startswith(b'\x89PNG\r\n\x1a\n')
            deny(lambda: fixture_browser.run(url, expect_text='never-present'), FrontierError)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)

    evidence = {
        'schema': 'musitu.axiom.frontier.browser-isolated-prequalification.v1',
        'status': 'PASS',
        'scope': 'LOOPBACK_FIXTURE_ONLY_NOT_RELEASE',
        'source_head_sha': sha,
        'github_run_id': run_id,
        'claims': {'full_stack': 'NOT_CERTIFIED', 'production_adapter': 'BLOCKED', 'superiority': 'NOT_CERTIFIED'},
        'checks': {
            'production_default_denies_loopback': True,
            'off_allowlist_and_file_urls_denied': True,
            'isolated_real_chromium_click_and_text': True,
            'negative_missing_expected_text': True,
            'screenshot_png_and_hash': True,
        },
        'fixture_html_sha256': app['sha256'],
        'result_body_text_sha256': result.text_sha256,
        'screenshot_sha256': result.screenshot_sha256,
    }
    (output/'browser-evidence.json').write_text(json.dumps(evidence,sort_keys=True,indent=2)+'\n',encoding='utf-8')
    print('MUSITU_AXIOM_FRONTIER_ISOLATED_BROWSER_PASS_NOT_RELEASE')


if __name__ == '__main__':
    main()
