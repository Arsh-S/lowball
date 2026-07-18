# Bill Assassin — Implementation Plan (Ramp Builders Cup, Jul 18 2026)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax. NOTE: this is a 4-hour hackathon plan — verification is manual (make the call, watch the screen), not unit tests. Do not add test suites.

**Goal:** An AI voice agent that phones a company's "retention line," negotiates a bill down live on speakerphone with real-time captions on a dashboard, and ends with a "You saved $X/mo" receipt.

**Architecture:** Node/TypeScript server bridges Twilio Media Streams (phone audio) ↔ OpenAI Realtime API (speech-to-speech) over WebSockets, exposed publicly via ngrok. The agent uses function tools (`log_offer`, `accept_offer`, `end_call`) whose calls drive a React dashboard over a second WebSocket: live transcript captions, an "offer ticker" counting the bill down, and a final savings receipt. Bill upload → OpenAI vision → JSON seeds the agent's negotiation context.

**Tech Stack:** Node 20+, TypeScript, Fastify + @fastify/websocket, ws, Twilio (Programmable Voice + Media Streams), OpenAI Realtime API (`gpt-realtime`, g711_ulaw audio), OpenAI vision model for bill parsing, Vite + React dashboard, ngrok.

## Global Constraints

- Hacking window is 11:00–3:30 with lunch at 12:45. Demo rehearsal starts 2:45 NO MATTER WHAT. Cut scope, never rehearsal.
- Judging rubric at comparable OpenAI events: Running Code 25% / Innovation 25% / Impact 25% / Theme 25%. A video fallback scores near zero on Running Code — the live call must work.
- The "company rep" on the demo call is a TEAMMATE'S PHONE with a script (see Task 8). Never cold-call a real company at the booth.
- Booths are loud: captions on screen are not optional, they ARE the demo for anyone who can't hear.
- Track submissions: **Save Time. Save Money.** (primary), **Best Use of Sponsors** (OpenAI Realtime + built in Cursor). Mention both in the pitch.
- Base the Twilio↔Realtime bridge on the official starter (`openai/openai-realtime-twilio-demo`, MIT). If Realtime event names in this plan have drifted from the current API, the starter repo is the source of truth — mirror it.
- Everyone on the team has $50 OpenAI credits. `gpt-realtime` audio ≈ $0.30/min combined; a 3-min call ≈ $1. Budget is a non-issue; do not spend time optimizing tokens.

## Team split (3 people; collapse C into A+B if only 2)

- **A (Arsh):** Tasks 1–4 — telephony bridge, Realtime session, tools, dashboard socket. The critical path.
- **B:** Tasks 5–6 — dashboard UI (upload → live call view → receipt).
- **C:** Tasks 7–9 — bill parsing endpoint, negotiation prompt tuning, rep script + demo assets.

---

## Task 0: Pre-hacking setup (DO BEFORE 11:00 — during check-in/kickoff)

**Files:** none (accounts + keys)

- [ ] **Step 1: Twilio account ready.** Sign up at twilio.com → **upgrade with $20** (card required). Non-negotiable: trial accounts play a "trial account" robo-preamble on every call and can only dial verified numbers — both kill the demo. Buy one US local number (~$1.15/mo).
- [ ] **Step 2: Verify caller flow.** In Twilio Console note: Account SID, Auth Token, purchased number. Add all teammates' cell numbers to Verified Caller IDs anyway (belt and suspenders).
- [ ] **Step 3: OpenAI key.** Create API key at platform.openai.com, confirm the $50 hackathon credits are applied to the org. Confirm `gpt-realtime` appears in the model list.
- [ ] **Step 4: ngrok.** Sign up free at ngrok.com → claim your **free static domain** (e.g. `bill-assassin.ngrok-free.app`) → install: `brew install ngrok && ngrok config add-authtoken <token>`. Static domain matters: Twilio webhook URLs won't need re-pasting every restart.
- [ ] **Step 5: Clone the reference.** `git clone https://github.com/openai/openai-realtime-twilio-demo ~/ref-realtime-twilio` — offline reference for exact current event names.
- [ ] **Step 6: Scaffold repo** (can also be done the night before):

