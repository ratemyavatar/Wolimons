#!/usr/bin/env python3
"""Build the 2018 site from the Wayback snapshots.

Usage:  python3 tools/build-2018.py <extracted-snapshots-dir> [outdir] [version]

The version is the ?v= cache-buster the pages are stamped with; it should be
bumped in step with the rest of the site.

Needs beautifulsoup4 + lxml:  pip install beautifulsoup4 lxml

These pages are not a reskin. Each one is the actual old page: its markup is
lifted out of a snapshot and kept, and only the things that cannot survive the
move are changed.

WHAT COMES OUT
    the Wayback toolbar and its comments, every original <script> (they talked
    to an API that no longer exists), the ad slots, and the cookie banner.

WHAT IS MADE CONSISTENT
    the snapshots were taken across ten months, so their navbars and footers
    disagree with each other - one has a Leaderboard link, another does not.
    Every page gets ONE navbar and ONE footer, both lifted whole out of the
    snapshots, with the entries pointed at routes this site actually serves.

WHAT IS KEPT, AND WHY IT MATTERS
    the repeating pieces - a catalog card, a player card, a table row - are
    moved into <template> elements and their containers emptied. The page
    adapter (assets/js/site2018.js) clones those templates to render live
    data, so every element on screen is the old site's own markup carrying
    today's numbers.
"""
import copy
import os
import re
import shutil
import sys

from bs4 import BeautifulSoup, Comment, NavigableString

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

TITLES = {
    'home': 'Wolimons',
    'catalog': 'Catalog - Wolimons',
    'itemtable': 'Item Table - Wolimons',
    'leaderboard': 'Leaderboard - Wolimons',
    'players': 'Players - Wolimons',
    'item': 'Item - Wolimons',
    'preferences': 'Preferences - Wolimons',
    'projecteds': 'Projected Items - Wolimons',
    'player': 'Player - Wolimons',
    'valuechanges': 'Recent Value Changes - Wolimons',
    'tradecalculator': 'Trade Calculator - Wolimons',
}

# The nav entry that should be lit up on each page.
ACTIVE = {
    'catalog': '/catalog',
    'players': '/players',
    'valuechanges': '/valuechanges',
    'projecteds': '/projecteds',
}

# Old path -> our route. Anything not in here and not one of the /item/,
# /player/ patterns is a page this site does not have, and the link to it goes.
LINK_MAP = {
    '/': '/',
    '/catalog': '/catalog',
    '/itemtable': '/itemtable',
    '/leaderboard': '/leaderboard',
    '/players': '/players',
    '/preferences': '/preferences',
    '/projecteditems': '/projecteds',
    '/deals': '/projecteds',
    '/recent': '/valuechanges',
    '/tradecalculator': '/tradecalculator',
}

DISCORD_INVITE = 'https://discord.gg/vCwRzWSMf'
LOGO = '/assets/Wolimonslogoo.png'

WAYBACK = re.compile(r'https?://web\.archive\.org/web/\d+(?:[a-z]{2}_)?/')
WAYBACK_STATIC = re.compile(r'https?://web-static\.archive\.org/[^"\')\s]*')

# Repeating elements: one is kept as a <template>, the rest are dropped and
# the container is emptied for the adapter to fill.
TEMPLATES = {
    'catalog': [('.catpg_item_cell', 'item')],
    'projecteds': [('.projectionspg_item_cell', 'item')],
    'valuechanges': [('.valuechangespg_item_cell', 'item')],
    'players': [('.playerspg_player_cell', 'player')],
    'leaderboard': [('.item_cell', 'player')],
    'player': [('.playerpg_item_cell', 'item')],
    'itemtable': [('#itemtable_table tbody tr', 'row')],
    'tradecalculator': [('.mix_item', 'item')],
}

# Junk that is in every snapshot and belongs in none of these pages.
DROP_SELECTORS = [
    'script', 'noscript', 'iframe', 'ins', 'link', 'style',
    '.banner_ad', '.mock_banner_ad', '.banner_ad_responsive',
    '[id^="nn_"]', '[id^="aswift"]', '[id^="google_"]', '[id^="div-gpt"]',
    '#wm-ipp', '#wm-ipp-base', '#donato', '#top_notice_div',
    '[class^="app_gdpr"]', '#ccpa-link', '.adsbygoogle',
]


# ---------------------------------------------------------------------------
# Text
# ---------------------------------------------------------------------------

REBRAND = [
    ("Rolimon&#39;s", 'Wolimons'), ("Rolimon's", 'Wolimons'), ('Rolimons', 'Wolimons'),
    ('rolimons.com', 'wolimons'), ('Rolimon', 'Wolimons'), ('rolimons', 'wolimons'),
    ('ROBLOX', 'Wanwood'), ('Roblox', 'Wanwood'), ('roblox.com', 'wanwoo.xyz'),
    ('roblox', 'wanwood'),
]


