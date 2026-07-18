import { VapiClient } from "@vapi-ai/server-sdk";
import { buildAssistant } from "./assistant.js";
import { broadcast } from "./dashboard.js";
import { defaultTarget, type Car } from "./types.js";

export async function startNegotiation(car: Car, dealerPhone?: string) {
  const token = process.env.VAPI_API_KEY;
  const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;
  if (!token) throw new Error("VAPI_API_KEY is not set in server/.env");
  if (!phoneNumberId) throw new Error("VAPI_PHONE_NUMBER_ID is not set in server/.env");
  if (!process.env.PUBLIC_DOMAIN) throw new Error("PUBLIC_DOMAIN is not set (ngrok URL for webhooks)");

  const number = dealerPhone ?? car.phone;
  if (!number) throw new Error("No dealer phone number provided");
  if (!car.target) car.target = defaultTarget(car.price);

  const vapi = new VapiClient({ token });
  const call = (await vapi.calls.create({
    phoneNumberId,
    customer: { number },
    assistant: buildAssistant(car) as never,
  })) as { id?: string };

  broadcast({ type: "call-started", callId: call.id, car });
  return { callId: call.id, car };
}
