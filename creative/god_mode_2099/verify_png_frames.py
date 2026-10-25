"""Offline 2099 pre-encoder PNG frame-header guard; no image decoding/provider access.

Verifies exact 360 filename set, nonlinked regular files, PNG IHDR CRC,
expected dimensions, and bounded raster metadata. FFmpeg remains responsible
for validating the compressed PNG body during actual encoding.
"""
from __future__ import annotations

import os
import pathlib
import stat
import struct
import sys
import zlib

PNG_SIG = b'\x89PNG\r\n\x1a\n'
FRAMES = 360
PRESETS = {'preview': (360, 640), 'final': (1080, 1920)}


def verify_frame_headers(mode: str, folder: pathlib.Path) -> dict:
    if mode not in PRESETS:
        raise ValueError('STUDIO_2099_PRESET_INVALID')
    root = pathlib.Path(folder)
    if not root.is_dir() or root.is_symlink():
        raise ValueError('STUDIO_2099_FRAME_DIRECTORY_INVALID')
    names = {p.name for p in root.glob('frame_*.png')}
    expected = {f'frame_{index:04d}.png' for index in range(1, FRAMES + 1)}
    if names != expected:
        raise ValueError('STUDIO_2099_PNG_FRAME_SET_INCOMPLETE')
    flags = os.O_RDONLY | getattr(os, 'O_CLOEXEC', 0) | getattr(os, 'O_NOFOLLOW', 0)
    for index in range(1, FRAMES + 1):
        p = root / f'frame_{index:04d}.png'
        if p.is_symlink():
            raise ValueError('STUDIO_2099_PNG_LINK_REJECTED')
        try:
            fd = os.open(p, flags)
            try:
                if not stat.S_ISREG(os.fstat(fd).st_mode):
                    raise ValueError('STUDIO_2099_PNG_NOT_REGULAR')
                head = os.read(fd, 33)
            finally:
                os.close(fd)
        except OSError:
            raise ValueError('STUDIO_2099_PNG_READ_FAILED') from None
        if len(head) != 33 or head[:8] != PNG_SIG or head[8:16] != b'\x00\x00\x00\x0dIHDR':
            raise ValueError('STUDIO_2099_PNG_HEADER_INVALID')
        if struct.unpack('>I', head[29:33])[0] != zlib.crc32(head[12:29]):
            raise ValueError('STUDIO_2099_PNG_IHDR_CRC_INVALID')
        width, height, bits, colour, comp, filt, interlace = struct.unpack('>IIBBBBB', head[16:29])
        if (width, height) != PRESETS[mode]:
            raise ValueError('STUDIO_2099_PNG_DIMENSIONS_MISMATCH')
        if bits not in (8, 16) or colour not in (2, 6) or (comp, filt) != (0, 0) or interlace not in (0, 1):
            raise ValueError('STUDIO_2099_PNG_ENCODING_INVALID')
    return {'verified_headers': FRAMES, 'width': PRESETS[mode][0], 'height': PRESETS[mode][1],
            'compressed_pixels_decoded': False, 'provider_verified': False}


def main() -> int:
    if len(sys.argv) != 3:
        raise ValueError('Usage: verify_png_frames.py MODE FRAME_DIRECTORY')
    value = verify_frame_headers(sys.argv[1], pathlib.Path(sys.argv[2]))
    print(f'STUDIO_2099_PNG_HEADERS_VERIFIED {value["verified_headers"]} {value["width"]}x{value["height"]}')
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