def rebrand(text):
    """Every name on the page becomes ours. Nothing may say Roblox."""
    for old, new in REBRAND:
        text = text.replace(old, new)
    return text


def rebrand_tree(node):
    """Rename in every text node and in the attributes a reader can see."""
    for string in list(node.find_all(string=True)):
        if isinstance(string, Comment):
            continue
        renamed = rebrand(str(string))
        if renamed != str(string):
            string.replace_with(NavigableString(renamed))
    for element in node.find_all(True):
        for name in ('title', 'alt', 'placeholder', 'aria-label', 'data-original-title'):
            if element.has_attr(name):
                element[name] = rebrand(element[name])


# ---------------------------------------------------------------------------
# Snapshot -> soup
# ---------------------------------------------------------------------------

def snapshot_index(src, folder):
    """The snapshot's own map of URL -> the file it was unpacked into."""
    found = {}
    index = os.path.join(src, folder, 'index.txt')
    if not os.path.exists(index):
        return found
    with open(index, encoding='utf-8', errors='replace') as handle:
        for line in handle:
            parts = line.split()
            if len(parts) >= 4 and parts[-1].startswith(('http', 'cid:')):
                found[parts[-1]] = os.path.join(src, folder, parts[0])
    return found


def page_stylesheet(src, folder, outdir, page_id):
    """The page's own <style> block, which the archive saved as a file.

    Chrome writes a page's inline CSS out as a separate part and links it with
    a cid: URL. Dropping those with the rest of the <link> tags is what left
    the trade calculator's item grid and the profile's inventory grid with no
    layout at all - the rules for them were never in site.css.
    """
    with open(os.path.join(src, folder, 'f0.html'), encoding='utf-8', errors='replace') as handle:
        raw = handle.read()

    parts = re.findall(r'href="(cid:[^"]+)"', raw)
    if not parts:
        return None

    index = snapshot_index(src, folder)
    blocks = []
    for part in parts:
        path_on_disk = index.get(part)
        if not path_on_disk or not os.path.exists(path_on_disk):
            continue
        body = open(path_on_disk, encoding='utf-8', errors='replace').read()
        # The archive's own toolbar has inline CSS too.
        if 'wm-ipp' in body or 'donato' in body:
            continue
        blocks.append(body)

    if not blocks:
        return None

    name = f'page-{page_id}.css'
    with open(os.path.join(outdir, 'css', name), 'w', encoding='utf-8') as handle:
        handle.write(rebrand('\n'.join(blocks)))
    return name


def read_snapshot(src, folder):
    with open(os.path.join(src, folder, 'f0.html'), encoding='utf-8', errors='replace') as handle:
        raw = handle.read()

    # Everything before the archive's own closing marker is the toolbar.
    for marker in ('<!-- End Wayback Rewrite JS Include -->', 'END WAYBACK TOOLBAR INSERT'):
        at = raw.find(marker)
        if at != -1:
            raw = raw[at + len(marker):]

    raw = WAYBACK.sub('', raw)
    raw = WAYBACK_STATIC.sub('', raw)
    # The toolbar's opening comment sits above the marker we cut at, so its
    # closing "-->" is left behind at the top of the page as visible text.
    raw = re.sub(r'^\s*-->', '', raw)
    return BeautifulSoup(raw, 'lxml')


def strip_junk(soup):
    for selector in DROP_SELECTORS:
        for element in soup.select(selector):
            element.decompose()
    for comment in soup.find_all(string=lambda text: isinstance(text, Comment)):
        comment.extract()


def path_of(href):
    """The site-relative path a snapshot href pointed at."""
    href = (href or '').strip()
    if href.startswith(('mailto:', 'javascript:', '#', 'data:')):
        return None
    without_host = re.sub(r'^https?://[^/]*', '', href)
    if not without_host.startswith('/'):
        return None
    return without_host.split('#')[0].split('?')[0].rstrip('/') or '/'


def fragment_of(href):
    """The #part of a link, which the tabs on the item page are built on.

    The chart tabs were saved as full URLs with a fragment - the page's own
    address plus #valuechart - so dropping the fragment along with the rest
    of the URL left every tab pointing at the page and switching nothing.
    """
    at = (href or '').find('#')
    return (href or '')[at:] if at != -1 else ''


