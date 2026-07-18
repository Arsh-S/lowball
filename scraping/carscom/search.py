"""Search cars.com and collect vehicle-detail URLs (+ card prices).

Search URL format (all params optional except zip):
https://www.cars.com/shopping/results/?stock_type=used&makes[]=toyota
    &models[]=toyota-camry&list_price_max=15000&maximum_distance=100
    &zip=10001&page_size=50&page=1
"""

from __future__ import annotations

import re
import statistics
from urllib.parse import urlencode

BASE = "https://www.cars.com/shopping/results/"


def build_search_url(
    make: str | None = None,
    model: str | None = None,
    zip_code: str = "10001",
    max_price: int | None = None,
    min_price: int | None = None,
    year_min: int | None = None,
    year_max: int | None = None,
    max_distance: int = 100,
    stock_type: str = "used",
    page: int = 1,
    page_size: int = 50,
) -> str:
    params: list[tuple[str, str]] = [
        ("stock_type", stock_type),
        ("zip", zip_code),
        ("maximum_distance", str(max_distance)),
        ("page", str(page)),
        ("page_size", str(page_size)),
    ]
    if make:
        params.append(("makes[]", make.lower().replace(" ", "_")))
    if model and make:
        slug = f"{make.lower().replace(' ', '_')}-{model.lower().replace(' ', '_')}"
        params.append(("models[]", slug))
    if max_price:
        params.append(("list_price_max", str(max_price)))
    if min_price:
        params.append(("list_price_min", str(min_price)))
    if year_min:
        params.append(("year_min", str(year_min)))
    if year_max:
        params.append(("year_max", str(year_max)))
    return BASE + "?" + urlencode(params)


def parse_search_results(html: str) -> list[dict]:
    """Extract listing cards: detail URL, listing id, and price.

    Cards link to /vehicledetail/<uuid>/ and carry a nearby price element;
    we pair ids with prices by scanning the card container blocks.
    """
    cards: list[dict] = []
    seen: set[str] = set()
    for m in re.finditer(
        r'href="/vehicledetail/([0-9a-f-]{36})/[^"]*"', html
    ):
        listing_id = m.group(1)
        if listing_id in seen:
            continue
        seen.add(listing_id)
        # Look for the first price after the link within the card block.
        window = html[m.start() : m.start() + 4000]
        pm = re.search(r"\$([\d,]+)", window)
        cards.append(
            {
                "id": listing_id,
                "url": f"https://www.cars.com/vehicledetail/{listing_id}/",
                "price": int(pm.group(1).replace(",", "")) if pm else None,
            }
        )
    return cards


def median_price(cards: list[dict]) -> float | None:
    prices = [c["price"] for c in cards if c.get("price")]
    return statistics.median(prices) if prices else None
