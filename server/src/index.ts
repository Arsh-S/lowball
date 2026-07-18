import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { ingestListing } from "./ingest.js";
import { startNegotiation } from "./negotiate.js";
import { handleVapiWebhook } from "./webhook.js";
import { addClient } from "./dashboard.js";
import { extractCriteria, search } from "./search.js";
import type { Car } from "./types.js";

const WEB_DIR = fileURLToPath(new URL("../../web", import.meta.url));

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

app.get("/", async (_req, reply) => {
  reply.type("text/html").send(readFileSync(`${WEB_DIR}/index.html`, "utf8"));
});
app.get("/styles.css", async (_req, reply) => {
  reply.type("text/css").send(readFileSync(`${WEB_DIR}/styles.css`, "utf8"));
});
app.get("/intro.js", async (_req, reply) => {
  reply.type("text/javascript").send(readFileSync(`${WEB_DIR}/intro.js`, "utf8"));
});

app.post<{ Body: { query: string; client?: string } }>("/search", async (req, reply) => {
  const query = req.body?.query?.trim();
  if (!query) return reply.code(400).send({ error: "query is required" });
  const criteria = await extractCriteria(query);
  return search(query, criteria);
});

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