def rewrite_links(soup):
    """Point every link at a route this site serves, or take it out.

    A dead link is worse than no link: the old site had pages - videos, hall
    of fame, market activity - that this one does not, and leaving them in
    the navbar was what made the 2018 pages feel broken.
    """
    for anchor in soup.find_all('a'):
        href = anchor.get('href')
        target = path_of(href)
        tail = fragment_of(href)

        if href and 'discord' in href:
            anchor['href'] = DISCORD_INVITE
            anchor['target'] = '_blank'
            anchor['rel'] = 'noopener'
            continue

        if target is None:
            # An in-page anchor or a control; leave it where it is.
            if href is None:
                anchor['href'] = '#'
            continue

        if target in LINK_MAP:
            anchor['href'] = LINK_MAP[target] + tail
        elif target.startswith('/item/'):
            anchor['href'] = f'/item/{tail}' if not tail else tail
        elif target.startswith('/player/'):
            anchor['href'] = f'/player/{tail}' if not tail else tail
        elif target.startswith('/uaid/'):
            # Copy pages: the id is a Wanwood user-asset id, and there is no
            # page here for one. The card keeps its shape, minus the link.
            anchor.unwrap()
        else:
            # A page this site does not have.
            anchor['href'] = '#'
            anchor['data-dead-link'] = ''


def rewrite_images(soup, art=None):
    """Thumbnails become our placeholder; the page's own art is kept.

    Item and avatar thumbnails belong to the game the copy came from, so they
    go and the adapter fetches Wanwood's instead. The site's own pictures -
    the empty trade slot, the remove button - are furniture, and the pages
    look broken without them, so those are saved beside the pages and kept.

    The lazy-loading attributes go too: they still held the old thumbnail
    URLs, which is how a page with no visible mention of the game it came
    from still had it written all over the markup.
    """
    art = art or {}
    for image in soup.find_all('img'):
        for attribute in ('data-src', 'data-img', 'data-original', 'srcset', 'data-srcset'):
            image.attrs.pop(attribute, None)
        src = image.get('src', '')
        if src.startswith('data:'):
            continue
        local = art.get(re.sub(r'^https?://[^/]*', '', src.split('?')[0]))
        image['src'] = local or LOGO
        image['loading'] = 'lazy'


def blank_data(soup):
    """Take the 2018 figures out and leave the shape of them behind.

    The archived pages were saved with a day's real data in them - item names,
    player names, prices - all of it about a different site and a different
    game. Keeping the markup is the point of this build; keeping the numbers
    would mean a reader seeing somebody else's items for the moment before the
    adapter fills them in, and seeing them forever if a fetch fails.

    So every figure is emptied to a dash and every name to nothing. The labels
    stay, because the adapter finds its rows by them.
    """
    for row in soup.select('.d-flex.justify-content-between, .list-group-item'):
        label = row.select_one('small')
        if label is None:
            continue
        figure = row.select_one('p, .card-text')
        if figure is None or figure is label:
            continue
        figure.clear()
        figure.append(NavigableString('-'))

    for title in soup.select('h6.card-title, .item-card-title'):
        title.clear()
        if title.has_attr('title'):
            title['title'] = ''

    for cell in soup.select('#itemtable_table tbody td'):
        link = cell.select_one('a')
        if link is not None:
            link.clear()
        elif not cell.select_one('img, svg'):
            cell.clear()
            cell.append(NavigableString('-'))

    for heading in soup.select('[data-2018="item-title"], [data-2018="player-title"]'):
        # The name is the heading's first piece of text; the adapter replaces
        # it. Anything else loose in there was the whitespace around markup
        # that has been taken out, and printing a second ellipsis after the
        # name is not what it was for.
        first = True
        for node in list(heading.children):
            if not isinstance(node, NavigableString):
                continue
            node.replace_with(NavigableString('\u2026 ' if first else ''))
            first = False

    for image in soup.select('img'):
        if image.get('alt'):
            image['alt'] = ''
        if image.get('title'):
            image['title'] = ''


# ---------------------------------------------------------------------------
# The one navbar and the one footer
# ---------------------------------------------------------------------------

