"""Collect cars.com listings into data/ as JSON.

Usage:
    python3 -m scraping.collect --total 50 --zip 10001
    python3 -m scraping.collect --make toyota --model camry --total 10

Runs one or more searches, dedupes listing URLs, scrapes each detail page
with bounded concurrency, and writes:
    data/listings/<id>.json    one file per listing (target schema)
    data/listings.json         combined array
    data/collection_report.json  latency + success stats + median prices
"""

from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import time
from pathlib import Path

from scraping.carscom.browser import browser_context, fetch_html, fetch_many
from scraping.carscom.detail import parse_detail
from scraping.carscom.search import build_search_url, median_price, parse_search_results

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"

# Default query mix: diverse inventory for chatbot testing.
DEFAULT_QUERIES = [
    {"make": "toyota", "model": "camry", "max_price": 20000},
    {"make": "honda", "model": "civic", "max_price": 20000},
    {"make": "ford", "model": "f_150", "max_price": 35000},
    {"make": "tesla", "model": "model_3", "max_price": 30000},
    {"make": "jeep", "model": "wrangler", "max_price": 30000},
]


async def collect(queries: list[dict], total: int, zip_code: str, concurrency: int) -> dict:
    per_query = max(1, total // len(queries))
    report: dict = {"queries": [], "listings": [], "latency": {}}
    t_start = time.time()

    async with browser_context() as ctx:
        # 1) search pages -> candidate detail URLs
        candidates: list[dict] = []
        for q in queries:
            url = build_search_url(zip_code=zip_code, **q)
            t0 = time.time()
            html = await fetch_html(ctx, url, wait_selector='a[href^="/vehicledetail/"]')
            cards = parse_search_results(html)
            report["queries"].append(
                {
                    "query": q,
                    "search_url": url,
                    "cards_found": len(cards),
                    "median_price": median_price(cards),
                    "search_seconds": round(time.time() - t0, 2),
                }
            )
            candidates.extend(cards[: per_query + 3])  # over-collect for failures

        # dedupe, cap
        seen: set[str] = set()
        urls: list[str] = []
        for c in candidates:
            if c["id"] not in seen:
                seen.add(c["id"])
                urls.append(c["url"])

        # 2) detail pages
        listings: list[dict] = []
        detail_times: list[float] = []
        failures: list[str] = []
        results = await fetch_many(ctx, urls, concurrency=concurrency)
        for url, html, elapsed in results:
            if len(listings) >= total:
                break
            if not html:
                failures.append(url)
                continue
            listing = parse_detail(html, url)
            if not listing["id"] or not listing["price"]:
                failures.append(url)
                continue
            listings.append(listing)
            detail_times.append(elapsed)

    # 3) write output
    out_dir = DATA_DIR / "listings"
    out_dir.mkdir(parents=True, exist_ok=True)
    for listing in listings:
        (out_dir / f"{listing['id']}.json").write_text(
            json.dumps(listing, indent=2, ensure_ascii=False)
        )
    (DATA_DIR / "listings.json").write_text(
        json.dumps(listings, indent=2, ensure_ascii=False)
    )

    report["listings"] = [
        {"id": l["id"], "title": f"{l['year']} {l['make']} {l['model']}",
         "price": l["price"], "phone": l["seller_phone_number"]}
        for l in listings
    ]
    report["latency"] = {
        "total_seconds": round(time.time() - t_start, 1),
        "detail_pages_scraped": len(detail_times),
        "detail_seconds_mean": round(statistics.mean(detail_times), 2) if detail_times else None,
        "detail_seconds_median": round(statistics.median(detail_times), 2) if detail_times else None,
        "detail_seconds_p95": round(sorted(detail_times)[int(len(detail_times) * 0.95) - 1], 2)
        if len(detail_times) >= 2 else None,
        "concurrency": concurrency,
        "failures": failures,
    }
    (DATA_DIR / "collection_report.json").write_text(json.dumps(report, indent=2))
    return report


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--total", type=int, default=50)
    ap.add_argument("--zip", default="10001")
    ap.add_argument("--make")
    ap.add_argument("--model")
    ap.add_argument("--max-price", type=int)
    ap.add_argument("--concurrency", type=int, default=4)
    args = ap.parse_args()

    if args.make:
        query: dict = {"make": args.make}
        if args.model:
            query["model"] = args.model
        if args.max_price:
            query["max_price"] = args.max_price
        queries = [query]
    else:
        queries = DEFAULT_QUERIES

    report = asyncio.run(collect(queries, args.total, args.zip, args.concurrency))
    print(json.dumps(report["latency"], indent=2))
    print(f"collected {len(report['listings'])} listings -> {DATA_DIR}")


if __name__ == "__main__":
    main()
