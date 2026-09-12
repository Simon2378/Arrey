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
CUSTOM_ASSET_FILES = [
    "cart.js", "cart.css", "payment-config.js",
    "admin.js", "admin.css", "product-display.js", "placeholder-product.svg",
    # generic licensed stock photos (Wikimedia Commons, CC0/public domain/CC
    # BY-SA -- see CONCENTRATE_IMAGE_CREDITS.md) used as default product
    # images per concentrate type until real photos are added via /admin/
    "concentrate-shatter.jpg", "concentrate-wax.jpg",
    "concentrate-rosin.jpg", "concentrate-extract.jpg",
    "concentrate-budder.jpg", "concentrate-oil-drop.jpg",
    "concentrate-hash.jpg", "concentrate-fine-extract.jpg",
    "concentrate-bho.jpg", "concentrate-gold.jpg",
    "concentrate-bho2.jpg", "concentrate-dab.jpg",
]
# products.json is live application data written by the admin panel via the
# GitHub API, not a build artifact -- only ever *seeded* if missing, never
# overwritten on rebuild (that would silently wipe out real admin edits the
# next time this script runs and gets pushed).
SEED_ONLY_ASSET_FILES = ["products.json"]

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


def fix_cart_link(soup: BeautifulSoup):
    """The cart icon's href still points at the dead
    https://txcannabiscompany.com/cart.php. Point it at our own dedicated
    /cart/ page instead -- a plain link (no click interception needed) since
    every device just navigates there, rather than a dropdown anchored to
    the header, which doesn't work well on mobile.

    data-dropdown/data-options are the theme's own *generic* dropdown-toggle
    hook (the same mechanism behind Recently Viewed, the account menu, etc.)
    -- it calls preventDefault() on any click on an element carrying
    data-dropdown regardless of href, which silently blocked navigation
    here. Strip them so the click just follows the link normally."""
    for a in soup.find_all("a", class_="navUser-action--cart"):
        a["href"] = "/cart/"
        for attr in ("data-dropdown", "data-options"):
            if a.has_attr(attr):
                del a[attr]


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


EMPTY_CONCENTRATE_SUBCATEGORY_URLS = (
    "https://txcannabiscompany.com/concentrates/crumble/",
    "https://txcannabiscompany.com/concentrates/live-resin/",
    "https://txcannabiscompany.com/concentrates/live-rosin/",
    "https://txcannabiscompany.com/concentrates/shatter/",
    "https://txcannabiscompany.com/concentrates/thca-diamonds/",
    "https://txcannabiscompany.com/thca-flower/prime-collection-aaa-exotic-thca-buds/",
    "https://txcannabiscompany.com/thca-flower/select-collection-lows-mids/",
    "https://txcannabiscompany.com/thca-flower/choice-collection-premium-indoor-thca-flower/",
)

# matches EMPTY_CONCENTRATE_SUBCATEGORY_URLS above -- kept as the new_rel
# (output-relative) form so main() can skip building these pages at all
SKIP_NEW_REL_PREFIXES = (
    "concentrates/crumble/",
    "concentrates/live-resin/",
    "concentrates/live-rosin/",
    "concentrates/shatter/",
    "concentrates/thca-diamonds/",
    "thca-flower/prime-collection-aaa-exotic-thca-buds/",
    "thca-flower/select-collection-lows-mids/",
    "thca-flower/choice-collection-premium-indoor-thca-flower/",
)


def strip_empty_concentrate_subcategory_links(soup: BeautifulSoup):
    """These Concentrates and THCA Flower subcategories (Crumble, Live Resin,
    Live Rosin, Shatter, THCA Diamonds, and the three THCA Flower tiers) were
    already empty on the live site before it went down, and every product in
    both categories now lives directly under its parent category instead of
    being split across them -- so a link to any of these just lands a
    visitor on a page that will always say "no products." Remove the links
    wherever they appear (desktop nav dropdown, mobile nav
    dropdown, and each category page's own subcategory sidebar).
    The pages themselves are simply not built -- see SKIP_NEW_REL_PREFIXES."""
    for a in soup.find_all("a", href=lambda h: h in EMPTY_CONCENTRATE_SUBCATEGORY_URLS):
        li = a.find_parent("li")
        (li if li is not None else a).decompose()


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


def strip_live_chat_banner(soup: BeautifulSoup):
    """The 'Questions? Click here to start a live chat' banner links out to
    a LiveChat.com account tied to the original business -- not something we
    control or know is still active. Remove it; the payment-proof-by-email
    flow is the actual support channel now."""
    for a in soup.find_all("a", href=lambda h: h and "direct.lc.chat" in h):
        a.decompose()


