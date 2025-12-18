import { LocalAuthStrategy } from "./local.js";
import { AgentAuthStrategy } from "./agent.js";
import type { CursorAuthResult } from "./types.js";

export async function getCursorAuth(): Promise<CursorAuthResult> {
  // 1. Try Local DB (IDE)
  const localStrategy = new LocalAuthStrategy();
  const localResult = await localStrategy.login();
  if (localResult.type === "success") {
    return localResult;
  }

  // 2. Try Agent Config
  const agentStrategy = new AgentAuthStrategy();
  const agentResult = await agentStrategy.login();
  if (agentResult.type === "success") {
    return agentResult;
  }

  return {
    type: "failed",
    error: `No authentication found. 
    Checked Local DB: ${localResult.error}
    Checked Agent Config: ${agentResult.error}`
  };
}
