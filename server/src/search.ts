import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import { defaultTarget } from "./types.js";

// Criteria the LLM extracts from free text. City -> zip is entity extraction,
// NOT URL synthesis, so no hallucinated cars.com slugs.
export type Criteria = {
  make?: string;
  model?: string;
  zip?: string;
  year_min?: number;
  year_max?: number;
  min_price?: number;
  max_price?: number;
};

export type Listing = Record<string, any>;

const LISTINGS_DIR = fileURLToPath(new URL("../../data/listings", import.meta.url));

// Full inventory lives as one JSON file per listing in data/listings/.
let cache: Listing[] | null = null;
function loadListings(): Listing[] {
  if (cache) return cache;
  try {
    cache = readdirSync(LISTINGS_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(`${LISTINGS_DIR}/${f}`, "utf8")));
  } catch {
    cache = [];
  }
  return cache!;
}

const num = (v: unknown): number => {
  const n = Number(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

// One cheap structured-output call. Falls back to naive parsing with no key.
export async function extractCriteria(query: string): Promise<Criteria> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return naive(query);
  try {
    const openai = new OpenAI({ apiKey });
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Extract used-car search criteria from the user's request. Return ONLY JSON with keys: " +
            "make (string, canonical e.g. 'Ford'), model (string e.g. 'F-150'), zip (5-digit US ZIP — " +
            "convert any city/town/region to its main ZIP), year_min (int), year_max (int), " +
            "min_price (int USD), max_price (int USD). Omit keys you cannot determine. No prose.",
        },
        { role: "user", content: query },
      ],
    });
    const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}");
    return sanitize(parsed);
  } catch {
    return naive(query);
  }
}

function sanitize(p: any): Criteria {
  const c: Criteria = {};
  if (p.make) c.make = String(p.make);
  if (p.model) c.model = String(p.model);
  if (p.zip) c.zip = String(p.zip).slice(0, 5);
  for (const k of ["year_min", "year_max", "min_price", "max_price"] as const) {
    if (p[k] != null && Number.isFinite(Number(p[k]))) c[k] = Math.round(Number(p[k]));
  }
  return c;
}

// No-key fallback: pull obvious signals with regex so the demo still works.
function naive(query: string): Criteria {
  const c: Criteria = {};
  const zip = query.match(/\b(\d{5})\b/);
  if (zip) c.zip = zip[1];
  const price = query.match(/(?:under|below|<|max)\s*\$?\s*([\d,]+)\s*k?/i);
  if (price) {
    let n = Number(price[1].replace(/,/g, ""));
    if (/k/i.test(price[0]) || n < 1000) n *= 1000;
    c.max_price = n;
  }
  const yr = query.match(/\b(20\d{2})\b/);
  if (yr) c.year_min = Number(yr[1]);
  const q = query.toLowerCase();
  // model keyword -> {make, model}. Checked before bare makes so "F-150 Raptor" resolves to Ford.
  const models: [RegExp, string, string][] = [
    [/f[-\s]?150|raptor|lightning/, "Ford", "F-150"],
    [/mustang/, "Ford", "Mustang"],
    [/camry/, "Toyota", "Camry"],
    [/corolla/, "Toyota", "Corolla"],
    [/tacoma/, "Toyota", "Tacoma"],
    [/civic/, "Honda", "Civic"],
    [/accord/, "Honda", "Accord"],
    [/cr[-\s]?v/, "Honda", "CR-V"],
    [/model\s?3/, "Tesla", "Model 3"],
    [/model\s?y/, "Tesla", "Model Y"],
    [/wrangler/, "Jeep", "Wrangler"],
    [/grand\s?cherokee/, "Jeep", "Grand Cherokee"],
  ];
  for (const [re, mk, md] of models) if (re.test(q)) { c.make = mk; c.model = md; break; }
  if (!c.make) {
    const makes = ["ford", "toyota", "honda", "tesla", "jeep", "chevrolet", "bmw", "nissan"];
    for (const m of makes) if (q.includes(m)) { c.make = m[0].toUpperCase() + m.slice(1); break; }
  }
  return c;
}

function matches(l: Listing, c: Criteria): boolean {
  const year = num(l.year), price = num(l.price);
  if (c.make && !String(l.make ?? "").toLowerCase().includes(c.make.toLowerCase())) return false;
  if (c.model && !String(l.model ?? "").toLowerCase().includes(c.model.toLowerCase())) return false;
  if (c.year_min && year && year < c.year_min) return false;
  if (c.year_max && year && year > c.year_max) return false;
  if (c.max_price && price && price > c.max_price) return false;
  if (c.min_price && price && price < c.min_price) return false;
  return true;
}

function median(nums: number[]): number {
  const a = nums.filter((n) => n > 0).sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// Rank by negotiation leverage: how far over the comp median + mileage.
export function search(query: string, criteria: Criteria) {
  const all = loadListings();
  let hits = all.filter((l) => matches(l, criteria));
  if (!hits.length) hits = all.filter((l) => matches(l, { make: criteria.make, model: criteria.model }));
  if (!hits.length) hits = all;

  const med = median(hits.map((l) => num(l.price)));

  const scored = hits.map((l) => {
    const price = num(l.price), miles = num(l.mileage);
    const overMedian = med ? price - med : 0;
    const leverage = (overMedian / (med || 1)) * 100 + (miles / 100000) * 8;
    return { l, price, miles, overMedian, leverage };
  });
  scored.sort((a, b) => b.leverage - a.leverage);

  const top = scored.slice(0, 5).map((s, i) => {
    const l = s.l;
    const bits: string[] = [];
    if (med && s.overMedian > 300) bits.push(`${Math.round(s.overMedian).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })} over the median for this spec`);
    else if (med && s.overMedian < -300) bits.push(`${Math.abs(Math.round(s.overMedian)).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })} under median (less room)`);
    else if (med) bits.push("right at the comp median");
    if (s.miles) bits.push(`${Math.round(s.miles).toLocaleString()} mi`);
    if (String(l.seller_type ?? "").includes("dealer")) bits.push("dealer inventory — motivated to move it");
    const why = (i === 0 ? "Top pick — " : "") + bits.join(" · ") + ".";
    return {
      id: l.id,
      year: num(l.year) || undefined,
      make: l.make,
      model: l.model,
      trim: l.trim || undefined,
      price: s.price || undefined,
      mileage: s.miles || undefined,
      dealer: l.seller_name || undefined,
      phone: l.seller_phone_number || undefined,
      location: l.seller_address || undefined,
      photo: firstPhoto(l.photos),
      target: s.price ? defaultTarget(s.price) : undefined,
      hot: i === 0,
      why,
    };
  });

  return { criteria, median: med || undefined, cars: top };
}

function firstPhoto(photos: unknown): string | undefined {
  if (!photos) return undefined;
  try {
    const arr = Array.isArray(photos) ? photos : JSON.parse(String(photos));
    return arr[0];
  } catch {
    return undefined;
  }
}
