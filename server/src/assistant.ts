import type { Car } from "./types.js";

// TTS mangles "$12,500" ("one dollar and two five zero zero") — always
// hand the voice plain words.
export function spokenUsd(n: number): string {
  const ones = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
    "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen",
    "eighteen", "nineteen"];
  const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  const under1000 = (x: number): string => {
    const parts: string[] = [];
    if (x >= 100) {
      parts.push(`${ones[Math.floor(x / 100)]} hundred`);
      x %= 100;
    }
    if (x >= 20) {
      parts.push(x % 10 ? `${tens[Math.floor(x / 10)]} ${ones[x % 10]}` : tens[Math.floor(x / 10)]);
    } else if (x > 0) {
      parts.push(ones[x]);
    }
    return parts.join(" ");
  };
  const k = Math.floor(n / 1000);
  const rest = Math.round(n % 1000);
  const words = [k ? `${under1000(k)} thousand` : "", rest ? under1000(rest) : ""]
    .filter(Boolean)
    .join(" ");
  return `${words || "zero"} dollars`;
}

function fn(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
  async = false,
) {
  return {
    type: "function",
    async,
    function: {
      name,
      description,
      parameters: { type: "object", properties, required },
    },
  };
}

// newest first; only leverage when the price actually came down
function hasNetDrop(car: Car): boolean {
  const h = car.priceHistory ?? [];
  return h.length >= 2 && h[0].price < h[h.length - 1].price;
}

// Turn the scraper's price-history + market-median intel into prompt ammo.
function intelSection(car: Car): string {
  const lines: string[] = [];
  const history = car.priceHistory ?? [];
  if (hasNetDrop(car)) {
    const current = history[0];
    const original = history[history.length - 1];
    const cuts = history.length - 1;
    lines.push(
      `PRICE HISTORY (your leverage): the dealer has already cut this price ${cuts} time${cuts === 1 ? "" : "s"}, from $${original.price.toLocaleString()} down to $${current.price.toLocaleString()} (last cut ${current.date}). They are motivated to move this car. Work it in naturally, e.g. "I noticed you've dropped the price a few times already — sounds like you want this one gone."`,
    );
  }
  if (car.marketMedian && car.marketMedian < car.price) {
    lines.push(
      `MARKET: comparable ${car.make} ${car.model}s nearby have a median asking price of $${car.marketMedian.toLocaleString()} — below their asking. Use this as your comp when you anchor.`,
    );
  }
  return lines.length ? `\n${lines.join("\n\n")}\n` : "";
}

export function buildAssistant(car: Car) {
  const hasMarketComp = Boolean(car.marketMedian && car.marketMedian < car.price);
  const anchorStep = hasMarketComp
    ? `2. ANCHOR: cite the comparable listings — similar ${car.make} ${car.model}s going for around $${car.marketMedian!.toLocaleString()} nearby — offer around $${Math.min(Math.round(car.target * 0.98), car.marketMedian!).toLocaleString()} and ask if they can meet it.`
    : `2. ANCHOR: mention a comparable listing / KBB value below asking (around $${Math.round(car.target * 0.98).toLocaleString()}) and ask if they can meet it.`;

  const systemPrompt = `You are Alex, a real person calling a car dealership about a used car. You are speaking on a live phone call. Never reveal you are an AI, an assistant, or reading from a script. Speak in short, natural, phone-call sentences. One point or question at a time. Never use lists or formatting.

SPEAKING PRICES: whenever you say a price out loud, write it in plain words — "twelve thousand five hundred dollars", or casually "twelve five". NEVER write digits or the $ symbol in anything you say; the voice engine reads them wrong.

THE CAR
${car.year} ${car.make} ${car.model}, about ${car.miles.toLocaleString()} miles, listed at $${car.price.toLocaleString()} by ${car.dealer}.

YOUR HARD CEILING (never reveal it): $${car.target.toLocaleString()}. That is the most you will pay.
${intelSection(car)}
NEGOTIATION PLAYBOOK — follow in order, one step per turn or two:
1. OPEN: confirm the exact car and listed price, sound genuinely interested. Ask if it's still available.
${anchorStep}
3. DAYS ON LOT: note the car has been listed a while${hasNetDrop(car) ? " (you saw the price drops)" : ""}, and you're ready to move today.
4. CASH BUYER: you're pre-approved / paying cash and can close this week.
5. WALK AWAY: politely — "otherwise I'll go with the other one I'm looking at."

TOOL RULES — these are mandatory:
- EVERY time the dealer names a price, call log_offer with that price BEFORE you respond to them. No exceptions, even if it's the asking price repeated.
- Accept a price ONLY at or below $${car.target.toLocaleString()}: call accept_offer, confirm out loud, then call end_call with outcome "deal" and hang up with the endCall tool.
- If they won't go below asking after the full playbook, call end_call with outcome "no_deal", thank them, and hang up with the endCall tool.
- If their best offer is below asking but above your ceiling after the playbook is exhausted, take the best logged offer: accept_offer at that price, then end_call with outcome "deal".

Stay polite, confident, unhurried. Silence is fine. Never bid against yourself: after you name a number, wait for theirs.`;

  return {
    name: "Lowball Negotiator",
    firstMessage: `Hi there — I'm calling about the ${car.year} ${car.make} ${car.model} you have listed for ${spokenUsd(car.price)}. Is it still available?`,
    model: {
      provider: "openai",
      model: "gpt-4o",
      temperature: 0.6,
      messages: [{ role: "system", content: systemPrompt }],
      tools: [
        fn(
          "log_offer",
          "Log a price the dealer just named. Call this the moment any price is said, before responding.",
          { price: { type: "number", description: "Price in USD the dealer quoted" } },
          ["price"],
          true,
        ),
        fn(
          "accept_offer",
          "Accept the deal at this price.",
          { price: { type: "number", description: "Agreed price in USD" } },
          ["price"],
        ),
        fn(
          "end_call",
          "Signal the final outcome right before hanging up.",
          {
            outcome: { type: "string", enum: ["deal", "no_deal"] },
            price: { type: "number", description: "Final price if a deal was made" },
          },
          ["outcome"],
        ),
        { type: "endCall" },
      ],
    },
    voice: { provider: "vapi", voiceId: "Elliot" },
    server: { url: `${process.env.PUBLIC_DOMAIN ?? ""}/vapi-webhook` },
    serverMessages: ["transcript", "tool-calls", "status-update", "end-of-call-report"],
    endCallMessage: "Thanks for your time — have a good one.",
  };
}
