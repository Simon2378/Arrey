"""
Turns the raw scrape in site-backup/ into a clean, self-contained static
site in public-site/, ready to push to GitHub (e.g. GitHub Pages):

  - Internal links and image/CSS references are rewritten to point at the
    local downloaded copies (relative paths), so pages render correctly
    without needing the old BigCommerce account or live CDN.
  - The Sign In / Register links are removed from every page's header nav.
  - The "Can Use Coupon" price badges are removed from product listings.
  - Truly external resources (Google Fonts, analytics, recaptcha, the
    BigCommerce checkout SDK, etc.) are left as absolute URLs since they
    are third-party services, not this site's own content.

Note: this produces a static copy of the *storefront pages* only. Add to
Cart / Checkout still point at the original txcannabiscompany.com, since a
static export has no e-commerce backend (no database, no payment
processing) to actually process orders -- that would require a real store
platform behind it.

Usage:
    python build_public_site.py
"""

import json
import os
import posixpath
import re
import shutil
import urllib.parse as urlparse

from bs4 import BeautifulSoup

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.join(ROOT, "site-backup")
MANIFEST_PATH = os.path.join(SRC_DIR, "manifest.json")
OUT_DIR = os.path.join(ROOT, "public-site")
CUSTOM_ASSETS_DIR = os.path.join(ROOT, "custom-assets")
CUSTOM_ASSET_FILES = ["cart.js", "cart.css", "payment-config.js"]

REWRITE_ATTRS = {
    "a": ["href"],
    "img": ["src", "data-src"],
    "source": ["srcset"],
    "link": ["href"],
}


def to_posix(p: str) -> str:
    return p.replace("\\", "/")


def normalize(url: str) -> str:
    parsed = urlparse.urlsplit(url)
    return urlparse.urlunsplit(("https", parsed.netloc, parsed.path, parsed.query, ""))


def decode_path(p: str) -> str:
    """Undo percent-encoding in each path segment so the file we save to
    disk has a normal name (e.g. 'thc%20concentrates.png' -> 'thc concentrates.png').
    BigCommerce's own URLs percent-encode spaces/parens in image filenames;
    saving the encoded string as the literal filename means a real browser
    request (which the server percent-decodes before the filesystem lookup)
    can never find it."""
    return "/".join(urlparse.unquote(seg) for seg in p.split("/"))


def encode_path(p: str) -> str:
    """Inverse of decode_path, for writing into href/src attributes: percent-encode
    each path segment so the browser sends a valid, correctly round-trippable URL."""
    return "/".join(urlparse.quote(seg) for seg in p.split("/"))


def build_url_map(manifest: dict) -> dict:
    url_map = {}
    for entry in manifest["pages"]:
        local = to_posix(entry["local_path"])
        assert local.startswith("pages/")
        new_rel = local[len("pages/"):]
        url_map[normalize(entry["url"])] = new_rel
    for entry in manifest["assets"]:
        local = to_posix(entry["local_path"])
        url_map[normalize(entry["url"])] = decode_path(local)
    return url_map


def rel_from(current_new_rel: str, target_new_rel: str) -> str:
    current_dir = posixpath.dirname(current_new_rel)
    rel = posixpath.relpath(target_new_rel, start=current_dir or ".")
    return encode_path(rel)


def strip_theme_cart_preview_hook(soup: BeautifulSoup):
    """The original BigCommerce theme JS (theme-bundle.main.js, still loaded from
    the live CDN) wires an AJAX cart-preview fetch onto any element carrying
    data-cart-preview -- it fetches cart HTML from the (nonexistent, on a static
    export) backend and dumps whatever it gets back (our server's 404 page)
    into #cart-preview-dropdown, overwriting our own cart.js render right after
    it runs. Removing the attribute stops the theme JS from recognizing this as
    a cart-preview trigger, leaving cart.js as the only thing that responds."""
    for tag in soup.find_all(attrs={"data-cart-preview": True}):
        del tag["data-cart-preview"]


def strip_login_register(soup: BeautifulSoup):
    login_anchors = soup.find_all("a", href=lambda h: h and "login.php" in h)
    seen_li = set()
    for a in login_anchors:
        li = a.find_parent("li")
        target = li if li is not None else a
        if id(target) in seen_li:
            continue
        seen_li.add(id(target))
        target.decompose()


def strip_coupon_badges(soup: BeautifulSoup):
    for span in soup.find_all("span", class_="price-label"):
        if span.get_text(strip=True).lower() == "can use coupon":
            span.decompose()


# Third-party scripts that inject their own popups/widgets server-side, controlled
# from an account we don't have access to (e.g. Klaviyo's "sign up for a coupon"
# email-capture popup). Static HTML can't disable these from our side -- the
# script itself decides what to show -- so the only real fix is not loading them.
POPUP_SCRIPT_HOST_MARKERS = (
    "static.klaviyo.com",
    "elfsightcdn.com",
)


def strip_marketing_popups(soup: BeautifulSoup):
    for script in soup.find_all("script", src=True):
        if any(marker in script["src"] for marker in POPUP_SCRIPT_HOST_MARKERS):
            script.decompose()


PAYMENT_BADGES = [
    ("bitcoin", "Bitcoin"),
    ("cashapp", "Cash App"),
    ("chime", "Chime"),
    ("usdt", "USDT"),
]


def replace_payment_icons(soup: BeautifulSoup):
    container = soup.find("div", class_="footer-payment-icons")
    if not container:
        return
    container.clear()
    for slug, label in PAYMENT_BADGES:
        span = soup.new_tag("span", **{"class": f"footer-payment-icon footer-payment-badge footer-payment-badge--{slug}"})
        span.string = label
        container.append(span)