```bash
mkdir -p ~/bill-assassin/server/src ~/bill-assassin/web
cd ~/bill-assassin/server && npm init -y && npm i fastify @fastify/websocket @fastify/formbody @fastify/multipart @fastify/cors ws twilio openai dotenv && npm i -D typescript tsx @types/ws @types/node && npx tsc --init --target es2022 --module nodejs --moduleResolution bundler --strict
cd ~/bill-assassin/web && npm create vite@latest . -- --template react-ts && npm i
```

- [ ] **Step 7: `.env`** at `server/.env`:

```
OPENAI_API_KEY=sk-...
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_NUMBER=+1...
PUBLIC_DOMAIN=bill-assassin.ngrok-free.app
REALTIME_MODEL=gpt-realtime
VISION_MODEL=gpt-5.6
PORT=8081
```

---

## Task 1: Server skeleton + Twilio call-in wiring

**Files:**
- Create: `server/src/index.ts`

**Interfaces:**
- Produces: Fastify app on `:8081` with `GET /twiml` (returns TwiML pointing Twilio at our media WebSocket), `WS /media-stream` (Task 2 fills in), `WS /dashboard` (Task 4), `POST /call` (Task 3), `POST /parse-bill` (Task 7).

- [ ] **Step 1: Write `server/src/index.ts`:**

```typescript
import Fastify from "fastify";
import fastifyWs from "@fastify/websocket";
import fastifyFormBody from "@fastify/formbody";
import fastifyMultipart from "@fastify/multipart";
import cors from "@fastify/cors";
import dotenv from "dotenv";
import { handleMediaStream } from "./bridge";
import { registerDashboard } from "./dashboard";
import { registerCall } from "./call";
import { registerParseBill } from "./parseBill";

dotenv.config();
const app = Fastify();
await app.register(fastifyWs);
await app.register(fastifyFormBody);
await app.register(fastifyMultipart, { limits: { fileSize: 20_000_000 } });
await app.register(cors, { origin: true });

// Twilio hits this when the outbound call connects; it tells Twilio to
// open a media stream to our bridge.
app.all("/twiml", async (_req, reply) => {
  reply.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${process.env.PUBLIC_DOMAIN}/media-stream" />
  </Connect>
</Response>`);
});

app.get("/media-stream", { websocket: true }, (conn) => handleMediaStream(conn));
registerDashboard(app);
registerCall(app);
registerParseBill(app);

await app.listen({ port: Number(process.env.PORT ?? 8081), host: "0.0.0.0" });
console.log("Bill Assassin server up on", process.env.PORT ?? 8081);
```

- [ ] **Step 2: Stub the four imports** so it boots: create `bridge.ts`, `dashboard.ts`, `call.ts`, `parseBill.ts` each exporting an empty function of the right name.
- [ ] **Step 3: Run it:** `cd server && npx tsx src/index.ts` → expect the "server up" log. In a second terminal: `ngrok http --domain=$PUBLIC_DOMAIN 8081`.
- [ ] **Step 4: Verify:** `curl https://<domain>/twiml` returns the TwiML XML.
- [ ] **Step 5: Commit:** `git init && git add -A && git commit -m "server skeleton + twiml"`

## Task 2: Twilio ↔ OpenAI Realtime audio bridge (THE critical path)

**Files:**
- Create: `server/src/bridge.ts`
- Create: `server/src/agent.ts` (session config: instructions + tools)

**Interfaces:**
- Consumes: `buildSessionConfig(bill)` from `agent.ts`; `broadcast(msg)` from `dashboard.ts` (Task 4 — stub as `console.log` until then); `getActiveBill()` from `call.ts`.
- Produces: working two-way phone audio with the agent.

- [ ] **Step 1: Write `server/src/bridge.ts`:**