def build_navbar(src):
    """The October 2018 navbar, with the two entries the later one added.

    Both pieces are real markup out of the snapshots - the bar itself from
    /catalog, the extra dropdown entries from the 2019 leaderboard - so this
    invents no HTML, it only decides which of the site's own entries survive.
    """
    catalog = read_snapshot(src, 'catalog')
    strip_junk(catalog)
    nav = catalog.select_one('nav.navbar')

    later = read_snapshot(src, 'leaderboard')
    strip_junk(later)
    menu = nav.select_one('.dropdown-menu')
    first = menu.select_one('.dropdown-item')
    for label, href in (('Leaderboard', '/leaderboard'), ('Trade Calculator', '/tradecalculator')):
        entry = next((a for a in later.select('.dropdown-item')
                      if a.get_text(strip=True) == label), None)
        if entry is None:
            continue
        entry = copy.copy(entry)
        entry['class'] = ['dropdown-item']
        entry['href'] = href
        first.insert_before(entry)

    rewrite_links(nav)
    rewrite_images(nav)
    rebrand_tree(nav)

    # The brand and the gear are the only images in here.
    for image in nav.find_all('img'):
        image['src'] = LOGO
        image['alt'] = 'Wolimons'

    for item in nav.select('li.nav-item'):
        item['class'] = [name for name in item.get('class', []) if name != 'active']

    # The Features toggle is a menu, not a destination: 2018 pointed it at the
    # page it was on, which made it light up as "active" everywhere.
    toggle = nav.select_one('.dropdown-toggle')
    if toggle is not None:
        toggle['href'] = '#'
    return nav


def build_footer(src):
    """The 2018 footer, minus the links to pages this site does not have."""
    home = read_snapshot(src, 'home')
    strip_junk(home)
    footer = home.select_one('footer')

    rows = footer.select('.row')
    if rows:
        # The first row is About / Terms & Privacy / Contact - three pages
        # that were never rebuilt here.
        rows[0].decompose()

    note = footer.select_one('p')
    if note is not None:
        note.clear()
        note.append(NavigableString('Wolimons is the official values and trading site for Wanwood.'))
        note.append(home.new_tag('br'))
        note.append(NavigableString('Copyright \u00a9 Wolimons - a Wanwood fan site'))

    top = footer.select_one('#scroll-to-top')
    if top is not None:
        top['href'] = '#'

    rebrand_tree(footer)
    return footer


def set_active(nav, route):
    """Light up the entry for the page being built.

    A page reached through the Features menu lights the menu instead, so the
    reader can still see where they are.
    """
    for anchor in nav.select('a.nav-link, a.dropdown-item'):
        if 'dropdown-toggle' in anchor.get('class', []):
            continue
        if anchor.get('href') != route:
            continue
        item = anchor.find_parent('li')
        if item is None:
            continue
        item['class'] = list(dict.fromkeys(item.get('class', []) + ['active']))


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------

def extract_templates(soup, page_id):
    """Keep one of each repeating element; empty the container behind it."""
    taken = []
    for selector, name in TEMPLATES.get(page_id, []):
        matches = soup.select(selector)
        if not matches:
            print(f'    ! no match for {selector}')
            continue

        specimen = copy.copy(matches[0])
        container = matches[0].parent
        for match in matches:
            match.decompose()
        if container is not None:
            container['data-2018-container'] = name
        taken.append((name, specimen))
    return taken


# ---------------------------------------------------------------------------
# Per-page repairs
# ---------------------------------------------------------------------------

def label_of(box):
    """The label a 2018 stat row carries, e.g. \"Best Price\"."""
    small = box.select_one('small')
    return small.get_text(strip=True) if small else box.get_text(' ', strip=True)


def drop_rows(soup, selector, labels):
    """Take out the stat rows for figures Wanwood does not have.

    Builders Club is a Roblox idea; Wanwood has no such thing, so a row that
    could only ever read \"-\" is removed rather than left to look broken.
    """
    for box in soup.select(selector):
        if label_of(box) in labels:
            box.decompose()


def rename_label(soup, selector, old, new):
    for box in soup.select(selector):
        small = box.select_one('small') or box
        if small.get_text(strip=True) == old:
            small.string = new


GONE = {'BC Copies', 'BC Owners', 'Favorites', 'Date Discovered'}


def tidy_itemtable(soup):
    """Unpick what DataTables had built when the page was saved.

    The plugin clones the header into a second table and wraps the body in a
    scroller, then writes pixel widths into both. None of that survives being
    re-filled by hand, so the clone goes and the real table comes back out of
    the scroller with its own <thead> doing the job again.
    """
    for clone in soup.select('.dataTables_scrollHead, .dataTables_scrollFoot'):
        clone.decompose()
    for body in soup.select('.dataTables_scrollBody'):
        body.attrs.pop('style', None)
        body.unwrap()
    for scroll in soup.select('.dataTables_scroll'):
        scroll.unwrap()

    table = soup.select_one('#itemtable_table')
    if table is None:
        return
    table.attrs.pop('style', None)
    for cell in table.select('th, td'):
        cell.attrs.pop('style', None)

    # The BC column, out of the header, the footer and every row.
    headers = [cell.get_text(strip=True) for cell in table.select('thead th')]
    doomed = [index for index, name in enumerate(headers) if name in GONE]
    for row in table.select('thead tr, tfoot tr, tbody tr'):
        cells = row.find_all(['th', 'td'], recursive=False)
        for index in reversed(doomed):
            if index < len(cells):
                cells[index].decompose()

    # The filter dropdown offered columns that are gone with it.
    for entry in soup.select('.dropdown-item'):
        if entry.get_text(strip=True) in GONE | {'Sellers', 'Owners', 'Percent Hoarded'}:
            entry.decompose()

    # Column visibility was a DataTables button; there is no plugin to drive.
    holder = soup.select_one('#colvis-button-div')
    if holder is not None:
        column = holder.find_parent(class_=re.compile(r'\bcol-'))
        (column or holder).decompose()


