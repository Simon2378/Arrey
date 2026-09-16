"""Readability auditor for site content (Flesch Reading Ease / Flesch-Kincaid
Grade Level -- the same metrics behind tools like Yoast SEO's readability
check). Extracts the main editorial text from a page, scores it, and flags
the specific sentences dragging the score down so they can be rewritten.

Usage: python seo_readability.py <page1.html> [page2.html ...]
"""
import re
import sys
import io
from bs4 import BeautifulSoup

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

VOWELS = "aeiouy"


def count_syllables(word: str) -> int:
    word = word.lower().strip(".,;:!?\"'()")
    if not word:
        return 0
    word = re.sub(r"[^a-z]", "", word)
    if not word:
        return 0
    groups = re.findall(r"[aeiouy]+", word)
    count = len(groups)
    if word.endswith("e") and not word.endswith("le") and count > 1:
        count -= 1
    return max(1, count)


def split_sentences(text: str):
    text = re.sub(r"\s+", " ", text).strip()
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9\"“])", text)
    return [p.strip() for p in parts if p.strip()]


def extract_content_text(path: str) -> str:
    with open(path, "rb") as f:
        soup = BeautifulSoup(f.read(), "lxml")
    for tag in soup.select("script, style, nav, footer, header, form"):
        tag.decompose()
    candidates = soup.select("main article")
    container = max(candidates, key=lambda c: len(c.get_text()), default=None)
    if container is None or len(container.get_text(strip=True)) < 200:
        container = soup.select_one("main") or soup.body
    return container.get_text(" ", strip=True)


def analyze(path: str):
    text = extract_content_text(path)
    sentences = split_sentences(text)
    words = re.findall(r"[A-Za-z']+", text)
    word_count = len(words)
    sentence_count = max(1, len(sentences))
    syllable_count = sum(count_syllables(w) for w in words)

    if word_count == 0:
        print(f"{path}: no extractable body text")
        return

    words_per_sentence = word_count / sentence_count
    syllables_per_word = syllable_count / word_count
    flesch = 206.835 - 1.015 * words_per_sentence - 84.6 * syllables_per_word
    grade = 0.39 * words_per_sentence + 11.8 * syllables_per_word - 15.59

    if flesch >= 70:
        band = "OK (fairly easy or better)"
    elif flesch >= 60:
        band = "borderline (standard, watch long sentences)"
    else:
        band = "NEEDS WORK (difficult to read)"

    print(f"\n=== {path} ===")
    print(f"  words: {word_count}   sentences: {sentence_count}   avg words/sentence: {words_per_sentence:.1f}")
    print(f"  Flesch Reading Ease: {flesch:.1f}  ({band})")
    print(f"  Flesch-Kincaid Grade Level: {grade:.1f}")

    long_sentences = sorted(
        (s for s in sentences if len(re.findall(r"[A-Za-z']+", s)) >= 28),
        key=lambda s: -len(re.findall(r"[A-Za-z']+", s)),
    )
    if long_sentences:
        print(f"  {len(long_sentences)} sentence(s) at 28+ words (hardest to read):")
        for s in long_sentences[:5]:
            wc = len(re.findall(r"[A-Za-z']+", s))
            print(f"    [{wc}w] {s[:160]}{'...' if len(s) > 160 else ''}")


if __name__ == "__main__":
    for p in sys.argv[1:]:
        analyze(p)
