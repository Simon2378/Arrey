"""
Fixes internal links that 404 because they point at pages that were never
part of the live site's actual content (dead cross-links baked into the
original pages, confirmed 404 on txcannabiscompany.com itself, not a
scraping gap). Where a real equivalent page exists it's redirected there;
where none exists the link is removed and the text kept as plain text
rather than guessing a mismatched target.

Usage:
    python fix_dead_links.py
"""

import os
import re
from bs4 import BeautifulSoup

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public-site")

# Fragment names used on the dead /glossary links don't all match the real
# page's anchor ids -- map the ones that differ.
GLOSSARY_FRAGMENT_FIXES = {
    "delta9": "delta-9",
}

SPECIFIC_HREF_FIXES = {
    "how-to-read-coa-s-like-a-pro/index.html": [
        ("../../../blog/how-to-read-a-coa", "/how-to-read-coa-s-like-a-pro/"),
    ],
    "blog/where-to-buy-weed-in-texas/index.html": [
        ("../../../blog/how-to-read-a-coa", "/how-to-read-coa-s-like-a-pro/"),
        ("../../../blog/why-thca-flower-is-legal-in-texas", "/will-thca-hemp-get-you-high-and-is-it-legal-in-my-state/"),
        ("../../../blog/thca-vs-delta-9", None),
        ("../../../blog/texas-thc-vape-rules", None),
    ],
}


def fix_generic_dead_patterns(soup) -> bool:
    """Any search.php link (no working search backend) -> /all-products/.
    Any /glossary link -> the real /cannabis-glossery/ page, fragment kept."""
    changed = False
    for a in soup.find_all("a", href=True):
        href = a["href"]

        if "search.php" in href:
            a["href"] = "/all-products/"
            changed = True
            continue

        m = re.search(r"/glossary(#([a-zA-Z0-9_-]+))?$", href)
        if m:
            fragment = m.group(2)
            if fragment:
                fragment = GLOSSARY_FRAGMENT_FIXES.get(fragment, fragment)
                a["href"] = f"/cannabis-glossery/#{fragment}"
            else:
                a["href"] = "/cannabis-glossery/"
            changed = True

    return changed


def fix_specific_hrefs(soup, edits) -> bool:
    changed = False
    for old_href, new_href in edits:
        for a in soup.find_all("a", href=old_href):
            if new_href is None:
                a.replace_with(a.get_text())
            else:
                a["href"] = new_href
            changed = True
    return changed


def process(rel_path: str, specific_edits):
    full = os.path.join(OUT_DIR, rel_path.replace("/", os.sep))
    with open(full, "rb") as f:
        soup = BeautifulSoup(f.read(), "lxml")

    changed = fix_specific_hrefs(soup, specific_edits)
    changed = fix_generic_dead_patterns(soup) or changed

    if changed:
        with open(full, "w", encoding="utf-8") as f:
            f.write(str(soup))
    return changed


def main():
    changed_files = []
    for rel_path, edits in SPECIFIC_HREF_FIXES.items():
        if process(rel_path, edits):
            changed_files.append(rel_path)

    print(f"Patched {len(changed_files)} file(s):")
    for f in changed_files:
        print(" ", f)


if __name__ == "__main__":
    main()
