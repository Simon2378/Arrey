"""
Full public-site backup crawler for txcannabiscompany.com

Mirrors every publicly reachable page (HTML), image, and stylesheet on the
domain into ./site-backup/, preserving the URL path structure. Skips
disallowed/private paths (cart, checkout, login, account, admin, search)
per the site's own robots.txt.

Usage:
    python backup_site.py
"""

import os
import re
import sys
import time
import json
import queue
import urllib.parse as urlparse

import requests
from bs4 import BeautifulSoup

START_URL = "https://txcannabiscompany.com/"
DOMAIN = "txcannabiscompany.com"
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "site-backup")
PAGES_DIR = os.path.join(OUT_DIR, "pages")
ASSETS_DIR = os.path.join(OUT_DIR, "assets")
MANIFEST_PATH = os.path.join(OUT_DIR, "manifest.json")

# Paths disallowed in robots.txt (private/admin/transactional - not content to back up)
SKIP_PATH_PREFIXES = [
    "/account.php", "/cart.php", "/checkout.php", "/checkout",
    "/finishorder.php", "/login.php", "/orderstatus.php", "/order-status",
    "/postreview.php", "/productimage.php", "/productupdates.php",
    "/remote.php", "/search.php", "/viewfile.php", "/admin/", "/wishlist.php",
]

REQUEST_DELAY_SECONDS = 2.0
MAX_PAGES = 3000
MAX_RUNTIME_SECONDS = 3 * 60 * 60  # 3 hour safety cap
TIMEOUT = 25
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SiteBackupBot/1.0 "
                  "(personal archive of own storefront; contact via account owner)"
}

SEED_PATHS = [
    "/", "/all-products/", "/blog/", "/brands/", "/sitemap/categories",
    "/sitemap/brands/", "/shop-by-cannabinoid/", "/concentrates/",
    "/edibles-gummies/", "/prerolls/", "/thca-flower/", "/papers-wraps/",
    "/wholesale/", "/shipping-returns/", "/certificate-of-analysis/",
    "/cannabis-glossery/", "/texas-cannabis-company-reviews/",
    "/contact-us/",
]


def is_skipped(path: str) -> bool:
    for prefix in SKIP_PATH_PREFIXES:
        if path.startswith(prefix):
            return True
    return False


def normalize(url: str, base: str) -> str | None:
    try:
        joined = urlparse.urljoin(base, url)
        parsed = urlparse.urlsplit(joined)
    except ValueError:
        return None
    if parsed.scheme not in ("http", "https"):
        return None
    if parsed.netloc != DOMAIN:
        return None
    if is_skipped(parsed.path):
        return None
    # Drop fragments; keep query (pagination/filters use query strings here)
    clean = urlparse.urlunsplit((("https"), parsed.netloc, parsed.path, parsed.query, ""))
    return clean


def local_path_for_page(url: str) -> str:
    parsed = urlparse.urlsplit(url)
    path = parsed.path
    if path.endswith("/") or path == "":
        path = path + "index.html"
    elif "." not in os.path.basename(path):
        path = path + "/index.html"
    if parsed.query:
        safe_q = re.sub(r"[^A-Za-z0-9_=&-]", "_", parsed.query)
        base, ext = os.path.splitext(path)
        path = f"{base}__q_{safe_q}{ext}"
    return os.path.join(PAGES_DIR, path.lstrip("/"))


def local_path_for_asset(url: str) -> str:
    parsed = urlparse.urlsplit(url)
    host_dir = parsed.netloc
    path = parsed.path.lstrip("/")
    if not path:
        path = "index"
    return os.path.join(ASSETS_DIR, host_dir, path)


def save_bytes(path: str, content: bytes):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(content)


def fetch(session: requests.Session, url: str, retries: int = 3):
    for attempt in range(1, retries + 1):
        try:
            resp = session.get(url, headers=HEADERS, timeout=TIMEOUT)
            if resp.status_code == 429 or resp.status_code >= 500:
                wait = 5 * attempt
                print(f"  [retry] {resp.status_code} on {url}, waiting {wait}s")
                time.sleep(wait)
                continue
            return resp
        except requests.RequestException as e:
            wait = 5 * attempt
            print(f"  [error] {e} on {url}, retrying in {wait}s")
            time.sleep(wait)
    return None


