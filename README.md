<p align="center">
  <img src="web/lowball.png" alt="Lowball" width="160" />
</p>

# 🎯 Lowball, Ramp hackathon winner 

**Lowball is an AI agent that calls car dealers and negotiates the price down for you, live.**

Built for the Ramp Builders Cup (NYC, Jul 18 2026). Tracks: **Save Time. Save Money.** (primary) + **Best Use of Sponsors** (OpenAI, built in Cursor).

> **📵 Note:** Outbound phone calling is currently **disabled** on the live deployment
> ([lowball.arshsingh.net](https://lowball.arshsingh.net)) — the demo phone number has been
> turned off. Browse and search still work. The calling code is fully intact: set
> `CALLS_ENABLED=true` and `DEMO_CALL_NUMBER=<E.164 number>` in `server/.env` to re-enable.

---

## The pitch

Americans overpay ~$1,000+ on the average used car because negotiating means calling around, knowing the market, and being willing to walk. The dealer does this 10 times a day; you do it once every 6 years. Lowball fixes the asymmetry: paste a car listing, and an AI voice agent calls the dealer, negotiates like a hardened buyer, and hands you a receipt showing what it saved.

**90-second demo:** paste a real Facebook Marketplace / dealer listing → agent dials the dealer → crowd watches live captions and a price ticker drop `$12,500 → $11,900 → $11,300` → savings receipt + confetti. Then: *"you be the dealer — see if you can resist it"* and it calls a volunteer's phone.

---

## Why this niche

- **Biggest single savings story a demo can show.** "Saved $1,400" lands harder than any subscription-shaving demo.
- **Negotiation is expected in car sales** — a price inquiry to a dealer is normal business traffic, not spam.
- **Target dealers, not private sellers.** Dealer listings publish phone numbers; private FBM sellers are Messenger-only anyway, so scraping naturally points at dealers. Calling a dealership sales line as a genuine buyer is legitimate; cold AI-calling private individuals is not (FCC/TCPA treats AI-voice robocalls as regulated) — so we don't.
- Still dead-center on **Save Time. Save Money.**

---

## Architecture

```
Apify (scrape listing)  ─►  car JSON {make, model, year, price, dealer, phone}
                                    │
                            POST /negotiate
                                    │
        Vapi assistant (negotiation prompt + tools)  ──dials──►  📞 Dealer
                                    │
              Vapi live "listen" WS / server webhooks
                                    │
                            /dashboard WebSocket
                                    │
        React dashboard: live captions · price ticker · savings receipt + confetti
```

**Vapi replaces the hardest part** of a from-scratch build (the Twilio ↔ OpenAI Realtime audio bridge). Vapi handles telephony + speech-to-speech; we own the scrape, the negotiation brain (prompt + function tools), and the demo dashboard.

**Tech stack:** Node 20 + TypeScript (Fastify), Vapi (voice agent + telephony), OpenAI (negotiation model behind the Vapi assistant + listing enrichment), Apify (listing scraper), Vite + React dashboard, ngrok (public webhook URL).

---

## Components

| Path | Responsibility |
|---|---|
| `server/src/index.ts` | Fastify app; routes + dashboard WS |
| `server/src/ingest.ts` | `POST /ingest {url}` → Apify scrape → `Car` JSON |
| `server/src/listings.ts` | `GET /listings` → scraped dataset (`data/listings/`) → `Car` + intel (price history, market median) |
| `server/src/negotiate.ts` | `POST /negotiate {car \| listingId, dealerPhone?}` → creates Vapi call with assistant config |
| `server/src/assistant.ts` | Negotiation system prompt + function tools (`log_offer`, `accept_offer`, `end_call`) |
| `server/src/webhook.ts` | `POST /vapi-webhook` → transcript + tool-call events → `broadcast()` |
| `server/src/dashboard.ts` | `WS /dashboard` fan-out hub |
| `web/src/App.tsx` | Paste listing → live call view → receipt |

**`Car` type** (the contract every file shares):
```ts
type Car = { year: number; make: string; model: string; miles: number;
             price: number; dealer: string; phone: string; target: number;
             // optional intel from the scraper dataset:
             priceHistory?: { date: string; price: number }[]; marketMedian?: number };
```

The scraper (`scraping/`, see its README) fills `data/listings/` with 50 real
cars.com listings — every one with a dealer phone. `GET /listings` serves them,
`POST /negotiate {listingId}` dials one; real price-drop history and the
same-model market median feed straight into the negotiation prompt.

---

## The negotiation brain

System prompt playbook (in `assistant.ts`), in order:
1. **Open** — genuine buyer, name the exact car and listed price, express real interest.
2. **Anchor** — cite a comparable listing / KBB value below asking; ask them to meet it.
3. **Leverage days-on-lot** — "this has been listed a while, I'm ready to move today."
4. **Cash-buyer-today lever** — pre-approved / cash, can close this week.
5. **Walk-away** — polite: "otherwise I'll go with the other one I'm looking at."
6. Call `log_offer` **every** time the dealer names a price, before responding.
7. Accept only at/below `target`; else take best logged offer if under asking, else `end_call(no_deal)`.

Function tools drive the dashboard: `log_offer{price}` → ticker, `accept_offer{price}` → deal + confetti, `end_call{outcome}` → hang up + receipt.

`target` defaults to ~91% of asking (a realistic used-car ask); tune per demo.

---

## Demo-day rules (hard)

- **Live call is to a teammate playing the dealer** with a scripted set of beats ($12,500 → 11,900 → 11,300 → caves). Real scraped listing data seeds the agent so it's authentic (real car, real dealer name), but a real dealer not picking up or going off-script kills the demo. Do at most ONE real dealer call during hacking as a proof-clip, never live at the booth.
- **Captions on screen are the demo** — booths are loud; anyone who can't hear reads the transcript and watches the ticker.
- **Feature freeze at 2:45**, then 3 full rehearsals. Cut scope, never rehearsal.
- Judging weights running code equally with innovation/impact/theme — the call must run live, not from a video.

---

## Setup (do during check-in, before 11:00)

1. **Vapi** — account at vapi.ai, API key, buy/import a phone number (free Vapi numbers have outbound limits — buy one or import Twilio, ~2 min).
2. **Apify** — token; pick a Facebook Marketplace / dealer-listing actor (Gabe owns this — uses Apify at work).
3. **OpenAI** — API key ($50 hackathon credits) for the assistant model + listing enrichment.
4. **ngrok** — static domain for the Vapi webhook URL.
5. Scaffold:
   ```bash
   mkdir -p server/src web
   cd server && npm init -y && npm i fastify @fastify/websocket @fastify/cors @vapi-ai/server-sdk apify-client openai dotenv && npm i -D typescript tsx @types/node
   cd ../web && npm create vite@latest . -- --template react-ts && npm i
   ```
6. `server/.env`: `VAPI_API_KEY`, `VAPI_PHONE_NUMBER_ID`, `APIFY_TOKEN`, `OPENAI_API_KEY`, `PUBLIC_DOMAIN`, `PORT=8081`.

---

## Timeline

| Time | Milestone |
|---|---|
| 11:00 | Accounts + keys ready, repo boots |
| 11:45 | **Vapi assistant answers/places a call with the negotiation prompt** |
| 12:30 | Apify ingest → Car JSON; webhook → dashboard events streaming |
| 1:15 | Full loop: paste listing → call → live captions → receipt |
| 2:15 | Confetti + polish; rep script rehearsed |
| 2:45 | **Feature freeze. Rehearse ×3** |
| 3:15 | Booth: laptop on stand, phone on speaker, captions maxed, QR to this repo |

## Team split

- **Arsh** — Vapi assistant + call flow + webhook→dashboard wiring (critical path).
- **Gabe** — Apify ingest (listing → Car JSON), dealer script + demo listing.
- **+1** — React dashboard (paste → live call → receipt), confetti, styling.

---

## Risks

- **Vapi webhook/live-listen wiring** is the demo — wire it first, it's the whole dashboard.
- **Dealer goes off-script / doesn't answer** → demo call is always a teammate.
- **Venue Wi-Fi** → hotspot the laptop; the call itself rides Vapi's network.
- **Apify actor slow/blocked** → keep one pre-scraped listing JSON hardcoded as fallback.

---

*Ref: Vapi phone quickstart — https://docs.vapi.ai/quickstart/phone*
