"""
Patches known-dead source images (confirmed 404 on BigCommerce's own live
CDN, not recoverable by fetching) with a working local replacement for the
same product, across every page in public-site/.

Currently known dead images:
  - products/166/549/rawlemon__25169.1760389332.png
    -> replaced with products/166/697/lyricallemonadegrape__04594.1764708803.png
       (the only other real photo BigCommerce has for this product)

For src/data-src: point at the best local size we actually downloaded.
For srcset/data-srcset: drop the dead entries entirely (we don't have every
resolution variant for the replacement) so the browser just uses src.

Usage:
    python fix_dead_images.py
"""

import os
import re

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public-site")

DEAD_TO_LOCAL = {
    # any-size rawlemon CDN url -> best local replacement asset (relative path, no leading ../)
    re.compile(r"https://cdn11\.bigcommerce\.com/s-rpcehsuohu/images/stencil/(80w|100x100|590x590)/products/166/549/rawlemon__25169\.1760389332\.png(\?c=1)?"):
        r"assets/cdn11.bigcommerce.com/s-rpcehsuohu/images/stencil/\1/products/166/697/lyricallemonadegrape__04594.1764708803.png",
    # any other size we didn't download locally -> fall back to the 590x590 local copy
    re.compile(r"https://cdn11\.bigcommerce\.com/s-rpcehsuohu/images/stencil/[^/\"]+/products/166/549/rawlemon__25169\.1760389332\.png(\?c=1)?"):
        "assets/cdn11.bigcommerce.com/s-rpcehsuohu/images/stencil/590x590/products/166/697/lyricallemonadegrape__04594.1764708803.png",
    # og:image meta tag (social-share preview crop) -> fall back to the 590x590 local copy
    re.compile(r"https://cdn11\.bigcommerce\.com/s-rpcehsuohu/products/166/images/549/rawlemon__25169\.1760389332\.\d+\.\d+\.png(\?c=1)?"):
        "assets/cdn11.bigcommerce.com/s-rpcehsuohu/images/stencil/590x590/products/166/697/lyricallemonadegrape__04594.1764708803.png",
}


def depth_prefix(rel_path: str) -> str:
    depth = rel_path.count(os.sep)
    return ("../" * depth)


def fix_file(path: str, rel_path: str):
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    original = content
    prefix = depth_prefix(rel_path)

    for pattern, replacement in DEAD_TO_LOCAL.items():
        def _sub(m, replacement=replacement, prefix=prefix):
            local = m.expand(replacement) if "\\1" in replacement else replacement
            return prefix + local
        content = pattern.sub(_sub, content)

    # Drop any leftover srcset/data-srcset lists that still mention the dead file
    # (entries we didn't have a same-size local replacement for)
    def strip_dead_from_srcset(m):
        attr, value = m.group(1), m.group(2)
        parts = [p.strip() for p in value.split(",")]
        kept = [p for p in parts if "rawlemon__25169" not in p]
        if not kept:
            return ""  # drop the attribute entirely
        return f'{attr}="{", ".join(kept)}"'

    content = re.sub(r'(srcset|data-srcset)="([^"]*)"', strip_dead_from_srcset, content)

    if content != original:
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        return True
    return False


def main():
    changed = []
    for dirpath, _dirnames, filenames in os.walk(OUT_DIR):
        if os.sep + ".git" in dirpath or dirpath.endswith(".git"):
            continue
        for fn in filenames:
            if not fn.endswith(".html"):
                continue
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, OUT_DIR)
            if fix_file(full, rel):
                changed.append(rel)

    print(f"Patched {len(changed)} file(s):")
    for c in changed:
        print(" ", c)


if __name__ == "__main__":
    main()
