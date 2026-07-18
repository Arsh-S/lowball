import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { ingestListing } from "./ingest.js";
import { startNegotiation } from "./negotiate.js";
import { handleVapiWebhook } from "./webhook.js";
import { addClient } from "./dashboard.js";
import { handleSearch, packetCache } from "./search.js";
import type { Car } from "./types.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(websocket);

app.get("/health", async () => ({
  ok: true,
  vapi: Boolean(process.env.VAPI_API_KEY),
  vapiPhone: Boolean(process.env.VAPI_PHONE_NUMBER_ID),
  apify: Boolean(process.env.APIFY_TOKEN && process.env.APIFY_ACTOR_ID),
  openai: Boolean(process.env.OPENAI_API_KEY),
  publicDomain: process.env.PUBLIC_DOMAIN ?? null,
  scraper: process.env.SCRAPER_URL ?? "http://localhost:8090",
}));

app.post<{ Body: { url: string } }>("/ingest", async (req, reply) => {
  if (!req.body?.url) return reply.code(400).send({ error: "url is required" });
  return ingestListing(req.body.url);
});

app.post<{ Body: { query: string } }>("/search", async (req, reply) => {
  if (!req.body?.query) return reply.code(400).send({ error: "query is required" });
  try {
    return await handleSearch(req.body.query);
  } catch (err) {
    req.log.error(err);
    return reply.code(502).send({ error: (err as Error).message });
  }
});

app.post<{
  Body: { listingId?: string; clientName?: string; dealerPhone?: string; car?: Car };
}>("/negotiate", async (req, reply) => {
  const { listingId, clientName, dealerPhone, car: bodyCar } = req.body ?? {};

  let car: Car | undefined;
  if (listingId) {
    car = packetCache.get(listingId);
    if (!car) return reply.code(404).send({ error: "unknown listingId — run /search first" });
    if (clientName) car = { ...car, clientName };
  } else {
    car = bodyCar;
  }
  if (!car) return reply.code(400).send({ error: "listingId or car is required" });

  try {
    return await startNegotiation(car, dealerPhone);
  } catch (err) {
    req.log.error(err);
    return reply.code(500).send({ error: (err as Error).message });
  }
});

app.post("/vapi-webhook", async (req) => handleVapiWebhook(req.body));

app.register(async (scope) => {
  scope.get("/dashboard", { websocket: true }, (conn: any) => {
    addClient(conn.socket ?? conn); // v8 SocketStream vs v10+ WebSocket
  });
});

const port = Number(process.env.PORT) || 8081;
await app.listen({ port, host: "0.0.0.0" });
