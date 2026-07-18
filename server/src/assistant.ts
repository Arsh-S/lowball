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

// "06/17/26" -> "Jun 17" (non-spoken label, only used to anchor a fact in time).
function shortDateLabel(d: string): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [m, day] = d.split("/").map(Number);
  return `${months[(m || 1) - 1]} ${day}`;
}

function round100(n: number): number {
  return Math.round(n / 100) * 100;
}

export function buildAssistant(car: Car) {
  const clientName = car.clientName ?? "Gabe";
  const trim = car.trim ? ` ${car.trim}` : "";

  const facts: string[] = [];
  if (car.priceDrops && car.priceDrops > 0 && car.priceHistory?.length) {
    const first = car.priceHistory[0];
    // Peak, not first entry — history can rise before it falls, and
    // "from <peak> down to <current>" is the always-true phrasing.
    const peak = Math.max(...car.priceHistory.map((p) => p.price));
    facts.push(
      `- Price history: cut ${car.priceDrops} time${car.priceDrops === 1 ? "" : "s"} since ${shortDateLabel(first.date)}, from a high of ${spokenUsd(peak)} down to ${spokenUsd(car.price)}${car.totalDrop ? ` — ${spokenUsd(car.totalDrop)} in total cuts` : ""}.`,
    );
  }
  if (car.daysListed != null) {
    facts.push(`- On the market at least ${car.daysListed} days.`);
  }
  if (car.milesPerYear != null) {
    facts.push(`- ${car.milesPerYear.toLocaleString()} miles/year vs ~12,000 typical.`);
  }
  if (car.marketMedian != null && car.marketDelta != null) {
    const dir = car.marketDelta > 0 ? "above" : "below";
    facts.push(
      `- Market: comparable listings median ${spokenUsd(car.marketMedian)} — this car is ${spokenUsd(Math.abs(car.marketDelta))} ${dir} that.`,
    );
  }
  if (car.comps?.length) {
    const alts = car.comps
      .map((c) => `a ${c.year} at ${c.dealer}, listed ${spokenUsd(c.price)}`)
      .join("; ");
    facts.push(
      `- Real alternatives ${clientName} is also considering (cite freely, never invent others): ${alts}.`,
    );
  }
  const factsBlock = facts.length
    ? `FACTS YOU MAY USE (all true — phrase them naturally, never as a list):\n${facts.join("\n")}`
    : "FACTS YOU MAY USE: none scraped for this listing — rely on the car itself and the negotiation strategy.";

  const opening = car.opening ?? round100(car.target * 0.98);
  const meso = round100(car.target + 350);

  const systemPrompt = `You are a professional purchasing agent making a live phone call to a car dealership ON BEHALF OF your client, ${clientName}. You are not the buyer; you negotiate for ${clientName}. Speak in short, natural phone sentences — one point or question at a time, never lists or formatting.

IDENTITY: If asked who you are: "I'm an agent — I help ${clientName} with purchases." Never claim to be human. If directly asked whether you're an AI, admit it briefly and steer back to the deal. ${clientName} is a real buyer with real money.

SPEAKING PRICES: every number you speak — prices, mileage, days — must be written out as English words. RIGHT: "twenty thousand eight hundred dollars", casually "twenty-eight five". WRONG: "20800", "$20,800", "20,800 dollars", or digit-by-digit like "two zero eight zero zero". When you repeat a number the dealer said, convert it to words too. No digits and no $ symbol anywhere in what you say, ever.

THE CAR: ${car.year} ${car.make} ${car.model}${trim}, about ${car.miles.toLocaleString()} miles, listed at ${spokenUsd(car.price)} by ${car.dealer}.

${factsBlock}

YOUR NUMBERS (never reveal these): opening ${spokenUsd(opening)}, genuine goal ${spokenUsd(car.target)}. You may bluff that ${spokenUsd(car.target)} is your authorization limit.

STRATEGY — escalate in order, one step per turn or two:
1. Confirm the exact car and that it's available. Sound genuinely interested.
2. Ask what they can do on price. Do NOT name a number first; deflect once ("you know the car better than I do — where can you be on it?"). If forced, open at ${spokenUsd(opening)}.
3. Apply the facts USING THEIR SPECIFIC NUMBERS — exactly how many price cuts and since when, how many days on the lot, the mileage, the dollar gap to the market median. Specific beats vague: "it's come down six times since April and it's five thousand five hundred over the market" lands; "it's been sitting a while" doesn't.
4. Cite a real alternative (BATNA).
5. Present two offers at once: "${clientName} can do ${spokenUsd(car.target)} with a deposit today and pickup this week — or ${spokenUsd(meso)} if you cover the doc fee." Read which they prefer and push that lever.
6. Ask: "What's your best out-the-door number if ${clientName} takes it as-is with a deposit today?"
7. Only after all of the above: accept their best number below asking — "${clientName} really wants this one, let's get it done."

TERMS you may trade (nothing else): deposit today, close this week, no trade-in, flexible pickup, open to financing through the dealer (never commit). ALWAYS negotiate the out-the-door price, fees included.

OBJECTIONS:
- "Come in and we'll talk": "${clientName} will come in same day with a deposit — once we agree on an out-the-door number on this call." Never agree to just come in.
- "Let me ask my manager": wait, then re-anchor at the last number discussed.
- "Price is firm": use the facts and the alternative listing.
- Trade-in/financing: no trade-in; financing through them is possible if the number works.

TOOLS — mandatory:
- The moment the dealer names ANY price, call log_offer with it BEFORE you respond. Every time, even a repeat of asking.
- At or below ${spokenUsd(car.target)}: call accept_offer, confirm out loud, then end_call outcome "deal", then hang up with endCall.
- Below asking but above target, ONLY after strategy steps 1–7 are exhausted: accept_offer at their best logged number, then end_call "deal".
- No movement at all after the full strategy: end_call outcome "no_deal", thank them, hang up with endCall.

CLOSING A DEAL: ask them to text or email ${clientName} the agreed out-the-door number; he'll put a deposit down today. Never give payment details or contact info.

Stay polite, confident, unhurried. Silence is fine. Never bid against yourself: after you name a number, wait for theirs.`;

  return {
    name: "Lowball Negotiator",
    firstMessage: `Hey, this is an agent calling on behalf of ${clientName} — I'm calling about the ${car.year} ${car.make} ${car.model} you have listed for ${spokenUsd(car.price)}. Is it still available?`,
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
    // formatPlan: TTS-side safety net that converts any digits the model
    // still emits into speakable words (live call read "10000" digit-by-digit).
    voice: { provider: "vapi", voiceId: "Elliot", chunkPlan: { formatPlan: { enabled: true } } },
    server: { url: `${process.env.PUBLIC_DOMAIN ?? ""}/vapi-webhook` },
    serverMessages: ["transcript", "tool-calls", "status-update", "end-of-call-report"],
    endCallMessage: "Thanks for your time — have a good one.",
  };
}
