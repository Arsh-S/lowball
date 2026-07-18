import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultTarget, type Car, type PricePoint } from "./types.js";

// Gabe's scraper schema (scraping/README.md) — everything arrives as strings.
type RawListing = {
  id: string;
  url: string;
  make: string;
  model: string;
  year: string;
  trim?: string;
  price: string;
  mileage: string;
  price_changes?: string; // JSON string: [{date:"07/16/26", price:"$19,379"}, ...] newest first
  seller_name: string;
  seller_address?: string;
  seller_phone_number?: string;
  price_badge?: string;
};

const DATA_DIR =
  process.env.DATA_DIR ?? fileURLToPath(new URL("../../data", import.meta.url));

export function loadListings(): RawListing[] {
  const dir = join(DATA_DIR, "listings");
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const listings: RawListing[] = [];
  for (const f of files) {
    try {
      listings.push(JSON.parse(readFileSync(join(dir, f), "utf8")));
    } catch (err) {
      console.warn(`skipping unparseable listing ${f}: ${(err as Error).message}`);
    }
  }
  return listings;
}

function parsePriceHistory(raw?: string): PricePoint[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as { date: string; price: string }[];
    return arr
      .map((p) => ({ date: p.date, price: Number(String(p.price).replace(/[^0-9]/g, "")) }))
      .filter((p) => p.price > 0);
  } catch {
    return [];
  }
}

function toE164(raw?: string): string {
  const digits = (raw ?? "").replace(/[^0-9]/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return "";
}

function median(nums: number[]): number | undefined {
  if (!nums.length) return undefined;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

// Median asking price of same make+model across the dataset — the market comp
// the assistant anchors against.
function marketMedianFor(listing: RawListing, all: RawListing[]): number | undefined {
  const comps = all.filter(
    (l) =>
      l.make.toLowerCase() === listing.make.toLowerCase() &&
      l.model.toLowerCase() === listing.model.toLowerCase(),
  );
  if (comps.length < 3) return undefined;
  return median(comps.map((l) => Number(l.price)).filter((p) => p > 0));
}

export function toCar(listing: RawListing, all: RawListing[]): Car {
  const price = Number(listing.price) || 0;
  return {
    year: Number(listing.year) || 0,
    make: listing.make,
    model: listing.trim ? `${listing.model} ${listing.trim}` : listing.model,
    miles: Number(listing.mileage) || 0,
    price,
    dealer: listing.seller_name,
    phone: toE164(listing.seller_phone_number),
    target: defaultTarget(price),
    priceHistory: parsePriceHistory(listing.price_changes),
    marketMedian: marketMedianFor(listing, all),
  };
}

export function getCar(id: string): Car | undefined {
  const all = loadListings();
  const listing = all.find((l) => l.id === id);
  return listing && toCar(listing, all);
}

// Compact shape for the dashboard picker.
export function listListings() {
  const all = loadListings();
  return all.map((l) => {
    const history = parsePriceHistory(l.price_changes);
    return {
      id: l.id,
      title: `${l.year} ${l.make} ${l.model}${l.trim ? ` ${l.trim}` : ""}`,
      price: Number(l.price) || 0,
      miles: Number(l.mileage) || 0,
      dealer: l.seller_name,
      location: l.seller_address ?? "",
      phone: toE164(l.seller_phone_number),
      badge: l.price_badge || null,
      priceCuts: Math.max(0, history.length - 1),
      url: l.url,
    };
  });
}