```typescript
import WebSocket from "ws";
import type { WebSocket as FWebSocket } from "@fastify/websocket";
import { buildSessionConfig, handleToolCall } from "./agent";
import { broadcast } from "./dashboard";
import { getActiveBill } from "./call";

export function handleMediaStream(twilioWs: FWebSocket) {
  let streamSid = "";
  const oa = new WebSocket(
    `wss://api.openai.com/v1/realtime?model=${process.env.REALTIME_MODEL}`,
    { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
  );

  oa.on("open", () => {
    oa.send(JSON.stringify(buildSessionConfig(getActiveBill())));
    // Agent speaks first when the callee picks up:
    oa.send(JSON.stringify({ type: "response.create" }));
  });

  // Twilio -> OpenAI (caller audio, base64 g711_ulaw)
  twilioWs.on("message", (raw: Buffer) => {
    const msg = JSON.parse(raw.toString());
    if (msg.event === "start") { streamSid = msg.start.streamSid; broadcast({ type: "call_started" }); }
    if (msg.event === "media" && oa.readyState === WebSocket.OPEN)
      oa.send(JSON.stringify({ type: "input_audio_buffer.append", audio: msg.media.payload }));
    if (msg.event === "stop") { broadcast({ type: "call_ended" }); oa.close(); }
  });

  // OpenAI -> Twilio + dashboard
  oa.on("message", (raw: Buffer) => {
    const ev = JSON.parse(raw.toString());

    // NOTE: if these event names 404 against the live API, mirror
    // ~/ref-realtime-twilio — it has the current names.
    if (ev.type === "response.output_audio.delta" || ev.type === "response.audio.delta")
      twilioWs.send(JSON.stringify({ event: "media", streamSid, media: { payload: ev.delta } }));

    // Barge-in: caller started talking -> cut the agent off
    if (ev.type === "input_audio_buffer.speech_started") {
      twilioWs.send(JSON.stringify({ event: "clear", streamSid }));
      oa.send(JSON.stringify({ type: "response.cancel" }));
    }

    // Captions
    if (ev.type === "response.output_audio_transcript.delta" || ev.type === "response.audio_transcript.delta")
      broadcast({ type: "caption", speaker: "assassin", text: ev.delta, partial: true });
    if (ev.type === "conversation.item.input_audio_transcription.completed")
      broadcast({ type: "caption", speaker: "rep", text: ev.transcript, partial: false });

    // Tool calls drive the dashboard
    if (ev.type === "response.function_call_arguments.done")
      handleToolCall(ev.name, JSON.parse(ev.arguments), ev.call_id, oa, twilioWs, streamSid);

    if (ev.type === "error") { console.error("OA error", ev); broadcast({ type: "error", detail: ev.error?.message }); }
  });

  twilioWs.on("close", () => oa.close());
  oa.on("close", () => { try { twilioWs.close(); } catch {} });
}
```

- [ ] **Step 2: Write `server/src/agent.ts`:**

```typescript
import type WebSocket from "ws";
import { broadcast } from "./dashboard";
import type { Bill } from "./call";

export function buildSessionConfig(bill: Bill | null) {
  return {
    type: "session.update",
    session: {
      instructions: negotiationPrompt(bill),
      voice: "marin",
      input_audio_format: "g711_ulaw",
      output_audio_format: "g711_ulaw",
      input_audio_transcription: { model: "whisper-1" },
      turn_detection: { type: "server_vad", silence_duration_ms: 600 },
      tools: [
        { type: "function", name: "log_offer",
          description: "Record every price the rep offers, the moment they say it.",
          parameters: { type: "object", properties: { monthly_price: { type: "number" }, terms: { type: "string" } }, required: ["monthly_price"] } },
        { type: "function", name: "accept_offer",
          description: "Accept the deal. Only if monthly_price <= the target you were given.",
          parameters: { type: "object", properties: { monthly_price: { type: "number" } }, required: ["monthly_price"] } },
        { type: "function", name: "end_call",
          description: "Politely end the call after accepting, or if the rep refuses to budge after 3 attempts.",
          parameters: { type: "object", properties: { outcome: { type: "string", enum: ["deal", "no_deal"] } } } },
      ],
      tool_choice: "auto",
    },
  };
}

