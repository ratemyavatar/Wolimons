"""Scope a stylesheet under one selector.

Shared by the snapshot-derived stylesheet builders. Lifting somebody else's
CSS wholesale means lifting generic names with it - .widget, .spinner, .card -
and those will collide with the rest of the site the moment they are loaded.
Scoping every rule to one ancestor is what makes that safe.

The parts that are easy to get wrong, and are handled here:

  - @keyframes and @font-face bodies are NOT selectors. Prefixing "0%" or
    "from" produces invalid CSS and silently kills the animation.
  - @media and @supports wrap further rules, which do need scoping, one level
    further in.
  - @charset and @import are statements, not blocks. A brace scanner glues
    them onto the rule that follows, and that whole rule then escapes scoping.
  - :root and html ARE the scope element; a descendant prefix never matches
    them. Everything else, including body and *, is a descendant.
"""
import re

DEFAULT_SCOPE = 'html.theme-2018'

# Selectors that ARE the root element. Only these collapse onto the scope; a
# descendant prefix would never match them. Everything else - including body
# and * - is a descendant of html and is prefixed normally.
ROOT_SELECTORS = {':root', 'html'}

# Blocks whose contents are not selectors and must be copied through untouched.
VERBATIM_AT_RULES = ('@keyframes', '@-webkit-keyframes', '@-moz-keyframes',
                     '@font-face', '@page', '@counter-style')

# Blocks that wrap more rules, which do need scoping inside.
NESTED_AT_RULES = ('@media', '@supports', '@document')


def split_top_level(css):
    """Yield (kind, text) chunks: at-rules and plain rules, in order."""
    out = []
    depth = 0
    start = 0
    in_string = None
    i = 0
    while i < len(css):
        ch = css[i]
        if in_string:
            if ch == '\\':
                i += 2
                continue
            if ch == in_string:
                in_string = None
        elif ch in '"\'':
            in_string = ch
        elif ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                out.append(css[start:i + 1])
                start = i + 1
        i += 1
    tail = css[start:].strip()
    if tail:
        out.append(tail)
    return out


def scope_selector_list(selectors, SCOPE=DEFAULT_SCOPE):
    """Prefix each comma-separated selector, leaving page-level ones as the scope."""
    parts = []
    for raw in selectors.split(','):
        sel = raw.strip()
        if not sel:
            continue
        if sel in ROOT_SELECTORS:
            parts.append(SCOPE)
            continue
        # "html.foo" and "html > x" hang their own qualifier off the scope.
        if sel == 'html' or sel.startswith(('html.', 'html[', 'html:')):
            parts.append(SCOPE + sel[len('html'):])
        elif sel.startswith('html '):
            parts.append(SCOPE + ' ' + sel[len('html '):])
        else:
            parts.append(SCOPE + ' ' + sel)
    return ', '.join(parts)


def scope_block(chunk, SCOPE=DEFAULT_SCOPE):
    """Scope one top-level chunk."""
    stripped = chunk.lstrip()

    if stripped.startswith(VERBATIM_AT_RULES):
        return chunk

    if stripped.startswith(NESTED_AT_RULES):
        head, _, rest = chunk.partition('{')
        body = rest.rsplit('}', 1)[0]
        inner = ''.join(scope_block(part, SCOPE) for part in split_top_level(body))
        return f'{head.rstrip()} {{\n{inner}\n}}\n'

    if stripped.startswith('@'):
        # Anything else beginning with @ that reached here is unrecognised;
        # dropping it is safer than emitting a rule nobody scoped.
        return ''

    head, _, rest = chunk.partition('{')
    if not rest:
        return ''
    body = rest.rsplit('}', 1)[0]
    return f'{scope_selector_list(head, SCOPE)} {{{body}}}\n'


def strip_statement_at_rules(css):
    """Remove @charset / @import lines.

    They are statements, not blocks, so the brace scanner would glue them onto
    the rule that follows and that whole rule would escape scoping - which is
    exactly how :root once slipped through unscoped and restyled the entire
    site the moment the file loaded.
    """
    return re.sub(r'@(?:charset|import)\b[^;]*;', '', css, flags=re.I)




def scope_css(css, scope):
    """Scope a whole stylesheet. The one function callers need."""
    css = strip_statement_at_rules(css)
    return ''.join(scope_block(chunk, scope) for chunk in split_top_level(css))
