import OpenAI from "openai";
import { scraperSearch, scraperGetListingsBatch, type ScraperSearchCard } from "./scraper.js";
import { buildPacket } from "./packet.js";
import { rankCards, isNoHaggle, buildBadgeReasons } from "./rank.js";
import type { Car, CompCard } from "./types.js";

// Built packets from the last /search, keyed by listing id, so /negotiate can
// reuse them without re-scraping.
export const packetCache = new Map<string, Car>();

export type CardView = {
  id: string;
  year: number;
  make: string;
  model: string;
  trim?: string;
  price: number;
  miles: number;
  dealer: string;
  city?: string;
  phone: string;
  badge?: { label: string; reasons: string[] };
  reasons: string[];
  negotiability: {
    priceDrops: number;
    totalDrop: number;
    daysListed: number | null;
    marketDelta: number | null;
  };
};

export type ExtractedParams = {
  make: string | null;
  model: string | null;
  zip: string | null;
  year_min: number | null;
  year_max: number | null;
  max_price: number | null;
  min_price: number | null;
};

export type SearchResult = {
  params: ExtractedParams;
  search_url: string;
  median: number | null;
  cards: CardView[];
};

const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    make: { type: ["string", "null"] },
    model: { type: ["string", "null"] },
    zip: { type: ["string", "null"] },
    year_min: { type: ["number", "null"] },
    year_max: { type: ["number", "null"] },
    max_price: { type: ["number", "null"] },
    min_price: { type: ["number", "null"] },
  },
  required: ["make", "model", "zip", "year_min", "year_max", "max_price", "min_price"],
  additionalProperties: false,
};

async function extractParams(query: string): Promise<ExtractedParams> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set in server/.env");
  const openai = new OpenAI({ apiKey });
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: {
      type: "json_schema",
      json_schema: { name: "car_search_params", strict: true, schema: EXTRACT_SCHEMA },
    },
    messages: [
      {
        role: "system",
        content:
          "Extract used-car search filters from a free-text request. Return make, model, zip, year_min, year_max, max_price, min_price. " +
          "A zip code is REQUIRED in the output — if a city, state, or region is mentioned, output a plausible real US zip for it " +
          "(you know US zip codes); default to 10001 only if the text gives no location at all. " +
          'Lowercase make/model and join multi-word names with underscores, cars.com slug style (e.g. "F-150" -> "f_150", "Model 3" -> "model_3"). ' +
          "Use null for any field absent from the text (zip is the only field that may never be null).",
      },
      { role: "user", content: query },
    ],
  });
  return JSON.parse(res.choices[0]?.message?.content ?? "{}");
}

function toCompCard(card: ScraperSearchCard): CompCard | null {
  if (card.price == null || card.year == null || !card.dealer) return null;
  return { year: card.year, price: card.price, dealer: card.dealer };
}

export async function handleSearch(query: string): Promise<SearchResult> {
  const params = await extractParams(query);
  const result = await scraperSearch(params);

  // Median only counts as a real comp median with enough priced cards behind it;
  // otherwise buildPacket falls back to defaultTarget (see packet.ts).
  const pricedCount = result.cards.filter((c) => c.price != null).length;
  const median = pricedCount >= 5 ? result.median : null;

  const candidates = result.cards.filter((c) => c.price != null && !isNoHaggle(c.dealer));
  const top8 = candidates.slice(0, 8);

  const { listings, failures } = await scraperGetListingsBatch(top8.map((c) => c.id));
  const failedIds = new Set(failures);
  const usable = top8.filter((c) => !failedIds.has(c.id));

  const details = new Map<string, Car>();
  for (const card of usable) {
    const listing = listings.find((l) => l.id === card.id);
    if (!listing) continue;
    const comps = usable
      .filter((c) => c.id !== card.id)
      .map(toCompCard)
      .filter((c): c is CompCard => c !== null);
    const car = buildPacket(listing, { median, comps });
    details.set(card.id, car);
    packetCache.set(card.id, car);
  }

  const ranked = rankCards(usable, details, median).slice(0, 5);

  const cards: CardView[] = ranked.map(({ card, car }, i) => {
    const reasons = car ? buildBadgeReasons(car) : [];
    return {
      id: card.id,
      year: car?.year ?? card.year ?? 0,
      make: car?.make ?? params.make ?? "",
      model: car?.model ?? params.model ?? "",
      trim: car?.trim,
      price: car?.price ?? card.price ?? 0,
      miles: car?.miles ?? 0,
      dealer: car?.dealer ?? card.dealer ?? "",
      city: car?.city,
      phone: car?.phone ?? "",
      badge: i === 0 ? { label: "🔥 most negotiable", reasons } : undefined,
      reasons,
      negotiability: {
        priceDrops: car?.priceDrops ?? 0,
        totalDrop: car?.totalDrop ?? 0,
        daysListed: car?.daysListed ?? null,
        marketDelta: car?.marketDelta ?? null,
      },
    };
  });

  return { params, search_url: result.search_url, median, cards };
}
