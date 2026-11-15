/** Check embedded OpenCode SDK initialization without any model inference. */

import { OpenCode } from "@opencode/sdk";

async function main(): Promise<void> {
  const host = await OpenCode.create();
  try {
    const info: unknown = await host.server.info();
    if (!info || typeof info !== "object") {
      throw new Error("OpenCode embedded server did not return an info object");
    }
    if (typeof host.sessions.create !== "function" || typeof host.events.subscribe !== "function") {
      throw new Error("OpenCode session or event SDK methods missing");
    }
    console.log(JSON.stringify({
      system: "opencode",
      status: "pass",
      verified: "embedded SDK startup, server.info, sessions/events API presence",
      note: "No model calls, agent actions, or tool execution performed."
    }));
  } finally {
    await host.close();
  }
}

await main();