function negotiationPrompt(bill: Bill | null) {
  const b = bill ?? { provider: "Optimum", service: "internet", monthly: 89.99, account: "demo", target: 55 };
  return `You are "Bill Assassin", a ruthless but unfailingly polite bill negotiator calling ${b.provider} on behalf of your client.

CLIENT'S BILL: ${b.service}, currently $${b.monthly}/month, account ${b.account}.
YOUR TARGET: $${b.target}/month or better. Anything at or below target: call accept_offer immediately.

PLAYBOOK, in order:
1. Open: confirm you've reached ${b.provider}, say you're calling about account ${b.account} because the client is considering cancelling over price.
2. Anchor low: competitor (Verizon Fios) offers the same service for $${Math.round(b.target * 0.9)}/mo. Ask them to beat it.
3. Loyalty lever: client has paid on time for 3 years. Ask what retention offers exist.
4. If they stall, ask directly for the retention/cancellation department.
5. Escalate to a polite cancellation threat: "then let's proceed with cancelling, unless there's anything else you can do."
6. Every time the rep names a price, call log_offer BEFORE responding.
7. Never accept above target unless the rep has refused three separate times; then take the best logged offer if it beats $${b.monthly}, else end_call with no_deal.

STYLE: short spoken sentences, warm but relentless, never lie beyond the scripted competitor anchor, never share info you don't have. You are on a real phone call: no lists, no markdown, just talk.`;
}

export function handleToolCall(
  name: string, args: any, callId: string,
  oa: WebSocket, twilioWs: any, streamSid: string
) {
  if (name === "log_offer") broadcast({ type: "offer", price: args.monthly_price, terms: args.terms ?? "" });
  if (name === "accept_offer") broadcast({ type: "deal", price: args.monthly_price });
  if (name === "end_call") {
    broadcast({ type: "call_outcome", outcome: args.outcome });
    // give the goodbye 3s to play out, then hang up by closing the stream
    setTimeout(() => { try { twilioWs.close(); } catch {} }, 3000);
  }
  // ACK the tool call so the model keeps talking
  oa.send(JSON.stringify({ type: "conversation.item.create", item: {
    type: "function_call_output", call_id: callId, output: JSON.stringify({ ok: true }) } }));
  oa.send(JSON.stringify({ type: "response.create" }));
}
```

- [ ] **Step 3: Verify with an inbound call (fastest loop):** In Twilio Console → your number → Voice Configuration → "A call comes in" → Webhook `https://<domain>/twiml` (HTTP POST). Save. Call the Twilio number from your cell. Expected: the Assassin greets you and starts negotiating. Talk back; it should barge-in correctly.
- [ ] **Step 4: If silence:** check ngrok request log (twiml hit?), server logs (OA error events?), and compare event names against `~/ref-realtime-twilio/websocket-server/src/sessionManager.ts`.
- [ ] **Step 5: Commit:** `git add -A && git commit -m "twilio-realtime bridge + negotiation agent"`

## Task 3: Outbound calling

**Files:**
- Create: `server/src/call.ts`

**Interfaces:**
- Produces: `POST /call {to, bill}` → dials the rep's phone; `getActiveBill(): Bill | null`; `type Bill = { provider: string; service: string; monthly: number; account: string; target: number }`.

- [ ] **Step 1: Write `server/src/call.ts`:**

```typescript
import twilio from "twilio";
import type { FastifyInstance } from "fastify";

export type Bill = { provider: string; service: string; monthly: number; account: string; target: number };
let activeBill: Bill | null = null;
export const getActiveBill = () => activeBill;

export function registerCall(app: FastifyInstance) {
  app.post("/call", async (req, reply) => {
    const { to, bill } = req.body as { to: string; bill: Bill };
    activeBill = bill;
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const call = await client.calls.create({
      to,
      from: process.env.TWILIO_NUMBER!,
      url: `https://${process.env.PUBLIC_DOMAIN}/twiml`,
    });
    reply.send({ sid: call.sid });
  });
}
```

- [ ] **Step 2: Verify:** `curl -X POST https://<domain>/call -H 'content-type: application/json' -d '{"to":"+1<teammate cell>","bill":{"provider":"Optimum","service":"internet","monthly":89.99,"account":"8834-2210","target":55}}'` → teammate's phone rings, Assassin opens the negotiation using those numbers.
- [ ] **Step 3: Commit.**

