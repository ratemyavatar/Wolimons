#!/usr/bin/env python
"""Build css/discord-widget.css from the 2018 snapshot's Discord widget.

Usage:  python tools/build-discord-widget.py <extracted-snapshot-dir> [outfile]

The 2018 site embedded Discord's own widget in an iframe. That iframe only
renders for a server whose owner has switched the widget on, and shows an
error when they have not - so the page carries a broken box until somebody
flips a setting. We draw the same panel from our own markup instead, and this
lifts the stylesheet that made it look the way it did.

Two things have to change on the way in, and nothing else does:

  - the 2018 web fonts and logo images came from hashed Discord CDN paths that
    stopped existing years ago. Those rules are dropped rather than left to
    fail; a rule whose only job was to paint a missing image is not worth ten
    404s per page load.
  - every rule is scoped. Names like .widget, .widget-body and .spinner are
    far too general to let loose on a site that also renders an admin panel -
    .spinner in particular already means something else here.
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from cssscope import scope_css      # noqa: E402

SCOPE = '.wolimons_discord'


def drop_dead_assets(css):
    """Remove the 2018 fonts, and any declaration pointing at a gone CDN file."""
    css = re.sub(r'@font-face\s*\{[^}]*\}', '', css)

    def clean(match):
        body = re.sub(r'[a-z-]+\s*:[^;{}]*url\([^)]*\)[^;{}]*;?', '', match.group(2))
        return f'{match.group(1)}{{{body}}}' if body.strip() else ''

    return re.sub(r'([^{}]+)\{([^{}]*)\}', clean, css)


BANNER = '''/*
 * Wolimons - the Discord panel.
 *
 * Built by tools/build-discord-widget.py from the widget stylesheet the 2018
 * site embedded, the same way every other piece of this site came out of a
 * snapshot. The 2018 Discord CDN fonts and images are gone, so the rules that
 * only existed to paint them are dropped and the panel inherits the site's
 * own font. Everything is scoped to .wolimons_discord.
 *
 * Do not edit the generated section. Re-run the tool. Additions the 2018
 * sheet had no rule for live at the bottom, below the marker.
 */
'''


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    src = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else 'css/discord-widget.css'

    with open(os.path.join(src, 'f15.css'), encoding='utf-8', errors='replace') as handle:
        raw = handle.read()

    raw = re.sub(r'/\*[\s\S]*?\*/', '', raw)
    scoped = scope_css(drop_dead_assets(raw), SCOPE)

    # Anything hand-written below the marker in an existing file is preserved.
    marker = '/* ---- additions ---- */'
    extra = ''
    if os.path.exists(out):
        with open(out, encoding='utf-8') as handle:
            existing = handle.read()
        if marker in existing:
            extra = '\n' + marker + existing.split(marker, 1)[1]

    with open(out, 'w', encoding='utf-8') as handle:
        handle.write(BANNER + scoped + extra)
    print(f'wrote {out} ({os.path.getsize(out)} bytes)')


if __name__ == '__main__':
    main()
