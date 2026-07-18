import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { ingestListing } from "./ingest.js";
import { listListings } from "./listings.js";
import { handleSearch, packetCache } from "./search.js";

const WEB_DIR = fileURLToPath(new URL("../../web", import.meta.url));

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

app.get("/health", async () => ({
  ok: true,
  apify: Boolean(process.env.APIFY_TOKEN && process.env.APIFY_ACTOR_ID),
  openai: Boolean(process.env.OPENAI_API_KEY),
  publicDomain: process.env.PUBLIC_DOMAIN ?? null,
  scraper: process.env.SCRAPER_URL ?? "http://localhost:8090",
}));

app.get("/", async (_req, reply) => {
  reply.type("text/html").send(readFileSync(`${WEB_DIR}/index.html`, "utf8"));
});
app.get("/styles.css", async (_req, reply) => {
  reply.type("text/css").send(readFileSync(`${WEB_DIR}/styles.css`, "utf8"));
});
app.get("/intro.js", async (_req, reply) => {
  reply.type("text/javascript").send(readFileSync(`${WEB_DIR}/intro.js`, "utf8"));
});
for (const png of ["lowball.png", "favicon.png", "apple-touch-icon.png"]) {
  app.get(`/${png}`, async (_req, reply) => {
    reply.type("image/png").send(readFileSync(`${WEB_DIR}/${png}`));
  });
}

app.post<{ Body: { query: string; client?: string } }>("/search", async (req, reply) => {
  const query = req.body?.query?.trim();
  if (!query) return reply.code(400).send({ error: "query is required" });
  try {
    const result = await handleSearch(query);
    // Dashboard-compat aliases: web/intro.js renders `criteria` + `cars`
    // (mileage/location/why/hot/target), while the API's native shape is
    // `params` + `cards`. Serve both so neither client breaks.
    const cars = result.cards.map((c) => ({
      id: c.id,
      year: c.year,
      make: c.make,
      model: c.model,
      trim: c.trim,
      price: c.price,
      mileage: c.miles,
      dealer: c.dealer,
      phone: c.phone,
      location: c.city,
      photo: c.photo,
      url: c.url,
      hot: Boolean(c.badge),
      why: (c.badge?.reasons ?? c.reasons)?.join(" · ") || undefined,
      target: packetCache.get(c.id)?.target,
      priceCuts: c.negotiability.priceDrops,
      totalDrop: c.negotiability.totalDrop,
      marketDelta: c.negotiability.marketDelta,
    }));
    return { ...result, criteria: result.params, cars };
  } catch (err) {
    req.log.error(err);
    return reply.code(502).send({ error: (err as Error).message });
  }
});

app.post<{ Body: { url: string } }>("/ingest", async (req, reply) => {
  if (!req.body?.url) return reply.code(400).send({ error: "url is required" });
  return ingestListing(req.body.url);
});

app.get("/listings", async () => listListings());

const port = Number(process.env.PORT) || 8081;
await app.listen({ port, host: "0.0.0.0" });