## Task 4: Dashboard WebSocket hub

**Files:**
- Create: `server/src/dashboard.ts`

**Interfaces:**
- Produces: `broadcast(msg: object)` — fan-out to all connected dashboards; `WS /dashboard`. Message types the frontend consumes: `call_started`, `caption {speaker: "assassin"|"rep", text, partial}`, `offer {price, terms}`, `deal {price}`, `call_outcome {outcome}`, `call_ended`, `error {detail}`.

- [ ] **Step 1: Write `server/src/dashboard.ts`:**

```typescript
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "@fastify/websocket";

const clients = new Set<WebSocket>();
export function broadcast(msg: object) {
  const s = JSON.stringify(msg);
  for (const c of clients) { try { c.send(s); } catch {} }
}
export function registerDashboard(app: FastifyInstance) {
  app.get("/dashboard", { websocket: true }, (conn) => {
    clients.add(conn);
    conn.on("close", () => clients.delete(conn));
  });
}
```

- [ ] **Step 2: Verify:** `npx wscat -c wss://<domain>/dashboard`, run a call, watch caption/offer JSON stream by.
- [ ] **Step 3: Commit.**

## Task 5: Dashboard UI — upload → live call → receipt

**Files:**
- Create: `web/src/App.tsx` (replace scaffold), `web/src/App.css`

**Interfaces:**
- Consumes: `WS /dashboard` messages (Task 4), `POST /parse-bill` → `Bill` (Task 7), `POST /call` (Task 3).

- [ ] **Step 1: Write `web/src/App.tsx`:** three screens in one component, state machine `idle → parsing → ready → calling → done`.

```tsx
import { useEffect, useRef, useState } from "react";
import "./App.css";

const SERVER = `https://${import.meta.env.VITE_DOMAIN ?? "bill-assassin.ngrok-free.app"}`;
type Bill = { provider: string; service: string; monthly: number; account: string; target: number };
type Caption = { speaker: "assassin" | "rep"; text: string };

