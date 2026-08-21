#!/usr/bin/env python
"""Build the 2018 site from Wayback snapshots.

Usage:  python tools/build-2018.py <extracted-snapshots-dir> [outdir]

These are not a reskin. Each page here is the actual 2018 page: its markup is
lifted out of the snapshot and kept, and only the things that cannot survive
the move are changed.

What is removed
    the Wayback toolbar, every original <script> (they talked to an API that
    no longer exists), the ad slots and their iframes, and analytics.

What is rewritten
    asset URLs point at the copies extracted beside these pages; links point
    at our routes; and every mention of the site it came from becomes ours.

What is kept, and why it matters
    the repeating pieces - a catalog card, a leaderboard row, a table row -
    are moved into <template> elements and their containers emptied. The page
    adapters then clone those templates to render live data, so every element
    on screen is 2018 markup rather than markup written to imitate it.
"""
import html
import os
import re
import shutil
import sys

# snapshot folder -> (our route, page id used by the adapter)
PAGES = {
    'home': ('', 'home'),
    'catalog': ('catalog', 'catalog'),
    'item_table': ('itemtable', 'itemtable'),
    'leaderboard': ('leaderboard', 'leaderboard'),
    'players': ('players', 'players'),
    'playful_vampire': ('item', 'item'),
    'preferences': ('preferences', 'preferences'),
    'projected_items': ('projecteds', 'projecteds'),
    'roblox': ('player', 'player'),
    'recent_value_changes': ('valuechanges', 'valuechanges'),
    'trade_calculator': ('tradecalculator', 'tradecalculator'),
}

# 2018 path -> our route
LINK_MAP = {
    '/catalog': '/catalog',
    '/itemtable': '/itemtable',
    '/leaderboard': '/leaderboard',
    '/players': '/players',
    '/preferences': '/preferences',
    '/projecteditems': '/projecteds',
    '/recent': '/valuechanges',
    '/tradecalculator': '/tradecalculator',
    '/deals': '/projecteds',
    '/faq': '/preferences',
}

WAYBACK = re.compile(r'https?://web\.archive\.org/web/\d+(?:[a-z]{2}_)?/')
WAYBACK_STATIC = re.compile(r'https?://web-static\.archive\.org/[^"\')\s]*')

# Repeating elements worth keeping one of, as a template for the adapter.
TEMPLATES = {
    'catalog': [('[data-ref="item"]', 'item')],
    'projecteds': [('[data-ref="item"]', 'item')],
    'itemtable': [('#itemtable_table tbody tr', 'row')],
    'leaderboard': [('#leaderboard_table tbody tr', 'row'), ('[data-ref="player"]', 'player')],
    'players': [('[data-ref="player"]', 'player')],
    'valuechanges': [('#recent_table tbody tr', 'row'), ('[data-ref="item"]', 'item')],
}


def strip_wayback(markup):
    """Take the archive's own furniture back out."""
    for marker in ('<!-- End Wayback Rewrite JS Include -->', 'END WAYBACK TOOLBAR INSERT'):
        at = markup.find(marker)
        if at != -1:
            markup = markup[at + len(marker):]
    markup = re.sub(r'<!--\s*BEGIN WAYBACK TOOLBAR INSERT\s*-->[\s\S]*?'
                    r'<!--\s*END WAYBACK TOOLBAR INSERT\s*-->', '', markup)
    markup = re.sub(r'<div id="wm-ipp[\s\S]*?</div>\s*(?=<)', '', markup, count=1)
    # Strip the archive prefix entirely rather than leaving a '/' in front of
    # the original absolute URL - that produced hrefs like "/https://...".
    markup = WAYBACK.sub('', markup)
    markup = WAYBACK_STATIC.sub('', markup)
    return markup


