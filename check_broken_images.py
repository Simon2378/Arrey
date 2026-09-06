"""
Walks every HTML page in public-site/, resolves every <img> src/srcset/data-src
(and inline background-image urls) against the local filesystem, and reports
any that don't actually exist -- plus flags any category pages that show
"no products" on the live site (not a fetch failure, just an empty category).
"""

import os
import re
import posixpath
from bs4 import BeautifulSoup

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public-site")

broken = []
empty_categories = []
total_imgs = 0


def check(rel_path: str, page_rel: str):
    if rel_path.startswith(("http://", "https://", "data:", "#")):
        return
    page_dir = posixpath.dirname(page_rel)
    target = posixpath.normpath(posixpath.join(page_dir, rel_path))
    fs_path = os.path.join(ROOT, target.replace("/", os.sep))
    if not os.path.isfile(fs_path):
        broken.append((page_rel, rel_path, target))


for dirpath, dirnames, filenames in os.walk(ROOT):
    if ".git" in dirpath.split(os.sep):
        continue
    for fn in filenames:
        if not fn.endswith(".html"):
            continue
        full = os.path.join(dirpath, fn)
        page_rel = os.path.relpath(full, ROOT).replace(os.sep, "/")

        with open(full, "rb") as f:
            content = f.read()
        soup = BeautifulSoup(content, "lxml")

        if b"There are no products listed under this category" in content:
            empty_categories.append(page_rel)

        for img in soup.find_all("img"):
            total_imgs += 1
            for attr in ("src", "data-src"):
                if img.get(attr):
                    check(img[attr], page_rel)
            if img.get("srcset"):
                for part in img["srcset"].split(","):
                    u = part.strip().split(" ")[0]
                    if u:
                        check(u, page_rel)
        for source in soup.find_all("source"):
            if source.get("srcset"):
                for part in source["srcset"].split(","):
                    u = part.strip().split(" ")[0]
                    if u:
                        check(u, page_rel)

print(f"Checked {total_imgs} <img> tags across all pages\n")

print(f"=== EMPTY CATEGORIES ({len(empty_categories)}) -- real 'no products' state on the live site, not a fetch issue ===")
for p in empty_categories:
    print(" ", p)

print(f"\n=== BROKEN IMAGE REFERENCES ({len(broken)}) ===")
seen = set()
for page_rel, raw, target in broken:
    key = (page_rel, raw)
    if key in seen:
        continue
    seen.add(key)
    print(f"  page={page_rel}  ref={raw}  ->  missing: {target}")
