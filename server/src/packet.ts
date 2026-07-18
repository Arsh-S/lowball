import { defaultTarget, type Car, type CompCard, type PriceHistoryEntry } from "./types.js";
import type { RawListing } from "./scraper.js";

// "$34,489" -> 34489
export function parseMoney(s: string | number | undefined | null): number {
  if (s == null) return 0;
  const n = Number(String(s).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

// "07/16/26" -> Date, assumes 20YY (cars.com always writes 2-digit years this way)
export function parseShortDate(s: string): Date {
  const [m, d, y] = s.split("/").map(Number);
  return new Date(Date.UTC(2000 + y, (m || 1) - 1, d || 1));
}

// price_changes JSON string ("[{\"date\":\"07/16/26\",\"price\":\"$34,489\"}, ...]", newest-first
// on cars.com) -> sorted oldest-first list of {date, price}.
// Dealer histories contain placeholder junk (seen live: $111,111 on a $19k
// truck before the real price appeared) — entries far out of band vs the
// current asking price would poison priceDrops/totalDrop, so drop them.
export function parsePriceHistory(raw: string | undefined, askingPrice?: number): PriceHistoryEntry[] {
  if (!raw) return [];
  let entries: { date: string; price: string }[];
  try {
    entries = JSON.parse(raw);
  } catch {
    return [];
  }
  return entries
    .map((e) => ({ date: e.date, price: parseMoney(e.price) }))
    .filter((e) => e.price > 0)
    .filter((e) => !askingPrice || (e.price >= askingPrice * 0.4 && e.price <= askingPrice * 2.5))
    .sort((a, b) => parseShortDate(a.date).getTime() - parseShortDate(b.date).getTime());
}

export function countPriceDrops(history: PriceHistoryEntry[]): number {
  let drops = 0;
  for (let i = 1; i < history.length; i++) {
    if (history[i].price < history[i - 1].price) drops++;
  }
  return drops;
}

export function computeDaysListed(history: PriceHistoryEntry[]): number | null {
  if (!history.length) return null;
  const earliest = parseShortDate(history[0].date);
  return Math.max(0, Math.floor((Date.now() - earliest.getTime()) / 86_400_000));
}

export function computeMilesPerYear(miles: number, year: number): number {
  const age = Math.max(0.5, new Date().getFullYear() - year + 0.5);
  return Math.round(miles / age);
}

function floor100(n: number): number {
  return Math.floor(n / 100) * 100;
}

function round100(n: number): number {
  return Math.round(n / 100) * 100;
}

// Raw scraped strings -> the identity subset of Car (year/miles/price parsed to numbers).
export function parseRawListing(raw: RawListing) {
  return {
    year: Number(raw.year) || 0,
    make: raw.make,
    model: raw.model,
    trim: raw.trim || undefined,
    vin: raw.vin || undefined,
    miles: Number(raw.mileage) || 0,
    price: parseMoney(raw.price),
    dealer: raw.seller_name,
    phone: raw.seller_phone_number || "",
    city: raw.seller_address || undefined,
  };
}

export function buildPacket(
  listing: RawListing,
  opts: { median: number | null; comps: CompCard[]; clientName?: string },
): Car {
  const identity = parseRawListing(listing);
  const priceHistory = parsePriceHistory(listing.price_changes, identity.price);
  const priceDrops = countPriceDrops(priceHistory);
  // Sum of the actual cuts, not first-minus-current — history can rise then fall
  // (the F-150 fixture went 35490 -> 36489 -> ... -> 34489), and the badge says
  // "totaling", so only the decreasing steps count.
  const totalDrop = priceHistory.reduce(
    (acc, e, i) => (i > 0 && e.price < priceHistory[i - 1].price ? acc + priceHistory[i - 1].price - e.price : acc),
    0,
  );
  const daysListed = computeDaysListed(priceHistory);
  const milesPerYear = computeMilesPerYear(identity.miles, identity.year);
  const marketMedian = opts.median;
  const marketDelta = marketMedian != null ? identity.price - marketMedian : null;
  const comps = opts.comps.slice(0, 3);

  // Ladder: comps-median-based target only when the caller supplied a median
  // backed by >=5 priced cards (search.ts's call — see its comment); never above asking.
  const rawTarget =
    marketMedian != null
      ? floor100(Math.min(marketMedian * 0.97, identity.price * 0.97))
      : defaultTarget(identity.price);
  const target = Math.min(rawTarget, identity.price);
  const opening = round100(target * 0.98);

  return {
    ...identity,
    priceHistory,
    priceDrops,
    totalDrop,
    daysListed: daysListed ?? undefined,
    milesPerYear,
    marketMedian,
    marketDelta,
    comps,
    opening,
    target,
    clientName: opts.clientName ?? "Gabe",
  };
}