export default function App() {
  const [phase, setPhase] = useState<"idle"|"parsing"|"ready"|"calling"|"done">("idle");
  const [bill, setBill] = useState<Bill | null>(null);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [currentOffer, setCurrentOffer] = useState<number | null>(null);
  const [dealPrice, setDealPrice] = useState<number | null>(null);
  const [repPhone, setRepPhone] = useState("");
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    const sock = new WebSocket(`${SERVER.replace("https", "wss")}/dashboard`);
    sock.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.type === "caption") setCaptions((c) => {
        const last = c[c.length - 1];
        if (m.partial && last?.speaker === m.speaker) // append streaming delta
          return [...c.slice(0, -1), { speaker: m.speaker, text: last.text + m.text }];
        return [...c, { speaker: m.speaker, text: m.text }];
      });
      if (m.type === "offer") setCurrentOffer(m.price);
      if (m.type === "deal") setDealPrice(m.price);
      if (m.type === "call_outcome" || m.type === "call_ended") setPhase("done");
      if (m.type === "call_started") setPhase("calling");
    };
    ws.current = sock;
    return () => sock.close();
  }, []);

  async function uploadBill(file: File) {
    setPhase("parsing");
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`${SERVER}/parse-bill`, { method: "POST", body: fd });
    setBill(await res.json());
    setPhase("ready");
  }

  async function assassinate() {
    setCaptions([]); setCurrentOffer(null); setDealPrice(null);
    await fetch(`${SERVER}/call`, { method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: repPhone, bill }) });
  }

  const saved = bill && dealPrice != null ? (bill.monthly - dealPrice) : null;

  if (phase === "idle" || phase === "parsing") return (
    <main className="hero">
      <h1>🎯 Bill Assassin</h1>
      <p>Upload a bill. We call them. You save.</p>
      <label className="drop">
        {phase === "parsing" ? "Reading your bill…" : "Drop bill photo / PDF"}
        <input type="file" accept="image/*,.pdf" hidden
          onChange={(e) => e.target.files && uploadBill(e.target.files[0])} />
      </label>
    </main>
  );

  if (phase === "ready") return (
    <main className="hero">
      <h2>{bill!.provider} · {bill!.service}</h2>
      <div className="big">${bill!.monthly}/mo</div>
      <p>Target: ${bill!.target}/mo</p>
      <input placeholder="+1 rep phone number" value={repPhone} onChange={(e) => setRepPhone(e.target.value)} />
      <button className="kill" onClick={assassinate}>☎️ ASSASSINATE THIS BILL</button>
    </main>
  );

  if (phase === "calling") return (
    <main className="call">
      <div className="ticker">
        <span>was ${bill?.monthly}/mo</span>
        <span className="now">{currentOffer != null ? `latest offer $${currentOffer}/mo` : "negotiating…"}</span>
      </div>
      <div className="transcript">
        {captions.map((c, i) => (
          <p key={i} className={c.speaker}>
            <b>{c.speaker === "assassin" ? "🎯 Assassin" : "🏢 Rep"}:</b> {c.text}
          </p>
        ))}
      </div>
    </main>
  );

  return (
    <main className="hero receipt">
      {saved != null && saved > 0 ? (
        <>
          <h1>💸 SAVED ${saved.toFixed(2)}/mo</h1>
          <div className="big">${(saved * 12).toFixed(0)}/year</div>
          <p>{bill?.provider}: ${bill?.monthly} → ${dealPrice}</p>
        </>
      ) : (<h1>They survived… this time.</h1>)}
      <button onClick={() => setPhase("ready")}>Run it again</button>
    </main>
  );
}
```

- [ ] **Step 2: Style `App.css`:** dark background (#0b0e14), one red accent (#ff3b3b) for the ASSASSINATE button and savings number, transcript bubbles left (rep, gray) / right (assassin, red tint), `.big { font-size: 5rem; font-weight: 800 }`. Auto-scroll transcript: `overflow-y: auto` + `scrollIntoView` on last caption. Big enough to read from 10 feet — booth screen is the demo.
- [ ] **Step 3: Verify end-to-end:** `cd web && npm run dev`, upload a bill photo, enter teammate number, press ASSASSINATE → phone rings, captions stream, offer ticker drops, receipt shows savings.
- [ ] **Step 4: Commit.**

## Task 6: Confetti + polish (only if Task 5 done before 2:15)

**Files:** Modify: `web/src/App.tsx`

- [ ] **Step 1:** `npm i canvas-confetti` in `web/`; fire on `deal` message: `import confetti from "canvas-confetti"; confetti({ particleCount: 200, spread: 90 });`
- [ ] **Step 2:** Add a subtle pulsing red "● LIVE CALL" badge during `calling` phase.
- [ ] **Step 3: Commit.**

## Task 7: Bill parsing (vision)

**Files:**
- Create: `server/src/parseBill.ts`

**Interfaces:**
- Produces: `POST /parse-bill` (multipart file) → `Bill` JSON (Task 3's type).

- [ ] **Step 1: Write `server/src/parseBill.ts`:**

```typescript
import OpenAI from "openai";
import type { FastifyInstance } from "fastify";

export function registerParseBill(app: FastifyInstance) {
  app.post("/parse-bill", async (req, reply) => {
    const file = await (req as any).file();
    const buf = await file.toBuffer();
    const b64 = `data:${file.mimetype};base64,${buf.toString("base64")}`;
    const openai = new OpenAI();
    const res = await openai.chat.completions.create({
      model: process.env.VISION_MODEL!,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: [
        { type: "text", text: `Extract from this bill as JSON: {"provider": string, "service": string (e.g. "internet"), "monthly": number, "account": string}. If unreadable, use provider "Optimum", service "internet", monthly 89.99, account "8834-2210".` },
        { type: "image_url", image_url: { url: b64 } },
      ]}],
    });
    const parsed = JSON.parse(res.choices[0].message.content!);
    parsed.target = Math.round(parsed.monthly * 0.62); // aim for ~38% cut
    reply.send(parsed);
  });
}
```

- [ ] **Step 2: Verify:** `curl -F "file=@bill.jpg" https://<domain>/parse-bill` returns sane JSON. Print + photograph the fake bill from Task 8 as the test asset.
- [ ] **Step 3: Commit.**