def strip_noise(markup):
    """Scripts, ads and tracking pixels - none of which can work here."""
    markup = re.sub(r'<script[\s\S]*?</script>', '', markup, flags=re.I)
    markup = re.sub(r'<noscript[\s\S]*?</noscript>', '', markup, flags=re.I)
    markup = re.sub(r'<iframe[\s\S]*?</iframe>', '', markup, flags=re.I)
    markup = re.sub(r'<ins[\s\S]*?</ins>', '', markup, flags=re.I)
    markup = re.sub(r'<div class="banner_ad"[\s\S]*?</div>', '', markup, count=0)
    markup = re.sub(r'<div class="mock_banner_ad"[^>]*>\s*</div>', '', markup)
    markup = re.sub(r'<link[^>]*(?:googlesyndication|doubleclick|google-analytics)[^>]*>', '', markup, flags=re.I)
    return markup


def rebrand(markup):
    """Every name on the page becomes ours."""
    pairs = [
        (r"Rolimon&#39;s", 'Wolimons'), (r"Rolimon's", 'Wolimons'), (r'Rolimons', 'Wolimons'),
        (r'rolimons\.com', 'wolimons'), (r'rolimons', 'wolimons'),
        (r'ROBLOX', 'Wanwood'), (r'Roblox', 'Wanwood'), (r'roblox\.com', 'wanwoo.xyz'),
        (r'roblox', 'wanwood'),
    ]
    for pattern, replacement in pairs:
        markup = re.sub(pattern, replacement, markup)
    return markup


def rewrite_links(markup):
    """Point the navigation and images at our routes and assets.

    Runs BEFORE rebranding, while the hostnames are still the ones the
    snapshot recorded - renaming the site first turns rolimons.com into a
    string this can no longer recognise as a host.
    """
    def fix(match):
        quote, href = match.group(1), match.group(2)
        path = re.sub(r'^https?://[^/]*', '', href) or '/'
        path = path.split('#')[0].split('?')[0].rstrip('/') or '/'
        if path in LINK_MAP:
            return f'href={quote}{LINK_MAP[path]}{quote}'
        if path in ('/', ''):
            return f'href={quote}/{quote}'
        if path.startswith('/item/'):
            return f'href={quote}/item/{quote}'
        if path.startswith('/player/'):
            return f'href={quote}/player/{quote}'
        return f'href={quote}{href}{quote}'
    markup = re.sub(r'href=(["\'])([^"\']*)\1', fix, markup)

    def fix_src(match):
        quote, src = match.group(1), match.group(2)
        if src.startswith('data:'):
            return match.group(0)
        path = re.sub(r'^https?://[^/]*', '', src)
        if 'thumbs/asset.ashx' in src or '/images/logo' in path:
            return f'src={quote}/assets/Wolimonslogoo.png{quote}'
        if path.startswith('/'):
            return f'src={quote}{path}{quote}'
        return match.group(0)

    return re.sub(r'src=(["\'])([^"\']*)\1', fix_src, markup)


def extract_templates(markup, page_id):
    """Move one of each repeating element into a <template>, empty the rest.

    Crude on purpose: a real parser is not available here, so this finds the
    first element carrying the marker attribute and takes it whole by counting
    tags. What comes out is exactly the 2018 element, which is the point.
    """
    templates = []
    for selector, name in TEMPLATES.get(page_id, []):
        marker = None
        if 'data-ref=' in selector:
            marker = selector.strip('[]')
        if not marker:
            continue

        start = markup.find(f'<div class=', markup.find(marker))
        if start == -1:
            continue
        # walk back to the opening '<' of the element carrying the marker
        opening = markup.rfind('<', 0, markup.find(marker))
        if opening == -1:
            continue
        depth = 0
        i = opening
        end = -1
        while i < len(markup):
            if markup.startswith('<div', i):
                depth += 1
            elif markup.startswith('</div>', i):
                depth -= 1
                if depth == 0:
                    end = i + len('</div>')
                    break
            i += 1
        if end == -1:
            continue
        specimen = markup[opening:end]
        templates.append((name, specimen))
        # remove every sibling that carries the same marker
        markup = re.sub(
            r'<div[^>]*' + re.escape(marker) + r'[\s\S]*?(?=<div[^>]*' + re.escape(marker) + r'|</div>\s*</div>)',
            '', markup)
    return markup, templates