def extract_asset_urls(soup: BeautifulSoup, page_url: str):
    urls = set()
    for tag in soup.find_all(["img", "source"]):
        for attr in ("src", "data-src"):
            if tag.get(attr):
                urls.add(urlparse.urljoin(page_url, tag[attr]))
        if tag.get("srcset"):
            for part in tag["srcset"].split(","):
                u = part.strip().split(" ")[0]
                if u:
                    urls.add(urlparse.urljoin(page_url, u))
    for tag in soup.find_all("link", rel=lambda v: v and "stylesheet" in v):
        if tag.get("href"):
            urls.add(urlparse.urljoin(page_url, tag["href"]))
    for tag in soup.find_all("link", rel=lambda v: v and "icon" in v):
        if tag.get("href"):
            urls.add(urlparse.urljoin(page_url, tag["href"]))
    meta_og = soup.find("meta", property="og:image")
    if meta_og and meta_og.get("content"):
        urls.add(urlparse.urljoin(page_url, meta_og["content"]))
    # only keep http(s) urls, drop data: URIs
    return {u for u in urls if u.startswith("http")}


def extract_page_links(soup: BeautifulSoup, page_url: str):
    links = set()
    for tag in soup.find_all("a", href=True):
        norm = normalize(tag["href"], page_url)
        if norm:
            links.add(norm)
    return links


def main():
    os.makedirs(PAGES_DIR, exist_ok=True)
    os.makedirs(ASSETS_DIR, exist_ok=True)

    session = requests.Session()

    visited_pages = set()
    downloaded_assets = set()
    q = queue.Queue()

    for p in SEED_PATHS:
        norm = normalize(p, START_URL)
        if norm:
            q.put(norm)

    manifest = {"pages": [], "assets": [], "errors": []}
    start_time = time.time()
    page_count = 0

    while not q.empty() and page_count < MAX_PAGES:
        if time.time() - start_time > MAX_RUNTIME_SECONDS:
            print("Hit max runtime cap, stopping crawl (can be re-run to continue).")
            break

        url = q.get()
        if url in visited_pages:
            continue
        visited_pages.add(url)

        print(f"[{page_count+1}] GET {url}")
        resp = fetch(session, url)
        time.sleep(REQUEST_DELAY_SECONDS)

        if resp is None or resp.status_code != 200:
            status = resp.status_code if resp is not None else "no-response"
            print(f"  [skip] status={status}")
            manifest["errors"].append({"url": url, "status": str(status)})
            continue

        content_type = resp.headers.get("Content-Type", "")
        if "text/html" not in content_type:
            continue

        local_path = local_path_for_page(url)
        save_bytes(local_path, resp.content)
        manifest["pages"].append({"url": url, "local_path": os.path.relpath(local_path, OUT_DIR)})
        page_count += 1

        soup = BeautifulSoup(resp.content, "lxml")

        # queue new same-domain links
        for link in extract_page_links(soup, url):
            if link not in visited_pages:
                q.put(link)

        # download assets referenced on this page
        for asset_url in extract_asset_urls(soup, url):
            if asset_url in downloaded_assets:
                continue
            downloaded_assets.add(asset_url)
            a_resp = fetch(session, asset_url, retries=2)
            time.sleep(0.3)
            if a_resp is not None and a_resp.status_code == 200:
                a_local = local_path_for_asset(asset_url)
                save_bytes(a_local, a_resp.content)
                manifest["assets"].append({
                    "url": asset_url,
                    "local_path": os.path.relpath(a_local, OUT_DIR),
                })
            else:
                status = a_resp.status_code if a_resp is not None else "no-response"
                manifest["errors"].append({"url": asset_url, "status": str(status)})

        if page_count % 5 == 0:
            with open(MANIFEST_PATH, "w", encoding="utf-8") as f:
                json.dump(manifest, f, indent=2)
            print(f"  ... progress saved: {page_count} pages, {len(downloaded_assets)} assets")

    with open(MANIFEST_PATH, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    print("\n=== DONE ===")
    print(f"Pages saved: {len(manifest['pages'])}")
    print(f"Assets saved: {len(manifest['assets'])}")
    print(f"Errors: {len(manifest['errors'])}")
    print(f"Output directory: {OUT_DIR}")


if __name__ == "__main__":
    main()
