"""
Crawls the site as actually SERVED by the local http.server (real HTTP
requests, not filesystem checks), following every internal <a href> and
verifying it returns 200. This catches things a filesystem check can't:
wrong relative-path depth, percent-encoding mismatches, genuinely missing
pages -- exactly what a real click in a browser would hit.
"""

import sys
import io
import urllib.parse as urlparse
import urllib.request
import collections

from bs4 import BeautifulSoup

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="backslashreplace")

BASE = "http://localhost:8787"

visited = set()
broken = []
queue = collections.deque([(BASE + "/", None, None)])

while queue:
    url, referrer, link_text = queue.popleft()
    path = urlparse.urlsplit(url).path
    if path in visited:
        continue
    visited.add(path)

    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            status = resp.status
            content_type = resp.headers.get("Content-Type", "")
            body = resp.read() if "text/html" in content_type else b""
    except urllib.error.HTTPError as e:
        status = e.code
        body = b""
    except Exception as e:
        print(f"  [error] {url}: {e}")
        continue

    if status != 200:
        broken.append((url, status, referrer, link_text))
        continue

    if not body:
        continue

    soup = BeautifulSoup(body, "lxml")
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if href.startswith(("#", "mailto:", "tel:", "javascript:", "http://", "https://")):
            continue
        next_url = urlparse.urljoin(url, href)
        next_path = urlparse.urlsplit(next_url).path
        if not next_path.startswith("/"):
            continue
        if next_path not in visited:
            queue.append((next_url, url, a.get_text(strip=True)[:60]))

print(f"\nChecked {len(visited)} URLs\n")
if broken:
    print(f"=== BROKEN LINKS ({len(broken)}) ===")
    for url, status, referrer, link_text in broken:
        print(f"  {status}  {url}")
        print(f"       linked from: {referrer}  (text: {link_text!r})")
else:
    print("No broken links found.")
