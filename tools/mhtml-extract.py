#!/usr/bin/env python
"""Unpack a Chrome "Save as .mhtml" snapshot into a directory of loose files.

Usage:  python tools/mhtml-extract.py <snapshot> <outdir>

Every part of the multipart archive is written out as f<N>.<ext>, and an
index.txt maps those filenames back to the URL each part came from. Quoted
printable and base64 parts are decoded; everything else is copied verbatim.
"""
import email
import os
import sys
from email import policy


def ext_for(ctype, location):
    tail = location.split('?')[0].rsplit('/', 1)[-1]
    if '.' in tail:
        guess = tail.rsplit('.', 1)[-1].lower()
        if 0 < len(guess) <= 5 and guess.isalnum():
            return guess
    return {
        'text/html': 'html',
        'text/css': 'css',
        'text/javascript': 'js',
        'application/javascript': 'js',
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/gif': 'gif',
        'image/webp': 'webp',
        'image/svg+xml': 'svg',
        'font/woff2': 'woff2',
        'font/woff': 'woff',
    }.get(ctype, 'bin')


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    src, outdir = sys.argv[1], sys.argv[2]
    os.makedirs(outdir, exist_ok=True)

    with open(src, 'rb') as fh:
        msg = email.message_from_binary_file(fh, policy=policy.default)

    parts = msg.walk() if msg.is_multipart() else [msg]
    index = []
    n = 0
    for part in parts:
        if part.get_content_maintype() == 'multipart':
            continue
        ctype = part.get_content_type()
        location = part.get('Content-Location', '')
        name = 'f%d.%s' % (n, ext_for(ctype, location))
        try:
            body = part.get_payload(decode=True)
        except Exception:
            body = None
        if body is None:
            body = str(part.get_payload()).encode('utf-8', 'replace')
        with open(os.path.join(outdir, name), 'wb') as out:
            out.write(body)
        index.append('%-14s %-28s %d bytes  %s' % (name, ctype, len(body), location))
        n += 1

    with open(os.path.join(outdir, 'index.txt'), 'w') as out:
        out.write('\n'.join(index) + '\n')
    print('\n'.join(index))


if __name__ == '__main__':
    main()