## Task 8: Demo assets — fake bill + rep script

**Files:**
- Create: `assets/optimum-bill.html` (print or screenshot it), `assets/rep-script.md`

- [ ] **Step 1:** Make a realistic-looking FAKE "Optimum" internet bill page: account 8834-2210, $89.99/mo, obviously watermarked "DEMO". This is the thing visitors watch get parsed.
- [ ] **Step 2:** Write `rep-script.md` — the teammate playing the rep follows beats, not lines: (1) open "Optimum retention, how can I help?", (2) first refusal "that's our standard rate", (3) counter at $75 when the competitor is mentioned, (4) counter at $60 when cancellation is threatened, (5) cave to $55 "one-time loyalty discount" → lets the agent hit target and fire the deal → confetti. Whole call ≤ 2.5 min. Rehearse resisting harder ONCE so you know the no_deal path also looks good.
- [ ] **Step 3:** **Audience participation mode (this wins the booth):** after the scripted demo, invite the visitor: "you be the rep — see if YOU can resist the Assassin." Type their number in, call their phone. Their friends watch the captions. This converts every visitor into a voter.

## Task 9: Fallback — browser practice mode (build ONLY if Twilio breaks)

**Files:** Create: `web/src/Practice.tsx`

- [ ] If venue circumstances kill telephony (Twilio outage, blocked ports — ngrok wss usually survives conference Wi-Fi, hotspot is plan B), pivot: WebRTC Realtime session in the browser, visitor talks to the negotiator mic-to-mic as "the rep", same captions + ticker + receipt. The reference for browser WebRTC auth (ephemeral key endpoint) is in the official OpenAI Realtime docs / console examples. Same agent.ts prompt and tools, so ~45 min pivot. Decide by 2:00 — do not run both paths.

---

## Timeline (hard checkpoints)

| Time | Milestone | If behind |
|---|---|---|
| 11:00 | Task 0 done, repo boots | do Task 0 during kickoff talks |
| 11:45 | **Task 2: AI answers a phone call** | ALL hands on the bridge; nothing else matters |
| 12:30 | Tasks 3+4: outbound call + events streaming | B keeps building UI against fake WS messages |
| 1:15 | Task 5: full loop upload→call→receipt | cut Task 7, hardcode the demo bill |
| 2:15 | Task 6 polish, Task 8 rehearsed once | skip confetti |
| 2:45 | **Feature freeze. 3 full rehearsals** | non-negotiable |
| 3:15 | Booth: laptop on stand, phone on speaker, captions maxed, QR to repo | |

## Demo script (90 seconds, career-fair loop)

1. Hook (10s): "Americans overpay $60B/yr on bills because negotiating means 45 minutes on hold. We built an assassin for that."
2. Upload the fake Optimum bill → parsed on screen (10s).
3. Press ASSASSINATE → teammate's phone rings ON SPEAKER (5s).
4. The call plays out, crowd reads captions, offer ticker drops 89.99 → 75 → 60 → 55, confetti (60s).
5. Close (5s): "Saved $420/year in two minutes. Built today with the OpenAI Realtime API. Want to try being the rep?"

## Risks

- **Realtime event-name drift** → mirror the cloned reference repo (Task 0 Step 5). Highest-probability failure; that's why the bridge is first and solo-owned.
- **Trial-account preamble ruins the call** → upgraded account (Task 0 Step 1).
- **Loud booth** → captions are primary; speakerphone held to the crowd is theater.
- **Venue Wi-Fi** → phone hotspot for the laptop; calls themselves ride Twilio's network, not venue Wi-Fi.
- **Agent accepts a bad deal live** → target threshold is in the prompt AND the rep script guarantees a path under target.
