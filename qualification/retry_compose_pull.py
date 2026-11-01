"""Bounded retries for transient Docker registry pulls in isolated qualification.

Never ignores failed images, changes tags, or starts production containers.
Registry credential/authentication errors are terminal.
"""
from __future__ import annotations

import argparse
import subprocess
import time
from typing import Callable

_TRANSIENT = (
    'context deadline exceeded', 'tls handshake timeout',
    'client.timeout exceeded', 'connection reset by peer',
    'unexpected eof', 'i/o timeout', '502 bad gateway',
    '503 service unavailable', 'too many requests',
)


def pull_qualified_images(*, compose_file: str,
                          runner: Callable = subprocess.run,
                          sleeper: Callable = time.sleep) -> int:
    if not isinstance(compose_file, str) or not compose_file.strip():
        raise ValueError('qualify_compose_path_required')
    command = ['docker', 'compose', '-f', compose_file, 'pull', '--quiet']
    for attempt in range(1, 5):
        try:
            result = runner(command, capture_output=True, text=True, timeout=210, check=False)
        except subprocess.TimeoutExpired as exc:
            reason = 'context deadline exceeded'
        else:
            if result.returncode == 0:
                return attempt
            reason = str(result.stderr or result.stdout or '').lower()
        if not any(fragment in reason for fragment in _TRANSIENT):
            raise RuntimeError('qualification_image_pull_failed_nontransient')
        if attempt == 4:
            raise RuntimeError('qualification_image_pull_failed_after_retries')
        sleeper(attempt * 8)
    raise AssertionError('unreachable')


def main() -> None:
    parser=argparse.ArgumentParser(description='Bounded Docker Hub retry, fails closed')
    parser.add_argument('--compose-file', required=True)
    args=parser.parse_args()
    tries=pull_qualified_images(compose_file=args.compose_file)
    print(f'QUALIFICATION_EXACT_IMAGE_PULL=PASS;ATTEMPTS={tries}')


if __name__ == '__main__':
    main()
