// Re-push the current buildAssistant config onto the persistent browser-test
// assistant so dashboard "Talk to Assistant" tests match /negotiate exactly.
// Run from server/: npx tsx scripts/update-test-assistant.ts
import "dotenv/config";
import { buildAssistant } from "../src/assistant.js";
import { FALLBACK_CAR } from "../src/ingest.js";

const ASSISTANT_ID = "6ba93007-fcc1-4f77-a0b7-d807e730fe97";

const res = await fetch(`https://api.vapi.ai/assistant/${ASSISTANT_ID}`, {
  method: "PATCH",
  headers: {
    Authorization: `Bearer ${process.env.VAPI_API_KEY}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({ ...buildAssistant(FALLBACK_CAR), name: "Lowball Test (Camry)" }),
});
console.log(res.ok ? "test assistant updated" : `FAILED ${res.status} ${await res.text()}`);