def ensure_charset_meta(soup: BeautifulSoup):
    """The original pages have NO <meta charset> tag at all -- the live site
    declared UTF-8 via its HTTP Content-Type header instead, which our static
    file server (and possibly the eventual host) doesn't replicate. Without
    either signal, browsers guess the encoding and guess wrong, silently
    mangling every curly quote/em-dash/emoji into mojibake (correctly-encoded
    UTF-8 bytes displayed as if they were Windows-1252). Adding this tag is
    the standard, host-independent fix -- it doesn't depend on any server
    header being set correctly."""
    head = soup.find("head")
    if head is None or head.find("meta", charset=True):
        return
    meta = soup.new_tag("meta", charset="utf-8")
    head.insert(0, meta)


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
        for fname in ("payment-config.js", "cart.js", "product-display.js"):
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

    ensure_charset_meta(soup)
    strip_login_register(soup)
    strip_empty_concentrate_subcategory_links(soup)
    strip_coupon_badges(soup)
    strip_marketing_popups(soup)
    strip_live_chat_banner(soup)
    strip_theme_cart_preview_hook(soup)
    fix_cart_link(soup)
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
    for fname in SEED_ONLY_ASSET_FILES:
        dst = os.path.join(OUT_DIR, fname)
        if not os.path.exists(dst):
            shutil.copyfile(os.path.join(CUSTOM_ASSETS_DIR, fname), dst)


def _build_page_from_template(out_rel_dir: str, title: str, body_html: str, extra_head_tags=None, extra_body_tags=None):
    """Shared helper for pages that don't exist in the original scrape
    (cart, admin, product detail): clones contact-us/index.html purely
    because it's already-built, has a simple single-column layout, and sits
    one level deep -- same depth as these new one-level-deep pages -- so
    every relative asset/nav link in its header/footer already resolves
    with no path adjustment."""
    template_path = os.path.join(OUT_DIR, "contact-us", "index.html")
    with open(template_path, "rb") as f:
        soup = BeautifulSoup(f.read(), "lxml")

    title_tag = soup.find("title")
    if title_tag:
        title_tag.string = title

    main_tag = soup.find("main", class_="page")
    if main_tag is None:
        raise RuntimeError(f"_build_page_from_template({out_rel_dir}): couldn't find <main class=\"page\"> in the template")

    main_tag.clear()
    main_tag["class"] = "page"
    content = BeautifulSoup(body_html, "lxml")
    main_tag.append(content.find("div", class_="page-content"))

    head = soup.find("head")
    for tag in (extra_head_tags or []):
        head.append(tag)
    body = soup.find("body")
    for tag in (extra_body_tags or []):
        body.append(tag)

    out_path = os.path.join(OUT_DIR, out_rel_dir, "index.html")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(str(soup))


def build_cart_page():
    """Builds public-site/cart/index.html -- a dedicated cart page that
    cart.js renders into (#cart-page-content), replacing the old dropdown
    panel approach (awkward on mobile)."""
    _build_page_from_template(
        "cart",
        "Your Cart - Texas Cannabis Company",
        '<div class="page-content" style="max-width:640px;margin:0 auto;padding:2rem 1rem;width:100%;">'
        '<h1 class="page-heading">Your Cart</h1>'
        '<div id="cart-page-content"></div>'
        "</div>",
    )


def build_admin_page():
    """Builds public-site/admin/index.html -- password-styled (really a
    GitHub token) login gate + product add/delete dashboard, all driven by
    admin.js. Not linked from anywhere in the site nav; reach it directly
    at /admin/."""
    soup = BeautifulSoup("<div></div>", "lxml")
    link = soup.new_tag("link", rel="stylesheet", href="../admin.css")
    script = soup.new_tag("script", src="../admin.js")

    _build_page_from_template(
        "admin",
        "Admin - Texas Cannabis Company",
        '<div class="page-content" style="max-width:640px;margin:0 auto;padding:2rem 1rem;width:100%;">'
        '<h1 class="page-heading">Admin</h1>'
        '<div id="admin-root"></div>'
        "</div>",
        extra_head_tags=[link],
        extra_body_tags=[script],
    )


def build_product_detail_page():
    """Builds public-site/p/index.html -- a generic product page for
    admin-added products (which have no individually pre-rendered page the
    way scraped products do). product-display.js renders the actual
    product, chosen via ?id=, into #product-detail-content on load."""
    _build_page_from_template(
        "p",
        "Product - Texas Cannabis Company",
        '<div class="page-content" style="max-width:800px;margin:0 auto;padding:2rem 1rem;width:100%;">'
        '<div id="product-detail-content"></div>'
        "</div>",
    )


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
        if new_rel.startswith(SKIP_NEW_REL_PREFIXES):
            print(f"skipped (empty concentrate subcategory): {new_rel}")
            continue
        process_page(page_url, local_html_path, new_rel, url_map)
        print(f"built {new_rel}")

    copy_assets()
    copy_custom_assets()
    build_cart_page()
    build_admin_page()
    build_product_detail_page()
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