def build_page(src, folder, route, page_id, outdir, assets):
    with open(os.path.join(src, folder, 'f0.html'), encoding='utf-8', errors='replace') as handle:
        raw = handle.read()

    markup = strip_wayback(raw)
    markup = strip_noise(markup)

    body = re.search(r'<body[^>]*>([\s\S]*)</body>', markup)
    body_html = body.group(1) if body else markup

    body_html = rewrite_links(body_html)
    body_html = rebrand(body_html)
    body_html, templates = extract_templates(body_html, page_id)

    # point every image at whatever we saved locally
    for original, local in assets.items():
        body_html = body_html.replace(original, local)
    body_html = re.sub(r'src="[^"]*thumbs/asset\.ashx[^"]*"', 'src="/assets/Wolimonslogoo.png"', body_html)

    title = {
        'home': 'Wolimons', 'catalog': 'Catalog - Wolimons', 'itemtable': 'Item Table - Wolimons',
        'leaderboard': 'Leaderboard - Wolimons', 'players': 'Players - Wolimons',
        'item': 'Item - Wolimons', 'preferences': 'Preferences - Wolimons',
        'projecteds': 'Projected Items - Wolimons', 'player': 'Player - Wolimons',
        'valuechanges': 'Recent Value Changes - Wolimons',
        'tradecalculator': 'Trade Calculator - Wolimons',
    }[page_id]

    template_html = '\n'.join(
        f'<template id="tpl_{name}">{specimen}</template>' for name, specimen in templates)

    page = f'''<!DOCTYPE html>
<html lang="en-US" class="theme-2018">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
<title>{title}</title>
<link rel="icon" type="image/png" href="/assets/Wolimonslogoo.png">
<link rel="stylesheet" href="/2018/css/bootstrap.css?v=VERSION">
<link rel="stylesheet" href="/2018/css/site.css?v=VERSION">
<link rel="stylesheet" href="/2018/css/wolimons2018.css?v=VERSION">
</head>
<body data-page-2018="{page_id}">
{body_html}
{template_html}
<script src="/assets/js/config.js?v=VERSION"></script>
<script src="/assets/js/values.js?v=VERSION"></script>
<script src="/assets/js/wanwood-api.js?v=VERSION"></script>
<script src="/assets/js/account.js?v=VERSION"></script>
<script src="/assets/js/prefs.js?v=VERSION"></script>
<script src="/assets/js/theme.js?v=VERSION"></script>
<script src="/assets/js/site2018.js?v=VERSION" defer></script>
</body>
</html>
'''

    target = os.path.join(outdir, route) if route else outdir
    os.makedirs(target, exist_ok=True)
    with open(os.path.join(target, 'index.html'), 'w', encoding='utf-8') as handle:
        handle.write(page)
    return os.path.join(target, 'index.html'), len(templates)


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    src = sys.argv[1]
    outdir = sys.argv[2] if len(sys.argv) > 2 else '2018'

    os.makedirs(os.path.join(outdir, 'css'), exist_ok=True)

    # The two stylesheets the 2018 site served, kept verbatim - these pages
    # are 2018 pages, so they get 2018 CSS with nothing scoped or layered.
    home = os.path.join(src, 'home')
    shutil.copyfile(os.path.join(home, 'f5.css'), os.path.join(outdir, 'css', 'bootstrap.css'))
    with open(os.path.join(home, 'f4.css'), encoding='utf-8', errors='replace') as handle:
        site = rebrand(handle.read())
    with open(os.path.join(outdir, 'css', 'site.css'), 'w', encoding='utf-8') as handle:
        handle.write(site)

    assets = {'/images/logo-56x56.png': '/assets/Wolimonslogoo.png'}

    built = 0
    for folder, (route, page_id) in PAGES.items():
        if not os.path.isdir(os.path.join(src, folder)):
            print(f'  skipped {folder} - not extracted')
            continue
        path, templates = build_page(src, folder, route, page_id, outdir, assets)
        print(f'  {path}  ({templates} template{"" if templates == 1 else "s"})')
        built += 1
    print(f'{built} pages')


if __name__ == '__main__':
    main()
