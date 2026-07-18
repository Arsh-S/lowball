import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { ingestListing } from "./ingest.js";
import { startNegotiation } from "./negotiate.js";
import { handleVapiWebhook } from "./webhook.js";
import { addClient } from "./dashboard.js";
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
}));

app.post<{ Body: { url: string } }>("/ingest", async (req, reply) => {
  if (!req.body?.url) return reply.code(400).send({ error: "url is required" });
  return ingestListing(req.body.url);
});

app.post<{ Body: { car: Car; dealerPhone?: string } }>("/negotiate", async (req, reply) => {
  if (!req.body?.car) return reply.code(400).send({ error: "car is required" });
  try {
    return await startNegotiation(req.body.car, req.body.dealerPhone);
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
