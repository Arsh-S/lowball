export type PricePoint = { date: string; price: number };

export type Car = {
  year: number;
  make: string;
  model: string;
  miles: number;
  price: number;
  dealer: string;
  phone: string;
  target: number;
  // Negotiation intel from the scraper dataset (optional — /ingest cars won't have it).
  priceHistory?: PricePoint[]; // newest first, from the VDP price-history table
  marketMedian?: number; // median asking of comparable make+model nearby
};

export function defaultTarget(price: number): number {
  return Math.round((price * 0.91) / 100) * 100;
}