def tidy_item(soup):
    """The item page: hooks for the adapter, and no Builders Club."""
    title = soup.select_one('.item_page_item_info_box h3')
    if title is not None:
        title['data-2018'] = 'item-title'
        offsite = title.select_one('a')
        if offsite is not None:
            offsite['data-2018'] = 'offsite'
            offsite.attrs.pop('data-dead-link', None)

    for image in soup.select('.item_page_item_info_box img'):
        image['data-2018'] = 'item-image'

    drop_rows(soup, '.list-group-item', GONE)
    rename_label(soup, '.list-group-item', 'Deleted Copies', 'Hidden Copies')

    # The owner tabs: 2018 split them into BC owners and hoards. Everyone on
    # Wanwood is an owner, so the first tab is simply the owners.
    for tab in soup.select('.nav-link'):
        if tab.get_text(strip=True) == 'BC Owners':
            tab.string = 'Owners'
    for heading in soup.select('.list-group-item.active'):
        if heading.get_text(strip=True) == 'Ownership':
            heading.string = 'Ownership'

    for pane in ('#bc_owners_table_container', '#hoards_table_container'):
        box = soup.select_one(pane)
        if box is not None:
            box.clear()


RENOTE = [
    ('Player rankings are recalculated every ten minutes. Visit your profile page to update your value',
     'Rankings are worked out from Wanwood\u2019s owner lists, and refresh a few '
     'minutes after a trade goes through.'),
    ('Item details are not updated in real time. Best price and other standard details '
     'are usually updated approximately every half-hour',
     'Best price, RAP and copies come from Wanwood when this page is opened. Value, '
     'demand and trend are set by the Wolimons value team.'),
    ('Certain item details are not updated in real time. Check back in a little while '
     'if something isn\'t updated',
     'This inventory comes from Wanwood as it is now. Value is set by the Wolimons '
     'value team, and the history below is what this site has recorded since the '
     'profile was first opened.'),
]


def renote(soup):
    """Replace the notes that describe how the old site worked.

    They are statements about somebody else's refresh schedule. Leaving them
    on a page that fetches live would be telling readers something untrue.
    """
    for node in soup.find_all(string=True):
        if isinstance(node, Comment):
            continue
        text = str(node).strip()
        for old, new in RENOTE:
            if text.startswith(old[:60]):
                node.replace_with(NavigableString(new))
                break


def tidy_player(soup):
    """The player page: hooks, real buttons, and no Builders Club badge."""
    title = soup.select_one('h3.text-truncate')
    if title is not None:
        title['data-2018'] = 'player-title'
        offsite = title.select_one('a')
        if offsite is not None:
            offsite['data-2018'] = 'offsite'
            offsite.attrs.pop('data-dead-link', None)

    for badge in soup.select('.icon-obc, .icon-bc, .icon-tbc, .icon-default-bc'):
        badge.decompose()

    for button in soup.select('a.btn'):
        label = button.get_text(strip=True)
        if label == 'Trade Ads':
            button['data-2018'] = 'trade-ads'
            button.attrs.pop('data-dead-link', None)
            button.attrs.pop('aria-disabled', None)
        elif label == 'Send Trade':
            button['data-2018'] = 'send-trade'
            button.attrs.pop('data-dead-link', None)
            button.attrs.pop('aria-disabled', None)
        elif label == 'Inventory History':
            # Wanwood keeps no ownership history, so this went from the modern
            # site too rather than being left as a button that explains itself.
            group = button.find_parent(class_='btn-group')
            (group or button).decompose()

    for image in soup.select('.col-md-4 img'):
        image['data-2018'] = 'player-image'

    # Every inventory card carried a link to the old site's own page for that
    # one copy. There is no such page here, so the row goes rather than
    # sitting there as the words "UAID Page" that do nothing.
    for row in soup.select('.playerpg_item_cell .d-flex'):
        if row.get_text(strip=True) == 'UAID Page':
            row.decompose()


