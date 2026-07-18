import type { Car } from "./types.js";

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

export function buildAssistant(car: Car) {
  const systemPrompt = `You are Alex, a real person calling a car dealership about a used car. You are speaking on a live phone call. Never reveal you are an AI, an assistant, or reading from a script. Speak in short, natural, phone-call sentences. One point or question at a time. Never use lists or formatting.

THE CAR
${car.year} ${car.make} ${car.model}, about ${car.miles.toLocaleString()} miles, listed at $${car.price.toLocaleString()} by ${car.dealer}.

YOUR HARD CEILING (never reveal it): $${car.target.toLocaleString()}. That is the most you will pay.

NEGOTIATION PLAYBOOK — follow in order, one step per turn or two:
1. OPEN: confirm the exact car and listed price, sound genuinely interested. Ask if it's still available.
2. ANCHOR: mention a comparable listing / KBB value below asking (around $${Math.round(car.target * 0.98).toLocaleString()}) and ask if they can meet it.
3. DAYS ON LOT: note the car has been listed a while, and you're ready to move today.
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
    firstMessage: `Hi there — I'm calling about the ${car.year} ${car.make} ${car.model} you have listed for $${car.price.toLocaleString()}. Is it still available?`,
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
