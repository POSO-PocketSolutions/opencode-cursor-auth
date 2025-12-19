import { loginLocal } from "./local.js";
import { loginAgent } from "./agent.js";
export async function getCursorAuth() {
    // 1. Try Local DB (IDE)
    const localResult = await loginLocal();
    if (localResult.type === "success") {
        return localResult;
    }
    // 2. Try Agent Config
    const agentResult = await loginAgent();
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
//# sourceMappingURL=auth.js.map