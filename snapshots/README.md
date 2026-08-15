# snapshots

Saved copies of the original Rolimon's / Koromon's / Colimons pages, in MHTML
format (a whole webpage saved as one file, images and all).

**These are reference material, not part of the site.** Nothing here is
served and nothing loads them. The site works fine if this whole folder is
deleted.

They're kept because every page in the site was rebuilt from them, so when I
add a page I open the matching one to copy the real HTML and CSS instead of
guessing at the layout.

They're most of the download size. If I ever want a smaller ZIP, this is the
folder to drop.

To open one, drag it into Chrome or Edge. Firefox doesn't do MHTML without an
add-on.

| File | Page it shows |
|---|---|
| `Koromon's` | homepage |
| `Koromon's Item Catalog` | item catalog |
| `Dominus Empyreus \| Roblox Limited Item - Rolimon's` | item detail page |
| `Richest Pekora Players Leaderboard - Koromon's` | leaderboard |
| `Leaderboard - Colimons` | leaderboard, other layout |
| `Colimons - Player Profile` | player profile |
| `Roblox \| Roblox Player Profile - Rolimon's` | player profile, other layout |
| `Colimons - Trade Calculator` | trade calculator |
| `Roblox Trade Calculator \| Rolimon's` | trade calculator, other layout |
| `Tradeads.mhtml.roblox trade ads _ rolimon's` | trade ads list |
| `Tradeadsdetailpage.roblox trade ad 91569542 - rolimon's` | one trade ad |
| `KoroBadges - Koromon's` | badges |
| `Koromon's Account Verification` | account verification |
| `Site Preferences - Koromon's` | site preferences |

Git is told to leave these alone (`-text` in `.gitattributes`). They contain
base64 binary with CRLF endings, and if Git "fixes" the line endings the
embedded images break.