def tidy_charts(soup):
    for chart in soup.select('.highcharts-container'):
        chart.decompose()
    for container in soup.select('.item_page_chart_container'):
        container.clear()


def tidy_catalog(soup):
    """No sorting by a column that no longer exists."""
    for entry in soup.select('.dropdown-item'):
        if entry.get_text(strip=True) in {'Least BC Copies', 'Most BC Copies', 'BC Copies'}:
            entry.decompose()
    for row in soup.select('.d-flex.justify-content-between'):
        if label_of(row) == 'BC Copies':
            row.decompose()


def tidy_home(soup):
    """Keep the box the Discord panel goes in.

    2018 put the same panel in twice - one column for wide screens and one
    for phones, each holding an iframe. The iframes are gone with the rest of
    the frames, and an empty div is exactly what the tidy-up at the end of the
    build deletes, which is how the panel ended up with nowhere to mount. One
    column is kept, marked so it survives, and shown at every width.
    """
    columns = []
    for heading in soup.select('h3'):
        if 'discord' in heading.get_text(strip=True).lower():
            column = heading.find_parent(class_=re.compile(r'\bcol-'))
            if column is not None:
                columns.append(column)

    for extra in columns[1:]:
        extra.decompose()
    if not columns:
        return

    column = columns[0]
    column['class'] = [name for name in column.get('class', [])
                       if name not in {'d-none', 'd-sm-block', 'd-block', 'd-sm-none'}]
    box = column.select_one('div')
    if box is None:
        box = soup.new_tag('div')
        column.append(box)
    box['data-2018-container'] = 'discord'


def tidy_preferences(soup):
    """Point the old form at the settings this site actually keeps.

    The checkboxes are the ones prefs.js knows about, named the way the modern
    /preferences page names them, so assets/js/preferences.js drives this page
    too - no second copy of the same wiring.

    The Deals section becomes the theme section. Nothing here is written from
    scratch: it is the section this page already had, saying something else.
    """
    for box in soup.select('input[type="checkbox"]'):
        if box.get('id') == 'hide-tablets-checkbox':
            box['data-pref'] = 'hideTablets'
        elif box.get('id') == 'hide-unobtainables-checkbox':
            box['data-pref'] = 'hideUnobtainables'

    deals = None
    for heading in soup.select('h2'):
        if heading.get_text(strip=True) == 'Deals':
            deals = heading
            break
    if deals is None:
        return

    deals.string = 'Appearance'
    section = deals.parent
    note = soup.new_tag('p')
    note.string = ('The 2018 site is not a coat of paint on this one: these are the pages '
                   'Wolimons had in 2018, rebuilt from archived copies and wired to today\u2019s '
                   'data. Turn this off to go back to the current site.')
    deals.insert_after(note)

    box = section.select_one('input[type="checkbox"]')
    label = section.select_one('label')
    if box is not None:
        box['id'] = 'theme-2018-checkbox'
        box['data-pref'] = 'theme2018'
    if label is not None:
        label['for'] = 'theme-2018-checkbox'
        label.string = 'Use the 2018 site'


TIDY = {
    'home': [tidy_home],
    'itemtable': [tidy_itemtable],
    'item': [tidy_item, tidy_charts],
    'player': [tidy_player, tidy_charts],
    'catalog': [tidy_catalog],
    'preferences': [tidy_preferences],
}


# ---------------------------------------------------------------------------
# Page assembly
# ---------------------------------------------------------------------------

HEAD_CSS = ['bootstrap.css', 'site.css', 'simplepagination.css', 'datatables.css', 'wolimons2018.css']

SCRIPTS = [
    'config.js', 'values.js', 'wanwood-api.js', 'account.js', 'prefs.js',
    'player-roster.js', 'navbar.js', 'site2018.js',
]

# The pages that draw charts get the same chart code the modern site uses.
CHART_SCRIPTS = {'item': True, 'player': True}

# The preferences form is the modern site's, so it uses the modern site's
# editor rather than a second copy of it.
EXTRA_SCRIPTS = {'preferences': ['preferences.js'], 'item': ['acronyms.js']}


def table_templates(src):
    """A real 2018 table, emptied, for the pages whose tables were built by JS.

    The item page's owner lists were drawn by DataTables after the page
    loaded, so the snapshot saved two empty boxes. Rather than write a table
    by hand, the one from the Item Table page is taken and emptied: header
    cell, body cell and shell are all that page's own markup.
    """
    soup = read_snapshot(src, 'item_table')
    strip_junk(soup)
    table = soup.select_one('#itemtable_table')
    if table is None:
        return []

    header = copy.copy(table.select_one('thead th'))
    header.attrs.pop('style', None)
    header['class'] = ['sorting_disabled']
    header.string = ''

    cell = copy.copy(table.select_one('tbody td'))
    cell.attrs.pop('style', None)
    cell.clear()

    shell = copy.copy(table)
    shell.attrs.pop('id', None)
    shell.attrs.pop('style', None)
    for part in shell.select('tfoot'):
        part.decompose()
    for row in shell.select('thead tr, tbody tr'):
        row.clear()
    for row in shell.select('tbody tr'):
        row.decompose()

    return [('table', shell), ('table_head', header), ('table_cell', cell)]