def inject_custom_assets(soup: BeautifulSoup, new_rel: str):
    prefix = "../" * new_rel.count("/")

    head = soup.find("head")
    if head:
        link = soup.new_tag("link", rel="stylesheet", href=f"{prefix}cart.css")
        head.append(link)

    body = soup.find("body")
    if body:
        for fname in ("payment-config.js", "cart.js"):
            script = soup.new_tag("script", src=f"{prefix}{fname}")
            body.append(script)


def rewrite_srcset(value: str, page_url: str, url_map: dict, current_new_rel: str) -> str:
    parts = []
    for chunk in value.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        bits = chunk.split(" ")
        raw_url = bits[0]
        descriptor = " ".join(bits[1:])
        abs_url = normalize(urlparse.urljoin(page_url, raw_url))
        if abs_url in url_map:
            new_url = rel_from(current_new_rel, url_map[abs_url])
        else:
            new_url = raw_url
        parts.append(f"{new_url} {descriptor}".strip())
    return ", ".join(parts)


def process_page(page_url: str, local_html_path: str, new_rel: str, url_map: dict):
    with open(local_html_path, "rb") as f:
        soup = BeautifulSoup(f.read(), "lxml")

    strip_login_register(soup)
    strip_coupon_badges(soup)
    strip_marketing_popups(soup)
    strip_theme_cart_preview_hook(soup)
    replace_payment_icons(soup)

    for tag_name, attrs in REWRITE_ATTRS.items():
        for tag in soup.find_all(tag_name):
            for attr in attrs:
                if not tag.get(attr):
                    continue
                if tag_name in ("img", "source") and attr == "srcset":
                    tag[attr] = rewrite_srcset(tag[attr], page_url, url_map, new_rel)
                    continue
                raw_val = tag[attr]
                if raw_val.startswith(("#", "mailto:", "tel:", "javascript:")):
                    continue
                abs_url = normalize(urlparse.urljoin(page_url, raw_val))
                if abs_url in url_map:
                    tag[attr] = rel_from(new_rel, url_map[abs_url])

    inject_custom_assets(soup, new_rel)

    out_path = os.path.join(OUT_DIR, new_rel.replace("/", os.sep))
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(str(soup))


def copy_assets():
    src_assets = os.path.join(SRC_DIR, "assets")
    dst_assets = os.path.join(OUT_DIR, "assets")
    if os.path.exists(dst_assets):
        shutil.rmtree(dst_assets)
    for dirpath, _dirnames, filenames in os.walk(src_assets):
        for fn in filenames:
            src_file = os.path.join(dirpath, fn)
            rel = to_posix(os.path.relpath(src_file, src_assets))
            dst_rel = decode_path(rel)
            dst_file = os.path.join(dst_assets, dst_rel.replace("/", os.sep))
            os.makedirs(os.path.dirname(dst_file), exist_ok=True)
            shutil.copyfile(src_file, dst_file)


def copy_custom_assets():
    for fname in CUSTOM_ASSET_FILES:
        shutil.copyfile(os.path.join(CUSTOM_ASSETS_DIR, fname), os.path.join(OUT_DIR, fname))


def write_readme(manifest: dict):
    readme = f"""# Texas Cannabis Company -- static export

Static copy of the public pages from txcannabiscompany.com, captured after
losing access to the original hosting account. {len(manifest['pages'])} pages
and {len(manifest['assets'])} images/assets, with internal links and image
paths rewritten to work locally / on GitHub Pages.

## What's included
- Every public page: homepage, brand pages, categories, products, blog posts
- All product/theme images, referenced with local relative paths
- Sign In / Register links removed from the header
- "Can Use Coupon" badges removed from product listings

## What's NOT included / won't work
- Add to Cart, Checkout, Login, Search, Order Status still link back to the
  original txcannabiscompany.com -- a static export has no backend
  (database, payment processing), so real orders can't be placed from this
  copy without a real e-commerce platform behind it.
- Anything that lived only in the BigCommerce admin (customer accounts,
  order history, unpublished drafts, inventory) -- that requires recovering
  the actual account.

## Regenerating
Source scrape lives in `site-backup/` (raw). Run `python build_public_site.py`
to regenerate this folder from it after re-running `python backup_site.py`.
"""
    with open(os.path.join(OUT_DIR, "README.md"), "w", encoding="utf-8") as f:
        f.write(readme)


def main():
    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    if os.path.exists(OUT_DIR):
        for name in os.listdir(OUT_DIR):
            if name == ".git":
                continue
            full = os.path.join(OUT_DIR, name)
            if os.path.isdir(full):
                shutil.rmtree(full)
            else:
                os.remove(full)
    os.makedirs(OUT_DIR, exist_ok=True)

    url_map = build_url_map(manifest)

    for entry in manifest["pages"]:
        page_url = entry["url"]
        local_html_path = os.path.join(SRC_DIR, entry["local_path"])
        new_rel = url_map[normalize(page_url)]
        process_page(page_url, local_html_path, new_rel, url_map)
        print(f"built {new_rel}")

    copy_assets()
    copy_custom_assets()
    write_readme(manifest)

    # Post-build patches for known-dead source content (confirmed 404 on the
    # live site itself, not a scraping gap) -- kept as separate modules but
    # run automatically here so a rebuild never silently drops them.
    import fix_dead_images
    import fix_dead_links
    fix_dead_images.main()
    fix_dead_links.main()

    print("\n=== DONE ===")
    print(f"Output: {OUT_DIR}")


if __name__ == "__main__":
    main()