PAGE = '''<!DOCTYPE html>
<html lang="en-US" class="theme-2018">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
<title>{title}</title>
<link rel="icon" type="image/png" href="/assets/Wolimonslogoo.png">
{css}
<script src="/assets/js/theme.js?v=VERSION"></script>
</head>
<body data-page-2018="{page_id}">
{body}
<div class="autocomplete-suggestions" style="position: absolute; display: none; max-height: 300px; z-index: 9999;"></div>
{templates}
{scripts}
</body>
</html>
'''


def save_art(src, folder, outdir):
    """Copy the old site's own pictures next to the pages that use them.

    Returns a map from the URL the markup carries to where the copy now
    lives. Thumbnails are deliberately left out: those are the game's, and
    they are fetched live.
    """
    os.makedirs(os.path.join(outdir, 'img'), exist_ok=True)
    art = {}
    for raw_url, path_on_disk in snapshot_index(src, folder).items():
        if not raw_url.startswith('http') or 'archive.org/_static' in raw_url:
            continue
        # index.txt records the archive's URL; the markup carries the original.
        url = WAYBACK_STATIC.sub('', WAYBACK.sub('', raw_url))
        tail = url.split('?')[0].split('/')[-1]
        if '/images/' not in url or 'thumbs' in url.lower():
            continue
        # Builders Club is a Roblox idea and Wanwood has no equivalent, so
        # its badges and overlays are not carried over.
        if re.search(r'(^|_)(bc|obc|tbc)([_.]|$)', tail.lower()):
            continue
        if 'logo' in tail.lower():
            art[re.sub(r'^https?://[^/]*', '', url.split('?')[0])] = LOGO
            continue
        if not os.path.exists(path_on_disk):
            continue
        shutil.copyfile(path_on_disk, os.path.join(outdir, 'img', tail))
        art[re.sub(r'^https?://[^/]*', '', url.split('?')[0])] = f'/2018/img/{tail}'
    return art


def build_page(src, folder, route, page_id, outdir, navbar, footer,
               extra_templates=(), version='1'):
    soup = read_snapshot(src, folder)
    art = save_art(src, folder, outdir)
    page_css = page_stylesheet(src, folder, outdir, page_id)
    strip_junk(soup)

    body = soup.body
    if body is None:
        raise SystemExit(f'{folder}: no <body>')

    # One navbar, one footer, in place of whatever this snapshot carried.
    for old in body.select('nav.navbar, .header, footer'):
        old.decompose()

    rewrite_links(body)
    rewrite_images(body, art)
    rebrand_tree(body)

    for repair in TIDY.get(page_id, []):
        repair(soup)

    blank_data(body)
    renote(body)

    templates = extract_templates(soup, page_id)
    if page_id in ('item', 'player'):
        templates += list(extra_templates)

    nav = copy.copy(navbar)
    set_active(nav, f'/{route}' if route else '/')
    header = soup.new_tag('div')
    header['class'] = ['header']
    header.append(nav)
    body.insert(0, header)
    body.append(copy.copy(footer))

    # Empty wrappers the removed ads and scripts left behind.
    for element in body.find_all(['div', 'span', 'p']):
        if element.get('id') or element.get('class') or element.get('data-2018-container'):
            continue
        if not element.get_text(strip=True) and not element.find(True):
            element.decompose()

    sheets = list(HEAD_CSS)
    if page_css:
        # The page's own rules come after the shared ones, as they did.
        sheets.insert(sheets.index('wolimons2018.css'), page_css)
    css = '\n'.join(f'<link rel="stylesheet" href="/2018/css/{name}?v=VERSION">' for name in sheets)
    names = list(SCRIPTS)
    if CHART_SCRIPTS.get(page_id):
        # history-chart.js is only here for its loader; the chart itself is
        # the 2018 one, rebuilt from the capture's own SVG.
        names.insert(names.index('site2018.js'), 'history-chart.js')
        names.insert(names.index('site2018.js'), 'chart2018.js')
    for extra in EXTRA_SCRIPTS.get(page_id, []):
        names.insert(names.index('site2018.js'), extra)
    scripts = '\n'.join(f'<script src="/assets/js/{name}?v=VERSION" defer></script>'
                        for name in names)
    template_html = '\n'.join(f'<template id="tpl_{name}">{specimen}</template>'
                              for name, specimen in templates)

    page = PAGE.format(
        title=TITLES[page_id],
        page_id=page_id,
        css=css,
        body=body.decode_contents(),
        templates=template_html,
        scripts=scripts,
    )

    page = page.replace('?v=VERSION', f'?v={version}')

    target = os.path.join(outdir, route) if route else outdir
    os.makedirs(target, exist_ok=True)
    with open(os.path.join(target, 'index.html'), 'w', encoding='utf-8') as handle:
        handle.write(page)
    return os.path.join(target, 'index.html'), len(templates)


# ---------------------------------------------------------------------------
# Stylesheets
# ---------------------------------------------------------------------------

def css_of(src, folder, needle):
    """The snapshot's copy of one stylesheet, found through its index."""
    index = os.path.join(src, folder, 'index.txt')
    if not os.path.exists(index):
        return None
    with open(index, encoding='utf-8', errors='replace') as handle:
        for line in handle:
            if needle in line:
                return os.path.join(src, folder, line.split()[0])
    return None


def rules_in(text):
    """Every top-level selector in a stylesheet, in order, with its block."""
    found = []
    for match in re.finditer(r'([^{}]+)\{([^{}]*)\}', text):
        found.append((match.group(1).strip(), match.group(0)))
    return found


def build_css(src, outdir):
    """The stylesheets the old site served, kept as they were.

    The snapshots span two versions of site.css: the 2018 one knows about the
    card grids, the 2019 one about trade ads and the copies table. Neither is
    a superset, so this is the 2018 file with the later file's own additions
    appended - every rule is theirs, none is written here.
    """
    os.makedirs(os.path.join(outdir, 'css'), exist_ok=True)

    bootstrap = css_of(src, 'home', 'bootswatch')
    shutil.copyfile(bootstrap, os.path.join(outdir, 'css', 'bootstrap.css'))

    early = open(css_of(src, 'home', '/css/site.css'), encoding='utf-8', errors='replace').read()
    late = open(css_of(src, 'leaderboard', '/css/site.css'), encoding='utf-8', errors='replace').read()

    known = {selector for selector, _ in rules_in(early)}
    extra = [block for selector, block in rules_in(late) if selector not in known]
    merged = rebrand(early)
    if extra:
        merged += ('\n\n/* Rules the 2019 stylesheet added, for the pages saved that year. */\n'
                   + rebrand('\n'.join(extra)) + '\n')
    with open(os.path.join(outdir, 'css', 'site.css'), 'w', encoding='utf-8') as handle:
        handle.write(merged)

    pagination = css_of(src, 'catalog', 'simplepagination')
    if pagination:
        shutil.copyfile(pagination, os.path.join(outdir, 'css', 'simplepagination.css'))

    tables = css_of(src, 'item_table', 'datatables.min.css')
    bs4_tables = css_of(src, 'item_table', 'dataTables.bootstrap4')
    with open(os.path.join(outdir, 'css', 'datatables.css'), 'w', encoding='utf-8') as handle:
        for path in (tables, bs4_tables):
            if path:
                handle.write(open(path, encoding='utf-8', errors='replace').read())
                handle.write('\n')


def prune_art(outdir):
    """Drop any saved picture no page ended up asking for."""
    folder = os.path.join(outdir, 'img')
    if not os.path.isdir(folder):
        return
    wanted = set()
    for root, _, files in os.walk(outdir):
        for name in files:
            if not name.endswith('.html'):
                continue
            markup = open(os.path.join(root, name), encoding='utf-8', errors='replace').read()
            wanted.update(re.findall(r'/2018/img/([^"\')\s]+)', markup))
    for name in os.listdir(folder):
        if name not in wanted:
            os.remove(os.path.join(folder, name))


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    src = sys.argv[1]
    outdir = sys.argv[2] if len(sys.argv) > 2 else '2018'
    version = sys.argv[3] if len(sys.argv) > 3 else '1'

    build_css(src, outdir)
    navbar = build_navbar(src)
    footer = build_footer(src)
    tables = table_templates(src)

    built = 0
    for folder, (route, page_id) in PAGES.items():
        if not os.path.isdir(os.path.join(src, folder)):
            print(f'  skipped {folder} - not extracted')
            continue
        path, templates = build_page(src, folder, route, page_id, outdir, navbar, footer,
                                     tables, version)
        print(f'  {path}  ({templates} template{"" if templates == 1 else "s"})')
        built += 1
    prune_art(outdir)
    print(f'{built} pages')


if __name__ == '__main__':
    main()
